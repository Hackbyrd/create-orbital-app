'use strict'

const fs = require('fs')
const path = require('path')

async function applyPostmark(targetDir) {
  // 1. Overwrite services/email.js with Postmark implementation
  const emailServicePath = path.join(targetDir, 'services', 'email.js')
  const emailServiceContent = `'use strict'

const postmark = require('postmark')

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)

async function send({ to, subject, htmlBody, textBody, tag } = {}) {
  return client.sendEmail({
    From: process.env.EMAIL_FROM,
    To: to,
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: textBody,
    Tag: tag,
    MessageStream: 'outbound',
  })
} // END send

module.exports = { send }
`
  fs.writeFileSync(emailServicePath, emailServiceContent)

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template')
  const envAdditions = `\nPOSTMARK_SERVER_TOKEN=\nEMAIL_FROM=\n`
  fs.appendFileSync(envTemplatePath, envAdditions)

  // 3. Append postmark to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  if (!packageJson.dependencies) packageJson.dependencies = {}
  packageJson.dependencies['postmark'] = '4.0.5'
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
} // END applyPostmark

module.exports = { applyPostmark }
