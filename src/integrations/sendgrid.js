'use strict';

const fs = require('fs');
const path = require('path');

const SENDGRID_EMAIL_SERVICE = `'use strict';

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function send({ to, from, subject, html, text }) {
  const msg = {
    to,
    from: from || process.env.EMAIL_FROM,
    subject,
    html,
    text,
  };
  await sgMail.send(msg);
} // END send

module.exports = { send };
`;

const SENDGRID_ENV_VARS = `
SENDGRID_API_KEY=
EMAIL_FROM=noreply@yourdomain.com
`;

async function applySendGrid(targetDir) {
  // 1. Overwrite services/email.js with SendGrid implementation
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(servicesDir, 'email.js'), SENDGRID_EMAIL_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, SENDGRID_ENV_VARS);

  // 3. Append @sendgrid/mail to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['@sendgrid/mail'] = '8.1.4';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
} // END applySendGrid

module.exports = { applySendGrid };
