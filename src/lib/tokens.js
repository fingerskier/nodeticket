/**
 * JWT purpose helpers — access vs purpose tokens must never be interchangeable.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

const TOKEN_USE = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFY: 'email_verify',
};

/**
 * Sign an access token for an authenticated principal.
 * @param {Object} principal - Must include type ('staff'|'user') and id
 * @param {Object} [options]
 * @returns {string}
 */
function signAccessToken(principal, options = {}) {
  const { iat, exp, token_use, purpose, ...rest } = principal;
  const payload = {
    ...rest,
    token_use: TOKEN_USE.ACCESS,
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: options.expiresIn || config.jwt.expiresIn,
  });
}

/**
 * Sign a single-purpose token (password reset / email verify).
 * @param {Object} claims
 * @param {string} tokenUse - TOKEN_USE.PASSWORD_RESET | EMAIL_VERIFY
 * @param {string} expiresIn
 * @returns {string}
 */
function signPurposeToken(claims, tokenUse, expiresIn) {
  if (tokenUse !== TOKEN_USE.PASSWORD_RESET && tokenUse !== TOKEN_USE.EMAIL_VERIFY) {
    throw new Error(`Invalid purpose token_use: ${tokenUse}`);
  }
  const payload = {
    ...claims,
    token_use: tokenUse,
    // Keep legacy purpose claim for existing consumers that check it
    purpose:
      tokenUse === TOKEN_USE.PASSWORD_RESET ? 'password-reset' : 'email-verify',
  };
  return jwt.sign(payload, config.jwt.secret, { expiresIn });
}

/**
 * Verify a JWT and return payload, or null on failure.
 * @param {string} token
 * @param {Object} [options] - passed to jwt.verify (e.g. ignoreExpiration)
 * @returns {Object|null}
 */
function verifyJwt(token, options = {}) {
  try {
    return jwt.verify(token, config.jwt.secret, options);
  } catch {
    return null;
  }
}

/**
 * True if payload is a valid access principal (not a purpose token).
 * Fail closed for missing/unknown type or non-access token_use.
 * @param {Object|null} payload
 * @returns {boolean}
 */
function isAccessPrincipal(payload) {
  if (!payload || typeof payload !== 'object') return false;

  // Reject purpose tokens (new token_use and legacy purpose claim)
  const use = payload.token_use;
  if (use && use !== TOKEN_USE.ACCESS && use !== TOKEN_USE.REFRESH) {
    return false;
  }
  if (payload.purpose === 'password-reset' || payload.purpose === 'email-verify') {
    return false;
  }
  // Legacy access tokens omit token_use — allow only if type is staff|user
  if (use === TOKEN_USE.REFRESH) return false;

  if (payload.type !== 'staff' && payload.type !== 'user') {
    return false;
  }
  if (payload.id === undefined || payload.id === null) {
    return false;
  }
  return true;
}

/**
 * True if this token may be refreshed into a new access token.
 * @param {Object|null} payload
 * @returns {boolean}
 */
function isRefreshableAccessToken(payload) {
  if (!isAccessPrincipal(payload)) return false;
  // Only access (or legacy access without token_use) — never purpose
  return !payload.token_use || payload.token_use === TOKEN_USE.ACCESS;
}

/**
 * Map purpose claim / token_use for purpose-token endpoints.
 * @param {Object} payload
 * @param {'password_reset'|'email_verify'} expected
 * @returns {boolean}
 */
function isPurposeToken(payload, expected) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.token_use === expected) return true;
  if (expected === TOKEN_USE.PASSWORD_RESET && payload.purpose === 'password-reset') {
    return true;
  }
  if (expected === TOKEN_USE.EMAIL_VERIFY && payload.purpose === 'email-verify') {
    return true;
  }
  return false;
}

module.exports = {
  TOKEN_USE,
  signAccessToken,
  signPurposeToken,
  verifyJwt,
  isAccessPrincipal,
  isRefreshableAccessToken,
  isPurposeToken,
};
