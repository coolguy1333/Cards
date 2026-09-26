const path = require('path');
const crypto = require('crypto');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file — use real env vars */ }

const express = require('express');
const cookieSession = require('cookie-session');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = `${BASE_URL}/auth/google/callback`;
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const DEV_LOGIN = process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set — using a random one (everyone is signed out on restart).');
}
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google sign-in is disabled.');
}

const oauth = GOOGLE_CLIENT_ID
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI)
  : null;

const app = express();
app.set('trust proxy', 1); // correct protocol/IP behind nginx, Caddy, Cloudflare Tunnel, etc.
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(cookieSession({
  name: 'classcards_session',
  secret: SESSION_SECRET,
  httpOnly: true,
  sameSite: 'lax',
  secure: BASE_URL.startsWith('https://'),
  maxAge: 30 * 24 * 60 * 60 * 1000,
}));

// ---------- helpers ----------
const getUser = req => req.session?.userId
  ? db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(req.session.userId)
  : null;

function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to do that.' });
  req.user = user;
  next();
}

function upsertUser({ sub, email, name, picture }) {
  db.prepare(`
    INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)
    ON CONFLICT(google_id) DO UPDATE SET
      email = excluded.email, name = excluded.name, picture = excluded.picture,
      last_login = datetime('now')
  `).run(sub, email, name || email, picture || null);
  return db.prepare('SELECT id FROM users WHERE google_id = ?').get(sub).id;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TYPES = ['text', 'long', 'number', 'date'];
const PLACES = ['front', 'sub', 'meta', 'back'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

const layoutFor = (id, userId) => db.prepare(
  'SELECT * FROM layouts WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)').get(id, userId ?? -1);
const classFor = (id, userId) => db.prepare(
  'SELECT * FROM classes WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)').get(id, userId ?? -1);
const classLayoutFields = classId => JSON.parse(db.prepare(
  'SELECT l.fields FROM classes c JOIN layouts l ON l.id = c.layout_id WHERE c.id = ?').get(classId).fields);

const layoutOut = l => ({ id: l.id, name: l.name, fields: JSON.parse(l.fields), builtin: l.owner_id == null });
const classOut = (c, userId) => ({
  id: c.id, name: c.name, color: c.color, layoutId: c.layout_id, builtin: c.owner_id == null,
  cardCount: db.prepare('SELECT COUNT(*) AS n FROM cards WHERE class_id = ? AND (owner_id IS NULL OR owner_id = ?)')
    .get(c.id, userId ?? -1).n,
});
const cardOut = (c, userId) => ({
  id: c.id, classId: c.class_id, fields: JSON.parse(c.fields), isHtml: !!c.is_html,
  mine: c.owner_id != null && c.owner_id === userId, builtin: c.owner_id == null,
});

// A layout is a list of fields. Existing field keys are kept on edit so saved cards keep their data.
function cleanLayout(b, oldFields = []) {
  const name = str(b.name, 60);
  if (!name) return { error: 'Layout name is required.' };
  if (!Array.isArray(b.fields) || b.fields.length < 1 || b.fields.length > 12) return { error: 'A layout needs 1–12 fields.' };
  const oldKeys = new Set(oldFields.map(f => f.key));
  const used = new Set();
  const fields = [];
  for (const f of b.fields) {
    const label = str(f?.label, 40);
    if (!label) return { error: 'Every field needs a name.' };
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const place = PLACES.includes(f.place) ? f.place : 'back';
    let key = typeof f.key === 'string' && oldKeys.has(f.key) && !used.has(f.key) ? f.key : null;
    while (!key || used.has(key)) key = 'f' + crypto.randomBytes(4).toString('hex');
    used.add(key);
    const out = { key, label, type, place };
    if (f.group && (type === 'number' || type === 'text')) out.group = true;
    const old = oldFields.find(o => o.key === key);
    if (old?.names) out.names = old.names;
    fields.push(out);
  }
  if (!fields.some(f => f.place === 'front')) return { error: 'At least one field has to go on the front.' };
  if (fields.filter(f => f.group).length > 3) return { error: 'Up to 3 fields can be used for sections.' };
  return { layout: { name, fields } };
}

function cleanCardFields(input, layoutFields) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of layoutFields) {
    const v = src[f.key];
    if (f.type === 'number') {
      if (v === '' || v == null) { out[f.key] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 99999) return { error: `${f.label} must be a whole number.` };
      out[f.key] = n;
    } else {
      out[f.key] = str(v, f.type === 'long' ? 4000 : 200);
    }
  }
  const first = layoutFields.find(f => f.place === 'front');
  if (out[first.key] == null || out[first.key] === '') return { error: `${first.label} is required.` };
  return { fields: out };
}

