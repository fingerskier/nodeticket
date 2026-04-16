/**
 * Email Template Controller - CRUD for template groups and templates
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
};

const formatGroup = (g) => ({
  tpl_id: g.tpl_id,
  name: g.name,
  isactive: !!g.isactive,
  lang: g.lang,
  notes: g.notes,
  created: g.created,
  updated: g.updated,
});

const formatTemplate = (t) => ({
  id: t.id,
  tpl_id: t.tpl_id,
  code_name: t.code_name,
  subject: t.subject,
  body: t.body,
  notes: t.notes,
  created: t.created,
  updated: t.updated,
});

const listGroups = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const totalRow = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('email_template_group')}`);
  const total = parseInt(totalRow?.count || 0, 10);
  const rows = await db.query(
    `SELECT etg.*, (SELECT COUNT(*) FROM ${db.table('email_template')} et WHERE et.tpl_id = etg.tpl_id) as template_count
     FROM ${db.table('email_template_group')} etg
     ORDER BY etg.name LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({
    success: true,
    data: rows.map(r => ({ ...formatGroup(r), template_count: parseInt(r.template_count || 0, 10) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

const getGroup = async (req, res) => {
  const { id } = req.params;
  const group = await db.queryOne(`SELECT * FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  if (!group) throw ApiError.notFound('Template group not found');
  const templates = await db.query(
    `SELECT * FROM ${db.table('email_template')} WHERE tpl_id = ? ORDER BY code_name`,
    [id]
  );
  res.json({
    success: true,
    data: { ...formatGroup(group), templates: templates.map(formatTemplate) },
  });
};

const createGroup = async (req, res) => {
  const { name, isactive, lang, notes } = req.body;
  if (!name || !name.trim()) throw ApiError.badRequest('name is required');
  if (name.length > 32) throw ApiError.badRequest('name must be 32 chars or less');
  const dup = await db.queryOne(`SELECT tpl_id FROM ${db.table('email_template_group')} WHERE name = ?`, [name.trim()]);
  if (dup) throw ApiError.conflict('Template group name already exists');
  const now = new Date();
  const result = await db.query(
    `INSERT INTO ${db.table('email_template_group')} (isactive, name, lang, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?)`,
    [isactive ? 1 : 0, name.trim(), lang || 'en_US', notes || null, now, now]
  );
  const id = result?.insertId || result?.lastInsertId || result?.id;
  res.status(201).json({ success: true, data: { tpl_id: id, name: name.trim() } });
};

const updateGroup = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT tpl_id FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Template group not found');

  const { name, isactive, lang, notes } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) {
    if (!name.trim()) throw ApiError.badRequest('name cannot be empty');
    if (name.length > 32) throw ApiError.badRequest('name must be 32 chars or less');
    const dup = await db.queryOne(
      `SELECT tpl_id FROM ${db.table('email_template_group')} WHERE name = ? AND tpl_id != ?`,
      [name.trim(), id]
    );
    if (dup) throw ApiError.conflict('Template group name already exists');
    updates.push('name = ?'); params.push(name.trim());
  }
  if (isactive !== undefined) { updates.push('isactive = ?'); params.push(isactive ? 1 : 0); }
  if (lang !== undefined) { updates.push('lang = ?'); params.push(lang); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (updates.length === 0) throw ApiError.badRequest('No fields to update');

  updates.push('updated = ?'); params.push(new Date()); params.push(id);
  await db.query(`UPDATE ${db.table('email_template_group')} SET ${updates.join(', ')} WHERE tpl_id = ?`, params);
  res.json({ success: true, message: 'Template group updated' });
};

const removeGroup = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT tpl_id FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Template group not found');

  const tpls = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('email_template')} WHERE tpl_id = ?`, [id]);
  if (parseInt(tpls?.count || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete group with existing templates');
  }
  await db.query(`DELETE FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  res.json({ success: true, message: 'Template group deleted' });
};

const list = async (req, res) => {
  const { tpl_id } = req.query;
  let sql = `SELECT et.*, etg.name as group_name FROM ${db.table('email_template')} et
             LEFT JOIN ${db.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id`;
  const params = [];
  if (tpl_id) { sql += ` WHERE et.tpl_id = ?`; params.push(tpl_id); }
  sql += ` ORDER BY etg.name, et.code_name`;
  const rows = await db.query(sql, params);
  res.json({ success: true, data: rows.map(r => ({ ...formatTemplate(r), group_name: r.group_name })) });
};

const get = async (req, res) => {
  const { id } = req.params;
  const template = await db.queryOne(
    `SELECT et.*, etg.name as group_name
     FROM ${db.table('email_template')} et
     LEFT JOIN ${db.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id
     WHERE et.id = ?`,
    [id]
  );
  if (!template) throw ApiError.notFound('Template not found');
  res.json({ success: true, data: { ...formatTemplate(template), group_name: template.group_name } });
};

const update = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT id FROM ${db.table('email_template')} WHERE id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Template not found');

  const { subject, body, notes } = req.body;
  const updates = [];
  const params = [];

  if (subject !== undefined) {
    if (!subject.trim()) throw ApiError.badRequest('subject cannot be empty');
    if (subject.length > 255) throw ApiError.badRequest('subject must be 255 chars or less');
    updates.push('subject = ?'); params.push(subject);
  }
  if (body !== undefined) { updates.push('body = ?'); params.push(body); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (updates.length === 0) throw ApiError.badRequest('No fields to update');

  updates.push('updated = ?'); params.push(new Date()); params.push(id);
  await db.query(`UPDATE ${db.table('email_template')} SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true, message: 'Template updated' });
};

module.exports = {
  listGroups, getGroup, createGroup, updateGroup, removeGroup,
  list, get, update,
};
