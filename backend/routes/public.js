const express = require('express');
const store = require('../db');
const U = require('../lib/util');
const path = require('path');

const router = express.Router();
const { fail } = U;

router.get('/info', (req, res) => {
  const db = store.get();
  res.json({ clinic: db.settings.clinic, allowRegistration: db.settings.general.allowRegistration,
    announcements: db.announcements.filter((a) => a.status === 'published').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) });
});

router.post('/contact', U.limiter({ max: 5, windowMs: 3600e3, message: 'You have sent several messages already. Please try again later.' }), (req, res) => {
  const v = U.validate(req.body, { name: { label: 'Name', required: true, maxLen: 80 }, email: { label: 'Email', required: true, email: true }, subject: { label: 'Subject', required: true, maxLen: 120 }, message: { label: 'Message', required: true, maxLen: 1500 } });
  if (v.error) return fail(res, 400, v.error);
  store.get().messages.unshift({ id: store.newId('ms'), ...v.data, at: new Date().toISOString() });
  store.notify('staff', 'New contact message', `${v.data.name}: ${v.data.subject}`, '#messages');
  store.log(v.data.name, 'Sent contact message', v.data.subject); store.save();
  res.status(201).json({ ok: true });
});

// Health documents: only the owning student or clinic staff may download.
router.get('/files/:id', U.requireAuth(), async (req, res) => {
  const doc = store.get().documents.find((d) => d.id === req.params.id);
  if (!doc || !doc.file) return fail(res, 404, 'File not found.');
  if (req.user.role === 'student' && doc.userId !== req.user.id) return fail(res, 403, 'You do not have access to this.');
  let buf = null;
  try { buf = await store.getFile(path.basename(doc.file)); } catch (e) { console.error(e); return fail(res, 500, 'Something went wrong on the server.'); }
  if (!buf) return fail(res, 404, 'File not found.');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName || 'document')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
});

module.exports = router;
