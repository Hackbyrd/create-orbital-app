/**
 * USER V1GoogleLogin ACTION
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
const { getGoogleTokensFromCode, getGoogleUserInfo } = require('../../../services/google'); // auth-only Google helpers

// helpers
const { randomString, createAccessToken, parseDurationMs, resolveClient, resolvePlatform, getTokenAudience } = require('../../../helpers/logic');
const { issueSession } = require('../../../helpers/session');
const { ALLOWED_EMAIL_DOMAINS } = require('../../../helpers/constants');

// models
const models = require('../../../models');

// the Redis key prefix for a pending OAuth state (must match V1GoogleAuthStart)
const GOOGLE_OAUTH_STATE_PREFIX = 'google_oauth_state:';

// methods
module.exports = {
  V1GoogleLogin
}

/**
 * Complete "Sign in with Google": verify the OAuth callback, resolve the user, and issue our session.
 *
 * GET  /v1/users/googlelogin
 * POST /v1/users/googlelogin
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged out
 * Roles: []
 *
 * req.params = {}
 * req.args = {
 *   @code - (STRING - REQUIRED): the authorization code Google returned to the callback
 *   @state - (STRING - REQUIRED): the CSRF token from V1GoogleAuthStart (validated against Redis)
 * }
 *
 * Resolution: match by googleId → else auto-link by verified email → else create a new user
 * (random password so the NOT NULL password holds; they can set a real one later via reset).
 *
 * Success: Return the user, a short-lived access token, and a refresh token (also set as an httpOnly cookie).
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_INVALID_GOOGLE_STATE
 *   400: USER_BAD_REQUEST_ACCOUNT_INACTIVE
 *   401: USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED
 *   401: USER_UNAUTHORIZED_EMAIL_DOMAIN_NOT_ALLOWED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1GoogleLogin(req, res) {
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
  const stateKey = `${GOOGLE_OAUTH_STATE_PREFIX}${req.args.state}`;
  const storedState = await redisClient.get(stateKey);
  if (!storedState)
    return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_INVALID_GOOGLE_STATE);

  await redisClient.del(stateKey).catch(() => null); // best-effort cleanup; don't fail the flow

  const { redirectUri } = JSON.parse(storedState);

  // exchange the code for tokens and read the Google profile — failure here means the OAuth handshake failed
  let googleProfile = null;
  try {
    const { oauth2Client } = await getGoogleTokensFromCode({ code: req.args.code, redirectUri });
    googleProfile = await getGoogleUserInfo(oauth2Client);
  } catch (err) {
    console.error('Google OAuth handshake failed:', err.message);
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED);
  }

  // we require a Google-verified email to identify / auto-link an account
  if (!googleProfile || !googleProfile.id || !googleProfile.email || !googleProfile.verified_email)
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_GOOGLE_AUTH_FAILED);

  const googleId = googleProfile.id; // the stable Google subject id ('sub')
  const email = googleProfile.email.toLowerCase().trim();

  // Nitra Brain is internal-only: restrict to the allowed workspace domain(s).
  const emailDomain = email.split('@')[1] || '';
  if (!ALLOWED_EMAIL_DOMAINS.includes(emailDomain))
    return errorResponse(req, ERROR_CODES.USER_UNAUTHORIZED_EMAIL_DOMAIN_NOT_ALLOWED);

  const t = await models.db.transaction();

  try {
    // 1. returning Google user — match by googleId
    let user = await models.user.findOne({ where: { googleId }, transaction: t });

    // 2. existing email/password account with the same email — auto-link googleId to it
    if (!user) {
      const userByEmail = await models.user.scope(null).findOne({ where: { email }, transaction: t });

      if (userByEmail) {
        const linkUpdates = { googleId };

        // backfill profile fields Google gives us if they're empty on the existing account
        if (!userByEmail.isEmailConfirmed) linkUpdates.isEmailConfirmed = true;
        if (googleProfile.picture && !userByEmail.profileImageUrl) linkUpdates.profileImageUrl = googleProfile.picture;
        if (googleProfile.given_name && !userByEmail.firstName) linkUpdates.firstName = googleProfile.given_name;
        if (googleProfile.family_name && !userByEmail.lastName) linkUpdates.lastName = googleProfile.family_name;

        await userByEmail.update(linkUpdates, { transaction: t });
        user = userByEmail;
      }
    }

    // 3. brand-new user — create with a random password (satisfies NOT NULL; set a real one later via reset)
    if (!user) {
      user = await models.user.create({
        googleId,
        email,
        firstName: googleProfile.given_name || '',
        lastName: googleProfile.family_name || '',
        profileImageUrl: googleProfile.picture || null,
        isEmailConfirmed: true, // Google verified the email
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
  const safeUser = await models.user.findOne({ where: { googleId } });

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
} // END V1GoogleLogin
