/**
 * FAQ Routes
 */

const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');
const { optionalAuth, requireStaff } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/faq - List FAQ articles
router.get('/', optionalAuth, asyncHandler(faqController.list));

// GET /api/v1/faq/categories - List FAQ categories
router.get('/categories', optionalAuth, asyncHandler(faqController.listCategories));

// POST /api/v1/faq - Create FAQ (staff)
router.post('/', requireStaff, asyncHandler(faqController.create));

// GET /api/v1/faq/:id - Get FAQ article
router.get('/:id', optionalAuth, asyncHandler(faqController.get));

// PUT /api/v1/faq/:id - Update FAQ (staff)
router.put('/:id', requireStaff, asyncHandler(faqController.update));

// DELETE /api/v1/faq/:id - Delete FAQ (staff)
router.delete('/:id', requireStaff, asyncHandler(faqController.remove));

module.exports = router;
