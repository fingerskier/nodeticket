/**
 * Threads data access (thread, thread_entry, thread_event, thread_collaborator)
 * @module sdk/data/threads
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Thread data operations
 */
module.exports = (conn) => {
  const TABLE = 'thread';
  const PK = 'id';

  // ── Thread CRUD ──────────────────────────────────────────────

  /**
   * Find threads matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of thread rows
   * @example
   * const threads = await threads.find({ where: { object_type: 'T' }, limit: 10 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a thread by its primary key.
   * @param {number|string} id - The thread id
   * @returns {Promise<Object|null>} Thread row or null
   * @example
   * const thread = await threads.findById(7);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Find a thread by its associated object.
   * @param {number|string} objectId - The object_id value
   * @param {string} objectType - The object_type value (e.g. 'T' for ticket)
   * @returns {Promise<Object|null>} Thread row or null
   * @example
   * const thread = await threads.findByObject(42, 'T');
   */
  const findByObject = async (objectId, objectType) => {
    return conn.findOne(TABLE, { object_id: objectId, object_type: objectType });
  };

  /**
   * Count threads matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await threads.count({ object_type: 'T' });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new thread.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const thread = await threads.create({ object_id: 42, object_type: 'T' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a thread by its primary key.
   * @param {number|string} id - The thread id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await threads.update(7, { extra: '{}' });
   */
  const update = async (id, data) => {
    const keys = Object.keys(data);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    await conn.query(
      `UPDATE ${conn.table(TABLE)} SET ${sets} WHERE ${PK} = ?`,
      [...Object.values(data), id],
    );
  };

  /**
   * Delete a thread by its primary key.
   * @param {number|string} id - The thread id
   * @returns {Promise<void>}
   * @example
   * await threads.remove(7);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  // ── Thread Entries ───────────────────────────────────────────

  /**
   * Find entries for a thread.
   * @param {number|string} threadId - The thread id
   * @param {Object} [options] - Query options
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of thread_entry rows
   * @example
   * const entries = await threads.findEntries(7, { limit: 20 });
   */
  const findEntries = async (threadId, options = {}) => {
    return conn.find('thread_entry', {
      where: { thread_id: threadId },
      orderBy: 'id ASC',
      ...options,
    });
  };

  /**
   * Create a new thread entry.
   * @param {Object} data - Column values (must include thread_id)
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const entry = await threads.createEntry({ thread_id: 7, type: 'M', poster: 'Admin', body: 'Hello' });
   */
  const createEntry = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table('thread_entry')} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, id: result.insertId };
  };

  /**
   * Count entries for a thread.
   * @param {number|string} threadId - The thread id
   * @returns {Promise<number>} Entry count
   * @example
   * const total = await threads.countEntries(7);
   */
  const countEntries = async (threadId) => {
    return conn.count('thread_entry', { thread_id: threadId });
  };

  // ── Thread Events ────────────────────────────────────────────

  /**
   * Find events for a thread.
   * @param {number|string} threadId - The thread id
   * @returns {Promise<Array<Object>>} Array of thread_event rows
   * @example
   * const events = await threads.findEvents(7);
   */
  const findEvents = async (threadId) => {
    return conn.find('thread_event', {
      where: { thread_id: threadId },
      orderBy: 'id ASC',
    });
  };

  /**
   * Create a new thread event.
   * @param {Object} data - Column values (must include thread_id)
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const evt = await threads.createEvent({ thread_id: 7, event_id: 1, staff_id: 2 });
   */
  const createEvent = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table('thread_event')} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, id: result.insertId };
  };

  // ── Thread Collaborators ─────────────────────────────────────

  /**
   * Find collaborators for a thread.
   * @param {number|string} threadId - The thread id
   * @returns {Promise<Array<Object>>} Array of thread_collaborator rows
   * @example
   * const collabs = await threads.findCollaborators(7);
   */
  const findCollaborators = async (threadId) => {
    return conn.find('thread_collaborator', {
      where: { thread_id: threadId },
    });
  };

  return {
    find,
    findById,
    findByObject,
    count,
    create,
    update,
    remove,
    findEntries,
    createEntry,
    countEntries,
    findEvents,
    createEvent,
    findCollaborators,
  };
};
