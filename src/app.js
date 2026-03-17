/**
 * Nodeticket - Node.js Help Desk System
 *
 * Main application entry point.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');

const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./lib/db');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { generateCsrfToken, csrfProtection } = require('./middleware/csrf');

// Import routes
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const userRoutes = require('./routes/users');
const staffRoutes = require('./routes/staff');
const departmentRoutes = require('./routes/departments');
const teamRoutes = require('./routes/teams');
const organizationRoutes = require('./routes/organizations');
const topicRoutes = require('./routes/topics');
const slaRoutes = require('./routes/sla');
const faqRoutes = require('./routes/faq');
const taskRoutes = require('./routes/tasks');
const systemRoutes = require('./routes/system');
const roleRoutes = require('./routes/roles');

// Import HTML routes
const htmlRoutes = require('./routes/html');
const adminRoutes = require('./routes/admin');

const app = express();

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
    }
  }
}));
app.use(cors());
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware
app.use(session({
  secret: config.session.secret,
  name: config.session.name,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.env === 'production',
    httpOnly: true,
    maxAge: config.session.maxAge
  }
}));

// Cookie parser (needed for CSRF double-submit cookie)
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API rate limiting
const apiLimiter = rateLimit({
  windowMs: config.api.rateLimit.windowMs,
  max: config.api.rateLimit.max,
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// API routes
app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/organizations', organizationRoutes);
app.use('/api/v1/topics', topicRoutes);
app.use('/api/v1/sla', slaRoutes);
app.use('/api/v1/faq', faqRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/roles', roleRoutes);
app.use('/api/v1', systemRoutes);

// Legacy interoperability endpoints
app.use('/api', ticketRoutes);

// CSRF token generator (available to all HTML routes including admin)
app.use((req, res, next) => {
  req.csrfToken = () => generateCsrfToken(req, res);
  next();
});

// HTML routes (CSRF protection applied to both admin and public)
app.use('/admin', csrfProtection, adminRoutes);
app.use('/', csrfProtection, htmlRoutes);

// MCP service
if (config.mcp.enabled) {
  app.use('/.well-known', require('./mcp/oauth/metadata'));
  app.use('/mcp', require('./mcp'));
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize database and start server
const start = async () => {
  try {
    // Initialize database connection
    await db.initialize();

    // Start server
    const server = app.listen(config.port, config.host, () => {
      console.log(`Nodeticket server running on http://${config.host}:${config.port}`);
      console.log(`Environment: ${config.env}`);
      console.log(`Database: ${config.db.dialect} @ ${config.db.host}:${config.db.port}/${config.db.name}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n${signal} received, shutting down...`);
      server.close(async () => {
        await db.close();
        console.log('Server closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error('Forced shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();

module.exports = app;
