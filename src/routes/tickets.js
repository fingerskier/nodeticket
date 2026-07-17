/**
 * Ticket Routes
 */

const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const {
  authenticate,
  canAccessTicket,
  requireStaff,
  requireVerified,
  requireAdmin,
  requirePermission,
} = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/v1/tickets/bulk - Bulk ticket operations (admin)
// Must be before /:id routes to avoid param conflict
router.post('/bulk', authenticate, requireAdmin, asyncHandler(ticketController.bulkAction));

// GET /api/v1/tickets - List tickets
router.get('/', authenticate, asyncHandler(ticketController.list));

// GET /api/v1/tickets/:id - Get ticket details
router.get('/:id', authenticate, canAccessTicket, asyncHandler(ticketController.get));

// GET /api/v1/tickets/:id/thread - Get ticket thread entries
router.get('/:id/thread', authenticate, canAccessTicket, asyncHandler(ticketController.getThread));

// GET /api/v1/tickets/:id/events - Get ticket event history (staff only)
router.get(
  '/:id/events',
  authenticate,
  requireStaff,
  canAccessTicket,
  asyncHandler(ticketController.getEvents)
);

// POST /api/v1/tickets - Create ticket
router.post('/', authenticate, requireVerified, asyncHandler(ticketController.create));

// PUT /api/v1/tickets/:id - Update ticket
router.put(
  '/:id',
  authenticate,
  canAccessTicket,
  asyncHandler(ticketController.update)
);

// POST /api/v1/tickets/:id/reply - Post reply
router.post(
  '/:id/reply',
  authenticate,
  canAccessTicket,
  asyncHandler(ticketController.reply)
);

// POST /api/v1/tickets/:id/note - Add internal note (staff + permission)
router.post(
  '/:id/note',
  requireStaff,
  requirePermission('ticket.note'),
  canAccessTicket,
  asyncHandler(ticketController.addNote)
);

// POST /api/v1/tickets/:id/merge - Merge tickets (staff + permission)
router.post(
  '/:id/merge',
  requireStaff,
  requirePermission('ticket.merge'),
  canAccessTicket,
  asyncHandler(ticketController.merge)
);

module.exports = router;
