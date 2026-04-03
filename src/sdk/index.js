/**
 * Nodeticket SDK
 *
 * Programmatic access to osTicket databases from any Node.js application.
 * Provides two tiers: a thin data-access layer (`nt.data.*`) and a
 * business-logic service layer (`nt.*`).
 *
 * @module nodeticket
 *
 * @example
 * const nodeticket = require('nodeticket');
 *
 * const nt = await nodeticket.init({
 *   dialect: 'mysql',
 *   host: 'localhost',
 *   port: 3306,
 *   database: 'osticket',
 *   user: 'root',
 *   password: 'secret',
 *   prefix: 'ost_',
 *   pool: { min: 2, max: 10 },
 * });
 *
 * // Thin data access
 * const tickets = await nt.data.tickets.find({ where: { status_id: 1 }, limit: 20 });
 *
 * // Business logic
 * const newTicket = await nt.tickets.create({ userId: 5, topicId: 2, subject: 'Help', body: 'Details...' });
 *
 * await nt.close();
 */

const { createConnection } = require('./connection');

// Data layer factories
const createTicketsData = require('./data/tickets');
const createThreadsData = require('./data/threads');
const createUsersData = require('./data/users');
const createStaffData = require('./data/staff');
const createDepartmentsData = require('./data/departments');
const createTeamsData = require('./data/teams');
const createOrganizationsData = require('./data/organizations');
const createRolesData = require('./data/roles');
const createTopicsData = require('./data/topics');
const createSlaData = require('./data/sla');
const createFaqData = require('./data/faq');
const createTasksData = require('./data/tasks');
const createConfigData = require('./data/config');

// Service layer factories
const createTicketsService = require('./services/tickets');
const createUsersService = require('./services/users');
const createStaffService = require('./services/staff');
const createDepartmentsService = require('./services/departments');
const createTeamsService = require('./services/teams');
const createOrganizationsService = require('./services/organizations');
const createAuthService = require('./services/auth');
const createSystemService = require('./services/system');

// Re-export errors for consumers
const errors = require('./errors');

/**
 * Initialize the Nodeticket SDK.
 *
 * @param {Object} options - Database connection options
 * @param {string} [options.dialect='mysql'] - 'mysql' or 'postgres'
 * @param {string} [options.host='localhost'] - Database host
 * @param {number} [options.port] - Database port (auto-detected from dialect)
 * @param {string} options.database - Database name
 * @param {string} [options.user='root'] - Database user
 * @param {string} [options.password=''] - Database password
 * @param {string} [options.prefix='ost_'] - osTicket table prefix
 * @param {Object} [options.pool] - Pool size options
 * @param {number} [options.pool.min=2] - Minimum connections
 * @param {number} [options.pool.max=10] - Maximum connections
 * @returns {Promise<NodeticketInstance>} Initialized SDK instance
 *
 * @example
 * const nt = await require('nodeticket').init({
 *   database: 'osticket',
 *   user: 'root',
 *   password: 'secret',
 * });
 */
const init = async (options) => {
  const conn = await createConnection(options);

  // Build data layer
  const data = {
    tickets: createTicketsData(conn),
    threads: createThreadsData(conn),
    users: createUsersData(conn),
    staff: createStaffData(conn),
    departments: createDepartmentsData(conn),
    teams: createTeamsData(conn),
    organizations: createOrganizationsData(conn),
    roles: createRolesData(conn),
    topics: createTopicsData(conn),
    sla: createSlaData(conn),
    faq: createFaqData(conn),
    tasks: createTasksData(conn),
    config: createConfigData(conn),
  };

  // Build service layer
  const tickets = createTicketsService(conn, data);
  const users = createUsersService(conn, data);
  const staff = createStaffService(conn, data);
  const departments = createDepartmentsService(conn, data);
  const teams = createTeamsService(conn, data);
  const organizations = createOrganizationsService(conn, data);
  const auth = createAuthService(conn, data);
  const system = createSystemService(conn, data);

  return {
    /** @type {Object} Thin data-access modules */
    data,

    /** @type {Object} Ticket service (business logic) */
    tickets,
    /** @type {Object} User service */
    users,
    /** @type {Object} Staff service */
    staff,
    /** @type {Object} Department service */
    departments,
    /** @type {Object} Team service */
    teams,
    /** @type {Object} Organization service */
    organizations,
    /** @type {Object} Auth service (password hash/verify only) */
    auth,
    /** @type {Object} System service (config, stats) */
    system,

    /** @type {Object} Raw connection for advanced use */
    connection: conn,

    /**
     * Close the database connection pool.
     * @returns {Promise<void>}
     */
    close: () => conn.close(),
  };
};

module.exports = { init, errors };
