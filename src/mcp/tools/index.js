/**
 * MCP Tool Registry
 *
 * Registers all MCP tools on a given McpServer instance.
 */

const { registerTicketTools } = require('./tickets');

const registerTools = (server, userAuth) => {
  registerTicketTools(server, userAuth);
};

module.exports = { registerTools };
