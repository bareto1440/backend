const jwt = require('jsonwebtoken');
const db = require('../db');

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

// Any logged-in user (freshly re-validated against the DB)
function requireAuth(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Re-query the DB to ensure role/email are current and account exists
    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { sub: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Admin-only routes — verify token, then confirm role in DB by user id/email
function requireAdmin(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) return res.status(401).json({ error: 'Missing admin token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
    req.user = { sub: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth, requireAdmin };
