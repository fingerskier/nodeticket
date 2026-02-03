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

/**
 * Forgot password - generate reset token
 */
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw ApiError.badRequest('Email is required');
  }

  // Look up in both user and staff tables
  let account = null;
  let resetType = null;
  let resetId = null;

  // Check staff first
  const staff = await db.queryOne(
    `SELECT staff_id, email, firstname, lastname FROM ${db.table('staff')} WHERE email = ? AND isactive = 1`,
    [email]
  );

  if (staff) {
    resetType = 'staff';
    resetId = staff.staff_id;
  } else {
    // Check user accounts
    account = await db.queryOne(
      `SELECT u.id as user_id, ue.address as email, u.name
       FROM ${db.table('user')} u
       JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
       LEFT JOIN ${db.table('user_account')} ua ON ua.user_id = u.id
       WHERE ue.address = ? AND ua.status = 1`,
      [email]
    );

    if (account) {
      resetType = 'user';
      resetId = account.user_id;
    }
  }

  // Always return success to prevent email enumeration
  const genericMessage = 'If an account exists with that email, a password reset link has been generated.';

  if (!resetType) {
    // No account found — still return success for security
    return res.json({ success: true, message: genericMessage });
  }

  // Generate reset token (1 hour expiry)
  const resetToken = jwt.sign(
    { id: resetId, type: resetType, purpose: 'password-reset' },
    config.jwt.secret,
    { expiresIn: '1h' }
  );

  const helpdeskUrl = config.helpdesk.url.replace(/\/$/, '');
  const resetUrl = `${helpdeskUrl}/reset-password?token=${resetToken}`;

  // Log reset link to console (email not configured)
  console.log(`\n=== PASSWORD RESET ===`);
  console.log(`Account: ${email} (${resetType})`);
  console.log(`Reset URL: ${resetUrl}`);
  console.log(`Expires: 1 hour`);
  console.log(`======================\n`);

  const response = { success: true, message: genericMessage };

  // In development mode, include the reset URL for easy testing
  if (config.env === 'development') {
    response.resetUrl = resetUrl;
  }

  res.json(response);
};

/**
 * Reset password - validate token and update password
 */
const resetPassword = async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw ApiError.badRequest('Token and new password are required');
  }

  if (password.length < 6) {
    throw ApiError.badRequest('Password must be at least 6 characters');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  if (decoded.purpose !== 'password-reset') {
    throw ApiError.badRequest('Invalid reset token');
  }

  // Hash the new password
  const hashedPassword = await bcrypt.hash(password, 10);

  if (decoded.type === 'staff') {
    await db.query(
      `UPDATE ${db.table('staff')} SET passwd = ?, updated = NOW() WHERE staff_id = ?`,
      [hashedPassword, decoded.id]
    );
  } else {
    await db.query(
      `UPDATE ${db.table('user_account')} SET passwd = ? WHERE user_id = ?`,
      [hashedPassword, decoded.id]
    );
  }

  res.json({ success: true, message: 'Password has been reset successfully' });
};

module.exports = {
  login,
  logout,
  me,
  refresh,
  forgotPassword,
  resetPassword
};
