/**
 * Authentication Middleware
 *
 * JWT access tokens, session principals, and API keys (capability-only).
 * API keys never become native staff/admin principals.
 */

const config = require('../config');
const db = require('../lib/db');
const {
  verifyJwt,
  isAccessPrincipal,
} = require('../lib/tokens');
const {
  hasPermission,
  staffCanAccessTicket,
} = require('../lib/authz');

/**
 * Verify JWT access token from Authorization header.
 * Rejects purpose tokens and unknown principal types.
 */
const verifyToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const decoded = verifyJwt(token);
  if (!isAccessPrincipal(decoded)) {
    return null;
  }
  return decoded;
};

/**
 * Verify API key from X-API-Key header.
 * Returns type 'apikey' with capability flags only — not staff/admin.
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
      const clientIp = req.ip || req.connection?.remoteAddress;
      if (key.ipaddr !== clientIp) {
        return null;
      }
    }

    return {
      type: 'apikey',
      id: key.id,
      // Never use key.id as staff_id
      permissions: {
        can_create_tickets: !!key.can_create_tickets,
        can_exec_cron: !!key.can_exec_cron,
      },
    };
  } catch (err) {
    console.error('API key verification error:', err.message);
    return null;
  }
};

/**
 * Session principal if still valid (idle timeout).
 */
const verifySession = (req, res) => {
  if (!req.session?.user) return null;

  const now = Date.now();
  const lastActivity = req.session.lastActivity || now;
  if (now - lastActivity > config.session.idleTimeout) {
    req.session.destroy(() => {});
    return { expired: true };
  }
  req.session.lastActivity = now;

  const user = req.session.user;
  // Session must still look like an access principal
  if (user.type !== 'staff' && user.type !== 'user') {
    return null;
  }
  if (user.id === undefined || user.id === null) {
    return null;
  }
  return user;
};

/**
 * Authentication middleware - requires JWT access, session, or API key.
 * Note: API key auth only establishes an apikey principal (not staff).
 */
const authenticate = async (req, res, next) => {
  let auth = await verifyToken(req);

  if (!auth) {
    auth = await verifyApiKey(req);
  }

  if (!auth) {
    const sessionResult = verifySession(req, res);
    if (sessionResult?.expired) {
      return res.status(401).json({
        success: false,
        message: 'Session expired',
        code: 'IDLE_TIMEOUT',
      });
    }
    auth = sessionResult;
  }

  if (!auth) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  // Fail closed: only staff, user, or apikey
  if (auth.type !== 'staff' && auth.type !== 'user' && auth.type !== 'apikey') {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
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

  if (!auth) {
    const sessionResult = verifySession(req, res);
    if (sessionResult?.expired) {
      req.auth = null;
      return next();
    }
    auth = sessionResult;
  }

  if (auth && auth.type !== 'staff' && auth.type !== 'user' && auth.type !== 'apikey') {
    auth = null;
  }

  req.auth = auth || null;
  next();
};

/**
 * Require staff authentication (never satisfied by API keys alone).
 */
const requireStaff = async (req, res, next) => {
  await authenticate(req, res, () => {
    if (req.auth?.type !== 'staff') {
      return res.status(403).json({
        success: false,
        message: 'Staff access required',
      });
    }
    next();
  });
};

/**
 * Require admin authentication (never satisfied by API keys alone).
 */
const requireAdmin = async (req, res, next) => {
  await requireStaff(req, res, () => {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Administrator access required',
      });
    }
    next();
  });
};

/**
 * Require specific staff role permission.
 * API keys never pass.
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    await requireStaff(req, res, () => {
      if (!hasPermission(req.auth, permission)) {
        return res.status(403).json({
          success: false,
          message: `Permission denied: ${permission}`,
        });
      }
      next();
    });
  };
};

/**
 * Require an API key with a specific capability (official/compat routes).
 * Does not establish a staff principal.
 */
const requireApiKeyCapability = (capability) => {
  return async (req, res, next) => {
    const keyAuth = await verifyApiKey(req);
    if (!keyAuth) {
      return res.status(401).json({
        success: false,
        message: 'Valid API key required',
      });
    }
    if (!keyAuth.permissions?.[capability]) {
      return res.status(401).json({
        success: false,
        message: 'API key does not have required permission',
      });
    }
    req.auth = keyAuth;
    next();
  };
};

/**
 * Load ticket row for access checks.
 */
async function loadTicketAccessRow(ticketId) {
  return db.queryOne(
    `SELECT ticket_id, user_id, dept_id, staff_id, team_id
     FROM ${db.table('ticket')} WHERE ticket_id = ?`,
    [ticketId]
  );
}

/**
 * Check if principal can access ticket — fail closed for unknown types.
 */
const canAccessTicket = async (req, res, next) => {
  const ticketId = req.params.id;

  if (!ticketId) {
    return next();
  }

  // API keys have no native ticket access (use official create only)
  if (req.auth?.type === 'apikey') {
    return res.status(403).json({
      success: false,
      message: 'Access denied',
    });
  }

  if (req.auth?.type === 'staff') {
    try {
      const ticket = await loadTicketAccessRow(ticketId);
      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found',
        });
      }
      if (!staffCanAccessTicket(req.auth, ticket)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
      req.ticketAccess = ticket;
      return next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Error checking ticket access',
      });
    }
  }

  if (req.auth?.type === 'user') {
    try {
      const ticket = await loadTicketAccessRow(ticketId);

      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found',
        });
      }

      if (parseInt(ticket.user_id, 10) !== parseInt(req.auth.id, 10)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
      req.ticketAccess = ticket;
      return next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Error checking ticket access',
      });
    }
  }

  // Unknown type — fail closed
  return res.status(403).json({
    success: false,
    message: 'Access denied',
  });
};

/**
 * Require email verification for user accounts
 */
const requireVerified = async (req, res, next) => {
  try {
    if (req.auth?.type === 'user') {
      const account = await db.queryOne(
        `SELECT status FROM ${db.table('user_account')} WHERE user_id = ?`,
        [req.auth.id]
      );
      if (!account || account.status !== 1) {
        return res.status(403).json({
          success: false,
          message: 'Email verification required',
          code: 'UNVERIFIED',
        });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  requireStaff,
  requireAdmin,
  requirePermission,
  requireApiKeyCapability,
  canAccessTicket,
  requireVerified,
  verifyToken,
  verifyApiKey,
  hasPermission,
};
