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
    // User login (allow unverified users to log in so they can resend verification)
    const account = await db.queryOne(
      `SELECT ua.*, u.id as user_id, u.name, ue.address as email
       FROM ${db.table('user_account')} ua
       JOIN ${db.table('user')} u ON ua.user_id = u.id
       LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
       WHERE ua.username = ?`,
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
      type: 'user',
      verified: account.status === 1
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

  const { sendEmail } = require('../lib/email');
  await sendEmail(email, 'Password Reset', `<p>Click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`);

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

  if (password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters');
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

/**
 * Register - create a new user account
 */
const register = async (req, res) => {
  const { name, email, username, password, confirm } = req.body;

  // Validate inputs
  if (!name) {
    throw ApiError.badRequest('Name is required');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest('A valid email address is required');
  }
  if (!username || username.length < 3) {
    throw ApiError.badRequest('Username must be at least 3 characters');
  }
  if (!password || password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters');
  }
  if (confirm !== undefined && password !== confirm) {
    throw ApiError.badRequest('Passwords do not match');
  }

  // Check email uniqueness
  const existingEmail = await db.queryOne(
    `SELECT id FROM ${db.table('user_email')} WHERE address = ?`,
    [email]
  );
  if (existingEmail) {
    throw ApiError.badRequest('An account with that email already exists');
  }

  // Check username uniqueness
  const existingUsername = await db.queryOne(
    `SELECT user_id FROM ${db.table('user_account')} WHERE username = ?`,
    [username]
  );
  if (existingUsername) {
    throw ApiError.badRequest('That username is already taken');
  }

  // Create user record
  const userResult = await db.query(
    `INSERT INTO ${db.table('user')} SET name = ?, status = 0, org_id = 0, default_email_id = 0, created = NOW(), updated = NOW()`,
    [name]
  );
  const userId = userResult.insertId;

  // Create email record
  const emailResult = await db.query(
    `INSERT INTO ${db.table('user_email')} SET user_id = ?, address = ?, flags = 0`,
    [userId, email]
  );
  const emailId = emailResult.insertId;

  // Update user with default email
  await db.query(
    `UPDATE ${db.table('user')} SET default_email_id = ? WHERE id = ?`,
    [emailId, userId]
  );

  // Hash password and create account
  const hashedPassword = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO ${db.table('user_account')} SET user_id = ?, status = 0, username = ?, passwd = ?, registered = NOW()`,
    [userId, username, hashedPassword]
  );

  // Generate verification token
  const verifyToken = jwt.sign(
    { id: userId, email, purpose: 'email-verify' },
    config.jwt.secret,
    { expiresIn: '24h' }
  );

  // Send verification email
  const { sendEmail } = require('../lib/email');
  const verifyUrl = `${config.helpdesk.url.replace(/\/$/, '')}/api/v1/auth/verify-email?token=${verifyToken}`;
  await sendEmail(email, 'Verify Your Email', `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`);

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email to verify your account.',
    user: { id: userId, name, email, username, verified: false }
  });
};

/**
 * Verify email - validate token and activate account
 */
const verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    throw ApiError.badRequest('Verification token is required');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  if (decoded.purpose !== 'email-verify') {
    throw ApiError.badRequest('Invalid verification token');
  }

  await db.query(
    `UPDATE ${db.table('user_account')} SET status = 1 WHERE user_id = ?`,
    [decoded.id]
  );

  // Check Accept header to determine response type
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

  if (acceptsHtml) {
    return res.redirect('/?verified=true');
  }

  res.json({ success: true, message: 'Email verified successfully' });
};

/**
 * Resend verification email
 */
const resendVerification = async (req, res) => {
  if (!req.auth) {
    throw ApiError.unauthorized('Authentication required');
  }

  const account = await db.queryOne(
    `SELECT status FROM ${db.table('user_account')} WHERE user_id = ?`,
    [req.auth.id]
  );

  if (account && account.status === 1) {
    return res.json({ success: true, message: 'Email is already verified' });
  }

  const userRow = await db.queryOne(
    `SELECT ue.address FROM ${db.table('user')} u JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id WHERE u.id = ?`,
    [req.auth.id]
  );

  if (!userRow) {
    throw ApiError.badRequest('User not found');
  }

  const email = userRow.address;

  const verifyToken = jwt.sign(
    { id: req.auth.id, email, purpose: 'email-verify' },
    config.jwt.secret,
    { expiresIn: '24h' }
  );

  const { sendEmail } = require('../lib/email');
  const verifyUrl = `${config.helpdesk.url.replace(/\/$/, '')}/api/v1/auth/verify-email?token=${verifyToken}`;
  await sendEmail(email, 'Verify Your Email', `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`);

  res.json({ success: true, message: 'Verification email sent' });
};

module.exports = {
  login,
  logout,
  me,
  refresh,
  forgotPassword,
  resetPassword,
  register,
  verifyEmail,
  resendVerification
};
