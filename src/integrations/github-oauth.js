'use strict';

const fs = require('fs');
const path = require('path');

// ─── services/github.js ──────────────────────────────────────────────────────

const GITHUB_SERVICE = `'use strict';

// ENV variables
const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI } = process.env;

// built-in
const crypto = require('crypto');

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

/**
 * Build the GitHub OAuth authorization URL.
 * @param {{ state: string, scopes?: string[] }} opts
 * @returns {string}
 */
function getAuthorizationUrl({ state, scopes = ['read:user', 'user:email'] } = {}) {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: scopes.join(' '),
    state,
  });

  return \`\${GITHUB_AUTHORIZE_URL}?\${params.toString()}\`;
} // END getAuthorizationUrl

/**
 * Exchange an authorization code for an access token.
 * @param {string} code - The code GitHub returned to the callback.
 * @returns {Promise<{ access_token: string, token_type: string, scope: string }>}
 */
async function exchangeCodeForToken(code) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    throw new Error(\`GitHub token exchange failed: \${response.status} \${response.statusText}\`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(\`GitHub token exchange error: \${data.error_description || data.error}\`);
  }

  return data; // { access_token, token_type, scope }
} // END exchangeCodeForToken

/**
 * Fetch the authenticated user's profile from the GitHub API.
 * @param {string} accessToken
 * @returns {Promise<{ id: number, login: string, email: string|null, name: string|null, avatar_url: string|null }>}
 */
async function getUserInfo(accessToken) {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: \`Bearer \${accessToken}\`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(\`GitHub user info request failed: \${response.status} \${response.statusText}\`);
  }

  return response.json();
} // END getUserInfo

module.exports = { getAuthorizationUrl, exchangeCodeForToken, getUserInfo };
`;

// ─── app/User/actions/V1LoginWithGitHub.js ───────────────────────────────────

const V1_LOGIN_WITH_GITHUB = `/**
 * USER V1LoginWithGitHub ACTION
 */

'use strict';

// ENV variables
const { GITHUB_REDIRECT_URI } = process.env;

// built-in
const crypto = require('crypto');

// third-party
const joi = require('joi');

// services
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis');
const { getAuthorizationUrl } = require('../../../services/github');

// the Redis key prefix + TTL for a pending OAuth state (CSRF token)
const GITHUB_OAUTH_STATE_PREFIX = 'github_oauth_state:';
const GITHUB_OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// methods
module.exports = {
  V1LoginWithGitHub
}

/**
 * Start the "Sign in with GitHub" flow — returns the GitHub consent URL.
 *
 * GET  /v1/users/loginwithgithub
 * POST /v1/users/loginwithgithub
 *
 * Must be logged out.
 * Roles: []
 *
 * req.params = {}
 * req.args = {}
 *
 * Flow: FE calls this → redirects the browser to authorizationUrl → GitHub redirects back to the FE
 * callback (GITHUB_REDIRECT_URI) with ?code&state → FE posts code+state to V1GitHubCallback.
 *
 * Success: Return { status: 200, success: true, authorizationUrl }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   500: INTERNAL_SERVER_ERROR
 *
 * !NOTE: A random state (CSRF token) is stored in Redis with a 10-minute expiry and validated in V1GitHubCallback.
 */
async function V1LoginWithGitHub(req, res) {
  const schema = joi.object({});

  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  try {
    // random, opaque CSRF token tying the start of the flow to its completion
    const state = crypto.randomBytes(32).toString('hex');

    // store the pending state in Redis (validated + deleted in V1GitHubCallback); expires in 10 minutes
    await redisClient.setEx(\`\${GITHUB_OAUTH_STATE_PREFIX}\${state}\`, GITHUB_OAUTH_STATE_TTL_SECONDS, JSON.stringify({
      redirectUri: GITHUB_REDIRECT_URI,
      createdAt: new Date().toISOString()
    }));

    const authorizationUrl = getAuthorizationUrl({ state });

    return {
      status: 200,
      success: true,
      authorizationUrl
    };
  } catch (err) {
    throw err;
  }
} // END V1LoginWithGitHub
`;

// ─── app/User/actions/V1GitHubCallback.js ────────────────────────────────────

