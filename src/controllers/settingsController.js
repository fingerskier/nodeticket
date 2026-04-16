const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

const SETTINGS_GROUPS = {
  general: {
    label: 'General',
    keys: {
      helpdesk_title: { type: 'text', label: 'Helpdesk Title' },
      helpdesk_url: { type: 'text', label: 'Helpdesk URL' },
    }
  },
  tickets: {
    label: 'Tickets',
    keys: {
      default_dept_id: { type: 'fk', label: 'Default Department', table: 'department', valueCol: 'id', labelCol: 'name' },
      default_sla_id: { type: 'fk', label: 'Default SLA Plan', table: 'sla', valueCol: 'id', labelCol: 'name' },
      default_priority_id: { type: 'fk', label: 'Default Priority', table: 'ticket_priority', valueCol: 'priority_id', labelCol: 'priority_desc' },
      default_template_id: { type: 'fk', label: 'Default Email Template', table: 'email_template_group', valueCol: 'tpl_id', labelCol: 'name' },
      ticket_autolock: { type: 'toggle', label: 'Auto-lock Tickets' },
      auto_claim_tickets: { type: 'toggle', label: 'Auto-claim Tickets' },
    }
  },
  kb: {
    label: 'Knowledge Base',
    keys: {
      enable_kb: { type: 'toggle', label: 'Enable Knowledge Base' },
      enable_captcha: { type: 'toggle', label: 'Enable CAPTCHA' },
    }
  },
  files: {
    label: 'Files',
    keys: {
      max_file_size: { type: 'number', label: 'Max File Size (bytes)' },
      allowed_filetypes: { type: 'text', label: 'Allowed File Types' },
    }
  }
};

const list = async (req, res) => {
  const rows = await db.query(
    `SELECT \`namespace\`, \`key\`, value FROM ${db.table('config')} ORDER BY \`namespace\`, \`key\``
  );

  const configMap = {};
  for (const row of rows) configMap[row.key] = row.value;

  const fkOptions = {};
  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      if (def.type === 'fk') {
        try {
          fkOptions[key] = await db.query(
            `SELECT ${def.valueCol} as value, ${def.labelCol} as label FROM ${db.table(def.table)} ORDER BY ${def.labelCol}`
          );
        } catch (e) {
          fkOptions[key] = [];
        }
      }
    }
  }

  res.json({
    success: true,
    data: { groups: SETTINGS_GROUPS, values: configMap, fkOptions }
  });
};

const update = async (req, res) => {
  const updates = req.body;

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw ApiError.badRequest('No settings to update');
  }

  const allKeys = {};
  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      allKeys[key] = def;
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    const def = allKeys[key];
    if (!def) throw ApiError.badRequest(`Unknown setting: ${key}`);

    if (def.type === 'number') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        throw ApiError.badRequest(`${def.label} must be a non-negative number`);
      }
    }

    if (def.type === 'fk' && value) {
      const exists = await db.queryOne(
        `SELECT ${def.valueCol} FROM ${db.table(def.table)} WHERE ${def.valueCol} = ?`,
        [value]
      );
      if (!exists) {
        throw ApiError.badRequest(`Invalid ${def.label}: referenced entity does not exist`);
      }
    }

    if (def.type === 'toggle') {
      updates[key] = value ? '1' : '0';
    }
  }

  await db.transaction(async (txQuery, txQueryOne) => {
    for (const [key, value] of Object.entries(updates)) {
      const existing = await txQueryOne(
        `SELECT id FROM ${db.table('config')} WHERE \`key\` = ?`,
        [key]
      );

      if (existing) {
        await txQuery(
          `UPDATE ${db.table('config')} SET value = ?, updated = ? WHERE \`key\` = ?`,
          [String(value), new Date(), key]
        );
      } else {
        await txQuery(
          `INSERT INTO ${db.table('config')} (\`namespace\`, \`key\`, value, updated) VALUES (?, ?, ?, ?)`,
          ['core', key, String(value), new Date()]
        );
      }
    }
  });

  res.json({ success: true, message: 'Settings updated' });
};

module.exports = { list, update, SETTINGS_GROUPS };
