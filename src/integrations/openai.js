'use strict'

const fs = require('fs')
const path = require('path')

const OPENAI_SERVICE = `'use strict'

const OpenAI = require('openai')

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function chat({ system, messages, model = 'gpt-4o', maxTokens = 4096 }) {
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
  })

  return response.choices[0].message.content
} // END chat

async function streamChat({ system, messages, model = 'gpt-4o', maxTokens = 4096, onChunk }) {
  const stream = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) onChunk(text)
  }
} // END streamChat

module.exports = { chat, streamChat }
`

async function applyOpenAI(targetDir) {
  // 1. Write services/openai.js
  const servicesDir = path.join(targetDir, 'services')
  fs.mkdirSync(servicesDir, { recursive: true })
  fs.writeFileSync(path.join(servicesDir, 'openai.js'), OPENAI_SERVICE)

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template')
  fs.appendFileSync(envTemplatePath, '\nOPENAI_API_KEY=\n')

  // 3. Append openai to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  packageJson.dependencies = packageJson.dependencies || {}
  packageJson.dependencies['openai'] = '4.100.0'
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
} // END applyOpenAI

module.exports = { applyOpenAI }
