/**
 * Organization Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');

/**
 * List organizations
 */
const list = async (req, res) => {
  const result = await getSdk().organizations.list(req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get organization details
 */
const get = async (req, res) => {
  const data = await getSdk().organizations.get(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get organization users
 */
const getUsers = async (req, res) => {
  const result = await getSdk().organizations.getUsers(req.params.id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get organization tickets
 */
const getTickets = async (req, res) => {
  const result = await getSdk().organizations.getTickets(req.params.id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Create organization
 */
const create = async (req, res) => {
  const data = await getSdk().organizations.create(req.body);
  res.status(201).json({ success: true, data });
};

/**
 * Update organization
 */
const update = async (req, res) => {
  await getSdk().organizations.update(req.params.id, req.body);
  res.json({ success: true, message: 'Organization updated' });
};

/**
 * Delete organization
 */
const remove = async (req, res) => {
  await getSdk().organizations.remove(req.params.id);
  res.json({ success: true, message: 'Organization deleted' });
};

module.exports = {
  list,
  get,
  getUsers,
  getTickets,
  create,
  update,
  remove,
};
