// Small JSON-file database. Every collection mirrors a table in schema.sql,
// so moving to MySQL/PostgreSQL later is a mechanical change (see README).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const VERSION = 2;
let db;

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoDay = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return fmt(d); };

const DEFAULT_SETTINGS = {
  clinic: {
    name: 'Talisay City College Clinic', systemName: 'TCC CLINIC — Student Health Record and Consultation Tracking System',
    address: 'Talisay City College, Talisay City, Cebu', email: 'tcclinic@tcc.edu.ph', phone: '(032) 494-1234',
    hours: [
      { days: 'Monday – Friday', time: '8:00 AM – 5:00 PM' },
      { days: 'Saturday', time: '8:00 AM – 12:00 PM' },
      { days: 'Sunday & Holidays', time: 'Closed' },
    ],
  },
  notifications: { appointmentUpdates: true, prescriptionIssued: true, newAnnouncements: true, followUpReminders: true },
  security: { sessionHours: 8, idleMinutes: 30, maxLoginAttempts: 5, minPasswordLength: 8 },
  general: { maxAdvanceDays: 60, slotMinutes: 30, allowRegistration: true },
  permissions: { staff: { manageStudents: true, manageConsultations: true, manageAppointments: true, managePrescriptions: true, manageAnnouncements: true, viewReports: true, deleteRecords: true } },
};

const COLLECTIONS = ['users', 'students', 'healthRecords', 'medicalHistory', 'allergies', 'immunizations', 'vitalSigns',
  'documents', 'consultations', 'appointments', 'prescriptions', 'medicines', 'alerts', 'announcements',
  'notifications', 'activity', 'messages', 'sessions', 'resetTokens'];

function emptyDb() {
  const d = { version: VERSION, nextId: 100, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
  COLLECTIONS.forEach((c) => (d[c] = []));
  return d;
}

// ---------- demo data ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const COMPLAINTS = [
  ['Headache and dizziness', 'Tension headache', 'Paracetamol 500mg', '1 tablet', 'every 6 hours as needed', '3 days'],
  ['Sore throat', 'Acute pharyngitis', 'Amoxicillin 500mg', '1 capsule', '3 times a day', '7 days'],
  ['Stomach pain', 'Hyperacidity', 'Antacid (Aluminum hydroxide)', '1 tablet', 'after meals', '5 days'],
  ['Fever and body aches', 'Viral infection', 'Paracetamol 500mg', '1 tablet', 'every 6 hours', '3 days'],
  ['Cough and colds', 'Upper respiratory infection', 'Cetirizine 10mg', '1 tablet', 'once daily at night', '5 days'],
  ['Menstrual cramps', 'Primary dysmenorrhea', 'Mefenamic acid 500mg', '1 capsule', 'every 8 hours as needed', '3 days'],
  ['Minor wound on knee', 'Abrasion', 'Povidone-iodine', 'Apply thin layer', 'twice daily', '5 days'],
  ['Allergic rash', 'Allergic dermatitis', 'Loratadine 10mg', '1 tablet', 'once daily', '5 days'],
  ['Diarrhea', 'Acute gastroenteritis', 'Oral rehydration salts', '1 sachet in 1L water', 'after each loose stool', '3 days'],
  ['Annual physical exam', 'Healthy', null],
];
const STAFF = ['Nurse Maria Santos', 'Dr. Ramon Uy'];
const MEDS = [['Paracetamol 500mg', 'Tablet'], ['Amoxicillin 500mg', 'Capsule'], ['Antacid (Aluminum hydroxide)', 'Tablet'], ['Cetirizine 10mg', 'Tablet'], ['Loratadine 10mg', 'Tablet'], ['Mefenamic acid 500mg', 'Capsule'], ['Povidone-iodine', 'Solution'], ['Oral rehydration salts', 'Sachet'], ['Ibuprofen 200mg', 'Tablet'], ['Salbutamol inhaler', 'Inhaler']];
const STUDENTS = [
  ['Ana Marie Reyes', '2023-00214', 'BSIT', '2nd Year', 'Female', 'A+'], ['Mark Anthony Villanueva', '2022-00387', 'BSED', '3rd Year', 'Male', 'B+'],
  ['Kristine Joy Ramos', '2024-00456', 'BSBA', '1st Year', 'Female', 'O+'], ['John Paul Lim', '2021-00102', 'BSCS', '4th Year', 'Male', 'AB+'],
  ['Maria Cecilia Tan', '2023-00561', 'BEED', '2nd Year', 'Female', 'O-'], ['Carlo Miguel Bautista', '2022-00298', 'BSIT', '3rd Year', 'Male', 'A-'],
  ['Jasmine Mae Flores', '2024-00619', 'BSHM', '1st Year', 'Female', 'B+'], ['Rafael Gabriel Cruz', '2021-00177', 'BSCrim', '4th Year', 'Male', 'O+'],
  ['Angelica Dizon', '2023-00733', 'BSED', '2nd Year', 'Female', 'A+'], ['Nathan Dave Ocampo', '2022-00845', 'BSBA', '3rd Year', 'Male', 'B-'],
  ['Bea Louise Navarro', '2024-00912', 'BSIT', '1st Year', 'Female', 'O+'],
];

