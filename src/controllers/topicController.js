/**
 * Help Topic Controller — thin HTTP adapter
 *
 * Topics don't have a dedicated SDK service. Complex queries remain
 * but use the SDK connection for table prefixing.
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Helper to build pagination
 */
const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * List help topics
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { ispublic } = req.query;
  const conn = getSdk().connection;

  let sql = `
    SELECT ht.*,
           p.topic as parent_topic,
           d.name as dept_name,
           tp.priority as priority_name,
           sla.name as sla_name
    FROM ${conn.table('help_topic')} ht
    LEFT JOIN ${conn.table('help_topic')} p ON ht.topic_pid = p.topic_id
    LEFT JOIN ${conn.table('department')} d ON ht.dept_id = d.id
    LEFT JOIN ${conn.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
    LEFT JOIN ${conn.table('sla')} sla ON ht.sla_id = sla.id
    WHERE 1=1
  `;
  const params = [];

  // Filter by public visibility for non-staff
  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND ht.ispublic = 1`;
  } else if (ispublic !== undefined) {
    sql += ` AND ht.ispublic = ?`;
    params.push(ispublic === 'true' || ispublic === '1' ? 1 : 0);
  }

  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
  const countResult = await conn.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  sql += ` ORDER BY ht.sort, ht.topic LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const topics = await conn.query(sql, params);

  res.json({
    success: true,
    data: topics.map(t => ({
      topic_id: t.topic_id,
      topic_pid: t.topic_pid,
      topic: t.topic,
      ispublic: !!t.ispublic,
      noautoresp: !!t.noautoresp,
      flags: t.flags,
      sort: t.sort,
      parent: t.topic_pid ? { topic_id: t.topic_pid, topic: t.parent_topic } : null,
      department: t.dept_id ? { id: t.dept_id, name: t.dept_name } : null,
      priority: t.priority_id ? { priority_id: t.priority_id, priority: t.priority_name } : null,
      sla: t.sla_id ? { id: t.sla_id, name: t.sla_name } : null,
      created: t.created,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

/**
 * Get topic details
 */
const get = async (req, res) => {
  const { id } = req.params;
  const conn = getSdk().connection;

  const topic = await conn.queryOne(`
    SELECT ht.*,
           p.topic as parent_topic,
           d.name as dept_name,
           tp.priority as priority_name, tp.priority_color,
           sla.name as sla_name, sla.grace_period,
           s.firstname, s.lastname,
           t.name as team_name
    FROM ${conn.table('help_topic')} ht
    LEFT JOIN ${conn.table('help_topic')} p ON ht.topic_pid = p.topic_id
    LEFT JOIN ${conn.table('department')} d ON ht.dept_id = d.id
    LEFT JOIN ${conn.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
    LEFT JOIN ${conn.table('sla')} sla ON ht.sla_id = sla.id
    LEFT JOIN ${conn.table('staff')} s ON ht.staff_id = s.staff_id
    LEFT JOIN ${conn.table('team')} t ON ht.team_id = t.team_id
    WHERE ht.topic_id = ?
  `, [id]);

  if (!topic) throw ApiError.notFound('Help topic not found');

  // Check visibility for non-staff
  if ((!req.auth || req.auth.type === 'user') && !topic.ispublic) {
    throw ApiError.notFound('Help topic not found');
  }

  const forms = await conn.query(`
    SELECT htf.*, f.title, f.type
    FROM ${conn.table('help_topic_form')} htf
    JOIN ${conn.table('form')} f ON htf.form_id = f.id
    WHERE htf.topic_id = ?
    ORDER BY htf.sort
  `, [id]);

  res.json({
    success: true,
    data: {
      topic_id: topic.topic_id,
      topic_pid: topic.topic_pid,
      topic: topic.topic,
      ispublic: !!topic.ispublic,
      noautoresp: !!topic.noautoresp,
      flags: topic.flags,
      sort: topic.sort,
      number_format: topic.number_format,
      notes: topic.notes,
      parent: topic.topic_pid ? { topic_id: topic.topic_pid, topic: topic.parent_topic } : null,
      department: topic.dept_id ? { id: topic.dept_id, name: topic.dept_name } : null,
      priority: topic.priority_id ? {
        priority_id: topic.priority_id,
        priority: topic.priority_name,
        priority_color: topic.priority_color,
      } : null,
      sla: topic.sla_id ? {
        id: topic.sla_id,
        name: topic.sla_name,
        grace_period: topic.grace_period,
      } : null,
      defaultAssignee: topic.staff_id ? {
        type: 'staff',
        staff_id: topic.staff_id,
        name: `${topic.firstname || ''} ${topic.lastname || ''}`.trim(),
      } : topic.team_id ? {
        type: 'team',
        team_id: topic.team_id,
        name: topic.team_name,
      } : null,
      forms: forms.map(f => ({
        form_id: f.form_id,
        title: f.title,
        type: f.type,
        sort: f.sort,
      })),
      created: topic.created,
      updated: topic.updated,
    },
  });
};

/**
 * Create help topic (admin)
 */
const create = async (req, res) => {
  const conn = getSdk().connection;
  const { topic, topic_pid, dept_id, priority_id, sla_id, staff_id, team_id,
          ispublic, noautoresp, flags, sort, notes, number_format } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    throw ApiError.badRequest('topic name is required');
  }
  if (topic.length > 128) {
    throw ApiError.badRequest('topic name must be 128 chars or less');
  }

  const parentId = topic_pid || 0;

  const dup = await conn.queryOne(
    `SELECT topic_id FROM ${conn.table('help_topic')} WHERE LOWER(topic) = LOWER(?) AND topic_pid = ?`,
    [topic.trim(), parentId]
  );
  if (dup) throw ApiError.conflict('A topic with that name already exists in this scope');

  if (parentId) {
    const parent = await conn.queryOne(
      `SELECT topic_id FROM ${conn.table('help_topic')} WHERE topic_id = ?`,
      [parentId]
    );
    if (!parent) throw ApiError.badRequest('Parent topic not found');
  }

  const now = new Date();
  const result = await conn.query(
    `INSERT INTO ${conn.table('help_topic')}
     (topic_pid, topic, ispublic, noautoresp, flags, sort, dept_id, priority_id, sla_id, staff_id, team_id, number_format, notes, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parentId,
      topic.trim(),
      ispublic !== undefined ? (ispublic ? 1 : 0) : 1,
      noautoresp ? 1 : 0,
      flags !== undefined ? flags : 1,
      sort || 0,
      dept_id || 0,
      priority_id || 0,
      sla_id || 0,
      staff_id || 0,
      team_id || 0,
      number_format || null,
      notes || null,
      now,
      now,
    ]
  );

  const insertId = result?.insertId || result?.lastInsertId || result?.id;
  res.status(201).json({ success: true, data: { topic_id: insertId, topic: topic.trim() } });
};

/**
 * Update help topic (admin)
 */
const update = async (req, res) => {
  const conn = getSdk().connection;
  const { id } = req.params;
  const existing = await conn.queryOne(
    `SELECT * FROM ${conn.table('help_topic')} WHERE topic_id = ?`,
    [id]
  );
  if (!existing) throw ApiError.notFound('Help topic not found');

  const { topic, topic_pid, dept_id, priority_id, sla_id, staff_id, team_id,
          ispublic, noautoresp, flags, sort, notes, number_format } = req.body;

  const updates = [];
  const params = [];

  if (topic !== undefined) {
    if (!topic || topic.trim().length === 0) throw ApiError.badRequest('topic cannot be empty');
    if (topic.length > 128) throw ApiError.badRequest('topic name must be 128 chars or less');
    const parentScope = topic_pid !== undefined ? (topic_pid || 0) : existing.topic_pid;
    const dup = await conn.queryOne(
      `SELECT topic_id FROM ${conn.table('help_topic')} WHERE LOWER(topic) = LOWER(?) AND topic_pid = ? AND topic_id != ?`,
      [topic.trim(), parentScope, id]
    );
    if (dup) throw ApiError.conflict('A topic with that name already exists in this scope');
    updates.push('topic = ?'); params.push(topic.trim());
  }

  if (topic_pid !== undefined) {
    const newParent = topic_pid || 0;
    if (newParent === parseInt(id, 10)) throw ApiError.badRequest('Topic cannot be its own parent');
    if (newParent) {
      const parent = await conn.queryOne(
        `SELECT topic_id FROM ${conn.table('help_topic')} WHERE topic_id = ?`, [newParent]
      );
      if (!parent) throw ApiError.badRequest('Parent topic not found');
    }
    updates.push('topic_pid = ?'); params.push(newParent);
  }

  if (dept_id !== undefined) { updates.push('dept_id = ?'); params.push(dept_id || 0); }
  if (priority_id !== undefined) { updates.push('priority_id = ?'); params.push(priority_id || 0); }
  if (sla_id !== undefined) { updates.push('sla_id = ?'); params.push(sla_id || 0); }
  if (staff_id !== undefined) { updates.push('staff_id = ?'); params.push(staff_id || 0); }
  if (team_id !== undefined) { updates.push('team_id = ?'); params.push(team_id || 0); }
  if (ispublic !== undefined) { updates.push('ispublic = ?'); params.push(ispublic ? 1 : 0); }
  if (noautoresp !== undefined) { updates.push('noautoresp = ?'); params.push(noautoresp ? 1 : 0); }
  if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }
  if (sort !== undefined) { updates.push('sort = ?'); params.push(sort); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (number_format !== undefined) { updates.push('number_format = ?'); params.push(number_format); }

  if (updates.length === 0) throw ApiError.badRequest('No fields to update');

  updates.push('updated = ?');
  params.push(new Date());
  params.push(id);

  await conn.query(
    `UPDATE ${conn.table('help_topic')} SET ${updates.join(', ')} WHERE topic_id = ?`,
    params
  );

  res.json({ success: true, message: 'Help topic updated' });
};

/**
 * Remove help topic (admin)
 */
const remove = async (req, res) => {
  const conn = getSdk().connection;
  const { id } = req.params;
  const existing = await conn.queryOne(
    `SELECT topic_id FROM ${conn.table('help_topic')} WHERE topic_id = ?`, [id]
  );
  if (!existing) throw ApiError.notFound('Help topic not found');

  const children = await conn.queryOne(
    `SELECT COUNT(*) as count FROM ${conn.table('help_topic')} WHERE topic_pid = ?`, [id]
  );
  if (parseInt(children?.count || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete topic with child topics');
  }

  const tickets = await conn.queryOne(
    `SELECT COUNT(*) as count FROM ${conn.table('ticket')} WHERE topic_id = ?`, [id]
  );
  if (parseInt(tickets?.count || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete topic with existing tickets');
  }

  await conn.query(`DELETE FROM ${conn.table('help_topic')} WHERE topic_id = ?`, [id]);
  res.json({ success: true, message: 'Help topic deleted' });
};

module.exports = {
  list,
  get,
  create,
  update,
  remove,
};
