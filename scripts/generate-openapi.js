/**
 * Generate docs/openapi.json from the live native + official API surface.
 *
 * Usage: node scripts/generate-openapi.js
 *        npm run openapi:generate
 *
 * This is a hand-maintained route catalog (not a runtime scanner) kept next
 * to mount points in src/app.js and src/routes/*.js. Re-run after API changes.
 */

const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

const sessionOrBearer = [{ bearerAuth: [] }, { cookieAuth: [] }];
const apiKey = [{ apiKey: [] }];
const optionalAuth = [{ bearerAuth: [] }, { cookieAuth: [] }, {}];

function jsonBody(schemaRef, required = true) {
  return {
    required,
    content: {
      'application/json': {
        schema: typeof schemaRef === 'string' ? { $ref: schemaRef } : schemaRef,
      },
    },
  };
}

function jsonOk(schemaRef, description = 'OK') {
  return {
    description,
    content: {
      'application/json': {
        schema: typeof schemaRef === 'string' ? { $ref: schemaRef } : schemaRef,
      },
    },
  };
}

function successData(dataSchema) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string' },
      data: dataSchema,
      pagination: { $ref: '#/components/schemas/Pagination' },
      notification: { $ref: '#/components/schemas/NotificationResult' },
      lock: { $ref: '#/components/schemas/LockTouchResult' },
    },
  };
}

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
  description: 'Resource id (numeric) or ticket number where supported',
};

const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
];

