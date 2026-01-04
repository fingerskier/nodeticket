/**
 * Authentication Middleware
 *
 * Handles JWT and API key authentication for the API.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../lib/db');

/**
 * Verify JWT token from Authorization header
 */
const verifyToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded;
  } catch (err) {
    return null;
  }
};

/**
 * Verify API key from X-API-Key header
 */
const verifyApiKey = async (req) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return null;
  }

  try {
    const key = await db.queryOne(
      `SELECT * FROM ${db.table('api_key')} WHERE apikey = ? AND isactive = 1`,
      [apiKey]
    );

    if (!key) {
      return null;
    }

    // Check IP restriction if configured
    if (key.ipaddr && key.ipaddr !== '0.0.0.0') {
      const clientIp = req.ip || req.connection.remoteAddress;
      if (key.ipaddr !== clientIp) {
        return null;
      }
    }

    return {
      type: 'apikey',
      id: key.id,
      permissions: {
        can_create_tickets: !!key.can_create_tickets,
        can_exec_cron: !!key.can_exec_cron
      }
    };
  } catch (err) {
    console.error('API key verification error:', err.message);
    return null;
  }
};

/**
 * Authentication middleware - requires authentication
 */
const authenticate = async (req, res, next) => {
  // Try JWT first
  let auth = await verifyToken(req);

  // Try API key if JWT not present
  if (!auth) {
    auth = await verifyApiKey(req);
  }

  // Try session (for HTML interface)
  if (!auth && req.session?.user) {
    auth = req.session.user;
  }

  if (!auth) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  req.auth = auth;
  next();
};

/**
 * Optional authentication - populates req.auth if authenticated
 */
const optionalAuth = async (req, res, next) => {
  let auth = await verifyToken(req);

  if (!auth) {
    auth = await verifyApiKey(req);
  }

  if (!auth && req.session?.user) {
    auth = req.session.user;
  }

  req.auth = auth || null;
  next();
};

/**
 * Require staff authentication
 */
const requireStaff = async (req, res, next) => {
  await authenticate(req, res, () => {
    if (req.auth?.type === 'apikey') {
      return next(); // API keys are treated as staff
    }

    if (req.auth?.type !== 'staff') {
      return res.status(403).json({
        success: false,
        message: 'Staff access required'
      });
    }

    next();
  });
};

/**
 * Require admin authentication
 */
const requireAdmin = async (req, res, next) => {
  await requireStaff(req, res, () => {
    if (req.auth?.type === 'apikey') {
      return next(); // API keys are treated as admin
    }

    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Administrator access required'
      });
    }

    next();
  });
};

/**
 * Require specific permission
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    await requireStaff(req, res, () => {
      // API keys bypass permission checks for now
      if (req.auth?.type === 'apikey') {
        return next();
      }

      // Check permissions from role
      const permissions = req.auth?.permissions || {};
      if (!permissions[permission]) {
        return res.status(403).json({
          success: false,
          message: `Permission denied: ${permission}`
        });
      }

      next();
    });
  };
};

/**
 * Check if user can access ticket
 */
const canAccessTicket = async (req, res, next) => {
  const ticketId = req.params.id;

  if (!ticketId) {
    return next();
  }

  // Staff can access all tickets in their department
  if (req.auth?.type === 'staff' || req.auth?.type === 'apikey') {
    return next();
  }

  // Users can only access their own tickets
  if (req.auth?.type === 'user') {
    try {
      const ticket = await db.queryOne(
        `SELECT user_id FROM ${db.table('ticket')} WHERE ticket_id = ?`,
        [ticketId]
      );

      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found'
        });
      }

      if (ticket.user_id !== req.auth.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Error checking ticket access'
      });
    }
  }

  next();
};

module.exports = {
  authenticate,
  optionalAuth,
  requireStaff,
  requireAdmin,
  requirePermission,
  canAccessTicket,
  verifyToken,
  verifyApiKey
};
