/**
 * System Routes
 */

const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/system/config - Get system configuration
router.get('/system/config', authenticate, requireStaff, asyncHandler(systemController.getConfig));

// GET /api/v1/system/stats - Get system statistics
router.get('/system/stats', authenticate, requireStaff, asyncHandler(systemController.getStats));

// GET /api/v1/priorities - List ticket priorities
router.get('/priorities', authenticate, asyncHandler(systemController.listPriorities));

// GET /api/v1/statuses - List ticket statuses
router.get('/statuses', authenticate, asyncHandler(systemController.listStatuses));

// POST /api/v1/cron - Execute scheduled tasks
router.post('/cron', authenticate, asyncHandler(systemController.runCron));

module.exports = router;
