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
  // API keys: capability only (never treated as staff/admin elsewhere)
  if (req.auth?.type === 'apikey') {
    if (!req.auth.permissions?.can_exec_cron) {
      throw ApiError.unauthorized('API key does not have cron permission');
    }
  } else if (req.auth?.type === 'staff' && req.auth?.isAdmin) {
    // admins may trigger cron via native API
  } else {
    throw ApiError.forbidden('Administrator access or cron-capable API key required');
  }

  const { runAllCronJobs } = require('../lib/cron');
  const { tasks, elapsedMs } = await runAllCronJobs(getSdk().connection);

  res.json({
    success: true,
    message: 'Cron execution completed',
    tasks,
    elapsedMs,
  });
};

module.exports = {
  getConfig,
  getStats,
  listPriorities,
  listStatuses,
  runCron,
};
