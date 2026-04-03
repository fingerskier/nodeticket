/**
 * System Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Get system configuration
 */
const getConfig = async (req, res) => {
  const data = await getSdk().system.getConfig();
  res.json({ success: true, data });
};

/**
 * Get system statistics
 */
const getStats = async (req, res) => {
  const data = await getSdk().system.getStats();
  res.json({ success: true, data });
};

/**
 * List ticket priorities
 */
const listPriorities = async (req, res) => {
  const publicOnly = !req.auth || req.auth.type === 'user';
  const data = await getSdk().system.listPriorities({ publicOnly });
  res.json({ success: true, data });
};

/**
 * List ticket statuses
 */
const listStatuses = async (req, res) => {
  const data = await getSdk().system.listStatuses();
  res.json({ success: true, data });
};

/**
 * Run cron tasks
 */
const runCron = async (req, res) => {
  if (req.auth?.type === 'apikey') {
    if (!req.auth.permissions.can_exec_cron) {
      throw ApiError.forbidden('API key does not have cron permission');
    }
  } else if (!req.auth?.isAdmin) {
    throw ApiError.forbidden('Administrator access required');
  }

  // Placeholder for cron execution
  const tasks = [
    { name: 'MailFetcher', status: 'skipped', message: 'Not implemented' },
    { name: 'TicketMonitor', status: 'skipped', message: 'Not implemented' },
    { name: 'CleanExpiredSessions', status: 'skipped', message: 'Not implemented' },
  ];

  res.json({ success: true, message: 'Cron execution completed', tasks });
};

module.exports = {
  getConfig,
  getStats,
  listPriorities,
  listStatuses,
  runCron,
};
