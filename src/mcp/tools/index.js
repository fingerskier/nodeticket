/**
 * MCP Tool Registry
 *
 * Registers all MCP tools on a given McpServer instance.
 */

const { registerTicketTools } = require('./tickets');
const { registerUserTools } = require('./users');
const { registerStaffTools } = require('./staff');
const { registerAdminTools } = require('./admin');

const registerTools = (server, userAuth) => {
  registerTicketTools(server, userAuth);
  registerUserTools(server, userAuth);
  registerStaffTools(server, userAuth);
  registerAdminTools(server, userAuth);
};

module.exports = { registerTools };
