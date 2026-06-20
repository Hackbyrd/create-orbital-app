'use strict'

const fs = require('fs')
const path = require('path')

const CLAUDE_SERVICE = `'use strict'

const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function chat({ system, messages, model = 'claude-sonnet-4-6', maxTokens = 4096 }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
  })

  return response.content.find((b) => b.type === 'text')?.text ?? ''
} // END chat

async function streamChat({ system, messages, model = 'claude-sonnet-4-6', maxTokens = 4096, onChunk }) {
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onChunk(event.delta.text)
    }
  }
} // END streamChat

module.exports = { chat, streamChat }
`

async function applyAnthropic(targetDir) {
  // 1. Write services/claude.js
  const servicesDir = path.join(targetDir, 'services')
  fs.mkdirSync(servicesDir, { recursive: true })
  fs.writeFileSync(path.join(servicesDir, 'claude.js'), CLAUDE_SERVICE)

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template')
  fs.appendFileSync(envTemplatePath, '\nANTHROPIC_API_KEY=\n')

  // 3. Append @anthropic-ai/sdk to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  packageJson.dependencies = packageJson.dependencies || {}
  packageJson.dependencies['@anthropic-ai/sdk'] = '0.52.0'
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
} // END applyAnthropic

module.exports = { applyAnthropic }
