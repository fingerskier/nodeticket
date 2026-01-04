/**
 * Team Routes
 */

const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/teams - List teams
router.get('/', authenticate, requireStaff, asyncHandler(teamController.list));

// GET /api/v1/teams/:id - Get team details
router.get('/:id', authenticate, requireStaff, asyncHandler(teamController.get));

// GET /api/v1/teams/:id/members - Get team members
router.get('/:id/members', authenticate, requireStaff, asyncHandler(teamController.getMembers));

module.exports = router;