// ---------- auth ----------
app.get('/auth/google', (req, res) => {
  if (!oauth) return res.status(503).send('Google sign-in is not configured on this server.');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' }));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = req.session.oauthState;
  req.session.oauthState = null;
  if (error) return res.redirect('/?login=cancelled');
  if (!oauth || !code || !state || state !== expected) return res.status(400).send('Invalid sign-in request. <a href="/">Go back</a>');
  try {
    const { tokens } = await oauth.getToken(String(code));
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(403).send('Your Google email is not verified.');
    if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(p.email.toLowerCase())) {
      return res.status(403).send('This account is not allowed on this server. <a href="/">Go back</a>');
    }
    req.session.userId = upsertUser(p);
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback failed:', e.message);
    res.status(500).send('Sign-in failed. <a href="/">Try again</a>');
  }
});

if (DEV_LOGIN) {
  console.warn('DEV_LOGIN enabled — /auth/dev signs in a local test user. Never use in production.');
  app.get('/auth/dev', (req, res) => {
    req.session.userId = upsertUser({ sub: 'dev-user', email: 'dev@localhost', name: 'Dev User' });
    res.redirect('/');
  });
}

app.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// ---------- API ----------
app.get('/api/me', (req, res) => {
  res.json({ user: getUser(req), googleEnabled: !!oauth, devLogin: DEV_LOGIN });
});

// --- layouts ---
app.get('/api/layouts', (req, res) => {
  const user = getUser(req);
  res.json(db.prepare('SELECT * FROM layouts WHERE owner_id IS NULL OR owner_id = ? ORDER BY (owner_id IS NOT NULL), id')
    .all(user?.id ?? -1).map(layoutOut));
});

app.post('/api/layouts', requireUser, (req, res) => {
  const { layout, error } = cleanLayout(req.body || {});
  if (error) return res.status(400).json({ error });
  const n = db.prepare('SELECT COUNT(*) AS n FROM layouts WHERE owner_id = ?').get(req.user.id).n;
  if (n >= 100) return res.status(400).json({ error: 'Layout limit reached (100).' });
  const id = db.prepare('INSERT INTO layouts (owner_id, name, fields) VALUES (?, ?, ?)')
    .run(req.user.id, layout.name, JSON.stringify(layout.fields)).lastInsertRowid;
  res.status(201).json(layoutOut(db.prepare('SELECT * FROM layouts WHERE id = ?').get(id)));
});

