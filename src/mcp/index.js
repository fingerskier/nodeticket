/**
 * MCP Router
 *
 * Mounts OAuth and MCP StreamableHTTP endpoints.
 */

const { Router } = require('express');
const registerRouter = require('./oauth/register');
const authorizeRouter = require('./oauth/authorize');
const tokenRouter = require('./oauth/token');
const { validateMcpJwt, handlePost, handleGet, handleDelete } = require('./transport');

const router = Router();

// OAuth endpoints (no MCP JWT required)
router.use('/oauth/register', registerRouter);
router.use('/oauth/authorize', authorizeRouter);
router.use('/oauth/token', tokenRouter);

// MCP StreamableHTTP endpoints (JWT required)
router.post('/', validateMcpJwt, handlePost);
router.get('/', validateMcpJwt, handleGet);
router.delete('/', validateMcpJwt, handleDelete);

module.exports = router;
