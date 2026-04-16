/**
 * SLA Routes
 */

const express = require('express');
const router = express.Router();
const slaController = require('../controllers/slaController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', authenticate, requireStaff, asyncHandler(slaController.list));
router.get('/:id', authenticate, requireStaff, asyncHandler(slaController.get));
router.post('/', authenticate, requireAdmin, asyncHandler(slaController.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(slaController.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(slaController.remove));

module.exports = router;
