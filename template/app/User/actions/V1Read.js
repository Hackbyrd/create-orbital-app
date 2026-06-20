/**
 * USER V1Read ACTION
 */

'use strict';

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md

// services
const lang = require('../../../services/language'); // internationalization
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1Read
}

/**
 * Read and return a user
 *
 * GET  /v1/users/read
 * POST /v1/users/read
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged in
 * Roles: ['user']
 *
 * req.params = {}
 * req.args = {
 *   @id - (STRING - OPTIONAL) [DEFAULT - req.user.id]: The id of a user
 * }
 *
 * Success: Return a user. The user includes a `departments` array (its department memberships,
 *          join-table attributes omitted) for onboarding state + the settings editor.
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: USER_BAD_REQUEST_ACCOUNT_DOES_NOT_EXIST
 *   401: UNAUTHORIZED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1Read(req, res) {
  const i18n = lang.getLocalI18n(); // get local i18n object

  const schema = joi.object({
    id: joi.string().uuid().default(req.user.id).optional()
  });

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value; // arguments are updated and variable types are converted to correct type. ex. '5' -> 5, 'true' -> true

  try {
    // user can only read self for now
    // TODO: users can only read other users in the same organization
    if (req.args.id !== req.user.id)
      return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_ACCOUNT_DOES_NOT_EXIST);

    // find user (sensitive data excluded by the default scope); include department
    // memberships so the client can show/pre-select them (onboarding + settings).
    const findUser = await models.user.findByPk(req.args.id, {
      attributes: {
        exclude: models.user.getSensitiveData() // remove sensitive data
      },
      include: [{ model: models.department, as: 'departments', through: { attributes: [] } }]
    });

    // check if user exists
    if (!findUser)
      return errorResponse(req, ERROR_CODES.USER_BAD_REQUEST_ACCOUNT_DOES_NOT_EXIST);

    return {
      status: 200,
      success: true,
      user: findUser.get({ plain: true }) // plain object so the included departments serialize
    };
  } catch (error) {
    throw error;
  }
} // END V1Read
