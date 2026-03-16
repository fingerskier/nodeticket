const { doubleCsrf } = require('csrf-csrf');
const config = require('../config');

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.session.secret,
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/'
  },
  getTokenFromRequest: (req) => {
    return req.body?._csrf || req.headers['x-csrf-token'];
  }
});

module.exports = { generateToken, csrfProtection: doubleCsrfProtection };
