/**
 * Help Topic Routes
 */

const express = require('express');
const router = express.Router();
const topicController = require('../controllers/topicController');
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', optionalAuth, asyncHandler(topicController.list));
router.get('/:id', optionalAuth, asyncHandler(topicController.get));
router.post('/', authenticate, requireAdmin, asyncHandler(topicController.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(topicController.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(topicController.remove));

module.exports = router;
