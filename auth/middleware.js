const { getUserForToken } = require('./session');

function extractToken(req) {
  const header = req.headers['authorization'];
  if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (req.headers['x-auth-token']) {
    return String(req.headers['x-auth-token']);
  }
  return null;
}

function authenticate(req, res, next) {
  (async () => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const user = await getUserForToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.user = user;
    req.authToken = token;
    next();
  })().catch((err) => {
    next(err);
  });
}

function optionalAuth(req, res, next) {
  (async () => {
    const token = extractToken(req);
    if (!token) {
      req.user = null;
      return next();
    }
    const user = await getUserForToken(token);
    if (!user) {
      req.user = null;
      req.authToken = null;
      return next();
    }
    req.user = user;
    req.authToken = token;
    next();
  })().catch((err) => next(err));
}

module.exports = {
  authenticate,
  optionalAuth
};
