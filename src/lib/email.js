/**
 * Email Service - AWS SES
 *
 * Sends emails via AWS SES. Falls back to console logging when AWS credentials
 * are not configured (dev/test environments).
 */

const config = require('../config');

let sesClient = null;

function getSESClient() {
  if (!sesClient) {
    const { SESClient } = require('@aws-sdk/client-ses');
    sesClient = new SESClient({ region: config.email.region });
  }
  return sesClient;
}

/**
 * Send an email via AWS SES.
 *
 * @param {string} to      - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML body content
 * @returns {Promise<string>} Message ID (or mock ID in dev mode)
 */
async function sendEmail(to, subject, htmlBody) {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    // Dev fallback — no AWS credentials configured
    console.log(`[email] DEV MODE — email not sent`);
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body:    ${htmlBody}`);
    return 'mock-message-id';
  }

  const { SendEmailCommand } = require('@aws-sdk/client-ses');
  const client = getSESClient();

  const command = new SendEmailCommand({
    Source: config.email.from,
    Destination: {
      ToAddresses: [to]
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: htmlBody,
          Charset: 'UTF-8'
        }
      }
    }
  });

  const result = await client.send(command);
  return result.MessageId;
}

module.exports = { sendEmail };
