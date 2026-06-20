'use strict';

const fs = require('fs');
const path = require('path');

// ─── services/apple.js ───────────────────────────────────────────────────────

const APPLE_SERVICE = `/**
 * APPLE SERVICE
 *
 * Helpers for Sign In with Apple:
 *   - verifyIdToken(idToken)      — validate Apple's JWT (mobile flow)
 *   - generateClientSecret()      — mint the short-lived client-secret JWT Apple requires
 *   - getAuthorizationUrl(state)  — build the web OAuth redirect URL
 */

'use strict';

// built-ins
const crypto = require('crypto');

// third-party
const appleSignin = require('apple-signin-auth');

const {
  APPLE_CLIENT_ID,
  APPLE_TEAM_ID,
  APPLE_KEY_ID,
  APPLE_PRIVATE_KEY,
  APPLE_REDIRECT_URI,
} = process.env;

/**
 * Validate an id_token issued by Apple (mobile flow).
 * Returns the decoded payload on success; throws on failure.
 * @param {string} idToken
 * @returns {Promise<object>} decoded Apple JWT payload
 */
async function verifyIdToken(idToken) {
  return appleSignin.verifyIdToken(idToken, {
    audience: APPLE_CLIENT_ID,
    ignoreExpiration: false,
  });
} // END verifyIdToken

/**
 * Generate a short-lived client-secret JWT signed with the Apple private key.
 * Apple requires this in place of a static client secret for the web flow.
 * @returns {string} signed JWT (valid for up to 6 months, we use 5 minutes)
 */
function generateClientSecret() {
  const privateKey = APPLE_PRIVATE_KEY.replace(/\\\\n/g, '\\n');

  return appleSignin.getClientSecret({
    clientID: APPLE_CLIENT_ID,
    teamID: APPLE_TEAM_ID,
    privateKey,
    keyIdentifier: APPLE_KEY_ID,
    expAfter: 300, // seconds — 5 minutes is plenty for a single exchange
  });
} // END generateClientSecret

/**
 * Build the Apple OAuth authorization URL for the web flow.
 * @param {string} state  CSRF token to embed in the URL
 * @returns {string} fully-formed authorization URL
 */
function getAuthorizationUrl(state) {
  return appleSignin.getAuthorizationUrl({
    clientID: APPLE_CLIENT_ID,
    redirectUri: APPLE_REDIRECT_URI,
    state,
    responseMode: 'form_post',
    scope: 'name email',
  });
} // END getAuthorizationUrl

/**
 * Exchange an authorization code (web flow) for Apple tokens.
 * Returns the raw Apple token response; callers should extract id_token from it.
 * @param {string} code  Authorization code from Apple's callback
 * @returns {Promise<object>} Apple token response
 */
async function getTokensFromCode(code) {
  const clientSecret = generateClientSecret();
  return appleSignin.getAuthorizationToken(code, {
    clientID: APPLE_CLIENT_ID,
    redirectUri: APPLE_REDIRECT_URI,
    clientSecret,
  });
} // END getTokensFromCode

module.exports = {
  verifyIdToken,
  generateClientSecret,
  getAuthorizationUrl,
  getTokensFromCode,
};
`;

// ─── app/User/actions/V1LoginWithApple.js ────────────────────────────────────

const V1_LOGIN_WITH_APPLE = `/**
 * USER V1LoginWithApple ACTION
 */

'use strict';

// ENV variables
const { NODE_ENV, REFRESH_TOKEN_EXPIRES_IN } = process.env;

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md
const moment = require('moment-timezone'); // manage timezone and dates: https://momentjs.com/timezone/docs/

// services
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { verifyIdToken, getTokensFromCode } = require('../../../services/apple');

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1LoginWithApple
};

/**
 * Sign In with Apple — handles both mobile (id_token) and web (code) flows.
 *
 * Mobile: the client validates with Apple natively and sends the resulting id_token directly.
 * Web:    Apple posts an authorization code to the redirect URI; we exchange it for an id_token here.
 *
 * GET  /v1/users/loginwithapple
 * POST /v1/users/loginwithapple
 *
 * Must be logged out
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @idToken  - (STRING - OPTIONAL): Apple id_token from mobile Sign In with Apple
 *   @code     - (STRING - OPTIONAL): Authorization code from Apple web OAuth callback
 *   @firstName - (STRING - OPTIONAL): Given name supplied by Apple on first login (mobile)
 *   @lastName  - (STRING - OPTIONAL): Family name supplied by Apple on first login (mobile)
 * }
 * Exactly one of idToken or code must be present.
 *
 * Success: Return the user, a short-lived access token, and a refresh token (also set as an httpOnly cookie).
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_APPLE_AUTH_FAILED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1LoginWithApple(req, res) {
  const schema = joi.object({
    idToken: joi.string().trim(),
    code: joi.string().trim(),
    firstName: joi.string().trim().allow('', null),
    lastName: joi.string().trim().allow('', null),
  }).xor('idToken', 'code'); // exactly one must be present

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  // resolve the Apple id_token — either provided directly (mobile) or obtained by exchanging a code (web)
  let applePayload;
  try {
    let idToken = req.args.idToken;

    if (!idToken) {
      // web flow: exchange the authorization code for tokens
      const tokenResponse = await getTokensFromCode(req.args.code);
      idToken = tokenResponse.id_token;
    }

    applePayload = await verifyIdToken(idToken);
  } catch (err) {
    console.error('Apple Sign In verification failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_APPLE_AUTH_FAILED);
  }

  // 'sub' is Apple's stable, unique user identifier
  const appleId = applePayload.sub;
  const email = applePayload.email ? applePayload.email.toLowerCase().trim() : null;

  if (!appleId)
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_APPLE_AUTH_FAILED);

  const t = await models.db.transaction();

  try {
    // 1. returning Apple user — match by appleId
    let user = await models.user.findOne({ where: { appleId }, transaction: t });

    // 2. existing account with the same email — auto-link appleId to it
    if (!user && email) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        await userByEmail.update({ appleId }, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user — create with a random password (NOT NULL; can be set later via password reset)
    if (!user) {
      user = await models.user.create({
        appleId,
        email: email || null,
        firstName: req.args.firstName || '',
        lastName: req.args.lastName || '',
        isEmailConfirmed: !!email, // Apple-verified emails are confirmed
        isActive: true,
        password: randomString({ len: 32, lowercase: true, uppercase: true, numbers: true, special: true }),
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
      lastLoginAt: moment.tz('UTC'),
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    if (!t.finished)
      await t.rollback();
    throw err;
  }

  // re-fetch without sensitive columns (default scope strips password, salt, etc.)
  const safeUser = await models.user.findOne({ where: { appleId } });

  // issue our own session: short-lived access token + revocable refresh-token session
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

  // set the refresh token as an httpOnly cookie (options MUST match V1Login / V1Logout)
  res.cookie('jwt-user-refresh', rawRefreshToken, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseDurationMs(REFRESH_TOKEN_EXPIRES_IN),
  });

  return {
    status: 201,
    success: true,
    token,
    refreshToken: rawRefreshToken,
    user: safeUser.dataValues,
  };
} // END V1LoginWithApple
`;

