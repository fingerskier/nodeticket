const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', authenticate, requireAdmin, asyncHandler(settingsController.list));
router.put('/', authenticate, requireAdmin, asyncHandler(settingsController.update));

module.exports = router;
