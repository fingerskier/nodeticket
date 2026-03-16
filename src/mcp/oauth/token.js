/**
 * OAuth Token Endpoint
 *
 * Exchanges authorization code + PKCE verifier for a JWT.
 */

const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const store = require('./store');
const { verifyChallenge } = require('./pkce');

const router = Router();

router.post('/', (req, res) => {
  const { grant_type, code, code_verifier, client_id, redirect_uri } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (!code || !code_verifier || !client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }

  const authCode = store.getAuthCode(code);
  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
  }

  // Validate client and redirect_uri match
  if (authCode.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch' });
  }

  if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  // Verify PKCE
  if (!verifyChallenge(code_verifier, authCode.code_challenge)) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  // Consume the code (one-time use)
  store.deleteAuthCode(code);

  // Sign JWT with the original user auth payload, stripping stale JWT claims
  const { iat, exp, nbf, ...payload } = authCode.user_auth;
  const expiresIn = config.mcp.jwt.expiresIn;
  const access_token = jwt.sign(payload, config.mcp.jwt.secret, { expiresIn });

  // Parse expiresIn string to seconds for response
  const expiresInSeconds = parseExpiresIn(expiresIn);

  res.json({
    access_token,
    token_type: 'bearer',
    expires_in: expiresInSeconds
  });
});

function parseExpiresIn(value) {
  if (typeof value === 'number') return value;
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 28800; // default 8h
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return 28800;
  }
}

module.exports = router;
