'use strict';

const fs = require('fs');
const path = require('path');

// ─── services/microsoft.js ────────────────────────────────────────────────────

const MICROSOFT_SERVICE = `/**
 * Microsoft identity-platform helpers — "Sign in with Microsoft" (MSAL).
 *
 * Handles ONLY authentication (identity). Requests identity scopes, exchanges
 * the authorization code for tokens, and reads the Microsoft Graph user profile.
 * Does NOT store Microsoft tokens or touch any Graph API beyond /me.
 *
 * The Microsoft 'id' (object id) from Graph is stable per AAD account and is
 * what callers store (e.g. Users.microsoftId) to recognize a returning user.
 */

'use strict';

// ENV variables
const {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  MICROSOFT_TENANT_ID,
  MICROSOFT_REDIRECT_URI
} = process.env;

// third-party
const { ConfidentialClientApplication } = require('@azure/msal-node');

// MSAL configuration — built lazily so env vars are resolved at call time, not module load
function getMsalClient() {
  return new ConfidentialClientApplication({
    auth: {
      clientId: MICROSOFT_CLIENT_ID,
      clientSecret: MICROSOFT_CLIENT_SECRET,
      authority: \`https://login.microsoftonline.com/\${MICROSOFT_TENANT_ID || 'common'}\`
    }
  });
} // END getMsalClient

// Microsoft Graph identity scopes (no extra Graph permissions needed)
const MICROSOFT_AUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'User.Read'
];

// methods
module.exports = {
  MICROSOFT_AUTH_SCOPES,
  getAuthCodeUrl,
  acquireTokenByCode,
  getUserInfo
};

/**
 * Build the Microsoft consent URL the user is redirected to in order to sign in.
 *
 * @redirectUri - (STRING - REQUIRED): where Microsoft sends the browser back (with ?code&state)
 * @state - (STRING - REQUIRED): opaque CSRF token; validated on the way back
 *
 * returns - (STRING) the authorization URL
 */
async function getAuthCodeUrl({ redirectUri, state }) {
  const msalClient = getMsalClient();

  const url = await msalClient.getAuthCodeUrl({
    scopes: MICROSOFT_AUTH_SCOPES,
    redirectUri: redirectUri || MICROSOFT_REDIRECT_URI,
    state
  });

  return url;
} // END getAuthCodeUrl

/**
 * Exchange an authorization code for Microsoft tokens.
 *
 * @code - (STRING - REQUIRED): the authorization code returned to the redirect URI
 * @redirectUri - (STRING - OPTIONAL): must match the one used to build the auth URL
 *
 * returns - (OBJECT) MSAL AuthenticationResult { accessToken, idToken, account, ... }
 */
async function acquireTokenByCode({ code, redirectUri }) {
  const msalClient = getMsalClient();

  const result = await msalClient.acquireTokenByCode({
    code,
    scopes: MICROSOFT_AUTH_SCOPES,
    redirectUri: redirectUri || MICROSOFT_REDIRECT_URI
  });

  return result;
} // END acquireTokenByCode

/**
 * Fetch the signed-in Microsoft user's profile from the Graph API.
 *
 * @accessToken - (STRING - REQUIRED): a valid Microsoft Graph access token
 *
 * returns - (OBJECT) Graph /me response:
 *   { id, displayName, givenName, surname, mail, userPrincipalName, ... }
 */
async function getUserInfo(accessToken) {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: \`Bearer \${accessToken}\`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(\`Microsoft Graph /me failed (\${response.status}): \${body}\`);
  }

  return response.json();
} // END getUserInfo
`;

// ─── V1LoginWithMicrosoft action ──────────────────────────────────────────────

const V1_LOGIN_WITH_MICROSOFT = `/**
 * USER V1LoginWithMicrosoft ACTION
 */

'use strict';

// ENV variables
const { MICROSOFT_REDIRECT_URI } = process.env;

// built-in node modules
const crypto = require('crypto');

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md

// services
const lang = require('../../../services/language'); // internationalization
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis'); // Redis client for OAuth state storage
const { getAuthCodeUrl } = require('../../../services/microsoft'); // Microsoft auth helpers

// models
const models = require('../../../models');

// the Redis key prefix + TTL (seconds) for a pending OAuth state (CSRF token)
const MS_OAUTH_STATE_PREFIX = 'microsoft_oauth_state:';
const MS_OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// methods
module.exports = {
  V1LoginWithMicrosoft
};

/**
 * Start the "Sign in with Microsoft" flow — returns the Microsoft consent URL to redirect the browser to.
 *
 * GET  /v1/users/loginwithmicrosoft
 * POST /v1/users/loginwithmicrosoft
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged out (this is a login flow — nobody is authenticated yet).
 * Roles: []
 *
 * req.params = {}
 * req.args = {}
 *
 * Flow: FE calls this → redirects the browser to authorizationUrl → Microsoft redirects back to
 * the FE callback (MICROSOFT_REDIRECT_URI) with ?code&state → FE posts code+state to V1MicrosoftCallback.
 *
 * Success: Return { status: 200, success: true, authorizationUrl }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   500: INTERNAL_SERVER_ERROR
 *
 * !NOTE: A random state (CSRF token) is stored in Redis with a 10-minute expiry and validated in V1MicrosoftCallback.
 */
async function V1LoginWithMicrosoft(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({});

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value; // arguments are updated and variable types are converted to correct type. ex. '5' -> 5, 'true' -> true

  try {
    const redirectUri = MICROSOFT_REDIRECT_URI;

    // random, opaque CSRF token tying the start of the flow to its completion
    const state = crypto.randomBytes(32).toString('hex');

    // store the pending state in Redis (validated + deleted in V1MicrosoftCallback); expires in 10 minutes
    await redisClient.setEx(\`\${MS_OAUTH_STATE_PREFIX}\${state}\`, MS_OAUTH_STATE_TTL_SECONDS, JSON.stringify({
      redirectUri,
      createdAt: new Date().toISOString()
    }));

    // build the Microsoft consent URL (identity scopes only)
    const authorizationUrl = await getAuthCodeUrl({ redirectUri, state });

    return {
      status: 200,
      success: true,
      authorizationUrl
    };
  } catch (error) {
    throw error;
  }
} // END V1LoginWithMicrosoft
`;

