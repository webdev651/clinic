// Remove the built-in demo accounts (and their data) from an existing database.
//   npm run remove-demo
// Removes: admin@tcc.edu.ph, nurse@tcc.edu.ph, doctor@tcc.edu.ph, cortesdave6@gmail.com,
// plus the demo students (Juan Dela Cruz and the generated sample students).
// It refuses to run unless another active admin exists, so you can never lock yourself out.
// Stop the server first (or restart it afterwards).
const store = require('../db');

const DEMO_IDS = new Set(['u_admin1', 'u_staff1', 'u_staff2', 'u_staff3', 'u_student1', ...Array.from({ length: 11 }, (_, i) => `u_s${i + 2}`)]);
const d = store.get();

const isDemo = (u) => DEMO_IDS.has(u.id);
const remainingAdmins = d.users.filter((u) => u.role === 'admin' && u.status === 'active' && !isDemo(u));
if (!remainingAdmins.length) {
  console.error('Not removed: there is no other active admin. Create one first:\n  npm run seed:admin -- "Full Name" you@example.com "password"');
  process.exit(1);
}

const gone = new Set(d.users.filter(isDemo).map((u) => u.id));
if (!gone.size) { console.log('No demo accounts found. Nothing to do.'); process.exit(0); }

d.users = d.users.filter((u) => !gone.has(u.id));
for (const key of Object.keys(d)) {
  if (!Array.isArray(d[key]) || key === 'users') continue;
  d[key] = d[key].filter((r) => !(r && gone.has(r.userId)));
}
store.log('System', 'Removed demo accounts', `${gone.size} account(s)`);
if (!store.persist()) { console.error('Could not save the database.'); process.exit(1); }
console.log(`Removed ${gone.size} demo account(s) and their records.`);
