'use strict'

const { applyGoogleOAuth } = require('./google-oauth')
const { applyMicrosoftOAuth } = require('./microsoft-oauth')
const { applyAppleOAuth } = require('./apple-oauth')
const { applyGitHubOAuth } = require('./github-oauth')
const { applyFacebookOAuth } = require('./facebook-oauth')
const { applySendGrid } = require('./sendgrid')
const { applyMailgun } = require('./mailgun')
const { applyPostmark } = require('./postmark')
const { applyAWSSES } = require('./aws-ses')
const { applyStripe } = require('./stripe')
const { applyTwilio } = require('./twilio')
const { applyAWSS3 } = require('./aws-s3')
const { applyCloudflareR2 } = require('./cloudflare-r2')
const { applyAnthropic } = require('./anthropic')
const { applyOpenAI } = require('./openai')

module.exports = {
  applyGoogleOAuth,
  applyMicrosoftOAuth,
  applyAppleOAuth,
  applyGitHubOAuth,
  applyFacebookOAuth,
  applySendGrid,
  applyMailgun,
  applyPostmark,
  applyAWSSES,
  applyStripe,
  applyTwilio,
  applyAWSS3,
  applyCloudflareR2,
  applyAnthropic,
  applyOpenAI,
}