// ─── V1MicrosoftCallback action ───────────────────────────────────────────────

const V1_MICROSOFT_CALLBACK = `/**
 * USER V1MicrosoftCallback ACTION
 */

'use strict';

// ENV variables
const { NODE_ENV, REFRESH_TOKEN_EXPIRES_IN } = process.env;

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md
const moment = require('moment-timezone'); // manage timezone and dates: https://momentjs.com/timezone/docs/

// services
const lang = require('../../../services/language'); // internationalization
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis'); // Redis client for OAuth state validation
const { acquireTokenByCode, getUserInfo } = require('../../../services/microsoft'); // Microsoft auth helpers

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');

// models
const models = require('../../../models');

// the Redis key prefix for a pending OAuth state (must match V1LoginWithMicrosoft)
const MS_OAUTH_STATE_PREFIX = 'microsoft_oauth_state:';

// methods
module.exports = {
  V1MicrosoftCallback
};

/**
 * Complete "Sign in with Microsoft": verify the OAuth callback, resolve the user, and issue our session.
 *
 * GET  /v1/users/microsoftcallback
 * POST /v1/users/microsoftcallback
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged out
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @code - (STRING - REQUIRED): the authorization code Microsoft returned to the callback
 *   @state - (STRING - REQUIRED): the CSRF token from V1LoginWithMicrosoft (validated against Redis)
 * }
 *
 * Resolution: match by microsoftId → else auto-link by verified email → else create a new user
 * (random password so the NOT NULL password holds; they can set a real one later via reset).
 *
 * Success: Return the user, a short-lived access token, and a refresh token (also set as an httpOnly cookie).
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_INVALID_MICROSOFT_STATE
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_MICROSOFT_AUTH_FAILED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1MicrosoftCallback(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({
    code: joi.string().trim().required(),
    state: joi.string().trim().required()
  });

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value; // arguments are updated and variable types are converted to correct type. ex. '5' -> 5, 'true' -> true

  // validate the state (CSRF) against Redis, then delete it so it can't be replayed
  const stateKey = \`\${MS_OAUTH_STATE_PREFIX}\${req.args.state}\`;
  const storedState = await redisClient.get(stateKey);
  if (!storedState)
    return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_INVALID_MICROSOFT_STATE);

  await redisClient.del(stateKey).catch(() => null); // best-effort cleanup; don't fail the flow

  const { redirectUri } = JSON.parse(storedState);

  // exchange the code for tokens and read the Microsoft profile — failure here means the OAuth handshake failed
  let msProfile = null;
  let accessToken = null;
  try {
    const result = await acquireTokenByCode({ code: req.args.code, redirectUri });
    accessToken = result.accessToken;
    msProfile = await getUserInfo(accessToken);
  } catch (err) {
    console.error('Microsoft OAuth handshake failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_MICROSOFT_AUTH_FAILED);
  }

  // we require an id and email to identify / auto-link an account
  if (!msProfile || !msProfile.id || (!msProfile.mail && !msProfile.userPrincipalName))
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_MICROSOFT_AUTH_FAILED);

  const microsoftId = msProfile.id; // stable AAD object id
  const email = (msProfile.mail || msProfile.userPrincipalName || '').toLowerCase().trim();

  const t = await models.db.transaction();

  try {
    // 1. returning Microsoft user — match by microsoftId
    let user = await models.user.findOne({ where: { microsoftId }, transaction: t });

    // 2. existing email/password account with the same email — auto-link microsoftId to it
    if (!user) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        const linkUpdates = { microsoftId };

        // backfill profile fields Microsoft gives us if they're empty on the existing account
        if (!userByEmail.isEmailConfirmed) linkUpdates.isEmailConfirmed = true;
        if (msProfile.givenName && !userByEmail.firstName) linkUpdates.firstName = msProfile.givenName;
        if (msProfile.surname && !userByEmail.lastName) linkUpdates.lastName = msProfile.surname;

        await userByEmail.update(linkUpdates, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user — create with a random password (satisfies NOT NULL; set a real one later via reset)
    if (!user) {
      user = await models.user.create({
        microsoftId,
        email,
        firstName: msProfile.givenName || '',
        lastName: msProfile.surname || '',
        isEmailConfirmed: true, // Microsoft verified the email
        isActive: true,
        password: randomString({ len: 32, lowercase: true, uppercase: true, numbers: true, special: true })
      }, { transaction: t });
    }

    // blocked accounts can't sign in
    if (!user.isActive || user.deletedAt) {
      await t.rollback();
      return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_ACCOUNT_INACTIVE);
    }

    // bump login stats
    await user.update({
      loginCount: user.loginCount + 1,
      lastLogin: moment.tz('UTC'),
      lastLoginAt: moment.tz('UTC')
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    if (!t.finished)
      await t.rollback();

    throw err;
  }

  // re-fetch without sensitive data (default scope excludes salt/password/tokens) — includes tokenVersion
  const safeUser = await models.user.findOne({ where: { microsoftId } });

  // issue our own session: access token + refresh-token session (same as V1Login)
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
    ipAddress: req.ip || null
  });

  // set the refresh token as an httpOnly cookie (options MUST match V1Login / V1Logout)
  res.cookie('jwt-user-refresh', rawRefreshToken, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseDurationMs(REFRESH_TOKEN_EXPIRES_IN)
  });

  return {
    status: 200,
    success: true,
    token: token, // short-lived access token (send in Authorization: jwt-user <token>)
    refreshToken: rawRefreshToken, // for mobile clients that can't use cookies
    user: safeUser.dataValues
  };
} // END V1MicrosoftCallback
`;