function seed() {
  const d = emptyDb();
  const now = new Date().toISOString();
  const R = rng(20260401);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const id = (p) => `${p}${d.nextId++}`;
  const hash = (p) => bcrypt.hashSync(p, 10);

  d.users.push(
    { id: 'u_admin1', role: 'admin', name: 'Clinic Administrator', studentId: '', email: 'admin@tcc.edu.ph', passwordHash: hash(process.env.ADMIN_PASSWORD || 'Admin1234'), status: 'active', photo: '', createdAt: now },
    { id: 'u_staff1', role: 'staff', name: 'Nurse Maria Santos', studentId: '', email: 'nurse@tcc.edu.ph', passwordHash: hash(process.env.STAFF_PASSWORD || 'Staff1234'), status: 'active', photo: '', createdAt: now },
    { id: 'u_staff2', role: 'staff', name: 'Dr. Ramon Uy', studentId: '', email: 'doctor@tcc.edu.ph', passwordHash: hash(process.env.STAFF_PASSWORD || 'Staff1234'), status: 'active', photo: '', createdAt: now },
    { id: 'u_staff3', role: 'staff', name: 'Dave M. Cortes', studentId: '', email: 'cortesdave6@gmail.com', passwordHash: hash(process.env.STAFF_PASSWORD || 'Staff1234'), status: 'active', photo: '', createdAt: now },
  );
  MEDS.forEach(([name, form]) => d.medicines.push({ id: id('m'), name, form }));

  // Juan Dela Cruz — the demo student (same login as earlier versions)
  const juan = 'u_student1';
  d.users.push({ id: juan, role: 'student', name: 'Juan Dela Cruz', studentId: '2024-00123', email: 'juan.delacruz@tcc.edu.ph', passwordHash: hash('Student123'), status: 'active', photo: '', createdAt: now });
  d.students.push({ userId: juan, course: 'BSIT', yearLevel: '3rd Year', contact: '0912-345-6789', birthdate: '2003-03-15', gender: 'Male', bloodType: 'O+', address: 'Talisay City, Cebu', emergencyContact: 'Elena Dela Cruz (Mother) — 0917-555-0101' });
  d.healthRecords.push({ userId: juan, general: 'No chronic illnesses currently recorded. Childhood asthma, no attacks in the past 5 years.', lastPhysical: isoDay(-9), notes: 'Allergic to penicillin — avoid penicillin-class antibiotics. Hepatitis B series is incomplete.' });
  d.medicalHistory.push(
    { id: id('mh'), userId: juan, condition: 'Asthma (childhood)', type: 'Condition', date: '', note: 'No attacks in the past 5 years' },
    { id: id('mh'), userId: juan, condition: 'Appendectomy', type: 'Hospitalization', date: '2018-05-12', note: 'Admitted 3 days, no complications' },
  );
  d.allergies.push(
    { id: id('al'), userId: juan, name: 'Penicillin', reaction: 'Skin rash', severity: 'Moderate' },
    { id: id('al'), userId: juan, name: 'Peanuts', reaction: 'Mild swelling', severity: 'Mild' },
  );
  d.immunizations.push(
    { id: id('im'), userId: juan, vaccine: 'COVID-19 (booster)', date: '2023-02-10', status: 'Completed' },
    { id: id('im'), userId: juan, vaccine: 'Influenza', date: isoDay(-120), status: 'Completed' },
    { id: id('im'), userId: juan, vaccine: 'Hepatitis B (dose 2 of 3)', date: '2022-06-05', status: 'Ongoing' },
  );
  d.vitalSigns.push(
    { id: id('v'), userId: juan, date: isoDay(-9), bp: '120/80', heartRate: 78, temp: 36.7, weight: 62, height: 168, recordedBy: 'Dr. Ramon Uy' },
    { id: id('v'), userId: juan, date: isoDay(-200), bp: '118/76', heartRate: 74, temp: 36.5, weight: 61, height: 168, recordedBy: 'Nurse Maria Santos' },
  );
  d.documents.push(
    { id: id('d'), userId: juan, name: 'Physical exam result', category: 'Laboratory Result', date: isoDay(-200), file: null, fileName: '', mime: '', size: 0, uploadedBy: 'Nurse Maria Santos' },
    { id: id('d'), userId: juan, name: 'Chest X-ray', category: 'Laboratory Result', date: '2025-11-14', file: null, fileName: '', mime: '', size: 0, uploadedBy: 'Nurse Maria Santos' },
  );
  [[-60, 0], [-41, 1], [-25, 2], [-9, 9]].forEach(([off, ci]) => {
    const c = COMPLAINTS[ci]; const cid = id('c'); const staff = ci % 2 ? STAFF[1] : STAFF[0];
    d.consultations.push({ id: cid, userId: juan, date: isoDay(off), complaint: c[0], diagnosis: c[1], treatment: c[2] ? `${c[2]}, rest and fluids` : 'No treatment needed', notes: 'Patient assessed by clinic staff. Vitals checked, advised rest and hydration, and to return if symptoms persist.', staffName: ci === 3 || ci === 9 ? STAFF[1] : staff, status: 'completed' });
    if (c[2]) d.prescriptions.push({ id: id('p'), userId: juan, consultationId: cid, date: isoDay(off), medicine: c[2], dosage: c[3], frequency: c[4], duration: c[5], instructions: 'Take with water. Stop and consult the clinic if rash or swelling appears.', staffName: staff, status: off > -30 ? 'active' : 'completed' });
  });
  d.appointments.push(
    { id: id('a'), userId: juan, date: isoDay(3), time: '09:30', purpose: 'Follow-up check-up', notes: '', status: 'approved', staffName: 'Nurse Maria Santos', remarks: '', createdAt: now },
    { id: id('a'), userId: juan, date: isoDay(10), time: '14:00', purpose: 'Dental screening', notes: '', status: 'pending', staffName: '', remarks: '', createdAt: now },
    { id: id('a'), userId: juan, date: isoDay(-9), time: '10:00', purpose: 'Annual physical exam', notes: '', status: 'completed', staffName: 'Dr. Ramon Uy', remarks: '', createdAt: now },
    { id: id('a'), userId: juan, date: isoDay(-30), time: '13:30', purpose: 'Medical certificate', notes: '', status: 'cancelled', staffName: '', remarks: 'Cancelled by student', createdAt: now },
  );

  // other students, with generated history so reports and charts have something to show
  const slotPool = ['08:00', '08:30', '09:00', '10:00', '10:30', '11:00', '13:00', '14:00', '15:00', '16:00'];
  STUDENTS.forEach(([name, sid, course, year, gender, blood], i) => {
    const uid = `u_s${i + 2}`;
    d.users.push({ id: uid, role: 'student', name, studentId: sid, email: `${name.split(' ')[0].toLowerCase()}.${name.split(' ').pop().toLowerCase()}@tcc.edu.ph`, passwordHash: hash('Student123'), status: i === 9 ? 'disabled' : 'active', photo: '', createdAt: now });
    d.students.push({ userId: uid, course, yearLevel: year, contact: `09${17 + (i % 3)}-${String(100 + i * 37).slice(0, 3)}-${String(1000 + i * 211).slice(0, 4)}`, birthdate: `${2000 + (i % 5)}-${pad(1 + (i * 5) % 12)}-${pad(1 + (i * 7) % 28)}`, gender, bloodType: blood, address: 'Talisay City, Cebu', emergencyContact: '' });
    d.healthRecords.push({ userId: uid, general: 'No significant medical concerns on file.', lastPhysical: isoDay(-30 - i * 12), notes: '' });
    d.vitalSigns.push({ id: id('v'), userId: uid, date: isoDay(-30 - i * 12), bp: `${108 + i * 2}/${70 + (i % 4) * 3}`, heartRate: 68 + i * 2, temp: 36.4 + (i % 4) / 10, weight: 48 + i * 3, height: 152 + i * 2, recordedBy: STAFF[i % 2] });
    d.immunizations.push({ id: id('im'), userId: uid, vaccine: 'COVID-19 (primary series)', date: '2022-01-15', status: 'Completed' }, { id: id('im'), userId: uid, vaccine: 'Influenza', date: isoDay(-100 - i * 9), status: i % 3 === 0 ? 'Due' : 'Completed' });
    if (i % 3 === 1) d.allergies.push({ id: id('al'), userId: uid, name: pick(['Shrimp', 'Dust mites', 'Aspirin', 'Pollen']), reaction: pick(['Hives', 'Sneezing', 'Itching']), severity: pick(['Mild', 'Moderate', 'Severe']) });
    const n = 2 + Math.floor(R() * 5);
    for (let k = 0; k < n; k++) {
      const off = -Math.floor(R() * 330) - 3; const c = pick(COMPLAINTS); const st = pick(STAFF); const cid = id('c');
      d.consultations.push({ id: cid, userId: uid, date: isoDay(off), complaint: c[0], diagnosis: c[1], treatment: c[2] ? `${c[2]}, rest and fluids` : 'No treatment needed', notes: '', staffName: st, status: 'completed' });
      if (c[2]) d.prescriptions.push({ id: id('p'), userId: uid, consultationId: cid, date: isoDay(off), medicine: c[2], dosage: c[3], frequency: c[4], duration: c[5], instructions: 'Take as directed.', staffName: st, status: off > -10 ? 'active' : R() > 0.1 ? 'completed' : 'cancelled' });
    }
    const aStat = ['pending', 'approved', 'completed', 'completed', 'cancelled', 'rejected'];
    for (let k = 0; k < 2; k++) {
      const status = pick(aStat); const off = status === 'completed' || status === 'cancelled' ? -Math.floor(R() * 40) - 1 : Math.floor(R() * 12) + 1;
      d.appointments.push({ id: id('a'), userId: uid, date: isoDay(off), time: pick(slotPool), purpose: pick(['Medical check-up', 'Follow-up check', 'Consultation', 'Medical certificate']), notes: '', status, staffName: status === 'pending' ? '' : pick(STAFF), remarks: status === 'rejected' ? 'Schedule not available' : '', createdAt: now });
    }
  });
  // make sure there is no accidental double booking in the generated data
  const seen = new Set();
  d.appointments = d.appointments.filter((a) => { if (!['pending', 'approved'].includes(a.status)) return true; const k = a.date + a.time; if (seen.has(k)) return false; seen.add(k); return true; });

  d.alerts.push(
    { id: id('h'), userId: juan, type: 'followup', title: 'Vaccination record incomplete', message: 'Please submit your Hepatitis B vaccination card to the clinic.', severity: 'warning', active: true, date: isoDay(-5) },
    { id: id('h'), userId: null, type: 'notice', title: 'Dengue advisory', message: 'Cases are rising in the area. Clear standing water and wear long sleeves in the afternoon.', severity: 'critical', active: true, date: isoDay(-2) },
    { id: id('h'), userId: null, type: 'health', title: 'Stay hydrated this week', message: 'Temperatures are high. Drink at least 8 glasses of water and take breaks in the shade.', severity: 'info', active: true, date: isoDay(-1) },
    { id: id('h'), userId: juan, type: 'appointment', title: 'Appointment reminder', message: 'You have a follow-up check-up in 3 days. Bring your school ID.', severity: 'info', active: true, date: isoDay(0) },
    { id: id('h'), userId: juan, type: 'prescription', title: 'Prescription reminder', message: 'Remember to finish your full course of medicine as prescribed.', severity: 'info', active: true, date: isoDay(-3) },
  );
  d.announcements.push(
    { id: id('n'), title: 'Free flu vaccination drive', body: 'The clinic is offering free flu shots to all enrolled students. Bring your school ID.', date: isoDay(-1), category: 'Vaccination Program', status: 'published' },
    { id: id('n'), title: 'Clinic hours during exam week', body: 'The clinic will stay open until 6:00 PM from Monday to Friday.', date: isoDay(-4), category: 'Clinic Schedule Update', status: 'published' },
    { id: id('n'), title: 'Mental health awareness talk', body: 'Join the guidance and clinic team for an open talk in the AVR this Friday at 2 PM.', date: isoDay(-8), category: 'Medical Campaign', status: 'published' },
    { id: id('n'), title: 'Clinic closed for city holiday', body: 'The clinic will be closed on the upcoming city holiday. For emergencies, call 911.', date: isoDay(5), category: 'Clinic Closure', status: 'draft' },
  );
  d.notifications.push({ id: id('nt'), userId: juan, title: 'Appointment approved', message: 'Your follow-up check-up was approved.', link: '#appointments', read: false, createdAt: now });
  d.activity.push({ id: id('ac'), at: now, actor: 'System', action: 'Database seeded', detail: 'Demo data created' });
  return d;
}

