// Dobles en memoria de Firestore / Auth / Stripe para pruebas locales.
// No tocan producción: nunca se conectan a Firebase ni a Stripe.

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

class FakeDB {
  constructor() { this.data = new Map(); this.autoId = 0; }
  _get(path) { return this.data.get(path); }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(fn) {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, val, opts) => ref.set(val, opts)
    };
    return fn(tx);
  }
  dump(prefix) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ path: k, ...v }));
  }
}

class FakeSnap {
  constructor(id, data, ref) { this.id = id; this._d = data; this.ref = ref; }
  get exists() { return this._d !== undefined; }
  data() { return clone(this._d); }
}

class FakeDoc {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() { return new FakeSnap(this.id, clone(this.db._get(this.path)), this); }
  async set(val, opts) {
    const prev = this.db._get(this.path);
    this.db.data.set(this.path, opts && opts.merge && prev ? { ...prev, ...clone(val) } : clone(val));
  }
  async update(val) {
    const prev = this.db._get(this.path);
    if (!prev) { const e = new Error('NOT_FOUND'); e.code = 5; throw e; }
    const next = { ...prev };
    for (const [k, v] of Object.entries(val)) {
      if (v && v.__increment !== undefined) next[k] = (Number(prev[k]) || 0) + v.__increment;
      else next[k] = clone(v);
    }
    this.db.data.set(this.path, next);
  }
  async create(val) {
    if (this.db._get(this.path)) { const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; }
    this.db.data.set(this.path, clone(val));
  }
  async delete() { this.db.data.delete(this.path); }
}

class FakeQuery {
  constructor(db, path, filters = [], lim = null, order = null) { Object.assign(this, { db, path, filters, lim, order }); }
  where(f, op, v) { return new FakeQuery(this.db, this.path, [...this.filters, [f, op, v]], this.lim, this.order); }
  limit(n) { return new FakeQuery(this.db, this.path, this.filters, n, this.order); }
  orderBy(f, dir) { return new FakeQuery(this.db, this.path, this.filters, this.lim, [f, dir]); }
  async get() {
    const depth = this.path.split('/').length + 1;
    let docs = [...this.db.data.entries()]
      .filter(([k]) => k.startsWith(this.path + '/') && k.split('/').length === depth)
      .filter(([, v]) => this.filters.every(([f, op, val]) => {
        if (op === '>=') return v[f] >= val;
        if (op === 'array-contains-any') return Array.isArray(v[f]) && val.some(term => v[f].includes(term));
        return v[f] === val;
      }))
      .map(([k, v]) => new FakeSnap(k.split('/').pop(), clone(v), new FakeDoc(this.db, k)));
    if (this.order) {
      const [f, dir] = this.order;
      docs.sort((a, b) => String(a._d[f]).localeCompare(String(b._d[f])) * (dir === 'desc' ? -1 : 1));
    }
    if (this.lim) docs = docs.slice(0, this.lim);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollection extends FakeQuery {
  constructor(db, path) { super(db, path); }
  doc(id) { return new FakeDoc(this.db, `${this.path}/${id || 'auto' + (++this.db.autoId)}`); }
  async add(val) { const d = this.doc(); await d.set(val); return d; }
}

function fakeAuth(users = {}) {
  // users: { token: { uid, email, email_verified } }
  return {
    users,
    async verifyIdToken(t) { if (!users[t]) throw new Error('bad token'); return users[t]; },
    async getUserByEmail(email) {
      const u = Object.values(users).find(x => x.email === email);
      if (!u) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; }
      return { uid: u.uid, email: u.email, emailVerified: u.email_verified, providerData: [{ providerId: 'google.com' }] };
    },
    async createUser({ email, emailVerified, displayName }) {
      const uid = 'nuevo-' + email.replace(/[^a-z0-9]/g, '');
      users['tok-' + uid] = { uid, email, email_verified: emailVerified === true, name: displayName || '' };
      return { uid, email, emailVerified: emailVerified === true };
    },
    async createCustomToken(uid) { return 'custom-' + uid; }
  };
}

function fakeStripe(sessions = {}) {
  const checkoutCreados = [], clientesCreados = [];
  return {
    checkoutCreados,
    clientesCreados,
    customers: {
      async create(datos) {
        clientesCreados.push(datos);
        return { id: 'cus_test_promo_' + clientesCreados.length };
      }
    },
    checkout: { sessions: {
      async retrieve(id) {
        if (!sessions[id]) { const e = new Error('No such session'); e.type = 'StripeInvalidRequestError'; throw e; }
        return sessions[id];
      },
      async create(datos) {
        checkoutCreados.push(datos);
        return { id: 'cs_test_new', client_secret: 'secret' };
      }
    } },
    webhooks: { constructEvent(body) { return JSON.parse(Buffer.isBuffer(body) ? body.toString() : body); } },
    subscriptions: {}
  };
}

const fakeAdmin = (db) => ({
  storage: () => ({ bucket: () => ({ file: (p) => ({ getSignedUrl: async () => [`https://signed.example/${p}?sig=1`], save: async (buf, opts) => { (fakeAdmin._guardados = fakeAdmin._guardados || []).push({ path: p, bytes: buf.length, contentType: opts && opts.contentType }); } }) }) }),
  firestore: Object.assign(() => db, { FieldValue: { increment: (n) => ({ __increment: n }) }, Timestamp: { fromMillis: (ms) => ({ seconds: ms / 1000 }) } })
});

module.exports = { FakeDB, fakeAuth, fakeStripe, fakeAdmin };
