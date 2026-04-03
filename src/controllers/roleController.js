/**
 * Role Controller — thin HTTP adapter using SDK data layer directly
 *
 * Roles don't have a dedicated service, so we use the data layer
 * and keep validation logic here.
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * List roles
 */
const list = async (req, res) => {
  const roles = await getSdk().data.roles.find({ orderBy: 'name ASC' });

  res.json({
    success: true,
    data: roles.map(r => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions ? JSON.parse(r.permissions) : {},
      flags: r.flags,
      notes: r.notes,
      created: r.created,
      updated: r.updated,
    })),
  });
};

/**
 * Get role by id
 */
const get = async (req, res) => {
  const role = await getSdk().data.roles.findById(req.params.id);
  if (!role) throw ApiError.notFound('Role not found');

  res.json({
    success: true,
    data: {
      id: role.id,
      name: role.name,
      permissions: role.permissions ? JSON.parse(role.permissions) : {},
      flags: role.flags,
      notes: role.notes,
      created: role.created,
      updated: role.updated,
    },
  });
};

/**
 * Create role
 */
const create = async (req, res) => {
  const { name, permissions, flags, notes } = req.body;

  if (!name || name.length < 1 || name.length > 64) {
    throw ApiError.badRequest('Name is required (1-64 characters)');
  }

  // Check uniqueness
  const sdk = getSdk();
  const conn = sdk.connection;
  const existing = await conn.queryOne(
    `SELECT id FROM ${conn.table('role')} WHERE name = ?`, [name],
  );
  if (existing) throw ApiError.conflict('A role with this name already exists');

  const now = new Date();
  const result = await sdk.data.roles.create({
    name: name.trim(),
    permissions: permissions ? JSON.stringify(permissions) : null,
    flags: flags || 0,
    notes: notes || null,
    created: now,
    updated: now,
  });

  res.status(201).json({
    success: true,
    data: {
      id: result.id,
      name: name.trim(),
      permissions: permissions || {},
      flags: flags || 0,
      notes: notes || null,
      created: now,
      updated: now,
    },
  });
};

/**
 * Update role
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { name, permissions, flags, notes } = req.body;

  const sdk = getSdk();
  const role = await sdk.data.roles.findById(id);
  if (!role) throw ApiError.notFound('Role not found');

  if (name !== undefined) {
    if (name.length < 1 || name.length > 64) {
      throw ApiError.badRequest('Name must be 1-64 characters');
    }
    const conn = sdk.connection;
    const existing = await conn.queryOne(
      `SELECT id FROM ${conn.table('role')} WHERE name = ? AND id != ?`, [name, id],
    );
    if (existing) throw ApiError.conflict('A role with this name already exists');
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (permissions !== undefined) data.permissions = JSON.stringify(permissions);
  if (flags !== undefined) data.flags = flags;
  if (notes !== undefined) data.notes = notes;

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  data.updated = new Date();
  await sdk.data.roles.update(id, data);

  res.json({ success: true, message: 'Role updated' });
};

/**
 * Delete role
 */
const remove = async (req, res) => {
  const { id } = req.params;
  const sdk = getSdk();

  const role = await sdk.data.roles.findById(id);
  if (!role) throw ApiError.notFound('Role not found');

  // Check references
  const conn = sdk.connection;
  const staffCount = parseInt(
    await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('staff')} WHERE role_id = ?`, [id]) || 0, 10,
  );
  if (staffCount > 0) {
    throw ApiError.conflict('Cannot delete role: staff members are assigned to this role');
  }

  const deptAccessCount = parseInt(
    await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('staff_dept_access')} WHERE role_id = ?`, [id]) || 0, 10,
  );
  if (deptAccessCount > 0) {
    throw ApiError.conflict('Cannot delete role: role is used in department access records');
  }

  await sdk.data.roles.remove(id);
  res.json({ success: true, message: 'Role deleted' });
};

module.exports = {
  list,
  get,
  create,
  update,
  remove,
};
