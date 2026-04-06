/**
 * CLI command registry. Add new commands here.
 */
module.exports = {
  'change-password': require('./change-password'),
  'export-users': require('./export-users'),
  'list-user-fields': require('./list-user-fields'),
};
