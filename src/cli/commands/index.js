/**
 * CLI command registry. Add new commands here.
 *
 * @typedef {Object} CliCommand
 * @property {string} describe - One-line summary shown in top-level help.
 * @property {string} [help] - Multi-line usage block printed on `--help`.
 * @property {(nt: Object, args: Object) => Promise<void>} handler
 *   Async command body. Receives the initialized SDK instance and parsed
 *   argv. Throw SDK error classes (ValidationError, NotFoundError, ...)
 *   to produce the corresponding CLI exit codes.
 *
 * @type {Object<string, CliCommand>}
 */
module.exports = {
  'change-password': require('./change-password'),
  'export-users': require('./export-users'),
  'list-user-fields': require('./list-user-fields'),
};
