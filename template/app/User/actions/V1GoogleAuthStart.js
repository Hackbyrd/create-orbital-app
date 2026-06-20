/**
 * USER V1GoogleAuthStart ACTION
 */

'use strict';

// ENV variables
const { GOOGLE_REDIRECT_URI_WEB } = process.env;

// built-in node modules
const crypto = require('crypto');

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md

// services
const lang = require('../../../services/language'); // internationalization
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis'); // Redis client for OAuth state storage
const { generateGoogleAuthUrl } = require('../../../services/google'); // auth-only Google helpers

// models
const models = require('../../../models');

// the Redis key prefix + TTL (seconds) for a pending OAuth state (CSRF token)
const GOOGLE_OAUTH_STATE_PREFIX = 'google_oauth_state:';
const GOOGLE_OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// methods
module.exports = {
  V1GoogleAuthStart
}

/**
 * Start the "Sign in with Google" flow — returns the Google consent URL to redirect the browser to.
 *
 * GET  /v1/users/googleauthstart
 * POST /v1/users/googleauthstart
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged out (this is a login flow — nobody is authenticated yet).
 * Roles: []
 *
 * req.params = {}
 * req.args = {}
 *
 * Flow: FE calls this → redirects the browser to authorizationUrl → Google redirects back to the FE
 * callback (GOOGLE_REDIRECT_URI_WEB) with ?code&state → FE posts code+state to V1GoogleLogin.
 *
 * Success: Return { status: 200, success: true, authorizationUrl }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   500: INTERNAL_SERVER_ERROR
 *
 * !NOTE: A random state (CSRF token) is stored in Redis with a 10-minute expiry and validated in V1GoogleLogin.
 */
async function V1GoogleAuthStart(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({});

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value; // arguments are updated and variable types are converted to correct type. ex. '5' -> 5, 'true' -> true

  try {
    const redirectUri = GOOGLE_REDIRECT_URI_WEB;

    // random, opaque CSRF token tying the start of the flow to its completion
    const state = crypto.randomBytes(32).toString('hex');

    // store the pending state in Redis (validated + deleted in V1GoogleLogin); expires in 10 minutes
    await redisClient.setEx(`${GOOGLE_OAUTH_STATE_PREFIX}${state}`, GOOGLE_OAUTH_STATE_TTL_SECONDS, JSON.stringify({
      redirectUri,
      createdAt: new Date().toISOString()
    }));

    // build the Google consent URL (identity scopes only)
    const authorizationUrl = generateGoogleAuthUrl({ redirectUri, state });

    return {
      status: 200,
      success: true,
      authorizationUrl
    };
  } catch (error) {
    throw error;
  }
} // END V1GoogleAuthStart
