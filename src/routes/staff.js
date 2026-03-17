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

// POST /api/v1/staff - Create staff member
router.post('/', authenticate, requireAdmin, asyncHandler(staffController.create));

// GET /api/v1/staff/:id - Get staff details
router.get('/:id', authenticate, requireStaff, asyncHandler(staffController.get));

// PUT /api/v1/staff/:id - Update staff member
router.put('/:id', authenticate, requireAdmin, asyncHandler(staffController.update));

// DELETE /api/v1/staff/:id - Delete staff member
router.delete('/:id', authenticate, requireAdmin, asyncHandler(staffController.remove));

// GET /api/v1/staff/:id/tickets - Get staff's assigned tickets
router.get('/:id/tickets', authenticate, requireStaff, asyncHandler(staffController.getTickets));

// GET /api/v1/staff/:id/departments - Get staff's departments
router.get('/:id/departments', authenticate, requireStaff, asyncHandler(staffController.getDepartments));

// GET /api/v1/staff/:id/teams - Get staff's teams
router.get('/:id/teams', authenticate, requireStaff, asyncHandler(staffController.getTeams));

module.exports = router;
