/**
 * Authorization helpers for ticket visibility and role permissions.
 * Pure / query-backed logic shared by REST, SSR, and MCP.
 */

/**
 * Normalize role permission object from DB JSON.
 * @param {Object|string|null} raw
 * @returns {Object}
 */
function parsePermissions(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Check staff role permission.
 *
 * Rules:
 * - Admins always allowed
 * - Empty permissions object = unrestricted agent (legacy roles)
 * - Otherwise permission key must be truthy
 *
 * @param {Object} auth - req.auth principal
 * @param {string} permission - e.g. 'ticket.reply'
 * @returns {boolean}
 */
function hasPermission(auth, permission) {
  if (!auth || auth.type !== 'staff') return false;
  if (auth.isAdmin) return true;

  const perms = auth.permissions || {};
  const keys = Object.keys(perms);
  if (keys.length === 0) return true;

  if (perms[permission]) return true;
  // Allow short form (reply) if full form stored
  const short = permission.includes('.') ? permission.split('.').pop() : permission;
  if (perms[short]) return true;
  return false;
}

/**
 * Build a staff visibility context from auth + optional DB fields.
 * @param {Object} auth
 * @returns {{ staffId: number, isAdmin: boolean, assignedOnly: boolean, deptIds: number[], teamIds: number[] }}
 */
function getStaffScope(auth) {
  const staffId = parseInt(auth.id, 10);
  const deptIds = Array.isArray(auth.deptIds)
    ? auth.deptIds.map((d) => parseInt(d, 10)).filter((n) => !isNaN(n))
    : [];
  if (auth.deptId != null && !deptIds.includes(parseInt(auth.deptId, 10))) {
    const primary = parseInt(auth.deptId, 10);
    if (!isNaN(primary)) deptIds.push(primary);
  }
  const teamIds = Array.isArray(auth.teamIds)
    ? auth.teamIds.map((t) => parseInt(t, 10)).filter((n) => !isNaN(n))
    : [];

  return {
    staffId,
    isAdmin: !!auth.isAdmin,
    assignedOnly: !!auth.assignedOnly,
    deptIds,
    teamIds,
  };
}

/**
 * Whether a staff principal may access a ticket row.
 * @param {Object} auth - staff principal
 * @param {Object} ticket - { user_id, dept_id, staff_id, team_id }
 * @returns {boolean}
 */
function staffCanAccessTicket(auth, ticket) {
  if (!auth || auth.type !== 'staff' || !ticket) return false;
  if (auth.isAdmin) return true;

  const scope = getStaffScope(auth);
  const tStaff = ticket.staff_id != null ? parseInt(ticket.staff_id, 10) : null;
  const tTeam = ticket.team_id != null ? parseInt(ticket.team_id, 10) : null;
  const tDept = ticket.dept_id != null ? parseInt(ticket.dept_id, 10) : null;

  const isAssignee = tStaff === scope.staffId;
  const isTeamTicket = tTeam != null && scope.teamIds.includes(tTeam);

  if (scope.assignedOnly) {
    return isAssignee || isTeamTicket;
  }

  if (isAssignee || isTeamTicket) return true;
  if (tDept != null && scope.deptIds.includes(tDept)) return true;

  return false;
}

/**
 * Append SQL visibility constraints for staff ticket lists.
 * Mutates sql string builder pattern: returns { clause, params }.
 *
 * @param {Object} auth - staff principal
 * @param {string} ticketAlias - table alias (default 't')
 * @returns {{ clause: string, params: any[] } | null} null means no restriction (admin)
 */
function staffListVisibilitySql(auth, ticketAlias = 't') {
  if (!auth || auth.type !== 'staff') return null;
  if (auth.isAdmin) return null;

  const scope = getStaffScope(auth);
  const a = ticketAlias;
  const params = [];

  if (scope.assignedOnly) {
    if (scope.teamIds.length > 0) {
      const ph = scope.teamIds.map(() => '?').join(',');
      params.push(scope.staffId, ...scope.teamIds);
      return {
        clause: ` AND (${a}.staff_id = ? OR ${a}.team_id IN (${ph}))`,
        params,
      };
    }
    params.push(scope.staffId);
    return {
      clause: ` AND ${a}.staff_id = ?`,
      params,
    };
  }

  const parts = [];
  if (scope.deptIds.length > 0) {
    const ph = scope.deptIds.map(() => '?').join(',');
    parts.push(`${a}.dept_id IN (${ph})`);
    params.push(...scope.deptIds);
  }
  parts.push(`${a}.staff_id = ?`);
  params.push(scope.staffId);
  if (scope.teamIds.length > 0) {
    const ph = scope.teamIds.map(() => '?').join(',');
    parts.push(`${a}.team_id IN (${ph})`);
    params.push(...scope.teamIds);
  }

  if (parts.length === 0) {
    // No dept/teams and not assigned-only → see nothing rather than everything
    return { clause: ' AND 1=0', params: [] };
  }

  return {
    clause: ` AND (${parts.join(' OR ')})`,
    params,
  };
}

/**
 * Public-safe ticket detail for customers (strip staff emails, private collab data).
 * @param {Object} detail - full ticket detail from SDK
 * @returns {Object}
 */
function publicTicketDetail(detail) {
  if (!detail) return detail;
  const out = { ...detail };
  if (out.staff) {
    out.staff = {
      staff_id: out.staff.staff_id,
      name: out.staff.name,
    };
  }
  if (out.user) {
    out.user = {
      id: out.user.id,
      name: out.user.name,
      // owner may see own email
      email: out.user.email,
    };
  }
  if (Array.isArray(out.collaborators)) {
    out.collaborators = out.collaborators.map((c) => ({
      id: c.id,
      user_id: c.user_id,
      name: c.name,
      role: c.role,
    }));
  }
  // Hide operational SLA internals from customers if present
  if (out.sla) {
    out.sla = { id: out.sla.id, name: out.sla.name };
  }
  return out;
}

/**
 * Public-safe thread entry (messages/replies only; no notes).
 * @param {Object} entry
 * @returns {Object}
 */
function publicThreadEntry(entry) {
  return {
    id: entry.id,
    thread_id: entry.thread_id,
    type: entry.type,
    poster: entry.poster,
    title: entry.title,
    body: entry.body,
    format: entry.format,
    source: entry.source,
    created: entry.created,
    // No staff_id, user_id, or email for public consumers
  };
}

/** Thread entry types visible to customers */
const PUBLIC_THREAD_TYPES = new Set(['M', 'R']);

function isPublicThreadType(type) {
  return PUBLIC_THREAD_TYPES.has(type);
}

module.exports = {
  parsePermissions,
  hasPermission,
  getStaffScope,
  staffCanAccessTicket,
  staffListVisibilitySql,
  publicTicketDetail,
  publicThreadEntry,
  isPublicThreadType,
  PUBLIC_THREAD_TYPES,
};