// A clean install: default settings only. No students, no records and NO default logins.
// Create the first admin with `npm run seed:admin` or the ADMIN_EMAIL / ADMIN_PASSWORD variables (see server.js).
function blank() {
  const fresh = emptyDb();
  fresh.activity.push({ id: `ac${fresh.nextId++}`, at: new Date().toISOString(), actor: 'System', action: 'Database created', detail: 'Blank database' });
  return fresh;
}
const initial = () => (process.env.DEMO_DATA === '1' ? seed() : blank());

// ---------- persistence ----------
// With DB_HOST set, everything is stored in MySQL: one table per collection (id + JSON data),
// plus `tcc_meta` (settings, counters, login secret) and `tcc_uploads` (document files).
// Without DB_HOST it falls back to the local data/db.json file (handy for local testing).
let mysql = null;
try { mysql = require('mysql2/promise'); } catch {}
const USE_MYSQL = !!(process.env.DB_HOST && mysql);
const UNSHIFTED = new Set(['activity', 'notifications', 'messages']); // these arrays are newest-first
const META_KEYS = ['version', 'nextId', 'settings', 'jwtSecret'];
let pool = null;
let timer = null;
let flushing = null;
const snap = {};      // collection -> Map(rowKey -> json) as last written to MySQL
let metaSnap = {};

