/**
 * Task Routes
 */

const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/tasks - List tasks
router.get('/', authenticate, requireStaff, asyncHandler(taskController.list));

// GET /api/v1/tasks/:id - Get task details
router.get('/:id', authenticate, requireStaff, asyncHandler(taskController.get));

// GET /api/v1/tasks/:id/thread - Get task thread
router.get('/:id/thread', authenticate, requireStaff, asyncHandler(taskController.getThread));

module.exports = router;
