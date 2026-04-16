const express = require('express');
const router = express.Router();
const c = require('../controllers/cannedResponseController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', authenticate, requireStaff, asyncHandler(c.list));
router.get('/:id', authenticate, requireStaff, asyncHandler(c.get));
router.post('/', authenticate, requireAdmin, asyncHandler(c.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(c.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(c.remove));

module.exports = router;
