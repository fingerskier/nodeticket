/**
 * User Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * List users
 */
const list = async (req, res) => {
  const result = await getSdk().users.list(req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get user details
 */
const get = async (req, res) => {
  const { id } = req.params;

  // User can only access their own profile
  if (req.auth?.type === 'user' && req.auth.id !== parseInt(id, 10)) {
    throw ApiError.forbidden('Access denied');
  }

  const data = await getSdk().users.get(id);
  res.json({ success: true, data });
};

/**
 * Get user's tickets
 */
const getTickets = async (req, res) => {
  const { id } = req.params;

  // User can only access their own tickets
  if (req.auth?.type === 'user' && req.auth.id !== parseInt(id, 10)) {
    throw ApiError.forbidden('Access denied');
  }

  const result = await getSdk().users.getTickets(id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get user's organizations
 */
const getOrganizations = async (req, res) => {
  const data = await getSdk().users.getOrganizations(req.params.id);
  res.json({ success: true, data });
};

/**
 * Create user (admin)
 */
const create = async (req, res) => {
  const data = await getSdk().users.create(req.body);
  res.status(201).json({ success: true, data });
};

/**
 * Update user (admin)
 */
const update = async (req, res) => {
  await getSdk().users.update(req.params.id, req.body);
  res.json({ success: true, message: 'User updated' });
};

/**
 * Delete user (admin)
 */
const remove = async (req, res) => {
  await getSdk().users.remove(req.params.id);
  res.json({ success: true, message: 'User deleted' });
};

/**
 * Update own profile (self-service)
 */
const updateProfile = async (req, res) => {
  const userId = req.auth.id;
  const { name } = req.body;

  // The SDK users.update handles name/org_id/status.
  // For profile self-service, we only allow name.
  const changes = {};
  if (name !== undefined) changes.name = name;

  // timezone/lang are not in the SDK service — use direct db for those
  const db = require('../lib/db');
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (req.body.timezone !== undefined) { updates.push('timezone = ?'); params.push(req.body.timezone); }
  if (req.body.lang !== undefined) { updates.push('lang = ?'); params.push(req.body.lang); }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(userId);

  await db.query(`UPDATE ${db.table('user')} SET ${updates.join(', ')} WHERE id = ?`, params);

  res.json({ success: true, message: 'Profile updated' });
};

/**
 * Change own password (self-service)
 */
const changePassword = async (req, res) => {
  const userId = req.auth.id;
  const authType = req.auth.type;
  const { current_password, new_password } = req.body;

  await getSdk().auth.changePassword(authType, userId, current_password, new_password);
  res.json({ success: true, message: 'Password changed' });
};

module.exports = {
  list,
  get,
  getTickets,
  getOrganizations,
  create,
  update,
  remove,
  updateProfile,
  changePassword,
};
