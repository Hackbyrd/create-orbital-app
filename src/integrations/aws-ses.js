'use strict';

const fs = require('fs');
const path = require('path');

const AWS_SES_EMAIL_SERVICE = `'use strict';

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function send({ to, from, subject, html, text }) {
  const command = new SendEmailCommand({
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
    },
    Message: {
      Body: {
        ...(html ? { Html: { Charset: 'UTF-8', Data: html } } : {}),
        ...(text ? { Text: { Charset: 'UTF-8', Data: text } } : {}),
      },
      Subject: { Charset: 'UTF-8', Data: subject },
    },
    Source: from || process.env.EMAIL_FROM,
  });
  await client.send(command);
} // END send

module.exports = { send };
`;

const AWS_SES_ENV_VARS = `
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
EMAIL_FROM=
`;

async function applyAWSSES(targetDir) {
  // 1. Overwrite services/email.js with AWS SES implementation
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(servicesDir, 'email.js'), AWS_SES_EMAIL_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, AWS_SES_ENV_VARS);

  // 3. Append @aws-sdk/client-ses to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['@aws-sdk/client-ses'] = '3.758.0';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
} // END applyAWSSES

module.exports = { applyAWSSES };
