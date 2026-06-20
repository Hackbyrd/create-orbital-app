'use strict';

const fs = require('fs');
const path = require('path');

// ─── services/facebook.js ─────────────────────────────────────────────────────

const FACEBOOK_SERVICE = `'use strict';

// ENV variables
const { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI } = process.env;

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Build the Facebook OAuth authorization URL to redirect the browser to.
 * @param {{ state: string }} opts
 * @returns {string}
 */
function getAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: FACEBOOK_REDIRECT_URI,
    state,
    scope: 'email,public_profile',
    response_type: 'code',
  });
  return \`https://www.facebook.com/dialog/oauth?\${params.toString()}\`;
} // END getAuthorizationUrl

/**
 * Exchange an authorization code for a user access token.
 * @param {string} code - The code returned by Facebook to the redirect URI.
 * @returns {Promise<{ access_token: string, token_type: string, expires_in: number }>}
 */
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    redirect_uri: FACEBOOK_REDIRECT_URI,
    code,
  });

  const response = await fetch(\`\${GRAPH_API_BASE}/oauth/access_token?\${params.toString()}\`);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to exchange Facebook auth code');
  }

  return data; // { access_token, token_type, expires_in }
} // END exchangeCodeForToken

/**
 * Fetch the authenticated user's profile from the Graph API.
 * @param {string} accessToken
 * @returns {Promise<{ id: string, name: string, email: string, first_name: string, last_name: string, picture: { data: { url: string } } }>}
 */
async function getUserInfo(accessToken) {
  const params = new URLSearchParams({
    fields: 'id,name,first_name,last_name,email,picture',
    access_token: accessToken,
  });

  const response = await fetch(\`\${GRAPH_API_BASE}/me?\${params.toString()}\`);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to fetch Facebook user info');
  }

  return data;
} // END getUserInfo

module.exports = { getAuthorizationUrl, exchangeCodeForToken, getUserInfo };
`;

// ─── app/User/actions/V1LoginWithFacebook.js ─────────────────────────────────

const V1_LOGIN_WITH_FACEBOOK = `/**
 * USER V1LoginWithFacebook ACTION
 */

'use strict';

// ENV variables
const { FACEBOOK_REDIRECT_URI } = process.env;

// built-in node modules
const crypto = require('crypto');

// third-party node modules
const joi = require('joi');

// services
const lang = require('../../../services/language');
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis');
const { getAuthorizationUrl } = require('../../../services/facebook');

// models
const models = require('../../../models');

const FACEBOOK_OAUTH_STATE_PREFIX = 'facebook_oauth_state:';
const FACEBOOK_OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// methods
module.exports = {
  V1LoginWithFacebook
};

/**
 * Start the "Login with Facebook" flow — returns the Facebook consent URL to redirect the browser to.
 *
 * GET  /v1/users/loginwithfacebook
 * POST /v1/users/loginwithfacebook
 *
 * Must be logged out.
 * Roles: []
 *
 * req.params = {}
 * req.args = {}
 *
 * Flow: FE calls this → redirects browser to authorizationUrl → Facebook redirects back to
 * FACEBOOK_REDIRECT_URI with ?code&state → FE posts code+state to V1FacebookCallback.
 *
 * Success: Return { status: 200, success: true, authorizationUrl }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1LoginWithFacebook(req, res) {
  const i18n = lang.getLocalI18n();

  const schema = joi.object({});

  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  try {
    // random CSRF token tying the start of the flow to its completion
    const state = crypto.randomBytes(32).toString('hex');

    // store pending state in Redis; validated + deleted in V1FacebookCallback
    await redisClient.setEx(
      \`\${FACEBOOK_OAUTH_STATE_PREFIX}\${state}\`,
      FACEBOOK_OAUTH_STATE_TTL_SECONDS,
      JSON.stringify({ createdAt: new Date().toISOString() })
    );

    const authorizationUrl = getAuthorizationUrl({ state });

    return {
      status: 200,
      success: true,
      authorizationUrl,
    };
  } catch (err) {
    throw err;
  }
} // END V1LoginWithFacebook
`;

