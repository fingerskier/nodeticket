/**
 * Department Routes
 */

const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/departments - List departments
router.get('/', authenticate, asyncHandler(departmentController.list));

// GET /api/v1/departments/:id - Get department details
router.get('/:id', authenticate, asyncHandler(departmentController.get));

// GET /api/v1/departments/:id/staff - Get department staff
router.get('/:id/staff', authenticate, requireStaff, asyncHandler(departmentController.getStaff));

// GET /api/v1/departments/:id/tickets - Get department tickets
router.get('/:id/tickets', authenticate, requireStaff, asyncHandler(departmentController.getTickets));

// POST /api/v1/departments - Create department
router.post('/', authenticate, requireAdmin, asyncHandler(departmentController.create));

// PUT /api/v1/departments/:id - Update department
router.put('/:id', authenticate, requireAdmin, asyncHandler(departmentController.update));

// DELETE /api/v1/departments/:id - Delete department
router.delete('/:id', authenticate, requireAdmin, asyncHandler(departmentController.remove));

module.exports = router;
