/**
 * Canned Response Controller
 *
 * Non-admin staff see responses scoped to their department (plus dept_id=0 global).
 * Admins see all.
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
};

const format = (r) => ({
  canned_id: r.canned_id,
  dept_id: r.dept_id,
  dept_name: r.dept_name || null,
  isenabled: !!r.isenabled,
  title: r.title,
  response: r.response,
  lang: r.lang,
  notes: r.notes,
  created: r.created,
  updated: r.updated,
});

const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { dept_id, enabled_only } = req.query;

  let where = ' WHERE 1=1';
  const args = [];

  if (req.auth?.type === 'staff' && !req.auth?.isAdmin) {
    const staff = await db.queryOne(
      `SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?`, [req.auth.id]
    );
    const staffDeptId = staff?.dept_id || 0;
    where += ` AND (cr.dept_id = ? OR cr.dept_id = 0)`;
    args.push(staffDeptId);
  } else if (dept_id !== undefined) {
    where += ` AND cr.dept_id = ?`;
    args.push(parseInt(dept_id, 10));
  }

  if (enabled_only === 'true' || enabled_only === '1') {
    where += ` AND cr.isenabled = 1`;
  }

  const countRow = await db.queryOne(
    `SELECT COUNT(*) as count FROM ${db.table('canned_response')} cr${where}`, args
  );
  const total = parseInt(countRow?.count || 0, 10);

  const rows = await db.query(
    `SELECT cr.*, d.name as dept_name
     FROM ${db.table('canned_response')} cr
     LEFT JOIN ${db.table('department')} d ON cr.dept_id = d.id
     ${where}
     ORDER BY cr.title LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  res.json({
    success: true,
    data: rows.map(format),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

const get = async (req, res) => {
  const { id } = req.params;
  const row = await db.queryOne(
    `SELECT cr.*, d.name as dept_name
     FROM ${db.table('canned_response')} cr
     LEFT JOIN ${db.table('department')} d ON cr.dept_id = d.id
     WHERE cr.canned_id = ?`, [id]
  );
  if (!row) throw ApiError.notFound('Canned response not found');

  if (req.auth?.type === 'staff' && !req.auth?.isAdmin) {
    const staff = await db.queryOne(`SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?`, [req.auth.id]);
    const staffDeptId = staff?.dept_id || 0;
    if (row.dept_id !== 0 && row.dept_id !== staffDeptId) throw ApiError.notFound('Canned response not found');
  }

  res.json({ success: true, data: format(row) });
};

const create = async (req, res) => {
  const { title, response, dept_id, isenabled, lang, notes } = req.body;
  if (!title || !title.trim()) throw ApiError.badRequest('title is required');
  if (title.length > 255) throw ApiError.badRequest('title must be 255 chars or less');
  if (!response) throw ApiError.badRequest('response body is required');

  const dup = await db.queryOne(`SELECT canned_id FROM ${db.table('canned_response')} WHERE title = ?`, [title.trim()]);
  if (dup) throw ApiError.conflict('Title already exists');

  const now = new Date();
  const result = await db.query(
    `INSERT INTO ${db.table('canned_response')}
     (dept_id, isenabled, title, response, lang, notes, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [parseInt(dept_id, 10) || 0, isenabled === false ? 0 : 1, title.trim(), response,
     lang || 'en_US', notes || null, now, now]
  );
  const id = result?.insertId || result?.lastInsertId || result?.id;
  res.status(201).json({ success: true, data: { canned_id: id, title: title.trim() } });
};

const update = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT * FROM ${db.table('canned_response')} WHERE canned_id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Canned response not found');

  const { title, response, dept_id, isenabled, lang, notes } = req.body;
  const updates = [];
  const args = [];

  if (title !== undefined) {
    if (!title.trim()) throw ApiError.badRequest('title cannot be empty');
    if (title.length > 255) throw ApiError.badRequest('title must be 255 chars or less');
    const dup = await db.queryOne(
      `SELECT canned_id FROM ${db.table('canned_response')} WHERE title = ? AND canned_id != ?`, [title.trim(), id]
    );
    if (dup) throw ApiError.conflict('Title already exists');
    updates.push('title = ?'); args.push(title.trim());
  }
  if (response !== undefined) { updates.push('response = ?'); args.push(response); }
  if (dept_id !== undefined) { updates.push('dept_id = ?'); args.push(parseInt(dept_id, 10) || 0); }
  if (isenabled !== undefined) { updates.push('isenabled = ?'); args.push(isenabled ? 1 : 0); }
  if (lang !== undefined) { updates.push('lang = ?'); args.push(lang); }
  if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
  if (updates.length === 0) throw ApiError.badRequest('No fields to update');

  updates.push('updated = ?'); args.push(new Date()); args.push(id);
  await db.query(`UPDATE ${db.table('canned_response')} SET ${updates.join(', ')} WHERE canned_id = ?`, args);
  res.json({ success: true, message: 'Canned response updated' });
};

const remove = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT canned_id FROM ${db.table('canned_response')} WHERE canned_id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Canned response not found');
  await db.query(`DELETE FROM ${db.table('canned_response')} WHERE canned_id = ?`, [id]);
  res.json({ success: true, message: 'Canned response deleted' });
};

module.exports = { list, get, create, update, remove };