app.put('/api/layouts/:id', requireUser, (req, res) => {
  const old = db.prepare('SELECT * FROM layouts WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
  if (!old) return res.status(404).json({ error: 'Layout not found. Built-in layouts can’t be edited; duplicate one instead.' });
  const { layout, error } = cleanLayout(req.body || {}, JSON.parse(old.fields));
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE layouts SET name = ?, fields = ? WHERE id = ?').run(layout.name, JSON.stringify(layout.fields), old.id);
  res.json(layoutOut(db.prepare('SELECT * FROM layouts WHERE id = ?').get(old.id)));
});

app.delete('/api/layouts/:id', requireUser, (req, res) => {
  const id = Number(req.params.id);
  const own = db.prepare('SELECT 1 FROM layouts WHERE id = ? AND owner_id = ?').get(id, req.user.id);
  if (!own) return res.status(404).json({ error: 'Layout not found.' });
  const inUse = db.prepare('SELECT name FROM classes WHERE layout_id = ?').all(id);
  if (inUse.length) return res.status(400).json({ error: `Used by: ${inUse.map(c => c.name).join(', ')}. Change or delete those classes first.` });
  db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- classes ---
app.get('/api/classes', (req, res) => {
  const user = getUser(req);
  res.json(db.prepare('SELECT * FROM classes WHERE owner_id IS NULL OR owner_id = ? ORDER BY (owner_id IS NOT NULL), name COLLATE NOCASE')
    .all(user?.id ?? -1).map(c => classOut(c, user?.id)));
});

function cleanClass(b, userId) {
  const name = str(b.name, 60);
  if (!name) return { error: 'Class name is required.' };
  const color = COLOR_RE.test(b.color || '') ? b.color.toLowerCase() : '#2962ff';
  const layout = layoutFor(Number(b.layoutId), userId);
  if (!layout) return { error: 'Pick a layout.' };
  return { cls: { name, color, layoutId: layout.id } };
}

app.post('/api/classes', requireUser, (req, res) => {
  const { cls, error } = cleanClass(req.body || {}, req.user.id);
  if (error) return res.status(400).json({ error });
  const n = db.prepare('SELECT COUNT(*) AS n FROM classes WHERE owner_id = ?').get(req.user.id).n;
  if (n >= 100) return res.status(400).json({ error: 'Class limit reached (100).' });
  const id = db.prepare('INSERT INTO classes (owner_id, name, color, layout_id) VALUES (?, ?, ?, ?)')
    .run(req.user.id, cls.name, cls.color, cls.layoutId).lastInsertRowid;
  res.status(201).json(classOut(db.prepare('SELECT * FROM classes WHERE id = ?').get(id), req.user.id));
});

app.put('/api/classes/:id', requireUser, (req, res) => {
  const old = db.prepare('SELECT * FROM classes WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
  if (!old) return res.status(404).json({ error: 'Class not found. Built-in classes can’t be edited.' });
  const { cls, error } = cleanClass(req.body || {}, req.user.id);
  if (error) return res.status(400).json({ error });
  if (cls.layoutId !== old.layout_id && db.prepare('SELECT 1 FROM cards WHERE class_id = ?').get(old.id)) {
    return res.status(400).json({ error: 'You can’t switch the layout of a class that already has cards.' });
  }
  db.prepare('UPDATE classes SET name = ?, color = ?, layout_id = ? WHERE id = ?').run(cls.name, cls.color, cls.layoutId, old.id);
  res.json(classOut(db.prepare('SELECT * FROM classes WHERE id = ?').get(old.id), req.user.id));
});

app.delete('/api/classes/:id', requireUser, (req, res) => {
  const info = db.prepare('DELETE FROM classes WHERE id = ? AND owner_id = ?').run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Class not found.' });
  res.json({ ok: true });
});

// --- cards ---
app.get('/api/classes/:id/cards', (req, res) => {
  const user = getUser(req);
  const cls = classFor(Number(req.params.id), user?.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  res.json(db.prepare('SELECT * FROM cards WHERE class_id = ? AND (owner_id IS NULL OR owner_id = ?) ORDER BY id')
    .all(cls.id, user?.id ?? -1).map(c => cardOut(c, user?.id)));
});

app.post('/api/classes/:id/cards', requireUser, (req, res) => {
  const cls = classFor(Number(req.params.id), req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  const { fields, error } = cleanCardFields(req.body?.fields, classLayoutFields(cls.id));
  if (error) return res.status(400).json({ error });
  const n = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id = ?').get(req.user.id).n;
  if (n >= 20000) return res.status(400).json({ error: 'Card limit reached.' });
  const id = db.prepare('INSERT INTO cards (class_id, owner_id, fields, is_html) VALUES (?, ?, ?, 0)')
    .run(cls.id, req.user.id, JSON.stringify(fields)).lastInsertRowid;
  res.status(201).json(cardOut(db.prepare('SELECT * FROM cards WHERE id = ?').get(id), req.user.id));
});

app.put('/api/cards/:id', requireUser, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  const { fields, error } = cleanCardFields(req.body?.fields, classLayoutFields(card.class_id));
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE cards SET fields = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(fields), card.id);
  res.json(cardOut(db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id), req.user.id));
});

app.delete('/api/cards/:id', requireUser, (req, res) => {
  const info = db.prepare('DELETE FROM cards WHERE id = ? AND owner_id = ?').run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Card not found.' });
  res.json({ ok: true });
});

// Export everything you made (backup / move to another server).
app.get('/api/export', requireUser, (req, res) => {
  const uid = req.user.id;
  const layouts = db.prepare('SELECT * FROM layouts WHERE owner_id = ?').all(uid).map(layoutOut);
  const classes = db.prepare(`
    SELECT c.*, l.name AS layout_name FROM classes c JOIN layouts l ON l.id = c.layout_id
    WHERE c.owner_id = ? OR c.id IN (SELECT class_id FROM cards WHERE owner_id = ?)`).all(uid, uid)
    .map(c => ({
      name: c.name, color: c.color, layout: c.layout_name, builtin: c.owner_id == null,
      cards: db.prepare('SELECT fields FROM cards WHERE class_id = ? AND owner_id = ? ORDER BY id')
        .all(c.id, uid).map(r => JSON.parse(r.fields)),
    }));
  res.setHeader('Content-Disposition', 'attachment; filename="classcards-export.json"');
  res.json({ exportedAt: new Date().toISOString(), layouts, classes });
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, HOST, () => console.log(`ClassCards running on ${BASE_URL} (${HOST}:${PORT})`));

process.on('SIGTERM', () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 8000).unref();
});
