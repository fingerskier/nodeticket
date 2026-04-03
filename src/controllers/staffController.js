/**
 * Staff Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');

/**
 * List staff members
 */
const list = async (req, res) => {
  const result = await getSdk().staff.list(req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get staff details
 */
const get = async (req, res) => {
  const data = await getSdk().staff.get(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get staff's assigned tickets
 */
const getTickets = async (req, res) => {
  const result = await getSdk().staff.getTickets(req.params.id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get staff's departments
 */
const getDepartments = async (req, res) => {
  const data = await getSdk().staff.getDepartments(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get staff's teams
 */
const getTeams = async (req, res) => {
  const data = await getSdk().staff.getTeams(req.params.id);
  res.json({ success: true, data });
};

/**
 * Create staff member
 */
const create = async (req, res) => {
  const data = await getSdk().staff.create(req.body);
  res.status(201).json({ success: true, data });
};

/**
 * Update staff member
 */
const update = async (req, res) => {
  await getSdk().staff.update(req.params.id, req.body);
  res.json({ success: true, message: 'Staff member updated' });
};

/**
 * Delete staff member
 */
const remove = async (req, res) => {
  await getSdk().staff.remove(req.params.id);
  res.json({ success: true, message: 'Staff member deleted' });
};

module.exports = {
  list,
  get,
  getTickets,
  getDepartments,
  getTeams,
  create,
  update,
  remove,
};
