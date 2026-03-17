/**
 * Role Controller
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * List roles
 */
const list = async (req, res) => {
  const roles = await db.query(`
    SELECT * FROM ${db.table('role')} ORDER BY name
  `);

  res.json({
    success: true,
    data: roles.map(r => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions ? JSON.parse(r.permissions) : {},
      flags: r.flags,
      notes: r.notes,
      created: r.created,
      updated: r.updated
    }))
  });
};

/**
 * Get role by id
 */
const get = async (req, res) => {
  const { id } = req.params;

  const role = await db.queryOne(`
    SELECT * FROM ${db.table('role')} WHERE id = ?
  `, [id]);

  if (!role) {
    throw ApiError.notFound('Role not found');
  }

  res.json({
    success: true,
    data: {
      id: role.id,
      name: role.name,
      permissions: role.permissions ? JSON.parse(role.permissions) : {},
      flags: role.flags,
      notes: role.notes,
      created: role.created,
      updated: role.updated
    }
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
  const existing = await db.queryOne(`
    SELECT id FROM ${db.table('role')} WHERE name = ?
  `, [name]);

  if (existing) {
    throw ApiError.conflict('A role with this name already exists');
  }

  const now = new Date();
  const result = await db.query(`
    INSERT INTO ${db.table('role')} (name, permissions, flags, notes, created, updated)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    name.trim(),
    permissions ? JSON.stringify(permissions) : null,
    flags || 0,
    notes || null,
    now,
    now
  ]);

  res.status(201).json({
    success: true,
    data: {
      id: result.insertId,
      name: name.trim(),
      permissions: permissions || {},
      flags: flags || 0,
      notes: notes || null,
      created: now,
      updated: now
    }
  });
};

/**
 * Update role
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { name, permissions, flags, notes } = req.body;

  const role = await db.queryOne(`
    SELECT id FROM ${db.table('role')} WHERE id = ?
  `, [id]);

  if (!role) {
    throw ApiError.notFound('Role not found');
  }

  if (name !== undefined) {
    if (name.length < 1 || name.length > 64) {
      throw ApiError.badRequest('Name must be 1-64 characters');
    }
    const existing = await db.queryOne(`
      SELECT id FROM ${db.table('role')} WHERE name = ? AND id != ?
    `, [name, id]);
    if (existing) {
      throw ApiError.conflict('A role with this name already exists');
    }
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (permissions !== undefined) { updates.push('permissions = ?'); params.push(JSON.stringify(permissions)); }
  if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(id);

  await db.query(`
    UPDATE ${db.table('role')} SET ${updates.join(', ')} WHERE id = ?
  `, params);

  res.json({ success: true, message: 'Role updated' });
};

/**
 * Delete role
 */
const remove = async (req, res) => {
  const { id } = req.params;

  const role = await db.queryOne(`
    SELECT id FROM ${db.table('role')} WHERE id = ?
  `, [id]);

  if (!role) {
    throw ApiError.notFound('Role not found');
  }

  // Check references
  const staffCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('staff')} WHERE role_id = ?
  `, [id]);

  if (parseInt(staffCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete role: staff members are assigned to this role');
  }

  const deptAccessCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('staff_dept_access')} WHERE role_id = ?
  `, [id]);

  if (parseInt(deptAccessCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete role: role is used in department access records');
  }

  await db.query(`DELETE FROM ${db.table('role')} WHERE id = ?`, [id]);

  res.json({ success: true, message: 'Role deleted' });
};

module.exports = {
  list,
  get,
  create,
  update,
  remove
};
