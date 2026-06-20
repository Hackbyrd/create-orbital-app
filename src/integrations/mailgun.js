'use strict';

const fs = require('fs');
const path = require('path');

const EMAIL_SERVICE_CONTENT = `'use strict';

const FormData = require('form-data');
const Mailgun = require('mailgun.js');

const mailgun = new Mailgun(FormData);
const client = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
});

const send = async ({ to, subject, html, text }) => {
  const messageData = {
    from: process.env.EMAIL_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };

  return client.messages.create(process.env.MAILGUN_DOMAIN, messageData);
}; // END send

module.exports = { send };
`;

const ENV_ADDITIONS = `
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
EMAIL_FROM=
`;

async function applyMailgun(targetDir) {
  // 1. Overwrite services/email.js
  const emailServicePath = path.join(targetDir, 'services', 'email.js');
  fs.writeFileSync(emailServicePath, EMAIL_SERVICE_CONTENT);

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, ENV_ADDITIONS);

  // 3. Append mailgun.js and form-data to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['mailgun.js'] = '10.2.3';
  packageJson.dependencies['form-data'] = '4.0.1';

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
} // END applyMailgun

module.exports = { applyMailgun };
