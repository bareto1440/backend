/**
 * Admin dashboard routes
 * Handles admin creation, login, and user management
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

// Ensure admin_replies table exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS admin_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    admin_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`).run();

// Helper functions
function hasAdmin() {
  return !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
}

function normalizeEmail(email) {
  return email ? email.toLowerCase().trim() : '';
}

function validateEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function createOrPromoteAdmin(email, password, name) {
  const normalized = normalizeEmail(email);
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);

  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(existing.id);
    return { type: 'promoted', user: db.prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?').get(existing.id) };
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
    "INSERT INTO users (email, password_hash, name, role, email_verified) VALUES (?, ?, ?, 'admin', 1)"
  ).run(normalized, passwordHash, name || null);

  return { type: 'created', user: db.prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?').get(result.lastInsertRowid) };
}

function requireAdmin(req) {
  try {
    const adminId = req.signedCookies && req.signedCookies.admin_id;
    if (!adminId) return null;
    const admin = db.prepare("SELECT id,email,name,role FROM users WHERE id = ? AND role = 'admin'").get(adminId);
    return admin || null;
  } catch (e) {
    return null;
  }
}

// Render functions
const renderForm = ({ message = '', error = '' } = {}) => {
  const setupKeyPlaceholder = process.env.ADMIN_SETUP_KEY ? '<div><label>Setup Key:<br><input name="setupKey" type="password" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:8px"></label></div>' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Create Admin</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; background:#f2f7fc; color:#0f172a; margin:0; padding:0; }
    .page { max-width:520px; margin:64px auto; background:#ffffff; border:1px solid #d1d5db; border-radius:18px; box-shadow:0 16px 32px rgba(15,23,42,.08); padding:32px; }
    h1 { margin-top:0; font-size:1.75rem; }
    label { display:block; margin-bottom:16px; font-weight:600; color:#334155; }
    input { width:100%; padding:12px 14px; border:1px solid #cbd5e1; border-radius:12px; font-size:1rem; }
    button { width:100%; padding:14px 16px; border:none; border-radius:12px; background:#2563eb; color:#fff; font-size:1rem; font-weight:700; cursor:pointer; }
    .message { margin:16px 0; padding:14px 16px; border-radius:12px; background:#ecfdf5; color:#065f46; }
    .error { margin:16px 0; padding:14px 16px; border-radius:12px; background:#fee2e2; color:#991b1b; }
    .note { margin-top:24px; color:#64748b; font-size:0.95rem; }
  </style>
</head>
<body>
  <div class="page">
    <h1>Create Admin</h1>
    <p class="note">Use this page to create or promote an admin user. If an admin already exists, a setup key is required.</p>
    ${message ? `<div class="message">${message}</div>` : ''}
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="post">
      <label>Email<br><input name="email" type="email" required></label>
      <label>Password<br><input name="password" type="password" required minlength="8"></label>
      <label>Name (optional)<br><input name="name" type="text"></label>
      ${setupKeyPlaceholder}
      <button type="submit">Create admin</button>
    </form>
      <p style="margin-top:12px;text-align:center"><a href="/admin/login">Admin login</a></p>
  </div>
</body>
</html>`;
};

const renderLogin = ({ message = '', error = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Login</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f2f7fc;color:#0f172a;margin:0;padding:0}.page{max-width:520px;margin:64px auto;background:#fff;border:1px solid #d1d5db;border-radius:18px;padding:32px}h1{margin-top:0}label{display:block;margin-bottom:12px;font-weight:600}input{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px}button{width:100%;padding:14px;border:none;border-radius:12px;background:#2563eb;color:#fff;font-weight:700} .error{margin:16px 0;padding:14px;border-radius:12px;background:#fee2e2;color:#991b1b}.message{margin:16px 0;padding:14px;border-radius:12px;background:#ecfdf5;color:#065f46}</style>
</head><body><div class="page"><h1>Admin login</h1>${message?`<div class="message">${message}</div>`:''}${error?`<div class="error">${error}</div>`:''}<form method="post" action="/admin/login"><label>Email<br><input name="email" type="email" required></label><label>Password<br><input name="password" type="password" required></label><button type="submit">Login</button></form><p style="margin-top:12px;text-align:center"><a href="/admin">Create admin</a></p></div></body></html>`;

const renderDashboard = ({ admin, users, replies = [], message = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Dashboard</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f2f7fc;color:#0f172a;margin:0;padding:0}.shell{max-width:1100px;margin:24px auto;padding:20px}.card{background:#fff;border:1px solid #d1d5db;border-radius:12px;padding:16px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #eef2f7;text-align:left}th{background:#f8fafc}textarea{width:100%;min-height:80px;padding:8px;border:1px solid #cbd5e1;border-radius:8px}button{padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer} .note{color:#64748b}</style>
</head><body><div class="shell"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h1>Admin dashboard</h1><div>Signed in as <strong>${admin.email}</strong> &nbsp; <form method="post" action="/admin/logout" style="display:inline"><button type="submit">Logout</button></form></div></div>
${message?`<div class="card"><strong>${message}</strong></div>`:''}
<div class="card"><h2>Users</h2><p class="note">Emails and names shown. Passwords are stored hashed (password_hash) and are not the plain user password.</p><table><thead><tr><th>ID</th><th>Email</th><th>Name</th><th>Password hash</th><th>Created</th><th>Reply</th></tr></thead><tbody>${users.map(u=>`<tr><td>${u.id}</td><td>${u.email}</td><td>${u.name||''}</td><td style="font-family:monospace;font-size:0.8rem;max-width:360px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${u.password_hash}</td><td>${u.created_at}</td><td><form method="post" action="/admin/reply"><input type="hidden" name="user_id" value="${u.id}"><textarea name="message" placeholder="Reply to ${u.email}"></textarea><div style="margin-top:8px"><button type="submit">Send reply</button></div></form></td></tr>`).join('')}</tbody></table></div>
<div class="card"><h2>Recent replies</h2><table><thead><tr><th>ID</th><th>User</th><th>Admin</th><th>Message</th><th>When</th></tr></thead><tbody>${replies.map(r=>`<tr><td>${r.id}</td><td>${r.user_email}</td><td>${r.admin_email}</td><td style="max-width:420px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${r.message}</td><td>${r.created_at}</td></tr>`).join('')}</tbody></table></div>
<p class="note">Live chat integration is incoming; replies are stored here and can be used to send messages when chat is available.</p>
</div></body></html>`;

// Routes
router.get('/', (req, res) => {
  // if logged in, redirect to dashboard
  const adminId = req.signedCookies && req.signedCookies.admin_id;
  if (adminId) return res.redirect('/admin/dashboard');
  res.send(renderForm());
});

router.get('/login', (req, res) => {
  const adminId = req.signedCookies && req.signedCookies.admin_id;
  if (adminId) return res.redirect('/admin/dashboard');
  res.send(renderLogin());
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !validateEmail(email)) return res.send(renderLogin({ error: 'Valid email required.' }));
  if (!password) return res.send(renderLogin({ error: 'Password required.' }));

  const admin = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'admin'").get(normalizeEmail(email));
  if (!admin) return res.send(renderLogin({ error: 'No admin account with that email.' }));

  const ok = bcrypt.compareSync(password, admin.password_hash || '');
  if (!ok) return res.send(renderLogin({ error: 'Invalid credentials.' }));

  // set signed cookie
  res.cookie('admin_id', admin.id, { signed: true, httpOnly: true });
  return res.redirect('/admin/dashboard');
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_id');
  res.redirect('/admin/login');
});

router.get('/dashboard', (req, res) => {
  const admin = requireAdmin(req);
  if (!admin) return res.redirect('/admin/login');

  const users = db.prepare('SELECT id,email,name,password_hash,created_at FROM users ORDER BY created_at DESC').all();
  const replies = db.prepare('SELECT r.id,r.message,r.created_at,u.email as user_email,a.email as admin_email FROM admin_replies r JOIN users u ON r.user_id = u.id JOIN users a ON r.admin_id = a.id ORDER BY r.created_at DESC LIMIT 50').all();
  res.send(renderDashboard({ admin, users, replies }));
});

router.post('/reply', (req, res) => {
  const admin = requireAdmin(req);
  if (!admin) return res.status(403).send('Not authorized');
  const { user_id, message } = req.body;
  if (!user_id || !message) return res.redirect('/admin/dashboard');
  // store reply
  db.prepare('INSERT INTO admin_replies (user_id, admin_id, message) VALUES (?, ?, ?)').run(user_id, admin.id, message);
  // In future: integrate with live chat or send email. For now, store the reply.
  res.redirect('/admin/dashboard');
});

router.post('/', (req, res) => {
  const { email, password, name, setupKey } = req.body;
  if (!email || !validateEmail(email)) {
    return res.send(renderForm({ error: 'A valid email is required.' }));
  }
  if (!password || password.length < 8) {
    return res.send(renderForm({ error: 'Password must be at least 8 characters.' }));
  }

  const existingAdmin = hasAdmin();
  if (existingAdmin && process.env.ADMIN_SETUP_KEY && setupKey !== process.env.ADMIN_SETUP_KEY) {
    return res.send(renderForm({ error: 'Invalid setup key.' }));
  }

  try {
    const result = createOrPromoteAdmin(email, password, name);
    const message = result.type === 'created' ? `Admin ${result.user.email} created successfully.` : `Existing user ${result.user.email} promoted to admin.`;
    res.send(renderForm({ message }));
  } catch (err) {
    res.send(renderForm({ error: err.message || 'Failed to create admin.' }));
  }
});

module.exports = router;
