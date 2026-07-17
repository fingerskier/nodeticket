const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// Ensure predictable secrets for unit tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

const {
  TOKEN_USE,
  signAccessToken,
  signPurposeToken,
  verifyJwt,
  isAccessPrincipal,
  isRefreshableAccessToken,
  isPurposeToken,
} = require('../src/lib/tokens');
const config = require('../src/config');

describe('JWT token_use isolation', () => {
  test('access token is an access principal', () => {
    const token = signAccessToken({
      id: 1,
      type: 'user',
      name: 'Test',
    });
    const payload = verifyJwt(token);
    assert.equal(payload.token_use, TOKEN_USE.ACCESS);
    assert.equal(isAccessPrincipal(payload), true);
    assert.equal(isRefreshableAccessToken(payload), true);
  });

  test('password-reset token is NOT an access principal', () => {
    const token = signPurposeToken(
      { id: 5, type: 'user' },
      TOKEN_USE.PASSWORD_RESET,
      '1h'
    );
    const payload = verifyJwt(token);
    assert.equal(payload.token_use, TOKEN_USE.PASSWORD_RESET);
    assert.equal(isAccessPrincipal(payload), false);
    assert.equal(isRefreshableAccessToken(payload), false);
    assert.equal(isPurposeToken(payload, TOKEN_USE.PASSWORD_RESET), true);
  });

  test('email-verify token is NOT an access principal', () => {
    const token = signPurposeToken(
      { id: 9, email: 'a@b.c' },
      TOKEN_USE.EMAIL_VERIFY,
      '24h'
    );
    const payload = verifyJwt(token);
    assert.equal(isAccessPrincipal(payload), false);
    assert.equal(isPurposeToken(payload, TOKEN_USE.EMAIL_VERIFY), true);
    // No type on verify tokens — must not become a principal
    assert.notEqual(payload.type, 'user');
    assert.notEqual(payload.type, 'staff');
  });

  test('legacy purpose claim without token_use still rejected as access', () => {
    const token = jwt.sign(
      { id: 1, type: 'staff', purpose: 'password-reset' },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    const payload = verifyJwt(token);
    assert.equal(isAccessPrincipal(payload), false);
  });

  test('unknown principal type fails closed', () => {
    const token = jwt.sign(
      { id: 1, type: 'agent', token_use: 'access' },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    const payload = verifyJwt(token);
    assert.equal(isAccessPrincipal(payload), false);
  });

  test('missing type fails closed', () => {
    const token = jwt.sign(
      { id: 1, token_use: 'access' },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    const payload = verifyJwt(token);
    assert.equal(isAccessPrincipal(payload), false);
  });

  test('legacy access token without token_use still accepted if type staff|user', () => {
    const token = jwt.sign(
      { id: 3, type: 'staff', name: 'Admin', isAdmin: true },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    const payload = verifyJwt(token);
    assert.equal(isAccessPrincipal(payload), true);
    assert.equal(isRefreshableAccessToken(payload), true);
  });
});
