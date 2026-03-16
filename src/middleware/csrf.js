const { doubleCsrf } = require('csrf-csrf');
const config = require('../config');

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.session.secret,
  getSessionIdentifier: () => 'csrf-sid',
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/'
  },
  getCsrfTokenFromRequest: (req) => {
    return req.body?._csrf || req.headers['x-csrf-token'];
  }
});

// Wrapper that ensures req.cookies exists before csrf-csrf runs
const csrfProtection = (req, res, next) => {
  if (!req.cookies) req.cookies = {};
  doubleCsrfProtection(req, res, next);
};

const safeGenerateCsrfToken = (req, res) => {
  if (!req.cookies) req.cookies = {};
  return generateCsrfToken(req, res);
};

module.exports = { generateCsrfToken: safeGenerateCsrfToken, csrfProtection };
