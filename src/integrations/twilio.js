'use strict';

const fs = require('fs');
const path = require('path');

async function applyTwilio(targetDir) {

  // 1. Write services/phone.js
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }

  const phoneService = `'use strict';

// services/phone.js — Twilio SMS service

const twilio = require('twilio');
const redis = require('./redis');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSMS(to, body) {
  const message = await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
  return message;
} // END sendSMS

async function sendVerificationCode(to) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const key = \`phone:verify:\${to}\`;

  await redis.set(key, code, 'EX', 600);

  await sendSMS(to, \`Your verification code is: \${code}\`);

  return code;
} // END sendVerificationCode

async function verifyCode(to, code) {
  const key = \`phone:verify:\${to}\`;
  const stored = await redis.get(key);

  if (!stored || stored !== code) {
    return false;
  }

  await redis.del(key);
  return true;
} // END verifyCode

module.exports = {
  sendSMS,
  sendVerificationCode,
  verifyCode,
};
`;

  fs.writeFileSync(path.join(servicesDir, 'phone.js'), phoneService);

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  const envAdditions = `
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
`;

  fs.appendFileSync(envTemplatePath, envAdditions);

  // 3. Append twilio to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies['twilio'] = '5.4.5';
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  }

} // END applyTwilio

module.exports = { applyTwilio };
