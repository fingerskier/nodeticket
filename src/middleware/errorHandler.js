/**
 * Error Handling Middleware
 *
 * Centralized error handling for the application.
 * Production: never leak stack traces or raw internal messages for non-operational errors.
 */

const config = require('../config');
const { ValidationError, NotFoundError, ConflictError, NodeticketError } = require('../sdk/errors');

/**
 * Escape text for safe HTML error pages.
 * @param {string} str
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(status, message, errors = null) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.isOperational = true;
  }

  static badRequest(message, errors = null) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Access denied') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Resource conflict') {
    return new ApiError(409, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }
}

/**
 * Not found handler - catch 404 errors
 */
const notFoundHandler = (req, res, next) => {
  // For API routes, return JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: 'Endpoint not found'
    });
  }

  // For HTML routes, render 404 page
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Page Not Found</title>
      <style>
        body { font-family: -apple-system, sans-serif; margin: 40px; }
        h1 { color: #333; }
        p { color: #666; }
        a { color: #007bff; }
      </style>
    </head>
    <body>
      <h1>404 - Page Not Found</h1>
      <p>The page you are looking for does not exist.</p>
      <a href="/">Return to Home</a>
    </body>
    </html>
  `);
};

/**
 * Safe client-facing message (no internal leak in production).
 */
function publicErrorMessage(err, status) {
  if (err.isOperational && err.message) {
    return err.message;
  }
  if (config.env === 'development' && err.message) {
    return err.message;
  }
  if (status === 404) return 'Resource not found';
  if (status === 401) return 'Authentication required';
  if (status === 403) return 'Access denied';
  if (status === 400) return 'Bad request';
  return 'An unexpected error occurred';
}

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  // Map SDK errors to ApiError before processing
  if (err instanceof ValidationError) {
    err = new ApiError(400, err.message, err.errors);
  } else if (err instanceof NotFoundError) {
    err = new ApiError(404, err.message);
  } else if (err instanceof ConflictError) {
    err = new ApiError(409, err.message);
  } else if (err instanceof NodeticketError) {
    err = new ApiError(500, err.message);
  }

  // Always log server-side (message + stack for unexpected)
  if (config.env === 'development') {
    console.error('Error:', err);
  } else if (!err.isOperational || (err.status || 500) >= 500) {
    console.error('Server error:', {
      message: err.message,
      status: err.status,
      path: req.path,
      stack: err.stack,
    });
  }

  const status = err.status || 500;
  const message = publicErrorMessage(err, status);

  // For API routes, return JSON
  if (req.path.startsWith('/api/')) {
    const response = {
      success: false,
      message,
    };

    if (err.errors) {
      response.errors = err.errors;
    }

    // Stack only in development for non-operational errors
    if (config.env === 'development' && !err.isOperational) {
      response.stack = err.stack;
    }

    return res.status(status).json(response);
  }

  // For HTML routes, render escaped error page (no raw HTML injection)
  const safeMessage = escapeHtml(message);
  const stackBlock = (config.env === 'development' && err.stack)
    ? `<pre>${escapeHtml(err.stack)}</pre>`
    : '';

  const errorHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error - ${status}</title>
      <style>
        body { font-family: -apple-system, sans-serif; margin: 40px; }
        h1 { color: #333; }
        p { color: #666; }
        pre { background: #f4f4f4; padding: 20px; overflow: auto; }
        a { color: #007bff; }
      </style>
    </head>
    <body>
      <h1>Error ${status}</h1>
      <p>${safeMessage}</p>
      ${stackBlock}
      <a href="/">Return to Home</a>
    </body>
    </html>
  `;

  res.status(status).send(errorHtml);
};

/**
 * Async handler wrapper - catches async errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler,
  escapeHtml,
};
