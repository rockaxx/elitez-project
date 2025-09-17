const { run, get } = require('../db/queries');
const { generateToken } = require('./security');

async function issueToken(userId) {
  const token = generateToken();
  await run(
    `INSERT INTO auth_tokens (token, user_id, created_at, expires_at)
     VALUES (?, ?, datetime('now'), datetime('now', '+7 day'))`,
    [token, userId]
  );
  return token;
}

async function getUserForToken(token) {
  if (!token) {
    return null;
  }
  return get(
    `SELECT u.id, u.username
       FROM auth_tokens t
       INNER JOIN users u ON u.id = t.user_id
      WHERE t.token = ?
        AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`,
    [token]
  );
}

async function revokeToken(token) {
  if (!token) {
    return;
  }
  await run('DELETE FROM auth_tokens WHERE token = ?', [token]);
}

async function pruneExpiredTokens() {
  await run(
    'DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND expires_at <= datetime(\'now\')'
  );
}

module.exports = {
  issueToken,
  getUserForToken,
  revokeToken,
  pruneExpiredTokens
};
