/**
 * Nodeticket SDK Error Classes
 *
 * SDK-specific errors that are independent of HTTP. Consumers (Express, MCP, etc.)
 * map these to their own error responses.
 * @module sdk/errors
 */

/**
 * Base error for all Nodeticket SDK errors.
 * @extends Error
 */
class NodeticketError extends Error {
  /**
   * @param {string} message - Error description
   * @param {string} code - Machine-readable error code
   */
  constructor(message, code = 'NODETICKET_ERROR') {
    super(message);
    this.name = 'NodeticketError';
    this.code = code;
  }
}

/**
 * Thrown when input data fails validation.
 * @extends NodeticketError
 *
 * @example
 * throw new ValidationError('Subject is required');
 * throw new ValidationError('Invalid input', { subject: 'required', body: 'too short' });
 */
class ValidationError extends NodeticketError {
  /**
   * @param {string} message - Validation failure description
   * @param {Object|null} [errors=null] - Field-level error details
   */
  constructor(message, errors = null) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Thrown when a requested record does not exist.
 * @extends NodeticketError
 *
 * @example
 * throw new NotFoundError('Ticket not found');
 */
class NotFoundError extends NodeticketError {
  /**
   * @param {string} [message='Resource not found']
   */
  constructor(message = 'Resource not found') {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown on uniqueness violations or constraint conflicts.
 * @extends NodeticketError
 *
 * @example
 * throw new ConflictError('A user with this email already exists');
 */
class ConflictError extends NodeticketError {
  /**
   * @param {string} [message='Resource conflict']
   */
  constructor(message = 'Resource conflict') {
    super(message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/**
 * Thrown when the database connection fails.
 * @extends NodeticketError
 *
 * @example
 * throw new ConnectionError('Failed to connect to MySQL');
 */
class ConnectionError extends NodeticketError {
  /**
   * @param {string} [message='Database connection error']
   */
  constructor(message = 'Database connection error') {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

module.exports = {
  NodeticketError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ConnectionError,
};
