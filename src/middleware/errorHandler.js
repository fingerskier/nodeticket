/**
 * Error Handling Middleware
 *
 * Centralized error handling for the application.
 */

const config = require('../config');

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
    <html>
    <head>
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
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  // Log error in development
  if (config.env === 'development') {
    console.error('Error:', err);
  } else {
    // In production, only log server errors
    if (!err.isOperational) {
      console.error('Unhandled error:', err);
    }
  }

  // Determine status code
  const status = err.status || 500;

  // For API routes, return JSON
  if (req.path.startsWith('/api/')) {
    const response = {
      success: false,
      message: err.message || 'An error occurred'
    };

    // Include errors object for validation errors
    if (err.errors) {
      response.errors = err.errors;
    }

    // Include stack trace in development
    if (config.env === 'development' && !err.isOperational) {
      response.stack = err.stack;
    }

    return res.status(status).json(response);
  }

  // For HTML routes, render error page
  const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head>
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
      <p>${err.message || 'An error occurred'}</p>
      ${config.env === 'development' ? `<pre>${err.stack}</pre>` : ''}
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
  asyncHandler
};
