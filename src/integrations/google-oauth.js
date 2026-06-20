'use strict';

/**
 * Google OAuth integration for create-orbital-app.
 *
 * Applies the complete "Sign in with Google" scaffolding to a newly-created
 * Orbital-Express project. Call applyGoogleOAuth(targetDir) after the base
 * template has been copied.
 *
 * What it does:
 *   1. Writes services/google.js         — OAuth2 client, URL generation, token exchange, user-info
 *   2. Appends to .env.template          — GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI vars
 *   3. Adds "googleapis" to package.json — exact version, no caret/tilde
 *   4. Writes app/User/actions/V1LoginWithGoogle.js  — returns the consent URL
 *   5. Writes app/User/actions/V1GoogleCallback.js   — handles the callback, issues session
 *   6. Appends routes to app/User/routes.js
 *   7. Exports the new actions from app/User/actions/index.js
 */

const fs   = require('fs-extra');
const path = require('path');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the Google OAuth integration to the scaffolded project at targetDir.
 * @param {string} targetDir - Absolute path to the scaffolded project root.
 */
async function applyGoogleOAuth(targetDir) {
  await Promise.all([
    writeGoogleService(targetDir),
    appendEnvTemplate(targetDir),
    addGooglapisDependency(targetDir),
  ]);

  // Actions must be written before we patch the index/routes files
  await Promise.all([
    writeV1LoginWithGoogle(targetDir),
    writeV1GoogleCallback(targetDir),
  ]);

  await Promise.all([
    appendUserRoutes(targetDir),
    exportActionsFromIndex(targetDir),
  ]);
} // END applyGoogleOAuth

module.exports = { applyGoogleOAuth };

// ---------------------------------------------------------------------------
// Step 1 — services/google.js
// ---------------------------------------------------------------------------

async function writeGoogleService(targetDir) {
  const dest = path.join(targetDir, 'services', 'google.js');

  const content = `/**
 * Everything related to the Google API — AUTHENTICATION ONLY.
 *
 * GOOGLE API
 * OAuth2.0 Docs: https://developers.google.com/identity/protocols/oauth2
 * OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
 *
 * This service handles ONLY "Sign in with Google" (identity). It requests identity scopes,
 * exchanges the authorization code for tokens, and reads the Google user's profile (sub, email,
 * name, picture). It does NOT store Google's tokens.
 *
 * The "sub" (subject id) from Google is stable per Google account and is what we store on
 * Users.googleId to recognize a returning user.
 */

'use strict';

// ENV variables
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
} = process.env;

// third-party
const { google } = require('googleapis');

// GOOGLE OAUTH SCOPES — identity only. 'openid' returns the stable 'sub' id.
const GOOGLE_AUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

// methods
module.exports = {
  generateAuthUrl,
  getTokensFromCode,
  getUserInfo
}

/**
 * Build the Google consent URL the user's browser is redirected to.
 *
 * @redirectUri - (STRING - OPTIONAL) [DEFAULT - GOOGLE_REDIRECT_URI]: must EXACTLY match the
 *   redirect URI registered in Google Cloud Console.
 * @state - (STRING - OPTIONAL): opaque CSRF token validated on the way back
 *
 * returns - (STRING) the authorization URL
 */
function generateAuthUrl({ redirectUri = GOOGLE_REDIRECT_URI, state } = {}) {
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  return client.generateAuthUrl({
    access_type: 'online',
    scope: GOOGLE_AUTH_SCOPES,
    include_granted_scopes: true,
    ...(state ? { state } : {})
  });
} // END generateAuthUrl

/**
 * Exchange an authorization code for Google tokens and return an authenticated client.
 *
 * @code - (STRING - REQUIRED): the authorization code returned to the redirect URI
 * @redirectUri - (STRING - OPTIONAL) [DEFAULT - GOOGLE_REDIRECT_URI]: must match the one used
 *   when generating the auth URL.
 *
 * returns - { oauth2Client, tokens }
 */
async function getTokensFromCode({ code, redirectUri = GOOGLE_REDIRECT_URI }) {
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return { oauth2Client: client, tokens };
} // END getTokensFromCode

/**
 * Fetch the signed-in Google user's profile using an authenticated client.
 *
 * @oauth2Client - (OBJECT - REQUIRED): a client with credentials set (from getTokensFromCode)
 *
 * returns - (OBJECT) Google userinfo:
 *   { id (the stable 'sub'), email, verified_email, name, given_name, family_name, picture, hd }
 */
async function getUserInfo(oauth2Client) {
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const response = await oauth2.userinfo.get();
  return response.data;
} // END getUserInfo
`;

  await fs.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, 'utf8');
} // END writeGoogleService

