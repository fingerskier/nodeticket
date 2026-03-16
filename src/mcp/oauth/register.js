/**
 * OAuth Dynamic Client Registration (RFC 7591)
 */

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');

const router = Router();

router.post('/', (req, res) => {
  const { redirect_uris, client_name } = req.body;

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
  }

  const client_id = uuidv4();

  const clientData = {
    client_id,
    redirect_uris,
    client_name: client_name || 'MCP Client',
    created_at: Date.now()
  };

  store.saveClient(clientData);

  res.status(201).json({
    client_id,
    redirect_uris,
    client_name: clientData.client_name,
    token_endpoint_auth_method: 'none'
  });
});

module.exports = router;
