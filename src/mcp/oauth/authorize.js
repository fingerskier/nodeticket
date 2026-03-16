/**
 * OAuth Authorization Endpoint
 *
 * GET  — Show consent (requires session auth)
 * POST — Issue authorization code and redirect
 */

const { Router } = require('express');
const crypto = require('crypto');
const { authenticate } = require('../../middleware/auth');
const store = require('./store');

const router = Router();

/**
 * GET /mcp/oauth/authorize
 * Validates params, then auto-approves for authenticated users.
 */
router.get('/', authenticate, (req, res) => {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state } = req.query;

  const client = store.getClient(client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Unknown client_id' });
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
  }

  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'PKCE S256 required' });
  }

  // Auto-approve: generate code and redirect
  const code = crypto.randomBytes(32).toString('hex');

  store.saveAuthCode(code, {
    client_id,
    redirect_uri,
    user_auth: req.auth,
    code_challenge,
    code_challenge_method
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  res.redirect(url.toString());
});

/**
 * POST /mcp/oauth/authorize
 * Alternative: accept form submission for consent flow.
 */
router.post('/', authenticate, (req, res) => {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state } = req.body;

  const client = store.getClient(client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Unknown client_id' });
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
  }

  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'PKCE S256 required' });
  }

  const code = crypto.randomBytes(32).toString('hex');

  store.saveAuthCode(code, {
    client_id,
    redirect_uri,
    user_auth: req.auth,
    code_challenge,
    code_challenge_method
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  res.redirect(url.toString());
});

module.exports = router;
