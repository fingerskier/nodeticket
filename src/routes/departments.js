/**
 * Department Routes
 */

const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/departments - List departments
router.get('/', authenticate, asyncHandler(departmentController.list));

// GET /api/v1/departments/:id - Get department details
router.get('/:id', authenticate, asyncHandler(departmentController.get));

// GET /api/v1/departments/:id/staff - Get department staff
router.get('/:id/staff', authenticate, requireStaff, asyncHandler(departmentController.getStaff));

// GET /api/v1/departments/:id/tickets - Get department tickets
router.get('/:id/tickets', authenticate, requireStaff, asyncHandler(departmentController.getTickets));

module.exports = router;
