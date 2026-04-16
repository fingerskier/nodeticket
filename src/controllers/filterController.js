/**
 * Filter Controller — CRUD for ticket routing filters and applyFilters engine
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

const VALID_HOW = new Set(['equal', 'not_equal', 'contains', 'dn_contain', 'starts', 'ends', 'match', 'not_match']);
const VALID_ACTIONS = new Set(['set_dept', 'set_priority', 'set_sla', 'set_status', 'assign_staff', 'assign_team', 'set_topic', 'reject']);
const VALID_TARGETS = new Set(['Any', 'Web', 'Email', 'API']);

function validateRegex(val) {
  try {
    new RegExp(val);
    return true;
  } catch {
    return false;
  }
}

function validateRules(rules) {
  if (!Array.isArray(rules)) throw ApiError.badRequest('rules must be an array');
  for (const r of rules) {
    if (!r.what || typeof r.what !== 'string' || r.what.length > 32) throw ApiError.badRequest('invalid rule.what');
    if (!VALID_HOW.has(r.how)) throw ApiError.badRequest(`invalid rule.how: ${r.how}`);
    if (typeof r.val !== 'string' || r.val.length > 255) throw ApiError.badRequest('invalid rule.val');
    if ((r.how === 'match' || r.how === 'not_match') && !validateRegex(r.val)) {
      throw ApiError.badRequest(`invalid regex in rule: ${r.val}`);
    }
  }
}

function validateActions(actions) {
  if (!Array.isArray(actions)) throw ApiError.badRequest('actions must be an array');
  for (const a of actions) {
    if (!VALID_ACTIONS.has(a.type)) throw ApiError.badRequest(`invalid action.type: ${a.type}`);
    try { JSON.parse(typeof a.configuration === 'string' ? a.configuration : JSON.stringify(a.configuration || {})); }
    catch { throw ApiError.badRequest('action.configuration must be valid JSON'); }
  }
}

const list = async (req, res) => {
  const rows = await db.query(
    `SELECT f.*,
            (SELECT COUNT(*) FROM ${db.table('filter_rule')} fr WHERE fr.filter_id = f.id) as rule_count,
            (SELECT COUNT(*) FROM ${db.table('filter_action')} fa WHERE fa.filter_id = f.id) as action_count
     FROM ${db.table('filter')} f
     ORDER BY f.execorder, f.id`
  );
  res.json({
    success: true,
    data: rows.map(f => ({
      id: f.id, name: f.name, execorder: f.execorder, isactive: !!f.isactive,
      target: f.target, match_all_rules: !!f.match_all_rules, stop_onmatch: !!f.stop_onmatch,
      rule_count: parseInt(f.rule_count || 0, 10),
      action_count: parseInt(f.action_count || 0, 10),
      notes: f.notes,
    })),
  });
};

const get = async (req, res) => {
  const { id } = req.params;
  const filter = await db.queryOne(`SELECT * FROM ${db.table('filter')} WHERE id = ?`, [id]);
  if (!filter) throw ApiError.notFound('Filter not found');
  const rules = await db.query(`SELECT * FROM ${db.table('filter_rule')} WHERE filter_id = ? ORDER BY id`, [id]);
  const actions = await db.query(`SELECT * FROM ${db.table('filter_action')} WHERE filter_id = ? ORDER BY sort, id`, [id]);
  res.json({
    success: true,
    data: {
      id: filter.id, name: filter.name, execorder: filter.execorder,
      isactive: !!filter.isactive, target: filter.target,
      match_all_rules: !!filter.match_all_rules, stop_onmatch: !!filter.stop_onmatch,
      email_id: filter.email_id, flags: filter.flags, notes: filter.notes,
      rules: rules.map(r => ({ id: r.id, what: r.what, how: r.how, val: r.val, isactive: !!r.isactive })),
      actions: actions.map(a => ({ id: a.id, type: a.type, configuration: a.configuration, sort: a.sort })),
    },
  });
};

const create = async (req, res) => {
  const { name, isactive, target, match_all_rules, stop_onmatch, email_id, flags, notes, rules = [], actions = [] } = req.body;
  if (!name || !name.trim()) throw ApiError.badRequest('name is required');
  if (name.length > 32) throw ApiError.badRequest('name must be 32 chars or less');
  if (target && !VALID_TARGETS.has(target)) throw ApiError.badRequest('invalid target');
  validateRules(rules);
  validateActions(actions);

  const now = new Date();
  const result = await db.transaction(async (txQuery, txQueryOne) => {
    const maxRow = await txQueryOne(`SELECT MAX(execorder) as max FROM ${db.table('filter')}`);
    const nextOrder = (parseInt(maxRow?.max || 0, 10)) + 1;

    const fr = await txQuery(
      `INSERT INTO ${db.table('filter')}
       (execorder, isactive, flags, status, match_all_rules, stop_onmatch, target, email_id, name, notes, created, updated)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextOrder, isactive === false ? 0 : 1, flags || 0,
       match_all_rules ? 1 : 0, stop_onmatch ? 1 : 0,
       target || 'Any', email_id || 0, name.trim(), notes || null, now, now]
    );
    const filterId = fr?.insertId || fr?.lastInsertId || fr?.id;

    for (const r of rules) {
      await txQuery(
        `INSERT INTO ${db.table('filter_rule')} (filter_id, what, how, val, isactive, notes, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [filterId, r.what, r.how, r.val, r.isactive === false ? 0 : 1, r.notes || '', now, now]
      );
    }

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const config = typeof a.configuration === 'string' ? a.configuration : JSON.stringify(a.configuration || {});
      await txQuery(
        `INSERT INTO ${db.table('filter_action')} (filter_id, sort, type, configuration, updated)
         VALUES (?, ?, ?, ?, ?)`,
        [filterId, a.sort !== undefined ? a.sort : i, a.type, config, now]
      );
    }

    return filterId;
  });

  res.status(201).json({ success: true, data: { id: result, name: name.trim() } });
};

const update = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT id FROM ${db.table('filter')} WHERE id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Filter not found');

  const { name, isactive, target, match_all_rules, stop_onmatch, email_id, flags, notes, rules, actions } = req.body;
  if (target && !VALID_TARGETS.has(target)) throw ApiError.badRequest('invalid target');
  if (rules !== undefined) validateRules(rules);
  if (actions !== undefined) validateActions(actions);

  const now = new Date();
  await db.transaction(async (txQuery) => {
    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name.trim()); }
    if (isactive !== undefined) { updates.push('isactive = ?'); args.push(isactive ? 1 : 0); }
    if (target !== undefined) { updates.push('target = ?'); args.push(target); }
    if (match_all_rules !== undefined) { updates.push('match_all_rules = ?'); args.push(match_all_rules ? 1 : 0); }
    if (stop_onmatch !== undefined) { updates.push('stop_onmatch = ?'); args.push(stop_onmatch ? 1 : 0); }
    if (email_id !== undefined) { updates.push('email_id = ?'); args.push(email_id); }
    if (flags !== undefined) { updates.push('flags = ?'); args.push(flags); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }

    if (updates.length > 0) {
      updates.push('updated = ?'); args.push(now); args.push(id);
      await txQuery(`UPDATE ${db.table('filter')} SET ${updates.join(', ')} WHERE id = ?`, args);
    }

    if (rules !== undefined) {
      await txQuery(`DELETE FROM ${db.table('filter_rule')} WHERE filter_id = ?`, [id]);
      for (const r of rules) {
        await txQuery(
          `INSERT INTO ${db.table('filter_rule')} (filter_id, what, how, val, isactive, notes, created, updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, r.what, r.how, r.val, r.isactive === false ? 0 : 1, r.notes || '', now, now]
        );
      }
    }

    if (actions !== undefined) {
      await txQuery(`DELETE FROM ${db.table('filter_action')} WHERE filter_id = ?`, [id]);
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        const config = typeof a.configuration === 'string' ? a.configuration : JSON.stringify(a.configuration || {});
        await txQuery(
          `INSERT INTO ${db.table('filter_action')} (filter_id, sort, type, configuration, updated)
           VALUES (?, ?, ?, ?, ?)`,
          [id, a.sort !== undefined ? a.sort : i, a.type, config, now]
        );
      }
    }
  });

  res.json({ success: true, message: 'Filter updated' });
};

const remove = async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne(`SELECT id FROM ${db.table('filter')} WHERE id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Filter not found');
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('filter_action')} WHERE filter_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('filter_rule')} WHERE filter_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('filter')} WHERE id = ?`, [id]);
  });
  res.json({ success: true, message: 'Filter deleted' });
};

const reorder = async (req, res) => {
  const { filterIds } = req.body;
  if (!Array.isArray(filterIds)) throw ApiError.badRequest('filterIds must be an array');

  const allRows = await db.query(`SELECT id FROM ${db.table('filter')}`);
  const allIds = new Set(allRows.map(r => parseInt(r.id, 10)));
  const provided = new Set(filterIds.map(i => parseInt(i, 10)));

  if (allIds.size !== provided.size) throw ApiError.badRequest('filterIds must contain every filter id exactly once');
  for (const id of allIds) {
    if (!provided.has(id)) throw ApiError.badRequest(`missing filter id: ${id}`);
  }
  if (filterIds.length !== new Set(filterIds).size) throw ApiError.badRequest('duplicate filter ids');

  const now = new Date();
  await db.transaction(async (txQuery) => {
    for (let i = 0; i < filterIds.length; i++) {
      await txQuery(`UPDATE ${db.table('filter')} SET execorder = ?, updated = ? WHERE id = ?`,
        [i + 1, now, filterIds[i]]);
    }
  });
  res.json({ success: true, message: 'Reordered' });
};

/**
 * Evaluate a single rule against a ticket data object. Coerces to String.
 */
