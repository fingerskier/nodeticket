const express = require('express');
const router = express.Router();
const c = require('../controllers/filterController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.put('/reorder', authenticate, requireAdmin, asyncHandler(c.reorder));

router.get('/', authenticate, requireAdmin, asyncHandler(c.list));
router.get('/:id', authenticate, requireAdmin, asyncHandler(c.get));
router.post('/', authenticate, requireAdmin, asyncHandler(c.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(c.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(c.remove));

module.exports = router;
