# create-orbital-app

Scaffold a new [Orbital Express](https://github.com/orbital-express/orbital-express) API project in seconds.

## Usage

```bash
npx create-orbital-app my-api
```

Then follow the interactive prompts to configure:
- Auth providers (Email/Password, Google, Microsoft, Apple, GitHub, Facebook)
- Email provider (Nodemailer, SendGrid, Mailgun, Postmark, AWS SES)
- Integrations (Stripe, Twilio, AWS S3, Cloudflare R2, AI)
- Optional: Admin portal, Socket.IO real-time

## What you get

A fully wired Node.js + Express + PostgreSQL + Redis API with:
- Feature-folder architecture (Django + Rails hybrid)
- JWT access + refresh token auth
- Background jobs (Bull queue)
- i18n support
- Integration tests with Jest
- AI agent skills (.claude/skills/)

## Getting started after scaffolding

```bash
cd my-api
cp config/.env.template config/.env.development
# Fill in your database URL, JWT secrets, etc.
yarn migrate
yarn s        # start web server
yarn w        # start worker (separate terminal)
```

## Documentation

→ [Orbital Express Docs](https://orbital-express.github.io/orbital-express)
