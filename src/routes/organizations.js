/**
 * Organization Routes
 */

const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organizationController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/organizations - List organizations
router.get('/', authenticate, requireStaff, asyncHandler(organizationController.list));

// GET /api/v1/organizations/:id - Get organization details
router.get('/:id', authenticate, asyncHandler(organizationController.get));

// GET /api/v1/organizations/:id/users - Get organization users
router.get('/:id/users', authenticate, asyncHandler(organizationController.getUsers));

// GET /api/v1/organizations/:id/tickets - Get organization tickets
router.get('/:id/tickets', authenticate, requireStaff, asyncHandler(organizationController.getTickets));

module.exports = router;