function evaluateRule(rule, ticket) {
  const field = String(ticket[rule.what] ?? '');
  const val = String(rule.val ?? '');
  switch (rule.how) {
    case 'equal': return val === field;
    case 'not_equal': return val !== field;
    case 'contains': return field.includes(val);
    case 'dn_contain': return !field.includes(val);
    case 'starts': return field.startsWith(val);
    case 'ends': return field.endsWith(val);
    case 'match':
      try { return new RegExp(val).test(field); }
      catch (e) { console.warn(`Filter rule invalid regex: ${val}`, e.message); return false; }
    case 'not_match':
      try { return !new RegExp(val).test(field); }
      catch (e) { console.warn(`Filter rule invalid regex: ${val}`, e.message); return false; }
    default: return false;
  }
}

/**
 * Apply active filters to a ticket object, returning field updates or rejection.
 * Accepts query functions so it runs inside a transaction.
 */
async function applyFilters(ticket, queryFn = db.query, queryOneFn = db.queryOne) {
  const filters = await queryFn(
    `SELECT * FROM ${db.table('filter')} WHERE isactive = 1
     AND (target = 'Any' OR target = ?)
     ORDER BY execorder, id`,
    [ticket.source || 'Any']
  );

  const fieldUpdates = {};

  for (const filter of filters) {
    const rules = await queryFn(
      `SELECT * FROM ${db.table('filter_rule')} WHERE filter_id = ? AND isactive = 1`,
      [filter.id]
    );
    if (rules.length === 0) continue;

    const matches = rules.map(r => evaluateRule(r, ticket));
    const matched = filter.match_all_rules ? matches.every(Boolean) : matches.some(Boolean);
    if (!matched) continue;

    const actions = await queryFn(
      `SELECT * FROM ${db.table('filter_action')} WHERE filter_id = ? ORDER BY sort, id`,
      [filter.id]
    );
    for (const action of actions) {
      let config = {};
      try { config = JSON.parse(action.configuration || '{}'); } catch {}

      switch (action.type) {
        case 'set_dept': if (config.dept_id) fieldUpdates.dept_id = config.dept_id; break;
        case 'set_priority': if (config.priority_id) fieldUpdates.priority_id = config.priority_id; break;
        case 'set_sla': if (config.sla_id) fieldUpdates.sla_id = config.sla_id; break;
        case 'set_status': if (config.status_id) fieldUpdates.status_id = config.status_id; break;
        case 'assign_staff': if (config.staff_id) fieldUpdates.staff_id = config.staff_id; break;
        case 'assign_team': if (config.team_id) fieldUpdates.team_id = config.team_id; break;
        case 'set_topic': if (config.topic_id) fieldUpdates.topic_id = config.topic_id; break;
        case 'reject':
          return { _rejected: true, _rejectMessage: config.message || 'Rejected by filter' };
      }
    }

    if (filter.stop_onmatch) break;
  }

  return fieldUpdates;
}

module.exports = { list, get, create, update, remove, reorder, applyFilters, evaluateRule };