const q = (c) => '`tcc_' + c + '`';
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const keyOf = (r) => String((r && (r.id ?? r.userId ?? r.jti ?? r.token)) ?? crypto.createHash('sha1').update(JSON.stringify(r)).digest('hex')).slice(0, 190);
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

function rowsOf(c) {
  const arr = db[c] || []; const used = new Set(); const cur = new Map();
  for (const r of (UNSHIFTED.has(c) ? arr.slice().reverse() : arr)) {
    let k = keyOf(r); while (used.has(k)) k = k.slice(0, 170) + '#' + used.size;
    used.add(k); cur.set(k, JSON.stringify(r));
  }
  return cur;
}

// ---------- automatic schema migration ----------
// Runs on every start. Creates missing tables, repairs tables with the wrong shape (the old table is
// renamed to <name>_old_<timestamp>, never dropped), and applies numbered migrations once each.
// To change the schema later, append an entry to MIGRATIONS; it will run automatically on the next deploy.
const COLLECTION_SQL = (c) => `CREATE TABLE ${q(c)} (seq BIGINT AUTO_INCREMENT PRIMARY KEY, id VARCHAR(190) NOT NULL, data JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_id (id)) DEFAULT CHARSET=utf8mb4`;
const TABLES = [
  ...COLLECTIONS.map((c) => ({ name: 'tcc_' + c, need: ['seq', 'id', 'data'], sql: COLLECTION_SQL(c) })),
  { name: 'tcc_meta', need: ['k', 'v'], sql: 'CREATE TABLE `tcc_meta` (k VARCHAR(64) PRIMARY KEY, v JSON NOT NULL) DEFAULT CHARSET=utf8mb4' },
  { name: 'tcc_uploads', need: ['name', 'data'], sql: 'CREATE TABLE `tcc_uploads` (name VARCHAR(190) PRIMARY KEY, data LONGBLOB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) DEFAULT CHARSET=utf8mb4' },
];