// ─── env vars to append ───────────────────────────────────────────────────────

const MICROSOFT_ENV_VARS = `
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=
`;

// ─── applyMicrosoftOAuth ──────────────────────────────────────────────────────

async function applyMicrosoftOAuth(targetDir) {
  // 1. Write services/microsoft.js
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(servicesDir, 'microsoft.js'), MICROSOFT_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, MICROSOFT_ENV_VARS);

  // 3. Add @azure/msal-node to package.json dependencies
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['@azure/msal-node'] = '2.16.2';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  // 4. Write action files
  const actionsDir = path.join(targetDir, 'app', 'User', 'actions');
  if (!fs.existsSync(actionsDir)) {
    fs.mkdirSync(actionsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(actionsDir, 'V1LoginWithMicrosoft.js'), V1_LOGIN_WITH_MICROSOFT);
  fs.writeFileSync(path.join(actionsDir, 'V1MicrosoftCallback.js'), V1_MICROSOFT_CALLBACK);

  // 5a. Update actions/index.js — append the two new exports
  const actionsIndexPath = path.join(actionsDir, 'index.js');
  if (fs.existsSync(actionsIndexPath)) {
    let actionsIndex = fs.readFileSync(actionsIndexPath, 'utf8');

    const microsoftExports = [
      `const { V1LoginWithMicrosoft } = require('./V1LoginWithMicrosoft');`,
      `const { V1MicrosoftCallback } = require('./V1MicrosoftCallback');`
    ];

    // append requires before the module.exports block, or at the end if no module.exports
    const moduleExportsIdx = actionsIndex.lastIndexOf('module.exports');
    if (moduleExportsIdx !== -1) {
      actionsIndex =
        actionsIndex.slice(0, moduleExportsIdx) +
        microsoftExports.join('\n') + '\n\n' +
        actionsIndex.slice(moduleExportsIdx);
    } else {
      actionsIndex += '\n' + microsoftExports.join('\n') + '\n';
    }

    // inject into the exports object — find the last closing brace of module.exports = { ... }
    actionsIndex = actionsIndex.replace(
      /module\.exports\s*=\s*\{([^}]*)\}/s,
      (match, inner) => {
        const trimmed = inner.trimEnd();
        const sep = trimmed.endsWith(',') ? '' : ',';
        return `module.exports = {${trimmed}${sep}\n  V1LoginWithMicrosoft,\n  V1MicrosoftCallback\n}`;
      }
    );

    fs.writeFileSync(actionsIndexPath, actionsIndex);
  }

  // 5b. Update routes.js — append Microsoft routes
  const routesPath = path.join(targetDir, 'app', 'User', 'routes.js');
  if (fs.existsSync(routesPath)) {
    let routes = fs.readFileSync(routesPath, 'utf8');

    const msRoutes = [
      ``,
      `  // "Sign in with Microsoft" (login flow — must be logged out)`,
      `  router.all('/v1/users/loginwithmicrosoft', controller.V1LoginWithMicrosoft);`,
      `  router.all('/v1/users/microsoftcallback', controller.V1MicrosoftCallback);`
    ].join('\n');

    // insert before the closing `return router;` line
    routes = routes.replace(
      /(\s*\/\/ return router\s*\n\s*return router;)/,
      `${msRoutes}\n\n$1`
    );

    fs.writeFileSync(routesPath, routes);
  }
} // END applyMicrosoftOAuth

module.exports = { applyMicrosoftOAuth };
