// Create (or update) an admin / staff login from the command line.
//   npm run seed:admin -- "Talisay Admin" admin@gmail.com "admin123"
//   npm run seed:staff -- "Nurse Jane Doe" jane@tcc.edu.ph "Staff1234"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const store = require('../db');

const role = process.argv[2];
const [name, emailRaw, password] = process.argv.slice(3);
const usage = (msg) => {
  if (msg) console.error('Error: ' + msg + '\n');
  console.error(`Usage: npm run seed:${role === 'staff' ? 'staff' : 'admin'} -- "Full Name" email@example.com "password"`);
  process.exit(1);
};

(async () => {
  if (!['admin', 'staff'].includes(role)) usage('role must be admin or staff.');
  if (!name || !emailRaw || !password) usage('name, email and password are all required.');
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage('that email address does not look valid.');
  await store.init();
  const d = store.get();
  const minLen = (d.settings && d.settings.security && d.settings.security.minPasswordLength) || 8;
  if (password.length < minLen) usage(`password must be at least ${minLen} characters.`);

  const existing = d.users.find((u) => (u.email || '').toLowerCase() === email);
  if (existing && existing.role === 'student') usage('that email belongs to a student account.');

  const passwordHash = bcrypt.hashSync(password, 10);
  let user;
  if (existing) {
    Object.assign(existing, { name: name.trim(), role, passwordHash, status: 'active' });
    user = existing;
  } else {
    user = { id: store.newId('u_'), role, name: name.trim(), studentId: '', email, passwordHash, status: 'active', photo: '', createdAt: new Date().toISOString() };
    d.users.push(user);
  }
  store.log('System', existing ? 'Updated user (CLI)' : 'Added user (CLI)', `${user.name} (${role})`);
  if (!store.persist()) { console.error('Could not save the database.'); process.exit(1); }
  await store.flush();
  console.log(`${existing ? 'Updated' : 'Created'} ${role}: ${user.name} <${email}>`);
  console.log('Log in on the "Clinic Staff" tab.');
  await store.close();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
