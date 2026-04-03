/**
 * Auth Service — password hashing, verification, and credential lookup
 *
 * This service handles password-related operations only.
 * It does NOT include login/logout, JWT, sessions, or email flows —
 * those are the Express app's concern.
 *
 * @module sdk/services/auth
 */

const { ValidationError, NotFoundError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Auth service methods
 */
module.exports = (conn, data) => {
  /**
   * Verify a plaintext password against a bcrypt hash.
   *
   * @param {string} plaintext - The plaintext password to check
   * @param {string} hash - The stored bcrypt hash
   * @returns {Promise<boolean>} True if the password matches
   *
   * @example
   * const valid = await auth.verifyPassword('secret123', '$2a$10$...');
   */
  const verifyPassword = async (plaintext, hash) => {
    const bcrypt = require('bcryptjs');
    return bcrypt.compare(plaintext, hash);
  };

  /**
   * Hash a plaintext password using bcrypt (salt rounds = 10).
   *
   * @param {string} plaintext - The plaintext password to hash
   * @returns {Promise<string>} The bcrypt hash
   *
   * @example
   * const hash = await auth.hashPassword('secret123');
   */
  const hashPassword = async (plaintext) => {
    const bcrypt = require('bcryptjs');
    return bcrypt.hash(plaintext, 10);
  };

  /**
   * Look up a staff member by username or email for authentication.
   * Returns the record including the passwd field for password verification.
   *
   * @param {string} username - Username or email address
   * @returns {Promise<Object|null>} Staff record with passwd, or null if not found
   *
   * @example
   * const staff = await auth.lookupStaffByCredentials('admin');
   * if (staff) {
   *   const valid = await auth.verifyPassword(inputPassword, staff.passwd);
   * }
   */
  const lookupStaffByCredentials = async (username) => {
    return conn.queryOne(`
      SELECT s.*, r.permissions as role_permissions
      FROM ${conn.table('staff')} s
      LEFT JOIN ${conn.table('role')} r ON s.role_id = r.id
      WHERE (s.username = ? OR s.email = ?) AND s.isactive = 1
    `, [username, username]);
  };

  /**
   * Look up a user account by username for authentication.
   * Returns the record including the passwd field for password verification.
   *
   * @param {string} username - Account username
   * @returns {Promise<Object|null>} User account record with passwd, or null if not found
   *
   * @example
   * const account = await auth.lookupUserByCredentials('jdoe');
   * if (account) {
   *   const valid = await auth.verifyPassword(inputPassword, account.passwd);
   * }
   */
  const lookupUserByCredentials = async (username) => {
    return conn.queryOne(`
      SELECT ua.*, u.id as user_id, u.name, ue.address as email
      FROM ${conn.table('user_account')} ua
      JOIN ${conn.table('user')} u ON ua.user_id = u.id
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      WHERE ua.username = ?
    `, [username]);
  };

  /**
   * Change a password for a staff member or user account.
   *
   * Verifies the current password before updating.
   *
   * @param {string} type - Account type: 'staff' or 'user'
   * @param {number|string} id - Staff ID or User ID
   * @param {string} currentPassword - Current plaintext password
   * @param {string} newPassword - New plaintext password (min 8 chars)
   * @returns {Promise<void>}
   * @throws {ValidationError} If passwords are missing, new password too short, or current password incorrect
   * @throws {NotFoundError} If the account does not exist
   *
   * @example
   * await auth.changePassword('staff', 1, 'oldPass123', 'newPass456');
   * await auth.changePassword('user', 5, 'oldPass123', 'newPass456');
   */
  const changePassword = async (type, id, currentPassword, newPassword) => {
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current password and new password are required');
    }
    if (newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters');
    }

    const bcrypt = require('bcryptjs');
    let account;

    if (type === 'staff') {
      account = await conn.queryOne(
        `SELECT passwd FROM ${conn.table('staff')} WHERE staff_id = ?`, [id]
      );
    } else {
      account = await conn.queryOne(
        `SELECT passwd FROM ${conn.table('user_account')} WHERE user_id = ?`, [id]
      );
    }

    if (!account) throw new NotFoundError('Account not found');

    const valid = await bcrypt.compare(currentPassword, account.passwd);
    if (!valid) throw new ValidationError('Current password is incorrect');

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (type === 'staff') {
      await conn.query(
        `UPDATE ${conn.table('staff')} SET passwd = ?, updated = ? WHERE staff_id = ?`,
        [hashedPassword, new Date(), id],
      );
    } else {
      await conn.query(
        `UPDATE ${conn.table('user_account')} SET passwd = ? WHERE user_id = ?`,
        [hashedPassword, id],
      );
    }
  };

  return {
    verifyPassword,
    hashPassword,
    lookupStaffByCredentials,
    lookupUserByCredentials,
    changePassword,
  };
};