async function columnsOf(table) {
  const [rows] = await pool.query('SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)', [table]);
  return rows.map((r) => String(r.c).toLowerCase());
}

async function verifyTables() {
  for (const t of TABLES) {
    const cols = await columnsOf(t.name);
    if (!cols.length) { await pool.query(t.sql); console.log(`Migration: created table ${t.name}`); continue; }
    if (t.need.some((n) => !cols.includes(n))) {
      const backup = `${t.name}_old_${Date.now()}`;
      await pool.query(`RENAME TABLE \`${t.name}\` TO \`${backup}\``);
      await pool.query(t.sql);
      console.log(`Migration: ${t.name} had the wrong columns; renamed it to ${backup} and created a new one.`);
    }
  }
}

const MIGRATIONS = [
  { id: '001_base_tables', up: verifyTables },
  { id: '002_updated_at_column', up: async () => {
    for (const c of COLLECTIONS) {
      if (!(await columnsOf('tcc_' + c)).includes('updated_at')) await pool.query(`ALTER TABLE ${q(c)} ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    }
  } },
  // Add future changes here, e.g. { id: '003_something', up: async () => { await pool.query('ALTER TABLE ...'); } },
];

async function ensureSchema() {
  await pool.query('CREATE TABLE IF NOT EXISTS `tcc_migrations` (id VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) DEFAULT CHARSET=utf8mb4');
  await verifyTables(); // self-heal on every start
  const [done] = await pool.query('SELECT id FROM `tcc_migrations`');
  const applied = new Set(done.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await m.up();
    await pool.query('INSERT INTO `tcc_migrations` (id) VALUES (?)', [m.id]);
    console.log(`Migration applied: ${m.id}`);
  }
}

async function flushNow() {
  if (!pool || !db) return;
  const conn = await pool.getConnection();
  const nextSnap = {}; const nextMeta = {};
  try {
    await conn.beginTransaction();
    for (const c of COLLECTIONS) {
      const cur = rowsOf(c); const old = snap[c] || new Map();
      const up = []; for (const [k, j] of cur) if (old.get(k) !== j) up.push([k, j]);
      const del = [...old.keys()].filter((k) => !cur.has(k));
      for (const part of chunks(del, 200)) await conn.query(`DELETE FROM ${q(c)} WHERE id IN (?)`, [part]);
      for (const part of chunks(up, 100)) await conn.query(`INSERT INTO ${q(c)} (id, data) VALUES ? ON DUPLICATE KEY UPDATE data = VALUES(data)`, [part]);
      nextSnap[c] = cur;
    }
    for (const k of META_KEYS) {
      if (db[k] === undefined) continue;
      const j = JSON.stringify(db[k]); nextMeta[k] = j;
      if (metaSnap[k] !== j) await conn.query('INSERT INTO `tcc_meta` (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, j]);
    }
    await conn.commit();
    Object.assign(snap, nextSnap); metaSnap = nextMeta;
  } catch (e) { try { await conn.rollback(); } catch {} throw e; } finally { conn.release(); }
}

function schedule(delay = 300) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const run = () => { flushing = flushNow().catch((e) => { console.error('Database write failed, will retry:', e.message); schedule(5000); }).finally(() => { flushing = null; }); };
    if (flushing) flushing.finally(run); else run();
  }, delay);
}

async function flush() { // wait until everything is really written (used by scripts and on shutdown)
  if (!USE_MYSQL) return;
  if (timer) { clearTimeout(timer); timer = null; }
  if (flushing) await flushing;
  await flushNow();
}
async function close() { if (pool) { await pool.end(); pool = null; } }

function saveFile() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(db, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
}
function save() { if (USE_MYSQL) schedule(); else saveFile(); }

// Save. In file mode a failed write runs undo() so memory never holds data that was not stored.
// In MySQL mode the write happens right after (and is retried until it works), so this returns true.
function persist(undo) {
  if (USE_MYSQL) { schedule(); return true; }
  try { saveFile(); return true; } catch (e) {
    console.error('Could not write the database:', e.message);
    try { if (undo) undo(); } catch {}
    return false;
  }
}

// Version 1 files (the earlier student-only build) are converted to a fresh database.
function upgradeFromV1(old) {
  const fresh = initial();
  const have = new Set(fresh.users.map((u) => u.id));
  for (const u of old.users || []) {
    if (have.has(u.id) || ['u_staff1', 'u_admin1', 'u_staff2', 'u_staff3'].includes(u.id) || (u.id === 'u_student1' && u.studentId === '2024-00123')) continue;
    fresh.users.push({ status: 'active', photo: '', ...u });
    if (u.role === 'student') fresh.students.push({ userId: u.id, course: '', yearLevel: '', contact: '', birthdate: '', gender: '', bloodType: '', address: '', emergencyContact: '' });
  }
  fresh.nextId = Math.max(fresh.nextId, old.nextId || 0);
  return fresh;
}

function normalize(raw) {
  COLLECTIONS.forEach((c) => (raw[c] = raw[c] || []));
  raw.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  return raw;
}

function loadFile() {
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw.version === VERSION) db = normalize(raw);
    else { fs.copyFileSync(FILE, FILE.replace(/\.json$/, '.v1-backup.json')); db = upgradeFromV1(raw); saveFile(); }
  } else { db = initial(); saveFile(); }
  return db;
}

async function init() {
  if (db) return db;
  if (!USE_MYSQL) {
    if (process.env.DB_HOST && !mysql) console.warn('WARNING: DB_HOST is set but the mysql2 package is missing. Run npm install. Using the local file instead.');
    return loadFile();
  }
  pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb', waitForConnections: true, connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
    charset: 'utf8mb4', jsonStrings: true, ssl: process.env.DB_CA ? { ca: process.env.DB_CA } : { rejectUnauthorized: false }, // Aiven requires SSL
  });
  await ensureSchema();
  const [metaRows] = await pool.query('SELECT k, v FROM `tcc_meta`');
  if (!metaRows.length) {
    // First run on this database: import the old db.json if it exists, otherwise start blank.
    let start = null;
    try { if (fs.existsSync(FILE)) { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); start = raw.version === VERSION ? normalize(raw) : upgradeFromV1(raw); console.log('Imported existing data/db.json into MySQL.'); } } catch (e) { console.warn('Could not import db.json:', e.message); }
    db = start || initial();
    await flushNow();
    console.log('MySQL database initialised.');
    return db;
  }
  const loaded = {};
  for (const r of metaRows) loaded[r.k] = parse(r.v);
  for (const c of COLLECTIONS) {
    const [rows] = await pool.query(`SELECT data FROM ${q(c)} ORDER BY seq`);
    const arr = rows.map((r) => parse(r.data));
    loaded[c] = UNSHIFTED.has(c) ? arr.reverse() : arr;
  }
  db = normalize({ version: VERSION, nextId: 100, ...loaded });
  for (const c of COLLECTIONS) snap[c] = rowsOf(c);
  metaSnap = {}; for (const k of META_KEYS) if (db[k] !== undefined) metaSnap[k] = JSON.stringify(db[k]);
  console.log(`MySQL connected (${process.env.DB_HOST}). Loaded ${db.users.length} user(s).`);
  return db;
}

function get() {
  if (!db) { if (USE_MYSQL) throw new Error('Database is not ready yet. Call await store.init() first.'); loadFile(); }
  return db;
}
const newId = (prefix) => `${prefix}${get().nextId++}`;
const log = (actor, action, detail = '') => {
  const a = get().activity; a.unshift({ id: newId('ac'), at: new Date().toISOString(), actor: actor || 'System', action, detail });
  if (a.length > 500) a.length = 500;
};
const notify = (userId, title, message, link = '') => get().notifications.unshift({ id: newId('nt'), userId, title, message, link, read: false, createdAt: new Date().toISOString() });

// The login-signing secret lives in the database so it survives restarts and redeploys (unless JWT_SECRET is set).
function secret() {
  const d = get();
  if (!d.jwtSecret || String(d.jwtSecret).length < 32) { d.jwtSecret = crypto.randomBytes(48).toString('hex'); save(); }
  return d.jwtSecret;
}

// ---------- uploaded document files ----------
const UPLOAD_DIR = path.join(path.dirname(FILE), 'uploads');
async function putFile(name, buf) {
  if (USE_MYSQL) { await pool.query('REPLACE INTO `tcc_uploads` (name, data) VALUES (?, ?)', [name, buf]); return; }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(path.join(UPLOAD_DIR, path.basename(name)), buf);
}
async function getFile(name) {
  if (USE_MYSQL) { const [rows] = await pool.query('SELECT data FROM `tcc_uploads` WHERE name = ?', [name]); return rows.length ? rows[0].data : null; }
  const p = path.join(UPLOAD_DIR, path.basename(name)); return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
async function delFile(name) {
  try {
    if (USE_MYSQL) await pool.query('DELETE FROM `tcc_uploads` WHERE name = ?', [name]);
    else fs.rmSync(path.join(UPLOAD_DIR, path.basename(name)), { force: true });
  } catch (e) { console.error('Could not delete file:', e.message); }
}

module.exports = { init, get, save, persist, flush, close, secret, putFile, getFile, delFile, newId, isoDay, log, notify, DEFAULT_SETTINGS, FILE, USE_MYSQL };
