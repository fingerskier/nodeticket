/**
 * Ticket Routes
 */

const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { authenticate, canAccessTicket, requireStaff, requireVerified } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/v1/tickets - List tickets
router.get('/', authenticate, asyncHandler(ticketController.list));

// GET /api/v1/tickets/:id - Get ticket details
router.get('/:id', authenticate, canAccessTicket, asyncHandler(ticketController.get));

// GET /api/v1/tickets/:id/thread - Get ticket thread entries
router.get('/:id/thread', authenticate, canAccessTicket, asyncHandler(ticketController.getThread));

// GET /api/v1/tickets/:id/events - Get ticket event history
router.get('/:id/events', authenticate, canAccessTicket, asyncHandler(ticketController.getEvents));

// POST /api/v1/tickets - Create ticket
router.post('/', authenticate, requireVerified, asyncHandler(ticketController.create));

// PUT /api/v1/tickets/:id - Update ticket
router.put('/:id', authenticate, canAccessTicket, asyncHandler(ticketController.update));

// POST /api/v1/tickets/:id/reply - Post reply
router.post('/:id/reply', authenticate, canAccessTicket, asyncHandler(ticketController.reply));

// POST /api/v1/tickets/:id/note - Add internal note (staff only)
router.post('/:id/note', requireStaff, canAccessTicket, asyncHandler(ticketController.addNote));

// POST /api/v1/tickets/:id/merge - Merge tickets (staff only)
router.post('/:id/merge', requireStaff, asyncHandler(ticketController.merge));

// Legacy interoperability endpoints
router.post('/tickets.json', asyncHandler(ticketController.createLegacy));

module.exports = router;
