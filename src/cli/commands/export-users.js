/**
 * export-users — dump users to CSV.
 *
 * Usage:
 *   nodeticket export-users [--out file.csv] [--limit N] [--fields a,b,c]
 *                           [--contact] [--all-fields]
 */
const fs = require('fs');
const { ValidationError } = require('../../sdk/errors');

const describe = 'Export users to CSV';

const help = `
Usage: nodeticket export-users [options]

Options:
  --out <file>       Output file (default: stdout)
  --limit <n>        Maximum total rows (default: all)
  --fields <list>    Comma-separated columns (default: id,name,email,org,created)
  --contact          Shortcut: append address,phone,email to fields
  --all-fields       Append every dynamic form field defined on user forms
                     (discovered via form.type='U'). Header uses field machine
                     names; collisions with built-ins are skipped with a warning.

Built-in fields: id, name, email, org, org_id, status, created, updated,
                 phone, address
`.trim();

const BUILTIN_ACCESSORS = {
  id: (u) => u.id,
  name: (u) => u.name,
  email: (u) => u.email,
  org: (u) => (u.organization ? u.organization.name : ''),
  org_id: (u) => u.org_id,
  status: (u) => u.status,
  created: (u) => formatDate(u.created),
  updated: (u) => formatDate(u.updated),
  phone: (u) => (u._contact ? u._contact.phone : ''),
  address: (u) => (u._contact ? u._contact.address : ''),
};

const CONTACT_FIELDS = new Set(['phone', 'address']);

function formatDate(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(',') + '\n';
}

async function handler(nt, args) {
  if (args.help || args.h) {
    process.stdout.write(help + '\n');
    return;
  }

  const fieldNames = (args.fields || 'id,name,email,org,created')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (args.contact) {
    for (const f of ['address', 'phone', 'email']) {
      if (!fieldNames.includes(f)) fieldNames.push(f);
    }
  }

  // Discover dynamic form fields up front (also used to validate --fields).
  const dynamicFields = await nt.users.listUserFormFields();
  const dynamicByName = new Map();
  for (const f of dynamicFields) {
    if (f.name && !dynamicByName.has(f.name)) dynamicByName.set(f.name, f);
  }

  if (args['all-fields']) {
    for (const f of dynamicFields) {
      if (!f.name) continue;
      if (BUILTIN_ACCESSORS[f.name]) {
        process.stderr.write(
          `warning: dynamic field "${f.name}" collides with built-in column; skipping\n`,
        );
        continue;
      }
      if (!fieldNames.includes(f.name)) fieldNames.push(f.name);
    }
  }

  // Validate every requested field is either a built-in or a known dynamic field.
  for (const f of fieldNames) {
    if (!BUILTIN_ACCESSORS[f] && !dynamicByName.has(f)) {
      throw new ValidationError(
        `Unknown field: ${f}. Built-ins: ${Object.keys(BUILTIN_ACCESSORS).join(', ')}. ` +
        `Run with --all-fields to include dynamic fields, or check form_field.name.`,
      );
    }
  }

  // Which dynamic fields actually need fetching this run?
  const dynamicToFetch = fieldNames.filter(
    (f) => !BUILTIN_ACCESSORS[f] && dynamicByName.has(f),
  );
  const needContact = fieldNames.some((f) => CONTACT_FIELDS.has(f));

  const limit = args.limit !== undefined ? parseInt(args.limit, 10) : Infinity;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new ValidationError('--limit must be a positive integer');
  }

  const sink = args.out
    ? fs.createWriteStream(args.out, { encoding: 'utf8' })
    : process.stdout;

  const closeSink = () =>
    new Promise((resolve, reject) => {
      if (sink === process.stdout) return resolve();
      sink.end((err) => (err ? reject(err) : resolve()));
    });

  try {
    sink.write(csvRow(fieldNames));

    let written = 0;
    let page = 1;
    const pageSize = 100;

    while (written < limit) {
      const { data, pagination } = await nt.users.list({ page, limit: pageSize });
      if (data.length === 0) break;

      const ids = data.map((u) => u.id);

      if (needContact) {
        const contacts = await nt.users.getContactInfoBulk(ids);
        for (const u of data) {
          u._contact = contacts.get(Number(u.id)) || { phone: '', address: '' };
        }
      }

      let dynValues = null;
      if (dynamicToFetch.length > 0) {
        dynValues = await nt.users.getFormValuesBulk(ids, dynamicToFetch);
      }

      for (const u of data) {
        if (written >= limit) break;
        const row = fieldNames.map((f) => {
          if (BUILTIN_ACCESSORS[f]) return BUILTIN_ACCESSORS[f](u);
          const m = dynValues && dynValues.get(Number(u.id));
          return m ? (m.get(f) || '') : '';
        });
        sink.write(csvRow(row));
        written++;
      }

      if (page >= pagination.totalPages) break;
      page++;
    }

    if (args.out) {
      process.stderr.write(`wrote ${written} row(s) to ${args.out}\n`);
    }
  } finally {
    await closeSink();
  }
}

module.exports = { describe, help, handler };
