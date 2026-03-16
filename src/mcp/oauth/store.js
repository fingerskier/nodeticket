/**
 * OAuth In-Memory Store
 *
 * Stores registered clients and authorization codes.
 * Data is ephemeral — MCP clients re-register on each connection.
 */

const clients = new Map();
const authCodes = new Map();

const CODE_TTL = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup of expired codes (unref to allow clean shutdown)
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes) {
    if (data.expires_at < now) {
      authCodes.delete(code);
    }
  }
}, 60 * 1000).unref();

const saveClient = (clientData) => {
  clients.set(clientData.client_id, clientData);
};

const getClient = (clientId) => {
  return clients.get(clientId) || null;
};

const saveAuthCode = (code, data) => {
  authCodes.set(code, {
    ...data,
    expires_at: Date.now() + CODE_TTL
  });
};

const getAuthCode = (code) => {
  const data = authCodes.get(code);
  if (!data) return null;
  if (data.expires_at < Date.now()) {
    authCodes.delete(code);
    return null;
  }
  return data;
};

const deleteAuthCode = (code) => {
  authCodes.delete(code);
};

module.exports = {
  saveClient,
  getClient,
  saveAuthCode,
  getAuthCode,
  deleteAuthCode
};
