/**
 * Authentication Controller — thin HTTP adapter
 *
 * Uses SDK for password/credential operations.
 * JWT, sessions, and email flows remain here (HTTP-layer concerns).
 */

const config = require('../config');
const db = require('../lib/db');
const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');
const {
  TOKEN_USE,
  signAccessToken,
  signPurposeToken,
  verifyJwt,
  isRefreshableAccessToken,
  isPurposeToken,
} = require('../lib/tokens');
const { parsePermissions } = require('../lib/authz');

/**
 * Load department access + team membership for staff visibility.
 */
async function loadStaffScope(staffId, primaryDeptId) {
  const deptIds = [];
  if (primaryDeptId != null) {
    const d = parseInt(primaryDeptId, 10);
    if (!isNaN(d)) deptIds.push(d);
  }

  try {
    const extra = await db.query(
      `SELECT dept_id FROM ${db.table('staff_dept_access')} WHERE staff_id = ?`,
      [staffId]
    );
    for (const row of extra) {
      const d = parseInt(row.dept_id, 10);
      if (!isNaN(d) && !deptIds.includes(d)) deptIds.push(d);
    }
  } catch {
    // table may be missing on partial fixtures
  }

  let teamIds = [];
  try {
    const teams = await db.query(
      `SELECT team_id FROM ${db.table('team_member')} WHERE staff_id = ?`,
      [staffId]
    );
    teamIds = teams.map((t) => parseInt(t.team_id, 10)).filter((n) => !isNaN(n));
  } catch {
    // ignore
  }

  return { deptIds, teamIds };
}

/**
 * Login - authenticate user or staff
 */
