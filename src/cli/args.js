/**
 * Tiny argv parser for CLI commands. No deps.
 *
 * Supported forms:
 *  - `--flag value`     → `{ flag: 'value' }`
 *  - `--flag=value`     → `{ flag: 'value' }`
 *  - `--flag` (trailing or followed by another `--opt`) → `{ flag: true }`
 *  - positional args    → collected in `_` array
 *
 * Notes:
 *  - `--flag=` (empty RHS) yields the empty string `''`, NOT `true`.
 *  - Values are always returned as strings (or booleans for bare flags);
 *    callers must coerce numeric args themselves.
 *  - Later occurrences of the same flag overwrite earlier ones.
 *
 * @param {string[]} argv - argv slice WITHOUT node/script (e.g. `process.argv.slice(3)`)
 * @returns {Object<string, string|boolean> & { _: string[] }}
 *
 * @example
 * parseArgs(['--out', 'f.csv', '--all-fields', 'extra']);
 * // → { out: 'f.csv', 'all-fields': true, _: ['extra'] }
 */
module.exports = function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          out[key] = true;
        } else {
          out[key] = next;
          i++;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
};
