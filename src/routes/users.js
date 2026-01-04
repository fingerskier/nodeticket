/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/users - List users
router.get('/', authenticate, requireStaff, asyncHandler(userController.list));

// GET /api/v1/users/:id - Get user details
router.get('/:id', authenticate, asyncHandler(userController.get));

// GET /api/v1/users/:id/tickets - Get user's tickets
router.get('/:id/tickets', authenticate, asyncHandler(userController.getTickets));

// GET /api/v1/users/:id/organizations - Get user's organizations
router.get('/:id/organizations', authenticate, asyncHandler(userController.getOrganizations));

module.exports = router;
