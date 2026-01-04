/**
 * Help Topic Controller
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
 * List help topics
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { ispublic } = req.query;

  let sql = `
    SELECT ht.*,
           p.topic as parent_topic,
           d.name as dept_name,
           tp.priority as priority_name,
           sla.name as sla_name
    FROM ${db.table('help_topic')} ht
    LEFT JOIN ${db.table('help_topic')} p ON ht.topic_pid = p.topic_id
    LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
    LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
    LEFT JOIN ${db.table('sla')} sla ON ht.sla_id = sla.id
    WHERE 1=1
  `;
  const params = [];

  // Filter by public visibility
  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND ht.ispublic = 1`;
  } else if (ispublic !== undefined) {
    sql += ` AND ht.ispublic = ?`;
    params.push(ispublic === 'true' || ispublic === '1' ? 1 : 0);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add sorting and pagination
  sql += ` ORDER BY ht.sort, ht.topic LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const topics = await db.query(sql, params);

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
      created: t.created
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
 * Get topic details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const topic = await db.queryOne(`
    SELECT ht.*,
           p.topic as parent_topic,
           d.name as dept_name,
           tp.priority as priority_name, tp.priority_color,
           sla.name as sla_name, sla.grace_period,
           s.firstname, s.lastname,
           t.name as team_name
    FROM ${db.table('help_topic')} ht
    LEFT JOIN ${db.table('help_topic')} p ON ht.topic_pid = p.topic_id
    LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
    LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
    LEFT JOIN ${db.table('sla')} sla ON ht.sla_id = sla.id
    LEFT JOIN ${db.table('staff')} s ON ht.staff_id = s.staff_id
    LEFT JOIN ${db.table('team')} t ON ht.team_id = t.team_id
    WHERE ht.topic_id = ?
  `, [id]);

  if (!topic) {
    throw ApiError.notFound('Help topic not found');
  }

  // Check visibility for non-staff
  if ((!req.auth || req.auth.type === 'user') && !topic.ispublic) {
    throw ApiError.notFound('Help topic not found');
  }

  // Get associated forms
  const forms = await db.query(`
    SELECT htf.*, f.title, f.type
    FROM ${db.table('help_topic_form')} htf
    JOIN ${db.table('form')} f ON htf.form_id = f.id
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
        priority_color: topic.priority_color
      } : null,
      sla: topic.sla_id ? {
        id: topic.sla_id,
        name: topic.sla_name,
        grace_period: topic.grace_period
      } : null,
      defaultAssignee: topic.staff_id ? {
        type: 'staff',
        staff_id: topic.staff_id,
        name: `${topic.firstname || ''} ${topic.lastname || ''}`.trim()
      } : topic.team_id ? {
        type: 'team',
        team_id: topic.team_id,
        name: topic.team_name
      } : null,
      forms: forms.map(f => ({
        form_id: f.form_id,
        title: f.title,
        type: f.type,
        sort: f.sort
      })),
      created: topic.created,
      updated: topic.updated
    }
  });
};

module.exports = {
  list,
  get
};
