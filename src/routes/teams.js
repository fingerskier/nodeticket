/**
 * Team Routes
 */

const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/teams - List teams
router.get('/', authenticate, requireStaff, asyncHandler(teamController.list));

// GET /api/v1/teams/:id - Get team details
router.get('/:id', authenticate, requireStaff, asyncHandler(teamController.get));

// GET /api/v1/teams/:id/members - Get team members
router.get('/:id/members', authenticate, requireStaff, asyncHandler(teamController.getMembers));

// POST /api/v1/teams - Create team
router.post('/', authenticate, requireAdmin, asyncHandler(teamController.create));

// PUT /api/v1/teams/:id - Update team
router.put('/:id', authenticate, requireAdmin, asyncHandler(teamController.update));

// DELETE /api/v1/teams/:id - Delete team
router.delete('/:id', authenticate, requireAdmin, asyncHandler(teamController.remove));

// POST /api/v1/teams/:id/members - Add member to team
router.post('/:id/members', authenticate, requireAdmin, asyncHandler(teamController.addMember));

// DELETE /api/v1/teams/:id/members/:staffId - Remove member from team
router.delete('/:id/members/:staffId', authenticate, requireAdmin, asyncHandler(teamController.removeMember));

module.exports = router;