// ─── app/User/actions/V1FacebookCallback.js ──────────────────────────────────

const V1_FACEBOOK_CALLBACK = `/**
 * USER V1FacebookCallback ACTION
 */

'use strict';

// ENV variables
const { NODE_ENV, REFRESH_TOKEN_EXPIRES_IN } = process.env;

// third-party node modules
const joi = require('joi');
const moment = require('moment-timezone');

// services
const lang = require('../../../services/language');
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis');
const { exchangeCodeForToken, getUserInfo } = require('../../../services/facebook');

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');

// models
const models = require('../../../models');

const FACEBOOK_OAUTH_STATE_PREFIX = 'facebook_oauth_state:';

// methods
module.exports = {
  V1FacebookCallback
};

/**
 * Complete "Login with Facebook": verify OAuth callback, resolve/create the user, issue session.
 *
 * GET  /v1/users/facebookcallback
 * POST /v1/users/facebookcallback
 *
 * Must be logged out.
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @code  - (STRING - REQUIRED): the authorization code Facebook returned to the callback
 *   @state - (STRING - REQUIRED): the CSRF token from V1LoginWithFacebook (validated against Redis)
 * }
 *
 * Resolution: match by facebookId → else auto-link by verified email → else create a new user.
 *
 * Success: Return { status: 200, success: true, token, refreshToken, user }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_INVALID_FACEBOOK_STATE
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_FACEBOOK_AUTH_FAILED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1FacebookCallback(req, res) {
  const i18n = lang.getLocalI18n();

  const schema = joi.object({
    code: joi.string().trim().required(),
    state: joi.string().trim().required(),
  });

  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  // validate + consume the CSRF state from Redis
  const stateKey = \`\${FACEBOOK_OAUTH_STATE_PREFIX}\${req.args.state}\`;
  const storedState = await redisClient.get(stateKey);
  if (!storedState)
    return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_INVALID_FACEBOOK_STATE);

  await redisClient.del(stateKey).catch(() => null); // best-effort; don't fail the flow

  // exchange code for access token, then fetch user profile
  let facebookProfile = null;
  try {
    const { access_token: accessToken } = await exchangeCodeForToken(req.args.code);
    facebookProfile = await getUserInfo(accessToken);
  } catch (err) {
    console.error('Facebook OAuth handshake failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_FACEBOOK_AUTH_FAILED);
  }

  if (!facebookProfile || !facebookProfile.id || !facebookProfile.email)
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_FACEBOOK_AUTH_FAILED);

  const facebookId = facebookProfile.id;
  const email = facebookProfile.email.toLowerCase().trim();

  const t = await models.db.transaction();

  try {
    // 1. returning Facebook user — match by facebookId
    let user = await models.user.findOne({ where: { facebookId }, transaction: t });

    // 2. existing email/password account — auto-link facebookId to it
    if (!user) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        const linkUpdates = { facebookId };

        if (!userByEmail.isEmailConfirmed) linkUpdates.isEmailConfirmed = true;
        if (facebookProfile.picture?.data?.url && !userByEmail.profileImageUrl)
          linkUpdates.profileImageUrl = facebookProfile.picture.data.url;
        if (facebookProfile.first_name && !userByEmail.firstName)
          linkUpdates.firstName = facebookProfile.first_name;
        if (facebookProfile.last_name && !userByEmail.lastName)
          linkUpdates.lastName = facebookProfile.last_name;

        await userByEmail.update(linkUpdates, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user
    if (!user) {
      user = await models.user.create({
        facebookId,
        email,
        firstName: facebookProfile.first_name || '',
        lastName: facebookProfile.last_name || '',
        profileImageUrl: facebookProfile.picture?.data?.url || null,
        isEmailConfirmed: true,
        isActive: true,
        password: randomString({ len: 32, lowercase: true, uppercase: true, numbers: true, special: true }),
      }, { transaction: t });
    }

    if (!user.isActive || user.deletedAt) {
      await t.rollback();
      return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_ACCOUNT_INACTIVE);
    }

    await user.update({
      loginCount: user.loginCount + 1,
      lastLogin: moment.tz('UTC'),
      lastLoginAt: moment.tz('UTC'),
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  // re-fetch through default scope (excludes sensitive fields)
  const safeUser = await models.user.findOne({ where: { facebookId } });

  const client = resolveClient(req);
  const platform = resolvePlatform(req);
  const token = createAccessToken(safeUser, getTokenAudience('user', client), 'user');

  const { rawRefreshToken } = await issueSession({
    sessionModel: models.userSession,
    ownerKey: 'userId',
    ownerId: safeUser.id,
    client,
    platform,
    userAgent: req.headers['user-agent'] || null,
    ipAddress: req.ip || null,
  });

  res.cookie('jwt-user-refresh', rawRefreshToken, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseDurationMs(REFRESH_TOKEN_EXPIRES_IN),
  });

  return {
    status: 200,
    success: true,
    token,
    refreshToken: rawRefreshToken,
    user: safeUser.dataValues,
  };
} // END V1FacebookCallback
`;

