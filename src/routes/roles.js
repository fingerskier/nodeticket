/**
 * Role Routes
 */

const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/roles - List roles
router.get('/', authenticate, requireStaff, asyncHandler(roleController.list));

// GET /api/v1/roles/:id - Get role details
router.get('/:id', authenticate, requireStaff, asyncHandler(roleController.get));

// POST /api/v1/roles - Create role
router.post('/', authenticate, requireAdmin, asyncHandler(roleController.create));

// PUT /api/v1/roles/:id - Update role
router.put('/:id', authenticate, requireAdmin, asyncHandler(roleController.update));

// DELETE /api/v1/roles/:id - Delete role
router.delete('/:id', authenticate, requireAdmin, asyncHandler(roleController.remove));

module.exports = router;
