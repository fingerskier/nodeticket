/**
 * Task Controller
 */

const db = require('../lib/db');
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
 * List tasks
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { staff_id, dept_id, team_id } = req.query;

  let sql = `
    SELECT t.*,
           d.name as dept_name,
           CONCAT(s.firstname, ' ', s.lastname) as staff_name,
           tm.name as team_name,
           tc.title, tc.description
    FROM ${db.table('task')} t
    LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
    LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
    LEFT JOIN ${db.table('team')} tm ON t.team_id = tm.team_id
    LEFT JOIN ${db.table('task__cdata')} tc ON t.id = tc.task_id
    WHERE 1=1
  `;
  const params = [];

  if (staff_id) {
    sql += ` AND t.staff_id = ?`;
    params.push(staff_id);
  }

  if (dept_id) {
    sql += ` AND t.dept_id = ?`;
    params.push(dept_id);
  }

  if (team_id) {
    sql += ` AND t.team_id = ?`;
    params.push(team_id);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY t.created DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const tasks = await db.query(sql, params);

  res.json({
    success: true,
    data: tasks.map(t => ({
      id: t.id,
      number: t.number,
      title: t.title,
      object_id: t.object_id,
      object_type: t.object_type,
      dept_id: t.dept_id,
      department: t.dept_name ? { id: t.dept_id, name: t.dept_name } : null,
      staff_id: t.staff_id,
      staff_name: t.staff_name,
      team_id: t.team_id,
      team_name: t.team_name,
      flags: t.flags,
      isClosed: !!t.closed,
      duedate: t.duedate,
      closed: t.closed,
      created: t.created,
      updated: t.updated
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get task details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const task = await db.queryOne(`
    SELECT t.*,
           d.name as dept_name,
           s.staff_id, s.firstname, s.lastname, s.email as staff_email,
           tm.team_id, tm.name as team_name,
           tc.title, tc.description,
           th.id as thread_id
    FROM ${db.table('task')} t
    LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
    LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
    LEFT JOIN ${db.table('team')} tm ON t.team_id = tm.team_id
    LEFT JOIN ${db.table('task__cdata')} tc ON t.id = tc.task_id
    LEFT JOIN ${db.table('thread')} th ON th.object_id = t.id AND th.object_type = 'A'
    WHERE t.id = ?
  `, [id]);

  if (!task) {
    throw ApiError.notFound('Task not found');
  }

  // Get parent ticket if linked
  let ticket = null;
  if (task.object_type === 'T' && task.object_id) {
    ticket = await db.queryOne(`
      SELECT ticket_id, number FROM ${db.table('ticket')} WHERE ticket_id = ?
    `, [task.object_id]);
  }

  res.json({
    success: true,
    data: {
      id: task.id,
      number: task.number,
      title: task.title,
      description: task.description,
      object_id: task.object_id,
      object_type: task.object_type,
      department: task.dept_id ? { id: task.dept_id, name: task.dept_name } : null,
      staff: task.staff_id ? {
        staff_id: task.staff_id,
        name: `${task.firstname || ''} ${task.lastname || ''}`.trim(),
        email: task.staff_email
      } : null,
      team: task.team_id ? {
        team_id: task.team_id,
        name: task.team_name
      } : null,
      ticket: ticket ? {
        ticket_id: ticket.ticket_id,
        number: ticket.number
      } : null,
      thread_id: task.thread_id,
      flags: task.flags,
      isClosed: !!task.closed,
      duedate: task.duedate,
      closed: task.closed,
      created: task.created,
      updated: task.updated
    }
  });
};

/**
 * Get task thread
 */
const getThread = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  const thread = await db.queryOne(`
    SELECT th.id FROM ${db.table('thread')} th
    WHERE th.object_id = ? AND th.object_type = 'A'
  `, [id]);

  if (!thread) {
    throw ApiError.notFound('Task not found');
  }

  const entries = await db.query(`
    SELECT te.*,
           s.firstname, s.lastname, s.email as staff_email
    FROM ${db.table('thread_entry')} te
    LEFT JOIN ${db.table('staff')} s ON te.staff_id = s.staff_id
    WHERE te.thread_id = ?
    ORDER BY te.created ASC
    LIMIT ? OFFSET ?
  `, [thread.id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('thread_entry')} WHERE thread_id = ?
  `, [thread.id]);

  res.json({
    success: true,
    data: entries.map(e => ({
      id: e.id,
      thread_id: e.thread_id,
      staff_id: e.staff_id,
      type: e.type,
      poster: e.poster || (e.staff_id ? `${e.firstname || ''} ${e.lastname || ''}`.trim() : null),
      title: e.title,
      body: e.body,
      format: e.format,
      created: e.created
    })),
    pagination: {
      page,
      limit,
      total: parseInt(total || 0, 10),
      totalPages: Math.ceil(total / limit)
    }
  });
};

module.exports = {
  list,
  get,
  getThread
};
