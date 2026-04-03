/**
 * FAQ Controller — thin HTTP adapter
 *
 * FAQs don't have a dedicated SDK service. Complex queries with
 * visibility checks use the SDK connection for table prefixing.
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Helper to build pagination
 */
const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * List FAQ articles
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { category_id, search } = req.query;
  const conn = getSdk().connection;

  let sql = `
    SELECT f.*, c.name as category_name
    FROM ${conn.table('faq')} f
    LEFT JOIN ${conn.table('faq_category')} c ON f.category_id = c.category_id
    WHERE f.ispublished = 1
  `;
  const params = [];

  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND (c.ispublic = 1 OR c.category_id IS NULL)`;
  }

  if (category_id) {
    sql += ` AND f.category_id = ?`;
    params.push(category_id);
  }

  if (search) {
    sql += ` AND (f.question LIKE ? OR f.answer LIKE ? OR f.keywords LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
  const countResult = await conn.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  sql += ` ORDER BY f.question LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const faqs = await conn.query(sql, params);

  res.json({
    success: true,
    data: faqs.map(f => ({
      faq_id: f.faq_id,
      category_id: f.category_id,
      category: f.category_name ? { category_id: f.category_id, name: f.category_name } : null,
      question: f.question,
      answer: f.answer,
      keywords: f.keywords,
      ispublished: !!f.ispublished,
      created: f.created,
      updated: f.updated,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

/**
 * List FAQ categories
 */
const listCategories = async (req, res) => {
  const conn = getSdk().connection;

  let sql = `
    SELECT c.*,
           (SELECT COUNT(*) FROM ${conn.table('faq')} f WHERE f.category_id = c.category_id AND f.ispublished = 1) as faq_count
    FROM ${conn.table('faq_category')} c
    WHERE 1=1
  `;
  const params = [];

  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND c.ispublic = 1`;
  }

  sql += ` ORDER BY c.name`;

  const categories = await conn.query(sql, params);

  res.json({
    success: true,
    data: categories.map(c => ({
      category_id: c.category_id,
      category_pid: c.category_pid,
      name: c.name,
      description: c.description,
      ispublic: !!c.ispublic,
      faqCount: parseInt(c.faq_count || 0, 10),
      created: c.created,
    })),
  });
};

/**
 * Get FAQ article
 */
const get = async (req, res) => {
  const { id } = req.params;
  const conn = getSdk().connection;

  const faq = await conn.queryOne(`
    SELECT f.*, c.name as category_name, c.ispublic as category_ispublic
    FROM ${conn.table('faq')} f
    LEFT JOIN ${conn.table('faq_category')} c ON f.category_id = c.category_id
    WHERE f.faq_id = ?
  `, [id]);

  if (!faq) throw ApiError.notFound('FAQ article not found');

  // Check visibility for non-staff
  if ((!req.auth || req.auth.type === 'user')) {
    if (!faq.ispublished || (faq.category_id && !faq.category_ispublic)) {
      throw ApiError.notFound('FAQ article not found');
    }
  }

  const topics = await conn.query(`
    SELECT ht.topic_id, ht.topic
    FROM ${conn.table('faq_topic')} ft
    JOIN ${conn.table('help_topic')} ht ON ft.topic_id = ht.topic_id
    WHERE ft.faq_id = ?
  `, [id]);

  res.json({
    success: true,
    data: {
      faq_id: faq.faq_id,
      category: faq.category_id ? { category_id: faq.category_id, name: faq.category_name } : null,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords,
      ispublished: !!faq.ispublished,
      notes: faq.notes,
      topics: topics.map(t => ({ topic_id: t.topic_id, topic: t.topic })),
      created: faq.created,
      updated: faq.updated,
    },
  });
};

module.exports = {
  list,
  listCategories,
  get,
};
