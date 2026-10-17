// Gmail sender (server side). Uses nodemailer over Gmail SMTP with an App Password.
//
// Env vars:
//   GMAIL_USER          the Gmail address that sends the mail, e.g. tcclinic@gmail.com
//   GMAIL_APP_PASSWORD  a 16-character Google "App password" (NOT your normal password)
//   MAIL_FROM_NAME      optional display name (default "TCC Clinic")
//   APP_URL             public site address used in email links, e.g. https://your-site.onrender.com
//   MAIL_DRY_RUN=1      print emails to the console instead of sending (for testing)
//
// EmailJS (HTTPS, works on hosts that block SMTP). If these are set, EmailJS is used instead of Gmail SMTP:
//   EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
//   EMAILJS_RESET_TEMPLATE_ID   template using {{to_email}} {{name}} {{code}}   (password reset code; {{subject}} and {{message}} are also sent)
//   EMAILJS_TEMPLATE_ID         template using {{to_email}} {{subject}} {{message}} (appointment updates etc.; optional)
//
// Sending never throws and never blocks a request: failures are logged and the app carries on.
const nodemailer = require('nodemailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dryRun = () => process.env.MAIL_DRY_RUN === '1';
const emailjsOn = () => !!(process.env.EMAILJS_SERVICE_ID && process.env.EMAILJS_PUBLIC_KEY && process.env.EMAILJS_PRIVATE_KEY && (process.env.EMAILJS_RESET_TEMPLATE_ID || process.env.EMAILJS_TEMPLATE_ID));
const gmailOn = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const isConfigured = () => dryRun() || emailjsOn() || gmailOn();

async function sendViaEmailJS(opts) {
  const reset = opts.reset && process.env.EMAILJS_RESET_TEMPLATE_ID;
  const template = reset ? process.env.EMAILJS_RESET_TEMPLATE_ID : process.env.EMAILJS_TEMPLATE_ID;
  if (!template) return { ok: false, error: 'No EmailJS template set for this kind of email.' };
  const params = reset
    ? { to_email: opts.to, name: opts.reset.name, code: opts.reset.code || '', link: opts.reset.link || opts.reset.code || '', subject: opts.subject, message: (opts.lines || []).join('\n\n') }
    : { to_email: opts.to, subject: opts.subject, message: [...(opts.lines || []), opts.button ? `${opts.button.label}: ${opts.button.url}` : ''].filter(Boolean).join('\n\n') };
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ service_id: process.env.EMAILJS_SERVICE_ID, template_id: template, user_id: process.env.EMAILJS_PUBLIC_KEY, accessToken: process.env.EMAILJS_PRIVATE_KEY, template_params: params }),
  });
  if (!r.ok) throw new Error(`EmailJS ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { ok: true };
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  return transport;
}

// Simple branded wrapper. `lines` are plain strings (escaped here); `button` is { label, url } or null.
function layout({ title, lines = [], button = null }) {
  const body = lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join('');
  const btn = button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(button.label)}</a></p><p style="font-size:12px;color:#666;word-break:break-all">${esc(button.url)}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222"><h2 style="color:#0f766e;margin:0 0 16px">${esc(title)}</h2>${body}${btn}<hr style="border:none;border-top:1px solid #eee;margin:24px 0 8px"><p style="font-size:12px;color:#888">TCC Clinic · Talisay City College. This is an automated message.</p></div>`;
  const text = [title, '', ...lines, button ? `\n${button.label}: ${button.url}` : ''].join('\n');
  return { html, text };
}

/** send({ to, subject, title?, lines?, button?, html?, text? }) -> { ok, error? } (never throws) */
async function send(opts) {
  try {
    const to = String(opts.to || '').trim();
    if (!to || !opts.subject) return { ok: false, error: 'Missing recipient or subject.' };
    if (!isConfigured()) return { ok: false, error: 'Email is not configured.' };
    const built = opts.html ? { html: opts.html, text: opts.text || '' } : layout({ title: opts.title || opts.subject, lines: opts.lines, button: opts.button });
    if (dryRun()) { console.log(`[mail:dry-run] to=${to} subject="${opts.subject}"\n${built.text}\n`); return { ok: true, dryRun: true }; }
    if (emailjsOn()) return await sendViaEmailJS(opts);
    if (!gmailOn()) return { ok: false, error: 'Email is not configured.' };
    await getTransport().sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'TCC Clinic'}" <${process.env.GMAIL_USER}>`,
      to, subject: opts.subject, text: built.text, html: built.html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail] send failed:', e && e.message ? e.message : e);
    return { ok: false, error: 'Email could not be sent.' };
  }
}

// Fire-and-forget: use inside request handlers so the response is never delayed.
const queue = (opts) => { send(opts); };

module.exports = { send, queue, isConfigured, layout };
