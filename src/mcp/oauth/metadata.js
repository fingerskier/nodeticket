/**
 * OAuth Authorization Server Metadata (RFC 8414)
 */

const { Router } = require('express');
const config = require('../../config');

const router = Router();

router.get('/oauth-authorization-server', (req, res) => {
  const issuer = config.helpdesk.url;

  res.json({
    issuer,
    authorization_endpoint: `${issuer}/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/mcp/oauth/token`,
    registration_endpoint: `${issuer}/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  });
});

module.exports = router;
