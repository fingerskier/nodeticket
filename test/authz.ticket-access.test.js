const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  hasPermission,
  staffCanAccessTicket,
  staffListVisibilitySql,
  publicTicketDetail,
  isPublicThreadType,
} = require('../src/lib/authz');

describe('hasPermission', () => {
  test('admin always allowed', () => {
    assert.equal(
      hasPermission({ type: 'staff', isAdmin: true, permissions: { 'ticket.reply': false } }, 'ticket.reply'),
      true
    );
  });

  test('empty permissions = unrestricted agent', () => {
    assert.equal(
      hasPermission({ type: 'staff', isAdmin: false, permissions: {} }, 'ticket.reply'),
      true
    );
  });

  test('explicit deny when permission missing from non-empty map', () => {
    assert.equal(
      hasPermission(
        { type: 'staff', isAdmin: false, permissions: { 'ticket.reply': 1 } },
        'ticket.merge'
      ),
      false
    );
  });

  test('explicit allow', () => {
    assert.equal(
      hasPermission(
        { type: 'staff', isAdmin: false, permissions: { 'ticket.note': 1 } },
        'ticket.note'
      ),
      true
    );
  });

  test('non-staff denied', () => {
    assert.equal(hasPermission({ type: 'user' }, 'ticket.reply'), false);
    assert.equal(hasPermission({ type: 'apikey' }, 'ticket.reply'), false);
  });
});

describe('staffCanAccessTicket', () => {
  const baseStaff = {
    type: 'staff',
    id: 10,
    isAdmin: false,
    deptId: 1,
    deptIds: [1, 2],
    teamIds: [5],
    assignedOnly: false,
  };

  test('admin sees all', () => {
    assert.equal(
      staffCanAccessTicket({ ...baseStaff, isAdmin: true }, { dept_id: 99, staff_id: null, team_id: null }),
      true
    );
  });

  test('primary/extended dept access', () => {
    assert.equal(
      staffCanAccessTicket(baseStaff, { dept_id: 2, staff_id: null, team_id: null }),
      true
    );
    assert.equal(
      staffCanAccessTicket(baseStaff, { dept_id: 99, staff_id: null, team_id: null }),
      false
    );
  });

  test('assignee can access even outside dept', () => {
    assert.equal(
      staffCanAccessTicket(baseStaff, { dept_id: 99, staff_id: 10, team_id: null }),
      true
    );
  });

  test('team ticket access', () => {
    assert.equal(
      staffCanAccessTicket(baseStaff, { dept_id: 99, staff_id: null, team_id: 5 }),
      true
    );
  });

  test('assigned_only restricts to assignee/team', () => {
    const only = { ...baseStaff, assignedOnly: true };
    assert.equal(
      staffCanAccessTicket(only, { dept_id: 1, staff_id: null, team_id: null }),
      false
    );
    assert.equal(
      staffCanAccessTicket(only, { dept_id: 1, staff_id: 10, team_id: null }),
      true
    );
    assert.equal(
      staffCanAccessTicket(only, { dept_id: 99, staff_id: null, team_id: 5 }),
      true
    );
  });
});

describe('staffListVisibilitySql', () => {
  test('admin has no clause', () => {
    assert.equal(
      staffListVisibilitySql({ type: 'staff', isAdmin: true, id: 1 }),
      null
    );
  });

  test('dept staff gets OR filter', () => {
    const vis = staffListVisibilitySql({
      type: 'staff',
      id: 3,
      isAdmin: false,
      deptIds: [1, 2],
      teamIds: [],
      assignedOnly: false,
    });
    assert.ok(vis.clause.includes('dept_id IN'));
    assert.ok(vis.clause.includes('staff_id = ?'));
    assert.deepEqual(vis.params, [1, 2, 3]);
  });

  test('assigned_only SQL', () => {
    const vis = staffListVisibilitySql({
      type: 'staff',
      id: 7,
      isAdmin: false,
      deptIds: [1],
      teamIds: [9],
      assignedOnly: true,
    });
    assert.ok(vis.clause.includes('staff_id = ?'));
    assert.ok(vis.clause.includes('team_id IN'));
    assert.deepEqual(vis.params, [7, 9]);
  });
});

describe('public DTOs', () => {
  test('publicTicketDetail strips staff email', () => {
    const out = publicTicketDetail({
      ticket_id: 1,
      staff: { staff_id: 2, name: 'Agent', email: 'secret@x.com' },
      collaborators: [{ id: 1, user_id: 3, name: 'Bob', email: 'bob@x.com', role: 'CC' }],
      sla: { id: 1, name: 'Default', grace_period: 24 },
    });
    assert.equal(out.staff.email, undefined);
    assert.equal(out.collaborators[0].email, undefined);
    assert.equal(out.sla.grace_period, undefined);
  });

  test('public thread types', () => {
    assert.equal(isPublicThreadType('M'), true);
    assert.equal(isPublicThreadType('R'), true);
    assert.equal(isPublicThreadType('N'), false);
  });
});
