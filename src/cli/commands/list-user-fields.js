/**
 * list-user-fields — print every dynamic form field discovered on user forms.
 *
 * Diagnostic for `export-users --all-fields` and `set-user-fields`.
 *
 * Usage:
 *   nodeticket list-user-fields
 */
const describe = 'List dynamic form fields defined on user forms';

const help = `
Usage: nodeticket list-user-fields

Prints id, form_id, name (machine), label, and type for every field that
nodeticket discovers on user forms. Discovery walks form_entry rows where
object_type='U' and falls back to form.type='U'.
`.trim();

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function handler(nt) {
  const fields = await nt.users.listUserFormFields();

  if (fields.length === 0) {
    process.stdout.write('(no user form fields discovered)\n');
    return;
  }

  const widths = {
    id: Math.max(2, ...fields.map((f) => String(f.id).length)),
    form: Math.max(4, ...fields.map((f) => String(f.form_id).length)),
    name: Math.max(4, ...fields.map((f) => f.name.length)),
    label: Math.max(5, ...fields.map((f) => f.label.length)),
    type: Math.max(4, ...fields.map((f) => f.type.length)),
  };

  const header =
    pad('id', widths.id) + '  ' +
    pad('form', widths.form) + '  ' +
    pad('name', widths.name) + '  ' +
    pad('label', widths.label) + '  ' +
    pad('type', widths.type);
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');

  for (const f of fields) {
    process.stdout.write(
      pad(f.id, widths.id) + '  ' +
      pad(f.form_id, widths.form) + '  ' +
      pad(f.name, widths.name) + '  ' +
      pad(f.label, widths.label) + '  ' +
      pad(f.type, widths.type) + '\n',
    );
  }

  process.stdout.write(`\n${fields.length} field(s)\n`);
}

module.exports = { describe, help, handler };
