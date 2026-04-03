/**
 * Department Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');

/**
 * List departments
 */
const list = async (req, res) => {
  const filters = { ...req.query };

  // Filter by public visibility for non-staff — HTTP-layer concern
  if (req.auth?.type !== 'staff' && req.auth?.type !== 'apikey') {
    filters.ispublic = true;
  }

  const result = await getSdk().departments.list(filters);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get department details
 */
const get = async (req, res) => {
  const data = await getSdk().departments.get(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get department staff
 */
const getStaff = async (req, res) => {
  const data = await getSdk().departments.getStaff(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get department tickets
 */
const getTickets = async (req, res) => {
  const result = await getSdk().departments.getTickets(req.params.id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Create department
 */
const create = async (req, res) => {
  const data = await getSdk().departments.create(req.body);
  res.status(201).json({ success: true, data });
};

/**
 * Update department
 */
const update = async (req, res) => {
  await getSdk().departments.update(req.params.id, req.body);
  res.json({ success: true, message: 'Department updated' });
};

/**
 * Delete department
 */
const remove = async (req, res) => {
  await getSdk().departments.remove(req.params.id);
  res.json({ success: true, message: 'Department deleted' });
};

module.exports = {
  list,
  get,
  getStaff,
  getTickets,
  create,
  update,
  remove,
};
