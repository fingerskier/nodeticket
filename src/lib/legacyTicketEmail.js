/**
 * MIME email parser for stock POST /api/tickets.email
 * @module lib/legacyTicketEmail
 */

/**
 * Parse a raw RFC822 message into fields for ticket create/reply.
 * @param {string|Buffer} raw
 * @returns {{ ok: true, data: Object } | { ok: false, message: string }}
 */
function parseTicketEmail(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (!text.trim()) {
    return { ok: false, message: 'Unable to read email request' };
  }

  const { headers, body } = splitHeadersBody(text);
  const contentType = headers['content-type'] || 'text/plain';
  const messageId = cleanMessageId(headers['message-id'] || headers['message_id'] || '');
  const inReplyTo = cleanMessageId(headers['in-reply-to'] || '');
  const references = parseReferences(headers['references'] || '');
  const subject = decodeMimeWords(headers['subject'] || '') || '[No Subject]';
  const from = headers['from'] || '';
  const { name, email } = parseFrom(from);

  let message = '';
  const attachments = [];

  if (/multipart\//i.test(contentType)) {
    const boundary = extractBoundary(contentType);
    if (boundary) {
      const parts = splitMultipart(body, boundary);
      for (const part of parts) {
        const { headers: ph, body: pb } = splitHeadersBody(part);
        const pct = ph['content-type'] || 'text/plain';
        const cd = ph['content-disposition'] || '';
        const transfer = (ph['content-transfer-encoding'] || '').toLowerCase();
        const isAttach = /attachment/i.test(cd) || /name=/i.test(pct);

        if (isAttach) {
          const fname =
            extractParam(cd, 'filename') ||
            extractParam(pct, 'name') ||
            'attachment';
          let data = pb.trim();
          if (transfer === 'base64') {
            data = data.replace(/\s+/g, '');
          }
          attachments.push({
            name: fname,
            type: pct.split(';')[0].trim(),
            encoding: transfer === 'base64' ? 'base64' : 'utf8',
            data,
          });
        } else if (/text\/plain/i.test(pct) && !message) {
          message = decodeBody(pb, transfer);
        } else if (/text\/html/i.test(pct) && !message) {
          message = stripHtml(decodeBody(pb, transfer));
        }
      }
    }
  } else {
    const transfer = (headers['content-transfer-encoding'] || '').toLowerCase();
    message = decodeBody(body, transfer);
    if (/text\/html/i.test(contentType)) {
      message = stripHtml(message);
    }
  }

  message = (message || '').trim() || '(no message body)';

  // Ticket number from subject patterns used by osTicket / common mailers
  const ticketNumber = extractTicketNumberFromSubject(subject);

  return {
    ok: true,
    data: {
      email: email || '',
      name: name || email || 'Email User',
      subject,
      message,
      source: 'Email',
      mid: messageId,
      inReplyTo,
      references,
      ticketNumber,
      attachments,
      headers,
    },
  };
}

function splitHeadersBody(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const idx = normalized.search(/\n\n/);
  if (idx === -1) {
    return { headers: parseHeaderBlock(normalized), body: '' };
  }
  return {
    headers: parseHeaderBlock(normalized.slice(0, idx)),
    body: normalized.slice(idx + 2),
  };
}

function parseHeaderBlock(block) {
  const headers = {};
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  let current = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      current = m[1].toLowerCase();
      headers[current] = m[2];
    }
  }
  return headers;
}

function parseFrom(from) {
  // "Name" <email@x.com> or email@x.com
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) {
    return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  }
  const emailMatch = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    return { name: emailMatch[0], email: emailMatch[0] };
  }
  return { name: from.trim(), email: '' };
}

function cleanMessageId(id) {
  return (id || '').replace(/[<>\s]/g, '').trim();
}

function parseReferences(refs) {
  if (!refs) return [];
  return refs
    .split(/\s+/)
    .map(cleanMessageId)
    .filter(Boolean);
}

function extractBoundary(contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return m ? (m[1] || m[2]) : null;
}

function extractParam(header, name) {
  const re = new RegExp(`${name}=(?:"([^"]+)"|([^;\\s]+))`, 'i');
  const m = (header || '').match(re);
  return m ? (m[1] || m[2]) : null;
}

function splitMultipart(body, boundary) {
  const delim = `--${boundary}`;
  const parts = body.split(delim);
  const out = [];
  for (const p of parts) {
    let chunk = p;
    if (chunk.startsWith('--')) break; // end
    if (chunk.startsWith('\n')) chunk = chunk.slice(1);
    if (chunk.startsWith('\r\n')) chunk = chunk.slice(2);
    chunk = chunk.replace(/\n--\s*$/, '').replace(/\r\n--\s*$/, '');
    if (!chunk.trim() || chunk.trim() === '--') continue;
    out.push(chunk);
  }
  return out;
}

function decodeBody(body, transfer) {
  if (!body) return '';
  if (transfer === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return body;
    }
  }
  if (transfer === 'quoted-printable') {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function decodeMimeWords(str) {
  // =?utf-8?B?...?= or =?utf-8?Q?...?=
  return str.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return Buffer.from(data, 'base64').toString('utf8');
      }
      return decodeBody(data.replace(/_/g, ' '), 'quoted-printable');
    } catch {
      return data;
    }
  });
}

/**
 * Extract ticket number from subject: [#12345], [Ticket#12345], Ticket #12345, etc.
 * @param {string} subject
 * @returns {string|null}
 */
function extractTicketNumberFromSubject(subject) {
  if (!subject) return null;
  const patterns = [
    /\[#([A-Za-z0-9-]+)\]/,
    /\[Ticket[#\s]*([A-Za-z0-9-]+)\]/i,
    /Ticket\s*#\s*([A-Za-z0-9-]+)/i,
    /#([A-Za-z0-9-]{3,})\s*$/,
  ];
  for (const re of patterns) {
    const m = subject.match(re);
    if (m) return m[1];
  }
  return null;
}

module.exports = {
  parseTicketEmail,
  extractTicketNumberFromSubject,
  parseFrom,
  cleanMessageId,
};
