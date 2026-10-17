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
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || process.env.APP_URL || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
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
app.use((req, res) => res.status(404).type('text').send('Page not found.'));

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

function startupChecks() {
  store.get();
  fs.mkdirSync(require('./routes/public').UPLOADS, { recursive: true });
  const warn = [];
  if (U.SECRET_SOURCE() === 'memory') warn.push('The login secret could not be saved, so everyone will be logged out on every restart. Make sure the data folder is writable.');
  const admin = store.get().users.find((u) => u.id === 'u_admin1');
  if (admin && bcrypt.compareSync('Admin1234', admin.passwordHash)) warn.push('The administrator is still using the default password (Admin1234). Log in and change it now.');
  if (store.get().users.some((u) => u.role === 'staff' && bcrypt.compareSync('Staff1234', u.passwordHash))) warn.push('A staff account still uses the default password (Staff1234). Change it in User Management.');
  warn.forEach((w) => console.warn('WARNING: ' + w));
}

app.listen(PORT, () => {
  startupChecks();
  console.log(`TCC Clinic running at http://localhost:${PORT}${U.IS_PROD ? ' (production)' : ''}`);
});
