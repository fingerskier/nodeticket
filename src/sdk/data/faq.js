/**
 * FAQ data access (faq, faq_category)
 * @module sdk/data/faq
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} FAQ data operations
 */
module.exports = (conn) => {
  const TABLE = 'faq';
  const PK = 'faq_id';

  // ── FAQ CRUD ─────────────────────────────────────────────────

  /**
   * Find FAQs matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of FAQ rows
   * @example
   * const faqs = await faq.find({ where: { ispublished: 1 }, limit: 20 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find an FAQ by primary key.
   * @param {number|string} id - The faq_id
   * @returns {Promise<Object|null>} FAQ row or null
   * @example
   * const item = await faq.findById(6);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count FAQs matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await faq.count({ ispublished: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new FAQ.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with faq_id
   * @example
   * const item = await faq.create({ category_id: 2, question: 'How?', answer: 'Like this.' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update an FAQ by primary key.
   * @param {number|string} id - The faq_id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await faq.update(6, { answer: 'Updated answer.' });
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
   * Delete an FAQ by primary key.
   * @param {number|string} id - The faq_id
   * @returns {Promise<void>}
   * @example
   * await faq.remove(6);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  // ── FAQ Categories ───────────────────────────────────────────

  /**
   * Find all FAQ categories.
   * @returns {Promise<Array<Object>>} Array of faq_category rows
   * @example
   * const categories = await faq.findCategories();
   */
  const findCategories = async () => {
    return conn.find('faq_category', {});
  };

  /**
   * Find FAQs belonging to a specific category.
   * @param {number|string} categoryId - The category id
   * @param {Object} [options] - Additional query options
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of FAQ rows in the category
   * @example
   * const faqs = await faq.findByCategory(2, { limit: 10 });
   */
  const findByCategory = async (categoryId, options = {}) => {
    return conn.find(TABLE, {
      where: { category_id: categoryId },
      ...options,
    });
  };

  return { find, findById, count, create, update, remove, findCategories, findByCategory };
};
