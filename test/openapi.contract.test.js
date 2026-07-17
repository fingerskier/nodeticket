/**
 * Smoke checks that docs/openapi.json covers live surface highlights.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const openapi = require('../docs/openapi.json');

describe('openapi.json contract', () => {
  test('is OpenAPI 3 with package-aligned version', () => {
    assert.equal(openapi.openapi, '3.0.3');
    assert.ok(openapi.info?.version);
    assert.ok(Object.keys(openapi.paths || {}).length >= 50);
  });

  test('documents native ticket attachments and locks', () => {
    assert.ok(openapi.paths['/tickets/{id}/attachments']?.get);
    assert.ok(openapi.paths['/tickets/{id}/attachments']?.post);
    assert.ok(openapi.paths['/tickets/{id}/attachments/{fileId}']?.get);
    assert.ok(openapi.paths['/tickets/{id}/lock']?.get);
    assert.ok(openapi.paths['/tickets/{id}/lock']?.post);
    assert.ok(openapi.paths['/tickets/{id}/lock/release']?.post);
  });

  test('documents FAQ write and settings', () => {
    assert.ok(openapi.paths['/faq']?.post);
    assert.ok(openapi.paths['/faq/{id}']?.put);
    assert.ok(openapi.paths['/faq/{id}']?.delete);
    assert.ok(openapi.paths['/settings']?.get);
    assert.ok(openapi.paths['/settings']?.put);
  });

  test('documents official FOSS API under absolute /api paths', () => {
    assert.ok(openapi.paths['/api/tickets.json']?.post);
    assert.ok(openapi.paths['/api/tickets.xml']?.post);
    assert.ok(openapi.paths['/api/tickets.email']?.post);
    assert.ok(openapi.paths['/api/tasks/cron']?.post);
  });

  test('security schemes include bearer, cookie, api key, csrf', () => {
    const s = openapi.components?.securitySchemes || {};
    assert.ok(s.bearerAuth);
    assert.ok(s.cookieAuth);
    assert.ok(s.apiKey);
    assert.ok(s.csrfHeader);
  });
});
