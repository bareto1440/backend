const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { generateToken, generateVerificationCode, hoursFromNow } = require('../services/tokens');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Simple in-memory rate limiting for email verification
const rateLimitStore = new Map();

function checkRateLimit(key, maxAttempts = 3, windowMs = 3600000) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.startTime > windowMs) {
    rateLimitStore.set(key, { count: 1, startTime: now });
    return true;
  }

  if (entry.count >= maxAttempts) {
    return false;
  }

  entry.count += 1;
  return true;
}

function getRateLimitRemaining(key) {
  const entry = rateLimitStore.get(key);
  if (!entry) return null;

  const now = Date.now();
  const windowMs = 3600000;
  const resetTime = entry.startTime + windowMs;
  const remaining = Math.max(0, Math.ceil((resetTime - now) / 1000));

  return remaining;
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /auth/signup { email, password, name }
router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const result = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, name || null);

  const userId = result.lastInsertRowid;

  try {
    const code = generateVerificationCode();
    db.prepare(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(userId, code, hoursFromNow(24));

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${code}`;
    await sendVerificationEmail(email, code, verifyUrl);
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
  }

  const user = db.prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?').get(userId);
  const token = issueToken(user);

  res.status(201).json({ token, user });
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  if (req.user.email_verified) {
    return res.status(400).json({ error: 'Email is already verified.' });
  }

  const rateLimitKey = `resend-verify-${req.user.sub}`;
  if (!checkRateLimit(rateLimitKey, 3, 3600000)) {
    return res.status(429).json({ error: 'Too many resend requests. Please try again in 1 hour.' });
  }

  try {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(user.id);
    const code = generateVerificationCode();
    db.prepare(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, code, hoursFromNow(24));

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${code}`;
    await sendVerificationEmail(user.email, code, verifyUrl);

    res.json({ message: 'Verification email sent.' });
  } catch (err) {
    console.error('Failed to resend verification email:', err.message);
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
});

// POST /auth/login { email, password }
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, email_verified: !!user.email_verified },
  });
});

// POST /auth/verify-email { token }
router.post('/verify-email', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  const rateLimitKey = `verify-email-${token}`;
  if (!checkRateLimit(rateLimitKey, 5, 3600000)) {
    return res.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
  }

  const record = db.prepare('SELECT * FROM email_verification_tokens WHERE token = ?').get(token);

  if (!record || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This verification code is invalid or expired' });
  }

  db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(
    record.user_id
  );
  db.prepare('DELETE FROM email_verification_tokens WHERE id = ?').run(record.id);

  res.json({ verified: true });
});

// POST /auth/forgot-password { email }
// Always returns the same response whether or not the email exists,
// so this endpoint can't be used to check which emails have accounts.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  if (user) {
    try {
      const token = generateToken();
      db.prepare(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
      ).run(user.id, token, hoursFromNow(1));

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error('Failed to send password reset email:', err.message);
      if (process.env.NODE_ENV !== 'production') {
        return res.status(500).json({ error: `Failed to send password reset email: ${err.message}` });
      }
    }
  }

  res.json({ message: 'If that email has an account, a reset link has been sent.' });
});

// POST /auth/reset-password { token, password }
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const record = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?').get(token);

  if (!record || record.used || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or expired' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    passwordHash,
    record.user_id
  );
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(record.id);

  res.json({ reset: true });
});

// GET /auth/me — current user from token
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db
      .prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

router.post('/update-profile', requireAuth, (req, res) => {
  const { name } = req.body;
  if (name === undefined) {
    return res.status(400).json({ error: 'Name is required' });
  }

  db.prepare('UPDATE users SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    name || null,
    req.user.sub
  );

  const user = db
    .prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?')
    .get(req.user.sub);
  res.json({ user });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    passwordHash,
    req.user.sub
  );

  res.json({ success: true });
});

module.exports = router;
