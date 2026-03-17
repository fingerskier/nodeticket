/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Self-service routes (MUST be before /:id routes)
// PUT /api/v1/users/me/profile - Update own profile
router.put('/me/profile', authenticate, asyncHandler(userController.updateProfile));

// PUT /api/v1/users/me/password - Change own password
router.put('/me/password', authenticate, asyncHandler(userController.changePassword));

// GET /api/v1/users - List users
router.get('/', authenticate, requireStaff, asyncHandler(userController.list));

// POST /api/v1/users - Create user
router.post('/', authenticate, requireAdmin, asyncHandler(userController.create));

// GET /api/v1/users/:id - Get user details
router.get('/:id', authenticate, asyncHandler(userController.get));

// PUT /api/v1/users/:id - Update user
router.put('/:id', authenticate, requireAdmin, asyncHandler(userController.update));

// DELETE /api/v1/users/:id - Delete user
router.delete('/:id', authenticate, requireAdmin, asyncHandler(userController.remove));

// GET /api/v1/users/:id/tickets - Get user's tickets
router.get('/:id/tickets', authenticate, asyncHandler(userController.getTickets));

// GET /api/v1/users/:id/organizations - Get user's organizations
router.get('/:id/organizations', authenticate, asyncHandler(userController.getOrganizations));

module.exports = router;