// Paths relative to server /api/v1
const nativePaths = {
  '/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Authenticate user or staff',
      operationId: 'authLogin',
      security: [],
      requestBody: jsonBody('#/components/schemas/LoginRequest'),
      responses: {
        '200': jsonOk('#/components/schemas/AuthResponse', 'JWT + principal; session regenerated'),
        '401': { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Authentication'],
      summary: 'End session / clear client token context',
      operationId: 'authLogout',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Authentication'],
      summary: 'Current principal',
      operationId: 'authMe',
      security: sessionOrBearer,
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/Principal' })) },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Authentication'],
      summary: 'Refresh access token',
      operationId: 'authRefresh',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/AuthResponse') },
    },
  },
  '/auth/register': {
    post: {
      tags: ['Authentication'],
      summary: 'Register customer account',
      operationId: 'authRegister',
      security: [],
      requestBody: jsonBody('#/components/schemas/RegisterRequest'),
      responses: {
        '201': jsonOk('#/components/schemas/SuccessResponse', 'Registered; verify email'),
        '400': { $ref: '#/components/responses/BadRequest' },
      },
    },
  },
  '/auth/forgot-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Request password reset',
      operationId: 'authForgotPassword',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/auth/reset-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Reset password with purpose token',
      operationId: 'authResetPassword',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string' },
          password: { type: 'string', minLength: 8 },
        },
      }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/auth/verify-email': {
    get: {
      tags: ['Authentication'],
      summary: 'Verify email with token query param',
      operationId: 'authVerifyEmail',
      security: [],
      parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/auth/resend-verification': {
    post: {
      tags: ['Authentication'],
      summary: 'Resend verification email',
      operationId: 'authResendVerification',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/tickets': {
    get: {
      tags: ['Tickets'],
      summary: 'List tickets',
      description: 'Users see only own tickets. Staff scoped by dept/assignment visibility.',
      operationId: 'listTickets',
      security: sessionOrBearer,
      parameters: [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string', description: 'Status state e.g. open, closed' } },
        { name: 'dept_id', in: 'query', schema: { type: 'integer' } },
        { name: 'staff_id', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Number or subject' },
        { name: 'sort', in: 'query', schema: { type: 'string' } },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc', 'ASC', 'DESC'] } },
      ],
      responses: { '200': jsonOk('#/components/schemas/TicketList') },
    },
    post: {
      tags: ['Tickets'],
      summary: 'Create ticket',
      description: 'User: self-service (verified). Staff: body.user_id required (on behalf).',
      operationId: 'createTicket',
      security: sessionOrBearer,
      requestBody: jsonBody('#/components/schemas/TicketCreate'),
      responses: {
        '201': jsonOk(successData({ $ref: '#/components/schemas/Ticket' }), 'Created'),
      },
    },
  },
  '/tickets/bulk': {
    post: {
      tags: ['Tickets'],
      summary: 'Bulk ticket actions (admin)',
      operationId: 'bulkTickets',
      security: sessionOrBearer,
      requestBody: jsonBody('#/components/schemas/TicketBulkRequest'),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/tickets/{id}': {
    get: {
      tags: ['Tickets'],
      summary: 'Get ticket',
      operationId: 'getTicket',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/TicketDetail' })) },
    },
    put: {
      tags: ['Tickets'],
      summary: 'Update ticket / named close|reopen',
      description: 'Users must use action close|reopen. Staff may update fields or named actions. Soft-touch lock on staff write.',
      operationId: 'updateTicket',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody('#/components/schemas/TicketUpdate'),
      responses: { '200': jsonOk(successData({ type: 'object' })) },
    },
  },
  '/tickets/{id}/thread': {
    get: {
      tags: ['Tickets'],
      summary: 'Ticket thread entries',
      description: 'Customers only see message/response types (no internal notes).',
      operationId: 'getTicketThread',
      security: sessionOrBearer,
      parameters: [...pageParams, idParam],
      responses: { '200': jsonOk('#/components/schemas/ThreadEntryList') },
    },
  },
  '/tickets/{id}/events': {
    get: {
      tags: ['Tickets'],
      summary: 'Ticket event log (staff)',
      operationId: 'getTicketEvents',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/ThreadEventList') },
    },
  },
  '/tickets/{id}/reply': {
    post: {
      tags: ['Tickets'],
      summary: 'Post public reply',
      operationId: 'replyTicket',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody('#/components/schemas/TicketReply'),
      responses: {
        '201': jsonOk(successData({ $ref: '#/components/schemas/ThreadEntry' }), 'Reply added'),
      },
    },
  },
  '/tickets/{id}/note': {
    post: {
      tags: ['Tickets'],
      summary: 'Add internal note (staff)',
      operationId: 'noteTicket',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody('#/components/schemas/TicketNote'),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/ThreadEntry' })) },
    },
  },
  '/tickets/{id}/merge': {
    post: {
      tags: ['Tickets'],
      summary: 'Merge ticket into target (staff)',
      operationId: 'mergeTicket',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['target_ticket_id'],
        properties: { target_ticket_id: { type: 'integer' } },
      }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/tickets/{id}/attachments': {
    get: {
      tags: ['Tickets'],
      summary: 'List attachments',
      operationId: 'listTicketAttachments',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/Attachment' } })) },
    },
    post: {
      tags: ['Tickets'],
      summary: 'Upload attachments (JSON data-URL / base64)',
      operationId: 'uploadTicketAttachments',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody('#/components/schemas/AttachmentUpload'),
      responses: { '201': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/Attachment' } })) },
    },
  },
  '/tickets/{id}/attachments/{fileId}': {
    get: {
      tags: ['Tickets'],
      summary: 'Download attachment bytes',
      operationId: 'downloadTicketAttachment',
      security: sessionOrBearer,
      parameters: [
        idParam,
        { name: 'fileId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        '200': {
          description: 'Binary file',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
  },
  '/tickets/{id}/lock': {
    get: {
      tags: ['Tickets'],
      summary: 'Lock status (staff)',
      operationId: 'getTicketLock',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/LockStatus' })) },
    },
    post: {
      tags: ['Tickets'],
      summary: 'Acquire or renew lock (staff, soft)',
      description: 'Never hard-blocks; if held by another agent returns acquired:false and warning.',
      operationId: 'acquireTicketLock',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/LockAcquireResponse') },
    },
  },
  '/tickets/{id}/lock/release': {
    post: {
      tags: ['Tickets'],
      summary: 'Release own lock (staff)',
      operationId: 'releaseTicketLock',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List users (staff)',
      operationId: 'listUsers',
      security: sessionOrBearer,
      parameters: pageParams,
      responses: { '200': jsonOk('#/components/schemas/UserList') },
    },
    post: {
      tags: ['Users'],
      summary: 'Create user (admin)',
      operationId: 'createUser',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/User' })) },
    },
  },
  '/users/me/profile': {
    put: {
      tags: ['Users'],
      summary: 'Update own profile',
      operationId: 'updateMyProfile',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, timezone: { type: 'string' } } }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/users/me/password': {
    put: {
      tags: ['Users'],
      summary: 'Change own password',
      operationId: 'changeMyPassword',
      security: sessionOrBearer,
      requestBody: jsonBody({
        type: 'object',
        required: ['current_password', 'new_password'],
        properties: {
          current_password: { type: 'string' },
          new_password: { type: 'string', minLength: 8 },
        },
      }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get user',
      operationId: 'getUser',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/UserDetail' })) },
    },
    put: {
      tags: ['Users'],
      summary: 'Update user (admin)',
      operationId: 'updateUser',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Users'],
      summary: 'Delete user (admin)',
      operationId: 'deleteUser',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/users/{id}/tickets': {
    get: {
      tags: ['Users'],
      summary: 'Tickets for user',
      operationId: 'getUserTickets',
      security: sessionOrBearer,
      parameters: [idParam, ...pageParams],
      responses: { '200': jsonOk('#/components/schemas/TicketList') },
    },
  },
  '/users/{id}/organizations': {
    get: {
      tags: ['Users'],
      summary: 'Organizations for user',
      operationId: 'getUserOrganizations',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/OrganizationSummary' } })) },
    },
  },

  '/staff': {
    get: {
      tags: ['Staff'],
      summary: 'List staff',
      operationId: 'listStaff',
      security: sessionOrBearer,
      parameters: pageParams,
      responses: { '200': jsonOk('#/components/schemas/StaffList') },
    },
    post: {
      tags: ['Staff'],
      summary: 'Create staff (admin)',
      operationId: 'createStaff',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Staff' })) },
    },
  },
  '/staff/{id}': {
    get: {
      tags: ['Staff'],
      summary: 'Get staff member',
      operationId: 'getStaff',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/StaffDetail' })) },
    },
    put: {
      tags: ['Staff'],
      summary: 'Update staff (admin)',
      operationId: 'updateStaff',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Staff'],
      summary: 'Delete staff (admin)',
      operationId: 'deleteStaff',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/staff/{id}/tickets': {
    get: {
      tags: ['Staff'],
      summary: 'Assigned tickets',
      operationId: 'getStaffTickets',
      security: sessionOrBearer,
      parameters: [idParam, ...pageParams],
      responses: { '200': jsonOk('#/components/schemas/TicketList') },
    },
  },
  '/staff/{id}/departments': {
    get: {
      tags: ['Staff'],
      summary: 'Staff departments',
      operationId: 'getStaffDepartments',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/DepartmentSummary' } })) },
    },
  },
  '/staff/{id}/teams': {
    get: {
      tags: ['Staff'],
      summary: 'Staff teams',
      operationId: 'getStaffTeams',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/TeamSummary' } })) },
    },
  },

  '/departments': {
    get: {
      tags: ['Departments'],
      summary: 'List departments',
      operationId: 'listDepartments',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/DepartmentList') },
    },
    post: {
      tags: ['Departments'],
      summary: 'Create department (admin)',
      operationId: 'createDepartment',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Department' })) },
    },
  },
  '/departments/{id}': {
    get: {
      tags: ['Departments'],
      summary: 'Get department',
      operationId: 'getDepartment',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/DepartmentDetail' })) },
    },
    put: {
      tags: ['Departments'],
      summary: 'Update department (admin)',
      operationId: 'updateDepartment',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Departments'],
      summary: 'Delete department (admin)',
      operationId: 'deleteDepartment',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/departments/{id}/staff': {
    get: {
      tags: ['Departments'],
      summary: 'Staff in department',
      operationId: 'getDepartmentStaff',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/StaffList') },
    },
  },
  '/departments/{id}/tickets': {
    get: {
      tags: ['Departments'],
      summary: 'Tickets in department (staff)',
      operationId: 'getDepartmentTickets',
      security: sessionOrBearer,
      parameters: [idParam, ...pageParams],
      responses: { '200': jsonOk('#/components/schemas/TicketList') },
    },
  },

  '/teams': {
    get: {
      tags: ['Teams'],
      summary: 'List teams',
      operationId: 'listTeams',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/TeamList') },
    },
    post: {
      tags: ['Teams'],
      summary: 'Create team (admin)',
      operationId: 'createTeam',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Team' })) },
    },
  },
  '/teams/{id}': {
    get: {
      tags: ['Teams'],
      summary: 'Get team',
      operationId: 'getTeam',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/TeamDetail' })) },
    },
    put: {
      tags: ['Teams'],
      summary: 'Update team (admin)',
      operationId: 'updateTeam',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Teams'],
      summary: 'Delete team (admin)',
      operationId: 'deleteTeam',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/teams/{id}/members': {
    get: {
      tags: ['Teams'],
      summary: 'Team members',
      operationId: 'getTeamMembers',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/StaffList') },
    },
    post: {
      tags: ['Teams'],
      summary: 'Add team member (admin)',
      operationId: 'addTeamMember',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['staff_id'], properties: { staff_id: { type: 'integer' } } }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/teams/{id}/members/{staffId}': {
    delete: {
      tags: ['Teams'],
      summary: 'Remove team member (admin)',
      operationId: 'removeTeamMember',
      security: sessionOrBearer,
      parameters: [
        idParam,
        { name: 'staffId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/organizations': {
    get: {
      tags: ['Organizations'],
      summary: 'List organizations (staff)',
      operationId: 'listOrganizations',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/OrganizationList') },
    },
    post: {
      tags: ['Organizations'],
      summary: 'Create organization (admin)',
      operationId: 'createOrganization',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Organization' })) },
    },
  },
  '/organizations/{id}': {
    get: {
      tags: ['Organizations'],
      summary: 'Get organization',
      operationId: 'getOrganization',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/OrganizationDetail' })) },
    },
    put: {
      tags: ['Organizations'],
      summary: 'Update organization (admin)',
      operationId: 'updateOrganization',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Organizations'],
      summary: 'Delete organization (admin)',
      operationId: 'deleteOrganization',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/organizations/{id}/users': {
    get: {
      tags: ['Organizations'],
      summary: 'Users in organization',
      operationId: 'getOrganizationUsers',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/UserList') },
    },
  },

  '/topics': {
    get: {
      tags: ['Help Topics'],
      summary: 'List help topics',
      description: 'Public topics for anonymous/users; staff may see more.',
      operationId: 'listTopics',
      security: optionalAuth,
      responses: { '200': jsonOk('#/components/schemas/TopicList') },
    },
    post: {
      tags: ['Help Topics'],
      summary: 'Create topic (admin)',
      operationId: 'createTopic',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Topic' })) },
    },
  },
  '/topics/{id}': {
    get: {
      tags: ['Help Topics'],
      summary: 'Get topic',
      operationId: 'getTopic',
      security: optionalAuth,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/Topic' })) },
    },
    put: {
      tags: ['Help Topics'],
      summary: 'Update topic (admin)',
      operationId: 'updateTopic',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Help Topics'],
      summary: 'Delete topic (admin)',
      operationId: 'deleteTopic',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/sla': {
    get: {
      tags: ['SLA'],
      summary: 'List SLA plans (staff)',
      operationId: 'listSla',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/SLAList') },
    },
    post: {
      tags: ['SLA'],
      summary: 'Create SLA (admin)',
      operationId: 'createSla',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/SLA' })) },
    },
  },
  '/sla/{id}': {
    get: {
      tags: ['SLA'],
      summary: 'Get SLA plan',
      operationId: 'getSla',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/SLA' })) },
    },
    put: {
      tags: ['SLA'],
      summary: 'Update SLA (admin)',
      operationId: 'updateSla',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['SLA'],
      summary: 'Delete SLA (admin)',
      operationId: 'deleteSla',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/faq': {
    get: {
      tags: ['FAQ'],
      summary: 'List FAQ articles',
      description: 'Public/user: published + public categories. Staff: includes drafts.',
      operationId: 'listFaq',
      security: optionalAuth,
      parameters: [
        ...pageParams,
        { name: 'category_id', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': jsonOk('#/components/schemas/FAQList') },
    },
    post: {
      tags: ['FAQ'],
      summary: 'Create FAQ (staff)',
      operationId: 'createFaq',
      security: sessionOrBearer,
      requestBody: jsonBody('#/components/schemas/FAQCreate'),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/FAQ' })) },
    },
  },
  '/faq/categories': {
    get: {
      tags: ['FAQ'],
      summary: 'List FAQ categories',
      operationId: 'listFaqCategories',
      security: optionalAuth,
      responses: { '200': jsonOk('#/components/schemas/FAQCategoryList') },
    },
  },
  '/faq/{id}': {
    get: {
      tags: ['FAQ'],
      summary: 'Get FAQ article',
      operationId: 'getFaq',
      security: optionalAuth,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/FAQ' })) },
    },
    put: {
      tags: ['FAQ'],
      summary: 'Update FAQ (staff)',
      operationId: 'updateFaq',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody('#/components/schemas/FAQCreate'),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['FAQ'],
      summary: 'Delete FAQ (staff)',
      operationId: 'deleteFaq',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/tasks': {
    get: {
      tags: ['Tasks'],
      summary: 'List tasks (staff)',
      operationId: 'listTasks',
      security: sessionOrBearer,
      parameters: pageParams,
      responses: { '200': jsonOk('#/components/schemas/TaskList') },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Create task (staff)',
      operationId: 'createTask',
      security: sessionOrBearer,
      requestBody: jsonBody('#/components/schemas/TaskCreate'),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Task' })) },
    },
  },
  '/tasks/{id}': {
    get: {
      tags: ['Tasks'],
      summary: 'Get task',
      operationId: 'getTask',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/TaskDetail' })) },
    },
    put: {
      tags: ['Tasks'],
      summary: 'Update task',
      operationId: 'updateTask',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/tasks/{id}/close': {
    post: {
      tags: ['Tasks'],
      summary: 'Close task',
      operationId: 'closeTask',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/tasks/{id}/thread': {
    get: {
      tags: ['Tasks'],
      summary: 'Task thread',
      operationId: 'getTaskThread',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/ThreadEntryList') },
    },
  },

  '/roles': {
    get: {
      tags: ['Roles'],
      summary: 'List roles (staff)',
      operationId: 'listRoles',
      security: sessionOrBearer,
      responses: { '200': jsonOk(successData({ type: 'array', items: { $ref: '#/components/schemas/Role' } })) },
    },
    post: {
      tags: ['Roles'],
      summary: 'Create role (admin)',
      operationId: 'createRole',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk(successData({ $ref: '#/components/schemas/Role' })) },
    },
  },
  '/roles/{id}': {
    get: {
      tags: ['Roles'],
      summary: 'Get role',
      operationId: 'getRole',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/Role' })) },
    },
    put: {
      tags: ['Roles'],
      summary: 'Update role (admin)',
      operationId: 'updateRole',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Roles'],
      summary: 'Delete role (admin)',
      operationId: 'deleteRole',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/settings': {
    get: {
      tags: ['Settings'],
      summary: 'List settings groups (admin)',
      operationId: 'listSettings',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    put: {
      tags: ['Settings'],
      summary: 'Update settings (admin)',
      operationId: 'updateSettings',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/email-templates/groups': {
    get: {
      tags: ['Email Templates'],
      summary: 'List template groups',
      operationId: 'listEmailTemplateGroups',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    post: {
      tags: ['Email Templates'],
      summary: 'Create template group (admin)',
      operationId: 'createEmailTemplateGroup',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/email-templates/groups/{id}': {
    get: {
      tags: ['Email Templates'],
      summary: 'Get template group',
      operationId: 'getEmailTemplateGroup',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    put: {
      tags: ['Email Templates'],
      summary: 'Update template group (admin)',
      operationId: 'updateEmailTemplateGroup',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Email Templates'],
      summary: 'Delete template group (admin)',
      operationId: 'deleteEmailTemplateGroup',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/email-templates': {
    get: {
      tags: ['Email Templates'],
      summary: 'List templates',
      operationId: 'listEmailTemplates',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
  },
  '/email-templates/{id}': {
    get: {
      tags: ['Email Templates'],
      summary: 'Get template',
      operationId: 'getEmailTemplate',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    put: {
      tags: ['Email Templates'],
      summary: 'Update template (admin)',
      operationId: 'updateEmailTemplate',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/canned-responses': {
    get: {
      tags: ['Canned Responses'],
      summary: 'List canned responses (staff)',
      operationId: 'listCannedResponses',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    post: {
      tags: ['Canned Responses'],
      summary: 'Create canned response (admin)',
      operationId: 'createCannedResponse',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/canned-responses/{id}': {
    get: {
      tags: ['Canned Responses'],
      summary: 'Get canned response',
      operationId: 'getCannedResponse',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    put: {
      tags: ['Canned Responses'],
      summary: 'Update canned response (admin)',
      operationId: 'updateCannedResponse',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Canned Responses'],
      summary: 'Delete canned response (admin)',
      operationId: 'deleteCannedResponse',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/filters': {
    get: {
      tags: ['Filters'],
      summary: 'List ticket filters (admin)',
      operationId: 'listFilters',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    post: {
      tags: ['Filters'],
      summary: 'Create filter (admin)',
      operationId: 'createFilter',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '201': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/filters/reorder': {
    put: {
      tags: ['Filters'],
      summary: 'Reorder filters (admin)',
      operationId: 'reorderFilters',
      security: sessionOrBearer,
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },
  '/filters/{id}': {
    get: {
      tags: ['Filters'],
      summary: 'Get filter',
      operationId: 'getFilter',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
    put: {
      tags: ['Filters'],
      summary: 'Update filter (admin)',
      operationId: 'updateFilter',
      security: sessionOrBearer,
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
    delete: {
      tags: ['Filters'],
      summary: 'Delete filter (admin)',
      operationId: 'deleteFilter',
      security: sessionOrBearer,
      parameters: [idParam],
      responses: { '200': jsonOk('#/components/schemas/SuccessResponse') },
    },
  },

  '/priorities': {
    get: {
      tags: ['System'],
      summary: 'List priorities',
      operationId: 'listPriorities',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/PriorityList') },
    },
  },
  '/statuses': {
    get: {
      tags: ['System'],
      summary: 'List ticket statuses',
      operationId: 'listStatuses',
      security: sessionOrBearer,
      responses: { '200': jsonOk('#/components/schemas/StatusList') },
    },
  },
  '/system/config': {
    get: {
      tags: ['System'],
      summary: 'System configuration snapshot (staff)',
      operationId: 'getSystemConfig',
      security: sessionOrBearer,
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/SystemConfig' })) },
    },
  },
  '/system/stats': {
    get: {
      tags: ['System'],
      summary: 'System statistics (staff)',
      operationId: 'getSystemStats',
      security: sessionOrBearer,
      responses: { '200': jsonOk(successData({ $ref: '#/components/schemas/SystemStats' })) },
    },
  },
  '/cron': {
    post: {
      tags: ['System'],
      summary: 'Run scheduled jobs (native)',
      description: 'Shares job runners with official POST /api/tasks/cron. Prefer official path for stock key capabilities.',
      operationId: 'runCronNative',
      security: sessionOrBearer,
      responses: { '200': jsonOk({ type: 'object', additionalProperties: true }) },
    },
  },
};

// Official FOSS API — paths absolute from server /
const officialPaths = {
  '/api/tickets.json': {
    post: {
      tags: ['Official FOSS API'],
      summary: 'Create ticket (JSON, stock contract)',
      description: 'Requires X-API-Key with can_create_tickets. HTTP 201 body is **plain text ticket number** (not JSON).',
      operationId: 'officialCreateTicketJson',
      security: apiKey,
      requestBody: jsonBody('#/components/schemas/TicketCreateLegacy'),
      responses: {
        '201': {
          description: 'Bare ticket number',
          content: { 'text/plain': { schema: { type: 'string', example: '1001' } } },
        },
        '401': {
          description: 'Missing/invalid API key (plain text)',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      },
    },
  },
  '/api/tickets.xml': {
    post: {
      tags: ['Official FOSS API'],
      summary: 'Create ticket (XML)',
      operationId: 'officialCreateTicketXml',
      security: apiKey,
      requestBody: {
        required: true,
        content: {
          'application/xml': { schema: { type: 'string' } },
          'text/xml': { schema: { type: 'string' } },
        },
      },
      responses: {
        '201': {
          description: 'Bare ticket number',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      },
    },
  },
  '/api/tickets.email': {
    post: {
      tags: ['Official FOSS API'],
      summary: 'Create or reply via raw email MIME',
      operationId: 'officialCreateTicketEmail',
      security: apiKey,
      requestBody: {
        required: true,
        content: {
          'message/rfc822': { schema: { type: 'string' } },
          'text/plain': { schema: { type: 'string' } },
        },
      },
      responses: {
        '201': {
          description: 'Bare ticket number',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      },
    },
  },
  '/api/tasks/cron': {
    post: {
      tags: ['Official FOSS API'],
      summary: 'Run cron jobs (stock path)',
      description: 'Requires X-API-Key with can_exec_cron. Body is plain text `Completed`. Runs TicketMonitor + LockCleanup + stubs.',
      operationId: 'officialCron',
      security: apiKey,
      responses: {
        '200': {
          description: 'Completed',
          content: { 'text/plain': { schema: { type: 'string', example: 'Completed' } } },
        },
      },
    },
  },
};

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Nodeticket API',
    description: [
      'Native product REST API under `/api/v1` plus official osTicket FOSS-compatible endpoints under `/api`.',
      '',
      '**Auth:** Bearer JWT (`Authorization: Bearer …`), session cookie (`nodeticket.sid`), or `X-API-Key` (official create/cron only — never a staff principal on native routes).',
      '',
      '**CSRF:** Session-authenticated mutating `/api/v1` calls must send `x-csrf-token` (from SPA `APP_CONFIG.csrfToken` or login HTML). Bearer and API-key clients are exempt.',
      '',
      '**Generated:** `npm run openapi:generate` from `scripts/generate-openapi.js` (route catalog aligned to `src/app.js` + `src/routes/*`).',
    ].join('\n'),
    version: packageJson.version || '2026.3.1',
    contact: { name: 'Nodeticket' },
    license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
  },
  servers: [
    { url: '/api/v1', description: 'Native product API (paths below are relative to this base)' },
    { url: '/', description: 'App root — use for official FOSS paths under /api/…' },
  ],
  tags: [
    { name: 'Authentication', description: 'Login, session, registration, password reset' },
    { name: 'Tickets', description: 'Ticket lifecycle, thread, attachments, locks' },
    { name: 'Users', description: 'Customer users' },
    { name: 'Staff', description: 'Staff agents' },
    { name: 'Departments', description: 'Departments' },
    { name: 'Teams', description: 'Teams and membership' },
    { name: 'Organizations', description: 'Organizations' },
    { name: 'Help Topics', description: 'Help topics / forms entry points' },
    { name: 'SLA', description: 'Service level agreements' },
    { name: 'FAQ', description: 'Knowledge base' },
    { name: 'Tasks', description: 'Staff tasks' },
    { name: 'Roles', description: 'Staff roles / permissions' },
    { name: 'Settings', description: 'Admin configuration' },
    { name: 'Email Templates', description: 'Outbound email templates' },
    { name: 'Canned Responses', description: 'Canned reply snippets' },
    { name: 'Filters', description: 'Ticket filters / routing rules' },
    { name: 'System', description: 'Priorities, statuses, config, stats, native cron' },
    { name: 'Official FOSS API', description: 'Stock osTicket HTTP create + cron (X-API-Key capabilities)' },
  ],
  paths: {
    ...nativePaths,
    // Document official paths with absolute paths; clients using server "/" resolve them.
    // Also listed with x-server-relative note for dual-server OpenAPI consumers.
    ...Object.fromEntries(
      Object.entries(officialPaths).map(([p, methods]) => [
        // Keep under a path that won't collide with /api/v1-relative docs:
        // OpenAPI allows full path keys when server is /
        p.startsWith('/api/') ? p : p,
        methods,
      ])
    ),
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from POST /auth/login (token_use=access only)',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'nodeticket.sid',
        description: 'Express session cookie after HTML or API login',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Official FOSS API only (can_create_tickets / can_exec_cron). Not a staff principal on /api/v1.',
      },
      csrfHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-csrf-token',
        description: 'Required for session-cookie mutations on /api/v1',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Authentication required or invalid token',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Error' } },
        },
      },
      Forbidden: {
        description: 'Authenticated but not allowed',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Error' } },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Error' } },
        },
      },
      BadRequest: {
        description: 'Validation error',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Error' } },
        },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          errors: { type: 'object', additionalProperties: true },
        },
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      NotificationResult: {
        type: 'object',
        properties: {
          sent: { type: 'boolean' },
          messageId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      LockTouchResult: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          touched: { type: 'boolean' },
          warning: { type: 'string', nullable: true },
          reason: { type: 'string' },
          lock: { $ref: '#/components/schemas/Lock' },
        },
      },
      Lock: {
        type: 'object',
        properties: {
          lock_id: { type: 'integer' },
          staff_id: { type: 'integer' },
          staff_name: { type: 'string' },
          expire: { type: 'string', format: 'date-time' },
          code: { type: 'string' },
          created: { type: 'string', format: 'date-time' },
          seconds_remaining: { type: 'integer' },
        },
      },
      LockStatus: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          mode: { type: 'integer', description: '0 disabled, 1 on view, 2 on activity' },
          minutes: { type: 'integer' },
          lock: { allOf: [{ $ref: '#/components/schemas/Lock' }], nullable: true },
          held_by_other: { type: 'boolean' },
          held_by_self: { type: 'boolean' },
          warning: { type: 'string', nullable: true },
        },
      },
      LockAcquireResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          acquired: { type: 'boolean' },
          reason: { type: 'string' },
          warning: { type: 'string' },
          data: { $ref: '#/components/schemas/Lock' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string', format: 'password' },
          type: { type: 'string', enum: ['user', 'staff'], default: 'staff' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'username', 'password'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 8 },
          confirm: { type: 'string' },
        },
      },
      Principal: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          type: { type: 'string', enum: ['user', 'staff'] },
          username: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          isAdmin: { type: 'boolean' },
          verified: { type: 'boolean' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          token: { type: 'string' },
          user: { $ref: '#/components/schemas/Principal' },
        },
      },
      Attachment: {
        type: 'object',
        properties: {
          attachment_id: { type: 'integer' },
          file_id: { type: 'integer' },
          name: { type: 'string' },
          mime_type: { type: 'string' },
          size: { type: 'integer' },
          entry_id: { type: 'integer' },
          entry_type: { type: 'string' },
          inline: { type: 'boolean' },
          created: { type: 'string', format: 'date-time' },
        },
      },
      AttachmentFile: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          data: {
            type: 'string',
            description: 'RFC 2397 data URL or base64 payload',
          },
          encoding: { type: 'string', enum: ['base64'] },
        },
        required: ['name', 'data'],
      },
      AttachmentUpload: {
        type: 'object',
        required: ['attachments'],
        properties: {
          attachments: {
            type: 'array',
            items: { $ref: '#/components/schemas/AttachmentFile' },
          },
          entry_id: { type: 'integer' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          ticket_id: { type: 'integer' },
          number: { type: 'string' },
          subject: { type: 'string' },
          user_id: { type: 'integer' },
          status: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              state: { type: 'string' },
            },
          },
          department: { $ref: '#/components/schemas/DepartmentSummary' },
          created: { type: 'string', format: 'date-time' },
          updated: { type: 'string', format: 'date-time' },
        },
      },
      TicketDetail: {
        allOf: [
          { $ref: '#/components/schemas/Ticket' },
          {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/UserSummary' },
              staff: { $ref: '#/components/schemas/StaffSummary' },
              priority: { $ref: '#/components/schemas/Priority' },
              sla: { $ref: '#/components/schemas/SLASummary' },
              collaborators: {
                type: 'array',
                items: { $ref: '#/components/schemas/Collaborator' },
              },
            },
          },
        ],
      },
      TicketList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      TicketCreate: {
        type: 'object',
        required: ['topic_id', 'subject', 'message'],
        properties: {
          topic_id: { type: 'integer' },
          subject: { type: 'string' },
          message: { type: 'string' },
          user_id: { type: 'integer', description: 'Staff create-on-behalf' },
          source: { type: 'string' },
          attachments: {
            type: 'array',
            items: { $ref: '#/components/schemas/AttachmentFile' },
          },
        },
      },
      TicketCreateLegacy: {
        type: 'object',
        required: ['name', 'email', 'subject', 'message'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          message: { type: 'string' },
          topicId: { type: 'integer' },
          source: { type: 'string', enum: ['Web', 'Email', 'Phone', 'API', 'Other'] },
          ip: { type: 'string' },
          attachments: {
            type: 'array',
            items: { $ref: '#/components/schemas/AttachmentFile' },
          },
        },
      },
      TicketUpdate: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['close', 'reopen'] },
          status_id: { type: 'integer' },
          staff_id: { type: 'integer' },
          dept_id: { type: 'integer' },
          team_id: { type: 'integer' },
          topic_id: { type: 'integer' },
          sla_id: { type: 'integer' },
          duedate: { type: 'string', format: 'date-time' },
          isoverdue: { type: 'boolean' },
        },
      },
      TicketReply: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          format: { type: 'string', enum: ['text', 'html'], default: 'text' },
          attachments: {
            type: 'array',
            items: { $ref: '#/components/schemas/AttachmentFile' },
          },
        },
      },
      TicketNote: {
        type: 'object',
        required: ['note'],
        properties: {
          title: { type: 'string' },
          note: { type: 'string' },
        },
      },
      TicketBulkRequest: {
        type: 'object',
        required: ['action', 'ticketIds'],
        properties: {
          action: { type: 'string', enum: ['assign', 'close', 'delete'] },
          ticketIds: { type: 'array', items: { type: 'integer' } },
          data: {
            type: 'object',
            properties: {
              staff_id: { type: 'integer' },
              team_id: { type: 'integer' },
            },
          },
        },
      },
      ThreadEntry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          thread_id: { type: 'integer' },
          type: { type: 'string', enum: ['M', 'R', 'N'] },
          poster: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          format: { type: 'string' },
          source: { type: 'string' },
          created: { type: 'string', format: 'date-time' },
        },
      },
      ThreadEntryList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/ThreadEntry' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      ThreadEvent: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          event: { type: 'string' },
          staff_id: { type: 'integer' },
          username: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ThreadEventList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/ThreadEvent' } },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
          org_id: { type: 'integer' },
          created: { type: 'string', format: 'date-time' },
        },
      },
      UserSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
      UserDetail: { allOf: [{ $ref: '#/components/schemas/User' }] },
      UserList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/User' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      Staff: {
        type: 'object',
        properties: {
          staff_id: { type: 'integer' },
          username: { type: 'string' },
          firstname: { type: 'string' },
          lastname: { type: 'string' },
          email: { type: 'string' },
          dept_id: { type: 'integer' },
          isadmin: { type: 'boolean' },
          isactive: { type: 'boolean' },
        },
      },
      StaffSummary: {
        type: 'object',
        properties: {
          staff_id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
      StaffDetail: { allOf: [{ $ref: '#/components/schemas/Staff' }] },
      StaffList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Staff' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      Department: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          pid: { type: 'integer' },
          sla_id: { type: 'integer' },
          manager_id: { type: 'integer' },
        },
      },
      DepartmentSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      DepartmentDetail: { allOf: [{ $ref: '#/components/schemas/Department' }] },
      DepartmentList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Department' } },
        },
      },
      Team: {
        type: 'object',
        properties: {
          team_id: { type: 'integer' },
          name: { type: 'string' },
          lead_id: { type: 'integer' },
          notes: { type: 'string' },
        },
      },
      TeamSummary: {
        type: 'object',
        properties: {
          team_id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      TeamDetail: { allOf: [{ $ref: '#/components/schemas/Team' }] },
      TeamList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Team' } },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          domain: { type: 'string' },
        },
      },
      OrganizationSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      OrganizationDetail: { allOf: [{ $ref: '#/components/schemas/Organization' }] },
      OrganizationList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Organization' } },
        },
      },
      Topic: {
        type: 'object',
        properties: {
          topic_id: { type: 'integer' },
          topic: { type: 'string' },
          ispublic: { type: 'boolean' },
          dept_id: { type: 'integer' },
          priority_id: { type: 'integer' },
          sla_id: { type: 'integer' },
        },
      },
      TopicSummary: {
        type: 'object',
        properties: {
          topic_id: { type: 'integer' },
          topic: { type: 'string' },
        },
      },
      TopicList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Topic' } },
        },
      },
      SLA: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          grace_period: { type: 'integer' },
          flags: { type: 'integer' },
        },
      },
      SLASummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          grace_period: { type: 'integer' },
        },
      },
      SLAList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/SLA' } },
        },
      },
      Status: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          state: { type: 'string' },
        },
      },
      StatusList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Status' } },
        },
      },
      Priority: {
        type: 'object',
        properties: {
          priority_id: { type: 'integer' },
          priority: { type: 'string' },
          priority_color: { type: 'string' },
          priority_urgency: { type: 'integer' },
        },
      },
      PriorityList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Priority' } },
        },
      },
      FAQ: {
        type: 'object',
        properties: {
          faq_id: { type: 'integer' },
          category_id: { type: 'integer' },
          category: { $ref: '#/components/schemas/FAQCategory' },
          question: { type: 'string' },
          answer: { type: 'string' },
          keywords: { type: 'string' },
          ispublished: { type: 'boolean' },
          created: { type: 'string', format: 'date-time' },
          updated: { type: 'string', format: 'date-time' },
        },
      },
      FAQCreate: {
        type: 'object',
        required: ['question', 'answer'],
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          category_id: { type: 'integer' },
          keywords: { type: 'string' },
          ispublished: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
      FAQList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/FAQ' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      FAQCategory: {
        type: 'object',
        properties: {
          category_id: { type: 'integer' },
          category_pid: { type: 'integer' },
          name: { type: 'string' },
          description: { type: 'string' },
          ispublic: { type: 'boolean' },
          faqCount: { type: 'integer' },
        },
      },
      FAQCategoryList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/FAQCategory' } },
        },
      },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          number: { type: 'string' },
          object_id: { type: 'integer' },
          object_type: { type: 'string' },
          dept_id: { type: 'integer' },
          staff_id: { type: 'integer' },
          team_id: { type: 'integer' },
          duedate: { type: 'string', format: 'date-time' },
          closed: { type: 'string', format: 'date-time' },
          created: { type: 'string', format: 'date-time' },
        },
      },
      TaskCreate: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          dept_id: { type: 'integer' },
          staff_id: { type: 'integer' },
          team_id: { type: 'integer' },
          object_id: { type: 'integer' },
          object_type: { type: 'string' },
          duedate: { type: 'string', format: 'date-time' },
        },
      },
      TaskDetail: {
        allOf: [
          { $ref: '#/components/schemas/Task' },
          {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              staff: { $ref: '#/components/schemas/StaffSummary' },
              team: { $ref: '#/components/schemas/TeamSummary' },
              department: { $ref: '#/components/schemas/DepartmentSummary' },
            },
          },
        ],
      },
      TaskList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      Collaborator: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          user_id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['M', 'C'] },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          permissions: { type: 'object', additionalProperties: true },
          notes: { type: 'string' },
        },
      },
      SystemConfig: {
        type: 'object',
        properties: {
          helpdesk_url: { type: 'string' },
          helpdesk_title: { type: 'string' },
          default_dept_id: { type: 'integer' },
          default_sla_id: { type: 'integer' },
          default_priority_id: { type: 'integer' },
          enable_kb: { type: 'boolean' },
          enable_captcha: { type: 'boolean' },
          max_file_size: { type: 'integer' },
          allowed_filetypes: { type: 'string' },
          auto_claim_tickets: { type: 'boolean' },
          ticket_lock: { type: 'integer' },
          autolock_minutes: { type: 'integer' },
        },
      },
      SystemStats: {
        type: 'object',
        properties: {
          tickets: {
            type: 'object',
            properties: {
              open: { type: 'integer' },
              closed: { type: 'integer' },
              overdue: { type: 'integer' },
              unassigned: { type: 'integer' },
            },
          },
          users: { type: 'integer' },
          staff: { type: 'integer' },
          departments: { type: 'integer' },
          teams: { type: 'integer' },
        },
      },
    },
  },
  'x-generated-by': 'scripts/generate-openapi.js',
  'x-generated-at': new Date().toISOString(),
  'x-note':
    'Native paths are relative to server /api/v1. Official FOSS paths are absolute from app root (/api/...). Prefer server / when resolving official paths.',
};

// Merge: OpenAPI single paths map — official absolute paths live alongside relative ones.
// Consumers using only /api/v1 server ignore /api/* keys; root server resolves both if rewritten.

const outPath = path.join(__dirname, '..', 'docs', 'openapi.json');
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

const pathCount = Object.keys(doc.paths).length;
const opCount = Object.values(doc.paths).reduce(
  (n, methods) => n + Object.keys(methods).filter((m) => !m.startsWith('x-')).length,
  0
);
console.log(`Wrote ${outPath}`);
console.log(`  paths: ${pathCount}, operations: ${opCount}`);
console.log(`  version: ${doc.info.version}`);
