/**
 * Minimal XML → object parser for stock osTicket ticket create payloads.
 *
 * Supports:
 *   <ticket>…</ticket> wrapper (optional)
 *   Scalar elements: name, email, subject, message, topicId, source, …
 *   <message type="text/html">body</message>
 *   <attachments><file name="a.txt" type="text/plain">base64…</file></attachments>
 *
 * @module lib/legacyTicketXml
 */

/**
 * Parse ticket XML string into a plain object compatible with parseLegacyCreateBody.
 * @param {string} xml
 * @returns {{ ok: true, data: Object } | { ok: false, message: string }}
 */
function parseTicketXml(xml) {
  if (!xml || typeof xml !== 'string' || !xml.trim()) {
    return { ok: false, message: 'Unable to read request body' };
  }

  let text = xml.replace(/^\uFEFF/, '').trim();
  // Strip XML declaration and comments
  text = text.replace(/<\?xml[^?]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trim();

  let root;
  try {
    root = parseElement(text);
  } catch (err) {
    return { ok: false, message: err.message || 'Invalid XML' };
  }

  if (!root) {
    return { ok: false, message: 'Invalid XML' };
  }

  // Unwrap <ticket> root if present
  let node = root;
  if (root.name.toLowerCase() === 'ticket') {
    node = { name: 'ticket', attrs: {}, children: root.children, text: root.text };
  } else if (root.name.toLowerCase() !== 'ticket' && root.children.length === 1
    && root.children[0].name.toLowerCase() === 'ticket') {
    node = root.children[0];
  }

  const data = flattenTicketNode(node);
  return { ok: true, data };
}

/**
 * Flatten a ticket element tree into create fields.
 * @param {Object} node
 * @returns {Object}
 */
function flattenTicketNode(node) {
  const out = {};
  const attachments = [];

  for (const child of node.children || []) {
    const key = child.name;
    const lower = key.toLowerCase();

    if (lower === 'attachments') {
      for (const file of child.children || []) {
        if (file.name.toLowerCase() !== 'file') continue;
        const name = file.attrs.name || file.attrs.Name || 'attachment';
        const type = file.attrs.type || file.attrs.Type || 'application/octet-stream';
        const encoding = (file.attrs.encoding || file.attrs.Encoding || 'base64').toLowerCase();
        const raw = (file.text || '').trim();
        attachments.push({
          name,
          type,
          encoding,
          data: raw,
        });
      }
      continue;
    }

    if (lower === 'message') {
      // Prefer text content; type attr ignored for body string
      out.message = (child.text || '').trim();
      // Nested <body> style
      if (!out.message && child.children?.length) {
        const bodyChild = child.children.find((c) => c.name.toLowerCase() === 'body');
        out.message = (bodyChild?.text || child.children.map((c) => c.text).join('')).trim();
      }
      continue;
    }

    // Scalar value
    const val = (child.text || '').trim();
    if (lower === 'topicid') out.topicId = val;
    else if (lower === 'priorityid') out.priorityId = val;
    else if (lower === 'staffid') out.staffId = val;
    else if (lower === 'slaid') out.slaId = val;
    else if (lower === 'duedate') out.duedate = val;
    else if (lower === 'alert') out.alert = !/^(false|0|no)$/i.test(val);
    else if (lower === 'autorespond') out.autorespond = !/^(false|0|no)$/i.test(val);
    else out[key] = val; // name, email, subject, source, ip, phone, notes
  }

  if (attachments.length) out.attachments = attachments;
  return out;
}

/**
 * Very small recursive XML element parser (no DTD/entities/namespaces).
 * @param {string} input
 * @returns {Object|null}
 */
function parseElement(input) {
  const s = input.trim();
  const open = s.match(/^<([A-Za-z_][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>/);
  if (!open) {
    throw new Error('Invalid XML: expected opening tag');
  }

  const name = open[1];
  const attrs = parseAttrs(open[2] || '');
  const selfClosing = open[3] === '/' || /\/\s*$/.test(open[2] || '');
  let rest = s.slice(open[0].length);

  if (selfClosing) {
    return { name, attrs, children: [], text: '' };
  }

  const children = [];
  let textParts = [];

  while (rest.length) {
    // Closing tag
    const closeRe = new RegExp(`^</${escapeRegExp(name)}\\s*>`, 'i');
    const closeMatch = rest.match(closeRe);
    if (closeMatch) {
      rest = rest.slice(closeMatch[0].length);
      return {
        name,
        attrs,
        children,
        text: textParts.join('').replace(/\s+/g, ' ').trim(),
        _rest: rest,
      };
    }

    // Nested element
    if (rest[0] === '<' && rest[1] !== '!' && rest[1] !== '?') {
      if (rest.startsWith('</')) {
        throw new Error(`Invalid XML: unexpected close near ${rest.slice(0, 40)}`);
      }
      const child = parseElement(rest);
      children.push(child);
      rest = child._rest || '';
      delete child._rest;
      continue;
    }

    // Text until next tag
    const next = rest.indexOf('<');
    if (next === -1) {
      textParts.push(rest);
      throw new Error(`Invalid XML: unclosed <${name}>`);
    }
    textParts.push(rest.slice(0, next));
    rest = rest.slice(next);
  }

  throw new Error(`Invalid XML: unclosed <${name}>`);
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str || ''))) {
    attrs[m[1]] = m[2] != null ? m[2] : m[3];
  }
  return attrs;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse full document — returns first root element object for tests.
 * @param {string} xml
 */
function parseXmlRoot(xml) {
  return parseElement(xml.replace(/^\uFEFF/, '').replace(/<\?xml[^?]*\?>/i, '').trim());
}

module.exports = {
  parseTicketXml,
  parseXmlRoot,
  flattenTicketNode,
};
