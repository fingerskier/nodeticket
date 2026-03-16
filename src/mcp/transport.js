/**
 * MCP Transport Layer
 *
 * Creates per-session MCP servers with StreamableHTTP transport.
 * Handles JWT validation and session lifecycle.
 */

const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { registerTools } = require('./tools');

// Per-session state
const sessions = new Map();

const SESSION_IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Periodic session cleanup (unref to allow clean shutdown)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_IDLE_TIMEOUT) {
      session.transport.close?.();
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL).unref();

/**
 * JWT validation middleware for MCP endpoints
 */
const validateMcpJwt = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const token = authHeader.slice(7);
    req.userAuth = jwt.verify(token, config.mcp.jwt.secret);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * POST /mcp — Handle MCP JSON-RPC requests
 */
const handlePost = async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  if (sessionId && sessions.has(sessionId)) {
    // Reuse existing session
    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    return session.transport.handleRequest(req, res);
  }

  // Create new session
  const server = new McpServer({
    name: 'nodeticket',
    version: '1.0.0'
  });

  registerTools(server, req.userAuth);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await server.connect(transport);

  // HACK: Capture the session ID via writeHead override — the SDK sets the
  // mcp-session-id header internally and doesn't expose a callback for it.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function (statusCode, ...args) {
    const newSessionId = res.getHeader('mcp-session-id');
    if (newSessionId && !sessions.has(newSessionId)) {
      sessions.set(newSessionId, {
        server,
        transport,
        userAuth: req.userAuth,
        lastActivity: Date.now()
      });
    }
    return origWriteHead(statusCode, ...args);
  };

  return transport.handleRequest(req, res);
};

/**
 * GET /mcp — SSE stream for server-initiated messages
 */
const handleGet = async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({ error: 'Invalid or missing session' });
  }

  const session = sessions.get(sessionId);
  session.lastActivity = Date.now();
  return session.transport.handleRequest(req, res);
};

/**
 * DELETE /mcp — Teardown session
 */
const handleDelete = async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({ error: 'Invalid or missing session' });
  }

  const session = sessions.get(sessionId);
  session.transport.close?.();
  sessions.delete(sessionId);

  res.status(200).json({ ok: true });
};

module.exports = {
  validateMcpJwt,
  handlePost,
  handleGet,
  handleDelete
};
