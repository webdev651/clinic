require('dotenv').config(); // loads backend/.env (if present) before anything reads process.env
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('./db');
const U = require('./lib/util');

const PORT = process.env.PORT || 8000;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind a host's HTTPS proxy (Render, Railway, Fly, nginx...) so req.ip and rate limits are per visitor

// Security headers: no framing, no MIME sniffing, no referrer leakage, locked-down script sources.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (U.IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
});
// CORS for split hosting (frontend on Netlify, API on Render). Allowed sites: CORS_ORIGIN (comma-separated), else APP_URL.
// Login uses a Bearer token (no cookies), so only these origins need to be listed.
const DEFAULT_ORIGINS = ['https://tcc-clinic-system.netlify.app']; // the published website is always allowed, even if the variables below are not set
const ALLOWED_ORIGINS = [...DEFAULT_ORIGINS, ...(process.env.CORS_ORIGIN || process.env.APP_URL || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)];
app.use('/api', (req, res, next) => {
  const origin = (req.headers.origin || '').replace(/\/+$/, '');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '4mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true })); // for the host's uptime / health check
app.use('/api/auth', require('./routes/auth'));
app.use('/api/student', require('./routes/student'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/public', require('./routes/public'));
app.use('/api', (req, res) => U.fail(res, 404, 'Not found.'));
app.use((err, req, res, next) => { // bad JSON, oversized body, anything unexpected
  if (err.type === 'entity.too.large') return U.fail(res, 413, 'That upload is too large.');
  if (err.type === 'entity.parse.failed') return U.fail(res, 400, 'Malformed request.');
  console.error(err);
  if (req.path.startsWith('/api')) return U.fail(res, 500, 'Something went wrong on the server.');
  res.status(500).type('text').send('Something went wrong on the server.');
});

// Static site. HTML/JS/CSS are always revalidated so a new deploy shows up immediately; images/icons are cached for a day.
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders(res, file) { res.setHeader('Cache-Control', /\.(png|svg|ico|jpg|jpeg|webp)$/i.test(file) ? 'public, max-age=86400' : 'no-cache'); },
}));
// API-only hosting (frontend lives on Netlify): the root address has no page, so send visitors to the site or say the API is running.
const HAS_FRONTEND = fs.existsSync(path.join(__dirname, '..', 'frontend', 'index.html'));
app.get('/', (req, res, next) => {
  if (HAS_FRONTEND) return next();
  const site = (process.env.APP_URL || '').trim();
  if (/^https?:\/\//.test(site)) return res.redirect(site);
  res.type('text').send('TCC Clinic API is running. Open the clinic website to log in.');
});
app.use((req, res) => res.status(404).type('text').send('Page not found.'));

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

function startupChecks() {
  store.get();
  const warn = [];
  if (!store.USE_MYSQL) warn.push('DB_HOST is not set, so data is stored in the local db.json file (it is lost on Render free redeploys). Set the DB_* variables to use MySQL.');
  // Optional: create the first administrator from environment variables (only if that email does not exist yet).
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const em = ADMIN_EMAIL.trim().toLowerCase();
    if (!store.get().users.some((u) => (u.email || '').toLowerCase() === em)) {
      store.get().users.push({ id: store.newId('u_'), role: 'admin', name: ADMIN_NAME || 'Clinic Administrator', studentId: '', email: em, passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10), status: 'active', photo: '', createdAt: new Date().toISOString() });
      store.log('System', 'Added user', `${em} (admin, from environment)`);
      store.persist();
    }
  }
  if (!store.get().users.some((u) => u.role === 'admin' && u.status === 'active')) warn.push('There is no administrator account, so nobody can log in to the staff portal. Run: npm run seed:admin -- "Full Name" email "password"  (or set ADMIN_EMAIL, ADMIN_PASSWORD and optionally ADMIN_NAME).');
  if (store.get().users.some((u) => u.role !== 'student' && ['Admin1234', 'Staff1234'].some((p) => bcrypt.compareSync(p, u.passwordHash)))) warn.push('A staff/admin account still uses a default demo password. Run: npm run remove-demo  (or change it in User Management).');
  warn.forEach((w) => console.warn('WARNING: ' + w));
}

store.init().then(() => {
  app.listen(PORT, () => {
    startupChecks();
    console.log(`TCC Clinic running on port ${PORT}${U.IS_PROD ? ' (production)' : ''}`);
  });
}).catch((e) => { console.error('Could not start the database:', e.message); process.exit(1); });

const shutdown = async () => { try { await store.flush(); } catch (e) { console.error('Final save failed:', e.message); } process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
