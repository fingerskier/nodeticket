/**
 * FAQ Routes
 */

const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/faq - List FAQ articles
router.get('/', optionalAuth, asyncHandler(faqController.list));

// GET /api/v1/faq/categories - List FAQ categories
router.get('/categories', optionalAuth, asyncHandler(faqController.listCategories));

// GET /api/v1/faq/:id - Get FAQ article
router.get('/:id', optionalAuth, asyncHandler(faqController.get));

module.exports = router;
