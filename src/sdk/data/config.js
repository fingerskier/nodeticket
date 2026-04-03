/**
 * Configuration data access
 * @module sdk/data/config
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Config data operations
 */
module.exports = (conn) => {
  const TABLE = 'config';

  /**
   * Get a single configuration value.
   * @param {string} key - The config key
   * @param {string} [namespace='core'] - The config namespace
   * @returns {Promise<string|null>} The config value or null if not found
   * @example
   * const siteName = await config.get('helpdesk_title', 'core');
   */
  const get = async (key, namespace = 'core') => {
    return conn.queryValue(
      `SELECT value FROM ${conn.table(TABLE)} WHERE \`key\` = ? AND namespace = ?`,
      [key, namespace],
    );
  };

  /**
   * Get all configuration values in a namespace.
   * @param {string} [namespace='core'] - The config namespace
   * @returns {Promise<Array<Object>>} Array of { key, value } rows
   * @example
   * const coreConfig = await config.getAll('core');
   */
  const getAll = async (namespace = 'core') => {
    return conn.query(
      `SELECT \`key\`, value FROM ${conn.table(TABLE)} WHERE namespace = ?`,
      [namespace],
    );
  };

  /**
   * Set (upsert) a configuration value. Inserts if the key does not exist,
   * updates if it does.
   * @param {string} key - The config key
   * @param {string} value - The config value
   * @param {string} [namespace='core'] - The config namespace
   * @returns {Promise<void>}
   * @example
   * await config.set('helpdesk_title', 'My Help Desk', 'core');
   */
  const set = async (key, value, namespace = 'core') => {
    const existing = await conn.queryOne(
      `SELECT \`key\` FROM ${conn.table(TABLE)} WHERE \`key\` = ? AND namespace = ?`,
      [key, namespace],
    );

    if (existing) {
      await conn.query(
        `UPDATE ${conn.table(TABLE)} SET value = ? WHERE \`key\` = ? AND namespace = ?`,
        [value, key, namespace],
      );
    } else {
      await conn.query(
        `INSERT INTO ${conn.table(TABLE)} (\`key\`, value, namespace) VALUES (?, ?, ?)`,
        [key, value, namespace],
      );
    }
  };

  return { get, getAll, set };
};