// ---------------------------------------------------------------------------
// Step 2 — .env.template
// ---------------------------------------------------------------------------

async function appendEnvTemplate(targetDir) {
  const dest = path.join(targetDir, '.env.template');

  const block = `
# Google OAuth ("Sign in with Google")
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
`;

  if (await fs.pathExists(dest)) {
    await fs.appendFile(dest, block, 'utf8');
  } else {
    await fs.writeFile(dest, block.trimStart(), 'utf8');
  }
} // END appendEnvTemplate

// ---------------------------------------------------------------------------
// Step 3 — package.json dependency
// ---------------------------------------------------------------------------

async function addGooglapisDependency(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!await fs.pathExists(pkgPath)) return;

  const pkg = await fs.readJson(pkgPath);
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['googleapis'] = '134.0.0'; // exact version — no ^ or ~
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
} // END addGooglapisDependency

// ---------------------------------------------------------------------------
// Step 4 — app/User/actions/V1LoginWithGoogle.js
// ---------------------------------------------------------------------------

async function writeV1LoginWithGoogle(targetDir) {
  const dest = path.join(targetDir, 'app', 'User', 'actions', 'V1LoginWithGoogle.js');

  const content = `/**
 * USER V1LoginWithGoogle ACTION
 */

'use strict';

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md

// services
const lang = require('../../../services/language'); // internationalization
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { generateAuthUrl } = require('../../../services/google');

// methods
module.exports = {
  V1LoginWithGoogle
}

/**
 * Start the "Sign in with Google" flow — returns the Google consent URL.
 *
 * GET  /v1/users/loginwithgoogle
 * POST /v1/users/loginwithgoogle
 *
 * Must be logged out (this is a login flow — nobody is authenticated yet).
 * Roles: []
 *
 * req.params = {}
 * req.args = {}
 *
 * Flow: FE calls this → redirects the browser to authorizationUrl → Google redirects back with
 * ?code → FE posts code to V1GoogleCallback.
 *
 * Success: Return { status: 200, success: true, authorizationUrl }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1LoginWithGoogle(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({});

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  try {
    const authorizationUrl = generateAuthUrl();

    return {
      status: 200,
      success: true,
      authorizationUrl
    };
  } catch (err) {
    throw err;
  }
} // END V1LoginWithGoogle
`;

  await fs.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, 'utf8');
} // END writeV1LoginWithGoogle

// ---------------------------------------------------------------------------
// Step 5 — app/User/actions/V1GoogleCallback.js
// ---------------------------------------------------------------------------

async function writeV1GoogleCallback(targetDir) {
  const dest = path.join(targetDir, 'app', 'User', 'actions', 'V1GoogleCallback.js');

  const content = `/**
 * USER V1GoogleCallback ACTION
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
const { getTokensFromCode, getUserInfo } = require('../../../services/google');

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1GoogleCallback
}

/**
 * Complete "Sign in with Google": exchange the code for tokens, resolve or create the user,
 * and issue our own session (access token + refresh token).
 *
 * GET  /v1/users/googlecallback
 * POST /v1/users/googlecallback
 *
 * Must be logged out.
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @code - (STRING - REQUIRED): the authorization code Google returned to the callback URL
 * }
 *
 * Resolution: match by googleId → else auto-link by verified email → else create a new user.
 *
 * Success: Return { status: 200, success: true, token, refreshToken, user }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1GoogleCallback(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({
    code: joi.string().trim().required()
  });

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  // exchange the code for tokens and read the Google profile
  let googleProfile = null;
  try {
    const { oauth2Client } = await getTokensFromCode({ code: req.args.code });
    googleProfile = await getUserInfo(oauth2Client);
  } catch (err) {
    console.error('Google OAuth handshake failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED);
  }

  // we require a Google-verified email to identify / auto-link an account
  if (!googleProfile || !googleProfile.id || !googleProfile.email || !googleProfile.verified_email)
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED);

  const googleId = googleProfile.id;
  const email = googleProfile.email.toLowerCase().trim();

  const t = await models.db.transaction();

  try {
    // 1. returning Google user — match by googleId
    let user = await models.user.findOne({ where: { googleId }, transaction: t });

    // 2. existing email/password account with the same email — auto-link googleId
    if (!user) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        const linkUpdates = { googleId };

        if (!userByEmail.isEmailConfirmed) linkUpdates.isEmailConfirmed = true;
        if (googleProfile.picture && !userByEmail.profileImageUrl) linkUpdates.profileImageUrl = googleProfile.picture;
        if (googleProfile.given_name && !userByEmail.firstName) linkUpdates.firstName = googleProfile.given_name;
        if (googleProfile.family_name && !userByEmail.lastName) linkUpdates.lastName = googleProfile.family_name;

        await userByEmail.update(linkUpdates, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user — create with a random password (satisfies NOT NULL; reset later)
    if (!user) {
      user = await models.user.create({
        googleId,
        email,
        firstName: googleProfile.given_name || '',
        lastName: googleProfile.family_name || '',
        profileImageUrl: googleProfile.picture || null,
        isEmailConfirmed: true,
        isActive: true,
        password: randomString({ len: 32, lowercase: true, uppercase: true, numbers: true, special: true })
      }, { transaction: t });
    }

    // blocked accounts cannot sign in
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

  // re-fetch without sensitive fields (default scope strips salt/password/tokens)
  const safeUser = await models.user.findOne({ where: { googleId } });

  // issue our own session: access token + revocable refresh token
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

  // set the refresh token as an httpOnly cookie (options must match V1Login / V1Logout)
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
    token,
    refreshToken: rawRefreshToken, // for mobile clients that cannot use cookies
    user: safeUser.dataValues
  };
} // END V1GoogleCallback
`;

  await fs.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, 'utf8');
} // END writeV1GoogleCallback

