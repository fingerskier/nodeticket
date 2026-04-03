/**
 * Lazy SDK service accessor for the Express application.
 * Uses the connection from lib/db.js (backward-compat wrapper).
 */
const db = require('./db');

// Data layer factories
const createTicketsData = require('../sdk/data/tickets');
const createThreadsData = require('../sdk/data/threads');
const createUsersData = require('../sdk/data/users');
const createStaffData = require('../sdk/data/staff');
const createDepartmentsData = require('../sdk/data/departments');
const createTeamsData = require('../sdk/data/teams');
const createOrganizationsData = require('../sdk/data/organizations');
const createRolesData = require('../sdk/data/roles');
const createTopicsData = require('../sdk/data/topics');
const createSlaData = require('../sdk/data/sla');
const createFaqData = require('../sdk/data/faq');
const createTasksData = require('../sdk/data/tasks');
const createConfigData = require('../sdk/data/config');

// Service layer factories
const createTicketsService = require('../sdk/services/tickets');
const createUsersService = require('../sdk/services/users');
const createStaffService = require('../sdk/services/staff');
const createDepartmentsService = require('../sdk/services/departments');
const createTeamsService = require('../sdk/services/teams');
const createOrganizationsService = require('../sdk/services/organizations');
const createAuthService = require('../sdk/services/auth');
const createSystemService = require('../sdk/services/system');

let _instance = null;

/**
 * Get the lazily-initialized SDK services.
 * Requires db.initialize() to have been called first.
 */
const getSdk = () => {
  if (_instance) return _instance;

  const conn = db.getConnection();
  if (!conn) {
    throw new Error('Database not initialized. Call db.initialize() first.');
  }

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

  _instance = {
    data,
    tickets: createTicketsService(conn, data),
    users: createUsersService(conn, data),
    staff: createStaffService(conn, data),
    departments: createDepartmentsService(conn, data),
    teams: createTeamsService(conn, data),
    organizations: createOrganizationsService(conn, data),
    auth: createAuthService(conn, data),
    system: createSystemService(conn, data),
    connection: conn,
  };

  return _instance;
};

module.exports = { getSdk };
