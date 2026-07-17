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
const settingsRoutes = require('./routes/settings');
const emailTemplateRoutes = require('./routes/emailTemplates');
const cannedResponseRoutes = require('./routes/cannedResponses');
const filterRoutes = require('./routes/filters');

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
      // Self-hosted ygdrassil under /vendor; CDN kept as optional fallback
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
// Default: MemoryStore (single process). For multi-instance production, set
// SESSION_STORE=redis and REDIS_URL (see docs/PRODUCTION.md).
const sessionOptions = {
  secret: config.session.secret,
  name: config.session.name,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.session.maxAge
  }
};

if (process.env.SESSION_STORE === 'redis' && process.env.REDIS_URL) {
  try {
    // Optional dependency — only required when SESSION_STORE=redis
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const RedisStore = require('connect-redis').default
      || require('connect-redis');
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.connect().catch((err) => {
      console.error('Redis session store connect failed:', err.message);
    });
    const StoreCtor = RedisStore.default || RedisStore;
    sessionOptions.store = new StoreCtor({
      client: redisClient,
      prefix: 'nt:sess:',
    });
    console.log('Session store: redis');
  } catch (err) {
    console.warn(
      'SESSION_STORE=redis requested but connect-redis/redis not installed; using MemoryStore.',
      err.message
    );
  }
}

app.use(session(sessionOptions));

// Cookie parser (needed for CSRF double-submit cookie)
app.use(cookieParser());

// CSRF token generator (HTML + session-authenticated API)
app.use((req, res, next) => {
  req.csrfToken = () => generateCsrfToken(req, res);
  next();
});

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

/**
 * CSRF for mutating session-authenticated API calls.
 * Exempt: safe methods, Bearer JWT, X-API-Key, and requests with no session cookie
 * (pure token clients / first login). Browser SPA sessions must send x-csrf-token.
 */
const apiSessionCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return next();
  }
  if (req.headers['x-api-key']) {
    return next();
  }
  const sid = config.session.name;
  if (!req.cookies?.[sid] && !req.session?.user) {
    return next();
  }
  return csrfProtection(req, res, next);
};

// API routes (rate limited + session CSRF)
app.use('/api/v1', apiLimiter, apiSessionCsrf);
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
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/email-templates', emailTemplateRoutes);
app.use('/api/v1/canned-responses', cannedResponseRoutes);
app.use('/api/v1/filters', filterRoutes);
app.use('/api/v1', systemRoutes);

// Legacy interoperability — official osTicket FOSS HTTP API
const { asyncHandler } = require('./middleware/errorHandler');
const { requireApiKeyCapability } = require('./middleware/auth');
const ticketController = require('./controllers/ticketController');

// Raw text bodies for XML / MIME (global json parser only handles application/json)
const rawText10mb = express.text({ type: () => true, limit: '10mb' });

app.post(
  '/api/tickets.json',
  apiLimiter,
  requireApiKeyCapability('can_create_tickets', { plainText: true }),
  asyncHandler(ticketController.createLegacy)
);
app.post(
  '/api/tickets.xml',
  apiLimiter,
  rawText10mb,
  requireApiKeyCapability('can_create_tickets', { plainText: true }),
  asyncHandler(ticketController.createLegacyXml)
);
app.post(
  '/api/tickets.email',
  apiLimiter,
  rawText10mb,
  requireApiKeyCapability('can_create_tickets', { plainText: true }),
  asyncHandler(ticketController.createLegacyEmail)
);
app.post(
  '/api/tasks/cron',
  apiLimiter,
  requireApiKeyCapability('can_exec_cron', { plainText: true }),
  asyncHandler(ticketController.runLegacyCron)
);

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

/**
 * Initialize DB (+ optional template seed) without listening.
 * Used by production start and by integration tests.
 */
const initializeApp = async ({ seed = true } = {}) => {
  await db.initialize();
  if (seed) {
    try {
      const { seed: seedTemplates } = require('./lib/seedEmailTemplates');
      await seedTemplates();
    } catch (e) {
      console.warn('Seed step failed:', e.message);
    }
  }
  return app;
};

// Initialize database and start server
const start = async (options = {}) => {
  try {
    await initializeApp(options);

    const port = options.port != null ? options.port : config.port;
    const host = options.host != null ? options.host : config.host;

    const server = await new Promise((resolve, reject) => {
      const s = app.listen(port, host, () => resolve(s));
      s.on('error', reject);
    });

    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    if (!options.quiet) {
      console.log(`Nodeticket server running on http://${host}:${boundPort}`);
      console.log(`Environment: ${config.env}`);
      console.log(`Database: ${config.db.dialect} @ ${config.db.host}:${config.db.port}/${config.db.name}`);
    }

    // Graceful shutdown (only when run as main process)
    if (require.main === module) {
      const shutdown = async (signal) => {
        console.log(`\n${signal} received, shutting down...`);
        server.close(async () => {
          await db.close();
          console.log('Server closed');
          process.exit(0);
        });

        setTimeout(() => {
          console.error('Forced shutdown');
          process.exit(1);
        }, 10000);
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    }

    return { app, server, port: boundPort };
  } catch (err) {
    console.error('Failed to start server:', err);
    if (require.main === module) process.exit(1);
    throw err;
  }
};

module.exports = { app, start, initializeApp };

// Only auto-listen when executed directly (not when required by tests)
if (require.main === module) {
  start();
}