// ---------------------------------------------------------------------------
// Step 6 — append routes to app/User/routes.js
// ---------------------------------------------------------------------------

async function appendUserRoutes(targetDir) {
  const routesPath = path.join(targetDir, 'app', 'User', 'routes.js');
  if (!await fs.pathExists(routesPath)) return;

  let content = await fs.readFile(routesPath, 'utf8');

  // Idempotency guard
  if (content.includes('loginwithgoogle') || content.includes('googlecallback')) return;

  const routeBlock = `
  // "Sign in with Google" (login flow — must be logged out)
  router.all('/v1/users/loginwithgoogle', controller.V1LoginWithGoogle);
  router.all('/v1/users/googlecallback', controller.V1GoogleCallback);
`;

  // Insert before the final "return router;" line
  content = content.replace(
    /(\s*\/\/ return router\s*\n\s*return router;)/,
    `${routeBlock}$1`
  );

  await fs.writeFile(routesPath, content, 'utf8');
} // END appendUserRoutes

// ---------------------------------------------------------------------------
// Step 7 — export actions from app/User/actions/index.js
// ---------------------------------------------------------------------------

async function exportActionsFromIndex(targetDir) {
  const indexPath = path.join(targetDir, 'app', 'User', 'actions', 'index.js');
  if (!await fs.pathExists(indexPath)) return;

  let content = await fs.readFile(indexPath, 'utf8');

  // Idempotency guard
  if (content.includes('V1LoginWithGoogle') || content.includes('V1GoogleCallback')) return;

  // Insert the two new requires in alphabetical order.
  // V1GoogleCallback comes after V1G..., V1LoginWithGoogle after V1L...
  // Strategy: append them before the closing brace of module.exports.
  const callbackLine  = `  ...require('./V1GoogleCallback'),\n`;
  const loginLine     = `  ...require('./V1LoginWithGoogle'),\n`;

  // Insert after an existing require line that sorts just before each, or prepend inside the block
  content = insertRequireLine(content, callbackLine, 'V1GoogleCallback');
  content = insertRequireLine(content, loginLine, 'V1LoginWithGoogle');

  await fs.writeFile(indexPath, content, 'utf8');
} // END exportActionsFromIndex

/**
 * Insert a require(...) spread line into the module.exports block of an actions/index.js file,
 * maintaining alphabetical order.
 *
 * @param {string} content       - Current file content
 * @param {string} newLine       - The line to insert (with trailing newline)
 * @param {string} actionName    - The action name used for ordering (e.g. 'V1GoogleCallback')
 * returns {string} updated content
 */
function insertRequireLine(content, newLine, actionName) {
  // Match individual spread-require lines inside module.exports = { ... }
  const requirePattern = /( {2}\.\.\.require\('\.\/([^']+)'\),?\n)/g;
  let match;
  let lastMatchEnd = -1;
  let insertAfterIndex = -1;

  while ((match = requirePattern.exec(content)) !== null) {
    const existingName = match[2]; // e.g. 'V1Login'
    if (existingName < actionName) {
      insertAfterIndex = match.index + match[0].length;
    }
    lastMatchEnd = match.index + match[0].length;
  }

  if (insertAfterIndex === -1) {
    // No line sorts before this one — insert at the top of the block (after the opening brace)
    return content.replace(/module\.exports = \{\n/, `module.exports = {\n${newLine}`);
  }

  return content.slice(0, insertAfterIndex) + newLine + content.slice(insertAfterIndex);
} // END insertRequireLine
