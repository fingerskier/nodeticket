/**
 * Authentication Controller
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Login - authenticate user or staff
 */
const login = async (req, res) => {
  const { username, password, type = 'staff' } = req.body;

  if (!username || !password) {
    throw ApiError.badRequest('Username and password are required');
  }

  let user = null;
  let userData = null;

  if (type === 'staff') {
    // Staff login
    user = await db.queryOne(
      `SELECT s.*, r.permissions as role_permissions
       FROM ${db.table('staff')} s
       LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
       WHERE (s.username = ? OR s.email = ?) AND s.isactive = 1`,
      [username, username]
    );

    if (!user) {
      throw ApiError.unauthorized('Invalid credentials');
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwd);
    if (!validPassword) {
      throw ApiError.unauthorized('Invalid credentials');
    }

    userData = {
      id: user.staff_id,
      username: user.username,
      name: `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.username,
      email: user.email,
      isAdmin: !!user.isadmin,
      type: 'staff',
      deptId: user.dept_id,
      roleId: user.role_id,
      permissions: user.role_permissions ? JSON.parse(user.role_permissions) : {}
    };
  } else {
    // User login
    const account = await db.queryOne(
      `SELECT ua.*, u.id as user_id, u.name, ue.address as email
       FROM ${db.table('user_account')} ua
       JOIN ${db.table('user')} u ON ua.user_id = u.id
       LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
       WHERE ua.username = ? AND ua.status = 1`,
      [username]
    );

    if (!account) {
      throw ApiError.unauthorized('Invalid credentials');
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, account.passwd);
    if (!validPassword) {
      throw ApiError.unauthorized('Invalid credentials');
    }

    userData = {
      id: account.user_id,
      username: account.username,
      name: account.name,
      email: account.email,
      isAdmin: false,
      type: 'user'
    };
  }

  // Generate JWT token
  const token = jwt.sign(userData, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  });

  // Store in session for HTML interface
  req.session.user = userData;

  res.json({
    success: true,
    token,
    user: userData
  });
};

/**
 * Logout - end session
 */
const logout = async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

/**
 * Get current user info
 */
const me = async (req, res) => {
  res.json({
    success: true,
    user: req.auth
  });
};

/**
 * Refresh token
 */
const refresh = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    throw ApiError.badRequest('Token is required');
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret, { ignoreExpiration: true });

    // Check if token is not too old (allow refresh within 7 days of expiry)
    const expiresAt = decoded.exp * 1000;
    const maxRefreshWindow = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (Date.now() - expiresAt > maxRefreshWindow) {
      throw ApiError.unauthorized('Token is too old to refresh');
    }

    // Generate new token
    const { iat, exp, ...userData } = decoded;
    const newToken = jwt.sign(userData, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });

    res.json({
      success: true,
      token: newToken
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.unauthorized('Invalid token');
  }
};

module.exports = {
  login,
  logout,
  me,
  refresh
};
