/**
 * SLA Routes
 */

const express = require('express');
const router = express.Router();
const slaController = require('../controllers/slaController');
const { authenticate, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/sla - List SLA plans
router.get('/', authenticate, requireStaff, asyncHandler(slaController.list));

// GET /api/v1/sla/:id - Get SLA details
router.get('/:id', authenticate, requireStaff, asyncHandler(slaController.get));

module.exports = router;