// ─── env additions ────────────────────────────────────────────────────────────

const ENV_ADDITIONS = `
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=
`;

// ─── main apply function ──────────────────────────────────────────────────────

async function applyFacebookOAuth(targetDir) {
  // 1. Write services/facebook.js
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(servicesDir, 'facebook.js'), FACEBOOK_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, ENV_ADDITIONS);

  // 3. Write V1LoginWithFacebook.js and V1FacebookCallback.js
  const actionsDir = path.join(targetDir, 'app', 'User', 'actions');
  if (!fs.existsSync(actionsDir)) {
    fs.mkdirSync(actionsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(actionsDir, 'V1LoginWithFacebook.js'), V1_LOGIN_WITH_FACEBOOK);
  fs.writeFileSync(path.join(actionsDir, 'V1FacebookCallback.js'), V1_FACEBOOK_CALLBACK);

  // 4a. Update app/User/actions/index.js — append the two new exports
  const actionsIndexPath = path.join(actionsDir, 'index.js');
  if (fs.existsSync(actionsIndexPath)) {
    let indexContent = fs.readFileSync(actionsIndexPath, 'utf8');

    const facebookExports = [
      `const { V1LoginWithFacebook } = require('./V1LoginWithFacebook');`,
      `const { V1FacebookCallback } = require('./V1FacebookCallback');`,
    ];

    const exportAdditions = [
      '  V1LoginWithFacebook,',
      '  V1FacebookCallback,',
    ];

    // Add requires before the module.exports block
    for (const line of facebookExports) {
      if (!indexContent.includes(line)) {
        // Insert before the module.exports line
        indexContent = indexContent.replace(
          /^(module\.exports\s*=)/m,
          `${line}\n$1`
        );
      }
    }

    // Add the identifiers inside module.exports = { ... }
    for (const entry of exportAdditions) {
      if (!indexContent.includes(entry.trim())) {
        // Insert before the closing brace of module.exports
        indexContent = indexContent.replace(
          /^(\s*}\s*;?\s*)$/m,
          `${entry}\n$1`
        );
      }
    }

    fs.writeFileSync(actionsIndexPath, indexContent);
  }

  // 4b. Update app/User/routes.js — append Facebook routes
  const routesPath = path.join(targetDir, 'app', 'User', 'routes.js');
  if (fs.existsSync(routesPath)) {
    let routesContent = fs.readFileSync(routesPath, 'utf8');

    const facebookRoutes = [
      `  router.all('/v1/users/loginwithfacebook', controller.V1LoginWithFacebook);`,
      `  router.all('/v1/users/facebookcallback', controller.V1FacebookCallback);`,
    ].join('\n');

    if (!routesContent.includes('loginwithfacebook')) {
      // Insert before the closing of the exported function (last `};` in the file)
      routesContent = routesContent.replace(
        /(\n\s*}\s*;?\s*)$/,
        `\n\n  // "Login with Facebook" OAuth flow\n${facebookRoutes}\n$1`
      );
      fs.writeFileSync(routesPath, routesContent);
    }
  }
} // END applyFacebookOAuth

module.exports = { applyFacebookOAuth };
