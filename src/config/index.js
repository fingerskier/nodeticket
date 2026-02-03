/**
 * Nodeticket Configuration
 *
 * Loads configuration from environment variables and provides defaults.
 */

require('dotenv').config();

const config = {
  // Server configuration
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',

  // Database configuration
  db: {
    dialect: process.env.DB_DIALECT || 'mysql', // 'mysql' or 'postgres'
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || (process.env.DB_DIALECT === 'postgres' ? 5432 : 3306),
    name: process.env.DB_NAME || 'original',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    prefix: process.env.TABLE_PREFIX || 'ost_',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10
    }
  },

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || 'nodeticket-secret-change-me',
    name: 'nodeticket.sid',
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000 // 24 hours
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'jwt-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },

  // API configuration
  api: {
    version: 'v1',
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.API_RATE_LIMIT, 10) || 100 // requests per window
    }
  },

  // Helpdesk configuration (can be overridden by database config)
  helpdesk: {
    title: process.env.HELPDESK_TITLE || 'Nodeticket Help Desk',
    url: process.env.HELPDESK_URL || 'http://localhost:3000'
  }
};

// Validate required configuration
const validateConfig = () => {
  const errors = [];

  if (config.env === 'production') {
    if (config.session.secret === 'nodeticket-secret-change-me') {
      errors.push('SESSION_SECRET must be set in production');
    }
    if (config.jwt.secret === 'jwt-secret-change-me') {
      errors.push('JWT_SECRET must be set in production');
    }
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
};

validateConfig();

module.exports = config;
