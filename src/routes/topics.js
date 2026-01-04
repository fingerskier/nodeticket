/**
 * Help Topic Routes
 */

const express = require('express');
const router = express.Router();
const topicController = require('../controllers/topicController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/topics - List help topics
router.get('/', optionalAuth, asyncHandler(topicController.list));

// GET /api/v1/topics/:id - Get topic details
router.get('/:id', optionalAuth, asyncHandler(topicController.get));

module.exports = router;
