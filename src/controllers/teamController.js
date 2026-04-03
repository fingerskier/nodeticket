/**
 * Team Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');

/**
 * List teams
 */
const list = async (req, res) => {
  const result = await getSdk().teams.list(req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get team details
 */
const get = async (req, res) => {
  const data = await getSdk().teams.get(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get team members
 */
const getMembers = async (req, res) => {
  const data = await getSdk().teams.getMembers(req.params.id);
  res.json({ success: true, data });
};

/**
 * Create team
 */
const create = async (req, res) => {
  const data = await getSdk().teams.create(req.body);
  res.status(201).json({ success: true, data });
};

/**
 * Update team
 */
const update = async (req, res) => {
  await getSdk().teams.update(req.params.id, req.body);
  res.json({ success: true, message: 'Team updated' });
};

/**
 * Delete team
 */
const remove = async (req, res) => {
  await getSdk().teams.remove(req.params.id);
  res.json({ success: true, message: 'Team deleted' });
};

/**
 * Add member to team
 */
const addMember = async (req, res) => {
  await getSdk().teams.addMember(req.params.id, req.body.staff_id);
  res.status(201).json({ success: true, message: 'Member added to team' });
};

/**
 * Remove member from team
 */
const removeMember = async (req, res) => {
  await getSdk().teams.removeMember(req.params.id, req.params.staffId);
  res.json({ success: true, message: 'Member removed from team' });
};

module.exports = {
  list,
  get,
  getMembers,
  create,
  update,
  remove,
  addMember,
  removeMember,
};
