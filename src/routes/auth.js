/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/v1/auth/login - Authenticate user or staff
router.post('/login', asyncHandler(authController.login));

// POST /api/v1/auth/logout - End session
router.post('/logout', authenticate, asyncHandler(authController.logout));

// GET /api/v1/auth/me - Get current user info
router.get('/me', authenticate, asyncHandler(authController.me));

// POST /api/v1/auth/refresh - Refresh token
router.post('/refresh', asyncHandler(authController.refresh));

// POST /api/v1/auth/forgot-password - Request password reset
router.post('/forgot-password', asyncHandler(authController.forgotPassword));

// POST /api/v1/auth/reset-password - Reset password with token
router.post('/reset-password', asyncHandler(authController.resetPassword));

module.exports = router;
