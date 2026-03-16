/**
 * PKCE (Proof Key for Code Exchange) Utilities
 */

const crypto = require('crypto');

/**
 * Verify a PKCE S256 challenge against a code verifier.
 * challenge must equal base64url(sha256(verifier))
 */
const verifyChallenge = (verifier, challenge) => {
  const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
  return hash === challenge;
};

module.exports = { verifyChallenge };
