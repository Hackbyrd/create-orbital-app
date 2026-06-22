'use strict';

const inquirer = require('inquirer');

async function runPrompts({ projectName } = {}) {
  const defaultDbName = (projectName || 'my_api').replace(/-/g, '_') + '_dev';

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'databaseName',
      message: 'Database name:',
      default: defaultDbName,
      validate: (input) => input.trim().length > 0 || 'Database name is required',
    },
    {
      type: 'confirm',
      name: 'includeAdmin',
      message: 'Include Admin user type?',
      default: true,
    },
    {
      type: 'checkbox',
      name: 'authProviders',
      message: 'Auth providers:',
      choices: [
        { name: 'Email + Password', value: 'email', checked: true, disabled: 'always included' },
        { name: 'Google OAuth',             value: 'google' },
        { name: 'Microsoft / Outlook OAuth', value: 'microsoft' },
        { name: 'Apple Sign In',            value: 'apple' },
        { name: 'GitHub OAuth',             value: 'github' },
        { name: 'Facebook OAuth',           value: 'facebook' },
      ],
    },
    {
      type: 'list',
      name: 'emailProvider',
      message: 'Email provider:',
      choices: [
        { name: 'Nodemailer/SMTP (default)', value: 'nodemailer' },
        { name: 'SendGrid',                  value: 'sendgrid' },
        { name: 'Mailgun',                   value: 'mailgun' },
        { name: 'Postmark',                  value: 'postmark' },
        { name: 'AWS SES',                   value: 'aws-ses' },
      ],
      default: 'nodemailer',
    },
    {
      type: 'checkbox',
      name: 'integrations',
      message: 'Additional integrations:',
      choices: [
        { name: 'Socket.IO / Real-time',    value: 'socketio', checked: true },
        { name: 'Stripe (Payments)',         value: 'stripe' },
        { name: 'AWS S3 (File storage)',     value: 'aws-s3' },
        { name: 'Twilio (SMS)',              value: 'twilio' },
        { name: 'Cloudflare R2 (Storage)',   value: 'cloudflare-r2' },
        { name: 'Anthropic Claude (AI)',     value: 'anthropic' },
        { name: 'OpenAI (AI)',               value: 'openai' },
      ],
    },
    {
      type: 'confirm',
      name: 'installDependencies',
      message: 'Run yarn install now?',
      default: true,
    },
  ]);

  // email is always included
  if (!answers.authProviders.includes('email')) {
    answers.authProviders = ['email', ...answers.authProviders];
  }

  return answers;
} // END runPrompts

module.exports = { runPrompts };