const V1_GITHUB_CALLBACK = `/**
 * USER V1GitHubCallback ACTION
 */

'use strict';

// ENV variables
const { NODE_ENV, REFRESH_TOKEN_EXPIRES_IN } = process.env;

// third-party
const joi = require('joi');
const moment = require('moment-timezone');

// services
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');
const { redisClient } = require('../../../services/redis');
const { exchangeCodeForToken, getUserInfo } = require('../../../services/github');

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');

// models
const models = require('../../../models');

// the Redis key prefix for a pending OAuth state (must match V1LoginWithGitHub)
const GITHUB_OAUTH_STATE_PREFIX = 'github_oauth_state:';

// methods
module.exports = {
  V1GitHubCallback
}

/**
 * Complete "Sign in with GitHub": verify the OAuth callback, resolve the user, and issue our session.
 *
 * GET  /v1/users/githubcallback
 * POST /v1/users/githubcallback
 *
 * Must be logged out.
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @code  - (STRING - REQUIRED): the authorization code GitHub returned to the callback
 *   @state - (STRING - REQUIRED): the CSRF token from V1LoginWithGitHub (validated against Redis)
 * }
 *
 * Resolution: match by githubId → else auto-link by verified email → else create a new user.
 *
 * Success: Return { status: 200/201, success: true, token, refreshToken, user }
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_INVALID_GITHUB_STATE
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_GITHUB_AUTH_FAILED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1GitHubCallback(req, res) {
  const schema = joi.object({
    code: joi.string().trim().required(),
    state: joi.string().trim().required()
  });

  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  // validate the state (CSRF) against Redis, then delete it so it cannot be replayed
  const stateKey = \`\${GITHUB_OAUTH_STATE_PREFIX}\${req.args.state}\`;
  const storedState = await redisClient.get(stateKey);
  if (!storedState)
    return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_INVALID_GITHUB_STATE);

  await redisClient.del(stateKey).catch(() => null); // best-effort cleanup

  // exchange the code for an access token and read the GitHub profile
  let githubProfile = null;
  try {
    const { access_token: accessToken } = await exchangeCodeForToken(req.args.code);
    githubProfile = await getUserInfo(accessToken);
  } catch (err) {
    console.error('GitHub OAuth handshake failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GITHUB_AUTH_FAILED);
  }

  if (!githubProfile || !githubProfile.id)
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GITHUB_AUTH_FAILED);

  const githubId = String(githubProfile.id);
  const email = githubProfile.email ? githubProfile.email.toLowerCase().trim() : null;

  const t = await models.db.transaction();
  let isNewUser = false;

  try {
    // 1. returning GitHub user — match by githubId
    let user = await models.user.findOne({ where: { githubId }, transaction: t });

    // 2. existing account with the same verified email — auto-link githubId
    if (!user && email) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        const linkUpdates = { githubId };

        if (!userByEmail.isEmailConfirmed) linkUpdates.isEmailConfirmed = true;
        if (githubProfile.avatar_url && !userByEmail.profileImageUrl) linkUpdates.profileImageUrl = githubProfile.avatar_url;

        // attempt to split display name into first/last if model has those columns
        if (githubProfile.name && !userByEmail.firstName) {
          const [first, ...rest] = githubProfile.name.split(' ');
          linkUpdates.firstName = first || '';
          if (rest.length) linkUpdates.lastName = rest.join(' ');
        }

        await userByEmail.update(linkUpdates, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user — create (random password satisfies NOT NULL; set a real one later via reset)
    if (!user) {
      isNewUser = true;
      const nameParts = githubProfile.name ? githubProfile.name.split(' ') : [];
      user = await models.user.create({
        githubId,
        email: email || \`github_\${githubId}@placeholder.invalid\`,
        firstName: nameParts[0] || githubProfile.login || '',
        lastName: nameParts.slice(1).join(' ') || '',
        profileImageUrl: githubProfile.avatar_url || null,
        isEmailConfirmed: !!email,
        isActive: true,
        password: randomString({ len: 32, lowercase: true, uppercase: true, numbers: true, special: true })
      }, { transaction: t });
    }

    if (!user.isActive || user.deletedAt) {
      await t.rollback();
      return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_ACCOUNT_INACTIVE);
    }

    await user.update({
      loginCount: user.loginCount + 1,
      lastLogin: moment.tz('UTC'),
      lastLoginAt: moment.tz('UTC')
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  // re-fetch without sensitive data
  const safeUser = await models.user.findOne({ where: { githubId } });

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

  res.cookie('jwt-user-refresh', rawRefreshToken, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseDurationMs(REFRESH_TOKEN_EXPIRES_IN)
  });

  return {
    status: isNewUser ? 201 : 200,
    success: true,
    token,
    refreshToken: rawRefreshToken,
    user: safeUser.dataValues
  };
} // END V1GitHubCallback
`;

// ─── ENV additions ───────────────────────────────────────────────────────────

const ENV_ADDITIONS = `
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=
`;

// ─── Route lines to inject ───────────────────────────────────────────────────

const ROUTE_COMMENT = `\n  // "Sign in with GitHub" (login flow — must be logged out)`;
const ROUTE_LINES = `  router.all('/v1/users/loginwithgithub', controller.V1LoginWithGitHub);
  router.all('/v1/users/githubcallback', controller.V1GitHubCallback);`;

