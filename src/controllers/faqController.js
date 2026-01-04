/**
 * FAQ Controller
 */

const db = require('../lib/db');
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

  let sql = `
    SELECT f.*, c.name as category_name
    FROM ${db.table('faq')} f
    LEFT JOIN ${db.table('faq_category')} c ON f.category_id = c.category_id
    WHERE f.ispublished = 1
  `;
  const params = [];

  // Only show FAQs in public categories for non-staff
  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND (c.ispublic = 1 OR c.category_id IS NULL)`;
  }

  if (category_id) {
    sql += ` AND f.category_id = ?`;
    params.push(category_id);
  }

  if (search) {
    sql += ` AND (f.question LIKE ? OR f.answer LIKE ? OR f.keywords LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY f.question LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const faqs = await db.query(sql, params);

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
      updated: f.updated
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * List FAQ categories
 */
const listCategories = async (req, res) => {
  let sql = `
    SELECT c.*,
           (SELECT COUNT(*) FROM ${db.table('faq')} f WHERE f.category_id = c.category_id AND f.ispublished = 1) as faq_count
    FROM ${db.table('faq_category')} c
    WHERE 1=1
  `;
  const params = [];

  // Only show public categories for non-staff
  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND c.ispublic = 1`;
  }

  sql += ` ORDER BY c.name`;

  const categories = await db.query(sql, params);

  res.json({
    success: true,
    data: categories.map(c => ({
      category_id: c.category_id,
      category_pid: c.category_pid,
      name: c.name,
      description: c.description,
      ispublic: !!c.ispublic,
      faqCount: parseInt(c.faq_count || 0, 10),
      created: c.created
    }))
  });
};

/**
 * Get FAQ article
 */
const get = async (req, res) => {
  const { id } = req.params;

  const faq = await db.queryOne(`
    SELECT f.*, c.name as category_name, c.ispublic as category_ispublic
    FROM ${db.table('faq')} f
    LEFT JOIN ${db.table('faq_category')} c ON f.category_id = c.category_id
    WHERE f.faq_id = ?
  `, [id]);

  if (!faq) {
    throw ApiError.notFound('FAQ article not found');
  }

  // Check visibility for non-staff
  if ((!req.auth || req.auth.type === 'user')) {
    if (!faq.ispublished || (faq.category_id && !faq.category_ispublic)) {
      throw ApiError.notFound('FAQ article not found');
    }
  }

  // Get related topics
  const topics = await db.query(`
    SELECT ht.topic_id, ht.topic
    FROM ${db.table('faq_topic')} ft
    JOIN ${db.table('help_topic')} ht ON ft.topic_id = ht.topic_id
    WHERE ft.faq_id = ?
  `, [id]);

  res.json({
    success: true,
    data: {
      faq_id: faq.faq_id,
      category: faq.category_id ? {
        category_id: faq.category_id,
        name: faq.category_name
      } : null,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords,
      ispublished: !!faq.ispublished,
      notes: faq.notes,
      topics: topics.map(t => ({
        topic_id: t.topic_id,
        topic: t.topic
      })),
      created: faq.created,
      updated: faq.updated
    }
  });
};

module.exports = {
  list,
  listCategories,
  get
};
