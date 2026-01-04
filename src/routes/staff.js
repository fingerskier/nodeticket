/**
 * Staff Routes
 */

const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/staff - List staff members
router.get('/', authenticate, requireStaff, asyncHandler(staffController.list));

// GET /api/v1/staff/:id - Get staff details
router.get('/:id', authenticate, requireStaff, asyncHandler(staffController.get));

// GET /api/v1/staff/:id/tickets - Get staff's assigned tickets
router.get('/:id/tickets', authenticate, requireStaff, asyncHandler(staffController.getTickets));

// GET /api/v1/staff/:id/departments - Get staff's departments
router.get('/:id/departments', authenticate, requireStaff, asyncHandler(staffController.getDepartments));

// GET /api/v1/staff/:id/teams - Get staff's teams
router.get('/:id/teams', authenticate, requireStaff, asyncHandler(staffController.getTeams));

module.exports = router;
