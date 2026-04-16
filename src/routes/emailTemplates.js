const express = require('express');
const router = express.Router();
const c = require('../controllers/emailTemplateController');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/groups', authenticate, requireStaff, asyncHandler(c.listGroups));
router.post('/groups', authenticate, requireAdmin, asyncHandler(c.createGroup));
router.get('/groups/:id', authenticate, requireStaff, asyncHandler(c.getGroup));
router.put('/groups/:id', authenticate, requireAdmin, asyncHandler(c.updateGroup));
router.delete('/groups/:id', authenticate, requireAdmin, asyncHandler(c.removeGroup));

router.get('/', authenticate, requireStaff, asyncHandler(c.list));
router.get('/:id', authenticate, requireStaff, asyncHandler(c.get));
router.put('/:id', authenticate, requireAdmin, asyncHandler(c.update));

module.exports = router;