const login = async (req, res) => {
  const { username, password, type = 'staff' } = req.body;

  if (!username || !password) {
    throw ApiError.badRequest('Username and password are required');
  }

  const sdk = getSdk();
  let userData = null;

  if (type === 'staff') {
    const user = await sdk.auth.lookupStaffByCredentials(username);
    if (!user) throw ApiError.unauthorized('Invalid credentials');

    const valid = await sdk.auth.verifyPassword(password, user.passwd);
    if (!valid) throw ApiError.unauthorized('Invalid credentials');

    const scope = await loadStaffScope(user.staff_id, user.dept_id);

    userData = {
      id: user.staff_id,
      username: user.username,
      name: `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.username,
      email: user.email,
      isAdmin: !!user.isadmin,
      type: 'staff',
      deptId: user.dept_id,
      roleId: user.role_id,
      assignedOnly: !!user.assigned_only,
      deptIds: scope.deptIds,
      teamIds: scope.teamIds,
      permissions: parsePermissions(user.role_permissions),
    };
  } else {
    const account = await sdk.auth.lookupUserByCredentials(username);
    if (!account) throw ApiError.unauthorized('Invalid credentials');

    const valid = await sdk.auth.verifyPassword(password, account.passwd);
    if (!valid) throw ApiError.unauthorized('Invalid credentials');

    userData = {
      id: account.user_id,
      username: account.username,
      name: account.name,
      email: account.email,
      isAdmin: false,
      type: 'user',
      verified: account.status === 1,
    };
  }

  // Rotate session id on login (session fixation)
  await new Promise((resolve) => {
    if (typeof req.session.regenerate === 'function') {
      req.session.regenerate((err) => {
        if (err) console.error('Session regenerate error:', err);
        resolve();
      });
    } else {
      resolve();
    }
  });

  const token = signAccessToken(userData);
  req.session.user = userData;
  req.session.lastActivity = Date.now();

  res.json({ success: true, token, user: userData });
};

/**
 * Logout - end session
 */
const logout = async (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
  });
  res.json({ success: true, message: 'Logged out successfully' });
};

/**
 * Get current user info
 */
const me = async (req, res) => {
  res.json({ success: true, user: req.auth });
};

/**
 * Refresh token — only access tokens (not purpose tokens) within max age window.
 * Revalidates that the principal still exists and is active.
 */
const refresh = async (req, res) => {
  const { token } = req.body;
  if (!token) throw ApiError.badRequest('Token is required');

  const decoded = verifyJwt(token, { ignoreExpiration: true });
  if (!decoded || !isRefreshableAccessToken(decoded)) {
    throw ApiError.unauthorized('Invalid token');
  }

  const expiresAt = (decoded.exp || 0) * 1000;
  const maxRefreshWindow = 7 * 24 * 60 * 60 * 1000;
  if (expiresAt && Date.now() - expiresAt > maxRefreshWindow) {
    throw ApiError.unauthorized('Token is too old to refresh');
  }

  // Revalidate principal status
  if (decoded.type === 'staff') {
    const staff = await db.queryOne(
      `SELECT staff_id, isactive, isadmin, dept_id, role_id, assigned_only, username, firstname, lastname, email
       FROM ${db.table('staff')} WHERE staff_id = ? AND isactive = 1`,
      [decoded.id]
    );
    if (!staff) throw ApiError.unauthorized('Invalid token');

    const scope = await loadStaffScope(staff.staff_id, staff.dept_id);
    let permissions = {};
    if (staff.role_id) {
      const role = await db.queryOne(
        `SELECT permissions FROM ${db.table('role')} WHERE id = ?`,
        [staff.role_id]
      );
      permissions = parsePermissions(role?.permissions);
    }

    const principal = {
      id: staff.staff_id,
      username: staff.username,
      name: `${staff.firstname || ''} ${staff.lastname || ''}`.trim() || staff.username,
      email: staff.email,
      isAdmin: !!staff.isadmin,
      type: 'staff',
      deptId: staff.dept_id,
      roleId: staff.role_id,
      assignedOnly: !!staff.assigned_only,
      deptIds: scope.deptIds,
      teamIds: scope.teamIds,
      permissions,
    };
    return res.json({ success: true, token: signAccessToken(principal) });
  }

  if (decoded.type === 'user') {
    const account = await db.queryOne(
      `SELECT ua.user_id, ua.username, ua.status, u.name, ue.address as email
       FROM ${db.table('user_account')} ua
       JOIN ${db.table('user')} u ON ua.user_id = u.id
       LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
       WHERE ua.user_id = ?`,
      [decoded.id]
    );
    if (!account) throw ApiError.unauthorized('Invalid token');

    const principal = {
      id: account.user_id,
      username: account.username,
      name: account.name,
      email: account.email,
      isAdmin: false,
      type: 'user',
      verified: account.status === 1,
    };
    return res.json({ success: true, token: signAccessToken(principal) });
  }

  throw ApiError.unauthorized('Invalid token');
};

/**
 * Forgot password - generate reset token
 */
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Email is required');

  const genericMessage = 'If an account exists with that email, a password reset link has been generated.';

  // Check staff first
  const staff = await db.queryOne(
    `SELECT staff_id, email, firstname, lastname FROM ${db.table('staff')} WHERE email = ? AND isactive = 1`,
    [email],
  );

  let resetType = null;
  let resetId = null;

  if (staff) {
    resetType = 'staff';
    resetId = staff.staff_id;
  } else {
    const account = await db.queryOne(
      `SELECT u.id as user_id, ue.address as email, u.name
       FROM ${db.table('user')} u
       JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
       LEFT JOIN ${db.table('user_account')} ua ON ua.user_id = u.id
       WHERE ue.address = ? AND ua.status = 1`,
      [email],
    );
    if (account) {
      resetType = 'user';
      resetId = account.user_id;
    }
  }

  if (!resetType) {
    return res.json({ success: true, message: genericMessage });
  }

  const resetToken = signPurposeToken(
    { id: resetId, type: resetType },
    TOKEN_USE.PASSWORD_RESET,
    '1h',
  );

  const helpdeskUrl = config.helpdesk.url.replace(/\/$/, '');
  const resetUrl = `${helpdeskUrl}/reset-password?token=${resetToken}`;

  const { sendEmail } = require('../lib/email');
  await sendEmail(email, 'Password Reset', `<p>Click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`);

  const response = { success: true, message: genericMessage };
  if (config.env === 'development') response.resetUrl = resetUrl;

  res.json(response);
};

/**
 * Reset password - validate token and update password
 */
const resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw ApiError.badRequest('Token and new password are required');
  if (password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');

  const decoded = verifyJwt(token);
  if (!decoded || !isPurposeToken(decoded, TOKEN_USE.PASSWORD_RESET)) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  const sdk = getSdk();
  const hashedPassword = await sdk.auth.hashPassword(password);

  if (decoded.type === 'staff') {
    await db.query(
      `UPDATE ${db.table('staff')} SET passwd = ?, updated = NOW() WHERE staff_id = ?`,
      [hashedPassword, decoded.id],
    );
  } else {
    await db.query(
      `UPDATE ${db.table('user_account')} SET passwd = ? WHERE user_id = ?`,
      [hashedPassword, decoded.id],
    );
  }

  res.json({ success: true, message: 'Password has been reset successfully' });
};

/**
 * Register - create a new user account
 */
const register = async (req, res) => {
  const { name, email, username, password, confirm } = req.body;

  if (!name) throw ApiError.badRequest('Name is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest('A valid email address is required');
  }
  if (!username || username.length < 3) throw ApiError.badRequest('Username must be at least 3 characters');
  if (!password || password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');
  if (confirm !== undefined && password !== confirm) throw ApiError.badRequest('Passwords do not match');

  // Check email uniqueness
  const existingEmail = await db.queryOne(
    `SELECT id FROM ${db.table('user_email')} WHERE address = ?`, [email],
  );
  if (existingEmail) throw ApiError.badRequest('An account with that email already exists');

  // Check username uniqueness
  const existingUsername = await db.queryOne(
    `SELECT user_id FROM ${db.table('user_account')} WHERE username = ?`, [username],
  );
  if (existingUsername) throw ApiError.badRequest('That username is already taken');

  // Use SDK to create the user (without account — we handle that separately for status=0)
  const sdk = getSdk();
  const hashedPassword = await sdk.auth.hashPassword(password);

  const userResult = await db.query(
    `INSERT INTO ${db.table('user')} SET name = ?, status = 0, org_id = 0, default_email_id = 0, created = NOW(), updated = NOW()`,
    [name],
  );
  const userId = userResult.insertId;

  const emailResult = await db.query(
    `INSERT INTO ${db.table('user_email')} SET user_id = ?, address = ?, flags = 0`,
    [userId, email],
  );
  await db.query(
    `UPDATE ${db.table('user')} SET default_email_id = ? WHERE id = ?`,
    [emailResult.insertId, userId],
  );

  await db.query(
    `INSERT INTO ${db.table('user_account')} SET user_id = ?, status = 0, username = ?, passwd = ?, registered = NOW()`,
    [userId, username, hashedPassword],
  );

  // Generate verification token & send email
  const verifyToken = signPurposeToken(
    { id: userId, email },
    TOKEN_USE.EMAIL_VERIFY,
    '24h',
  );

  const { sendEmail } = require('../lib/email');
  const verifyUrl = `${config.helpdesk.url.replace(/\/$/, '')}/api/v1/auth/verify-email?token=${verifyToken}`;
  await sendEmail(email, 'Verify Your Email', `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`);

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email to verify your account.',
    user: { id: userId, name, email, username, verified: false },
  });
};

/**
 * Verify email - validate token and activate account
 */
const verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) throw ApiError.badRequest('Verification token is required');

  const decoded = verifyJwt(token);
  if (!decoded || !isPurposeToken(decoded, TOKEN_USE.EMAIL_VERIFY)) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  await db.query(
    `UPDATE ${db.table('user_account')} SET status = 1 WHERE user_id = ?`,
    [decoded.id],
  );

  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) return res.redirect('/?verified=true');

  res.json({ success: true, message: 'Email verified successfully' });
};

/**
 * Resend verification email
 */
const resendVerification = async (req, res) => {
  if (!req.auth) throw ApiError.unauthorized('Authentication required');

  const account = await db.queryOne(
    `SELECT status FROM ${db.table('user_account')} WHERE user_id = ?`,
    [req.auth.id],
  );

  if (account && account.status === 1) {
    return res.json({ success: true, message: 'Email is already verified' });
  }

  const userRow = await db.queryOne(
    `SELECT ue.address FROM ${db.table('user')} u JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id WHERE u.id = ?`,
    [req.auth.id],
  );
  if (!userRow) throw ApiError.badRequest('User not found');

  const email = userRow.address;
  const verifyToken = signPurposeToken(
    { id: req.auth.id, email },
    TOKEN_USE.EMAIL_VERIFY,
    '24h',
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
  resendVerification,
};
