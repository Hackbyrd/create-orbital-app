'use strict';

const inquirer = require('inquirer');

async function runPrompts(argv = {}) {
  const defaultProjectName = (argv._ && argv._[0]) || argv.name || 'my-api';

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: defaultProjectName,
      validate: (input) => input.trim().length > 0 || 'Project name is required',
    },
    {
      type: 'input',
      name: 'databaseName',
      message: 'Database name:',
      default: (ans) => ans.projectName.replace(/-/g, '_') + '_dev',
      validate: (input) => input.trim().length > 0 || 'Database name is required',
    },
    {
      type: 'confirm',
      name: 'includeAdmin',
      message: 'Include Admin portal?',
      default: true,
    },
    {
      type: 'checkbox',
      name: 'authProviders',
      message: 'Auth providers:',
      choices: [
        {
          name: 'Email + Password',
          value: 'email',
          checked: true,
          disabled: 'always included',
        },
        {
          name: 'Google OAuth',
          value: 'google',
        },
        {
          name: 'Microsoft / Outlook OAuth',
          value: 'microsoft',
        },
        {
          name: 'Apple Sign In',
          value: 'apple',
        },
        {
          name: 'GitHub OAuth',
          value: 'github',
        },
        {
          name: 'Facebook OAuth',
          value: 'facebook',
        },
      ],
    },
    {
      type: 'list',
      name: 'emailProvider',
      message: 'Email provider:',
      choices: [
        { name: 'Nodemailer/SMTP', value: 'nodemailer' },
        { name: 'SendGrid', value: 'sendgrid' },
        { name: 'Mailgun', value: 'mailgun' },
        { name: 'Postmark', value: 'postmark' },
        { name: 'AWS SES', value: 'aws-ses' },
      ],
      default: 'nodemailer',
    },
    {
      type: 'checkbox',
      name: 'integrations',
      message: 'Additional integrations:',
      choices: [
        { name: 'Socket.IO / Real-time', value: 'socketio', checked: true },
        { name: 'Twilio (SMS)', value: 'twilio' },
        { name: 'Stripe (Payments)', value: 'stripe' },
        { name: 'AWS S3 (File storage)', value: 'aws-s3' },
        { name: 'Cloudflare R2 (File storage)', value: 'cloudflare-r2' },
        { name: 'Anthropic Claude (AI)', value: 'anthropic' },
        { name: 'OpenAI (AI)', value: 'openai' },
      ],
    },
    {
      type: 'confirm',
      name: 'installDependencies',
      message: 'Install dependencies now?',
      default: true,
    },
  ]);

  // Ensure email is always included in authProviders
  if (!answers.authProviders.includes('email')) {
    answers.authProviders = ['email', ...answers.authProviders];
  }

  return answers;
} // END runPrompts

module.exports = { runPrompts };