// ─── Controller methods to append ────────────────────────────────────────────

const CONTROLLER_EXPORTS = `  V1LoginWithGitHub,
  V1GitHubCallback,`;

const CONTROLLER_METHODS = `
/**
 * Start "Sign in with GitHub"
 *
 * /v1/users/loginwithgithub
 *
 * Must be logged out
 */
async function V1LoginWithGitHub(req, res, next) {
  let method = null;

  if (req.user)
    return res.status(401).json(errorResponse(req, ERROR_CODES.UNAUTHORIZED));
  else
    method = 'V1LoginWithGitHub';

  try {
    const result = await actions[method](req, res);
    return res.status(result.status).json(result);
  } catch (error) {
    return next(error);
  }
} // END V1LoginWithGitHub

/**
 * Complete "Sign in with GitHub"
 *
 * /v1/users/githubcallback
 *
 * Must be logged out
 */
async function V1GitHubCallback(req, res, next) {
  let method = null;

  if (req.user)
    return res.status(401).json(errorResponse(req, ERROR_CODES.UNAUTHORIZED));
  else
    method = 'V1GitHubCallback';

  try {
    const result = await actions[method](req, res);
    return res.status(result.status).json(result);
  } catch (error) {
    return next(error);
  }
} // END V1GitHubCallback
`;

// ─── Main integration function ────────────────────────────────────────────────

/**
 * Apply the GitHub OAuth integration to a scaffolded Orbital-Express project.
 * @param {string} targetDir - Absolute path to the generated project root.
 */
async function applyGitHubOAuth(targetDir) {
  // 1. Write services/github.js
  const servicesDir = path.join(targetDir, 'services');
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(servicesDir, 'github.js'), GITHUB_SERVICE);

  // 2. Append env vars to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  fs.appendFileSync(envTemplatePath, ENV_ADDITIONS);

  // 3. Write action files
  const actionsDir = path.join(targetDir, 'app', 'User', 'actions');
  if (!fs.existsSync(actionsDir)) {
    fs.mkdirSync(actionsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(actionsDir, 'V1LoginWithGitHub.js'), V1_LOGIN_WITH_GITHUB);
  fs.writeFileSync(path.join(actionsDir, 'V1GitHubCallback.js'), V1_GITHUB_CALLBACK);

  // 4. Update actions/index.js — append two new requires in alphabetical order
  const actionsIndexPath = path.join(actionsDir, 'index.js');
  if (fs.existsSync(actionsIndexPath)) {
    let actionsIndex = fs.readFileSync(actionsIndexPath, 'utf8');

    // Insert V1GitHubCallback after the last existing require line, before the closing brace
    // We append just before `}` at the end of the module.exports block
    actionsIndex = actionsIndex.replace(
      /^(module\.exports\s*=\s*\{[\s\S]*?)(\s*\})/m,
      (match, body, closing) => {
        const additions = [
          `  ...require('./V1GitHubCallback'),`,
          `  ...require('./V1LoginWithGitHub'),`,
        ]
          .filter(line => !body.includes(line.trim()))
          .join('\n');

        return additions
          ? `${body}\n${additions}${closing}`
          : match;
      }
    );

    fs.writeFileSync(actionsIndexPath, actionsIndex);
  }

  // 5. Update app/User/routes.js — add two route registrations before the `return router` line
  const routesPath = path.join(targetDir, 'app', 'User', 'routes.js');
  if (fs.existsSync(routesPath)) {
    let routes = fs.readFileSync(routesPath, 'utf8');

    if (!routes.includes('loginwithgithub')) {
      // Insert before the `return router;` line
      routes = routes.replace(
        /(\s*\/\/ return router\s*\n\s*return router;)/,
        `\n${ROUTE_COMMENT}\n${ROUTE_LINES}\n$1`
      );
      fs.writeFileSync(routesPath, routes);
    }
  }

  // 6. Update app/User/controller.js — add exports and method definitions
  const controllerPath = path.join(targetDir, 'app', 'User', 'controller.js');
  if (fs.existsSync(controllerPath)) {
    let controller = fs.readFileSync(controllerPath, 'utf8');

    // Add to module.exports list if not already present
    if (!controller.includes('V1LoginWithGitHub')) {
      // Insert into the module.exports = { ... } block before the closing brace
      controller = controller.replace(
        /^(module\.exports\s*=\s*\{[\s\S]*?)(\s*\})/m,
        (match, body, closing) =>
          `${body}\n${CONTROLLER_EXPORTS}${closing}`
      );

      // Append controller method definitions at the end of the file
      controller = controller.trimEnd() + '\n' + CONTROLLER_METHODS;

      fs.writeFileSync(controllerPath, controller);
    }
  }
} // END applyGitHubOAuth

module.exports = { applyGitHubOAuth };