// ─── ENV vars to append ──────────────────────────────────────────────────────

const APPLE_ENV_VARS = `
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
APPLE_REDIRECT_URI=
`;

// ─── main apply function ─────────────────────────────────────────────────────

/**
 * Apply the Apple Sign In integration to a scaffolded Orbital-Express project.
 *
 * Steps:
 *   1. Write services/apple.js
 *   2. Append Apple env vars to .env.template
 *   3. Add apple-signin-auth to package.json dependencies
 *   4. Write app/User/actions/V1LoginWithApple.js
 *   5. Register the action in app/User/actions/index.js
 *   6. Add the route to app/User/routes.js
 *
 * @param {string} targetDir  Absolute path to the scaffolded project root.
 */
async function applyAppleOAuth(targetDir) {
  // 1. Write services/apple.js
  const servicesDir = path.join(targetDir, 'services');
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.writeFileSync(path.join(servicesDir, 'apple.js'), APPLE_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, APPLE_ENV_VARS);

  // 3. Add apple-signin-auth to package.json dependencies
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['apple-signin-auth'] = '1.7.4';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  // 4. Write the action file
  const actionsDir = path.join(targetDir, 'app', 'User', 'actions');
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.writeFileSync(path.join(actionsDir, 'V1LoginWithApple.js'), V1_LOGIN_WITH_APPLE);

  // 5. Register the action in actions/index.js
  //    Insert ...require('./V1LoginWithApple') in alphabetical order.
  const actionsIndexPath = path.join(actionsDir, 'index.js');
  if (fs.existsSync(actionsIndexPath)) {
    let indexContent = fs.readFileSync(actionsIndexPath, 'utf8');
    const requireLine = `  ...require('./V1LoginWithApple'),`;

    if (!indexContent.includes(requireLine)) {
      // Find a sensible insertion point: after a V1L* line if present, otherwise before the closing brace.
      // We insert before the first require that sorts after 'V1LoginWithApple' alphabetically,
      // or before the closing '};' if none exists.
      const lines = indexContent.split('\n');
      let insertAt = -1;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/require\('\.\/([^']+)'\)/);
        if (m && m[1] > 'V1LoginWithApple') {
          insertAt = i;
          break;
        }
      }

      if (insertAt === -1) {
        // Fall back: insert before the closing '}' of module.exports
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim() === '}') {
            insertAt = i;
            break;
          }
        }
      }

      if (insertAt !== -1) {
        lines.splice(insertAt, 0, requireLine);
        fs.writeFileSync(actionsIndexPath, lines.join('\n'));
      }
    }
  }

  // 6. Add the route to app/User/routes.js
  const routesPath = path.join(targetDir, 'app', 'User', 'routes.js');
  if (fs.existsSync(routesPath)) {
    let routesContent = fs.readFileSync(routesPath, 'utf8');
    const routeLine = `  router.all('/v1/users/loginwithapple', controller.V1LoginWithApple);`;

    if (!routesContent.includes(routeLine)) {
      // Insert after the existing login route, or before 'return router' as a fallback.
      const loginRoutePattern = /router\.all\('\/v1\/users\/login'[^;]+;/;
      const loginMatch = routesContent.match(loginRoutePattern);

      if (loginMatch) {
        const insertPos = routesContent.indexOf(loginMatch[0]) + loginMatch[0].length;
        routesContent = routesContent.slice(0, insertPos) + '\n' + routeLine + routesContent.slice(insertPos);
      } else {
        // Fallback: insert before 'return router'
        routesContent = routesContent.replace(
          /(\s*\/\/ return router\s*\n\s*return router;)/,
          `\n${routeLine}\n$1`
        );
      }

      fs.writeFileSync(routesPath, routesContent);
    }
  }
} // END applyAppleOAuth

module.exports = { applyAppleOAuth };
