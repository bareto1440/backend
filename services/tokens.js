const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateVerificationCode() {
  const code = crypto.randomInt(0, 1000000);
  return String(code).padStart(6, '0');
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

module.exports = { generateToken, generateVerificationCode, hoursFromNow };
