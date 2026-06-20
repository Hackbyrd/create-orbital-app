/**
 * ADMIN V1UpdateEmail ACTION
 */

'use strict';

// third-party node modules
const joi = require('joi'); // argument validations: https://github.com/hapijs/joi/blob/master/API.md

// services
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1UpdateEmail
}

/**
 * Update email of admin
 *
 * GET  /v1/admins/updateemail
 * POST /v1/admins/updateemail
 *
 * Use req.__('') or res.__('') for i18n language translations (DON'T require('i18n') since it is already attached to the req & res objects): https://github.com/mashpie/i18n-node
 *
 * Must be logged in
 * Roles: ['admin']
 *
 * req.params = {}
 * req.args = {
 *   @email - (STRING - REQUIRED): The new email of the admin
 * }
 *
 * Success: Return true.
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   400: ADMIN_BAD_REQUEST_SAME_EMAIL
 *   400: ADMIN_BAD_REQUEST_EMAIL_ALREADY_TAKEN
 *   401: UNAUTHORIZED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1UpdateEmail(req, res) {
  const schema = joi.object({
    email: joi.string().trim().lowercase().min(3).email().required()
  });

  // validate
  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value; // arguments are updated and variable types are converted to correct type. ex. '5' -> 5, 'true' -> true

  // check if it is the same email
  if (req.args.email === req.admin.email)
    return errorResponse(req, ERROR_CODES.ADMIN_BAD_REQUEST_SAME_EMAIL);

  try {
    // check if email is already taken
    const duplicateAdmin = await models.admin.findOne({
      where: {
        email: req.args.email
      }
    });

    if (duplicateAdmin)
      return errorResponse(req, ERROR_CODES.ADMIN_BAD_REQUEST_EMAIL_ALREADY_TAKEN);

    // update email
    await models.admin.update({
      email: req.args.email
    }, {
      fields: ['email'], // only these fields
      where: {
        id: req.admin.id
      }
    });

    // return success
    return {
      status: 200,
      success: true
    };
  } catch (error) {
    throw error;
  }
} // END V1UpdateEmail
