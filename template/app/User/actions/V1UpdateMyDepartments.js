/**
 * USER V1UpdateMyDepartments ACTION
 */

'use strict';

// third-party
const joi = require('joi');

// services
const { ERROR_CODES, errorResponse, joiErrorsMessage } = require('../../../services/error');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1UpdateMyDepartments
}

/**
 * Replace the current user's department memberships with a new set.
 *
 * POST /v1/users/updatemydepartments
 *
 * Must be logged in
 * Roles: []
 *
 * req.args = {
 *   @departmentIds - (ARRAY of UUIDs - REQUIRED): The complete set of department IDs to assign.
 *                     Pass an empty array to remove all memberships.
 * }
 *
 * Success: Return the updated list of departments.
 * Errors:
 *   400: BAD_REQUEST_INVALID_ARGUMENTS
 *   401: UNAUTHORIZED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1UpdateMyDepartments(req, res) {
  const schema = joi.object({
    departmentIds: joi.array().items(joi.string().uuid({ version: 'uuidv7' })).required()
  });

  const { error, value } = schema.validate(req.args);
  if (error)
    return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, joiErrorsMessage(error));
  req.args = value;

  const t = await models.db.transaction();

  try {
    // validate all department IDs exist
    if (req.args.departmentIds.length > 0) {
      const found = await models.department.findAll({
        where: { id: req.args.departmentIds },
        attributes: ['id'],
        transaction: t
      });

      if (found.length !== req.args.departmentIds.length) {
        await t.rollback();
        return errorResponse(req, ERROR_CODES.BAD_REQUEST_INVALID_ARGUMENTS, 'One or more department IDs are invalid.');
      }
    }

    // delete existing memberships
    await models.userDepartment.destroy({
      where: { userId: req.user.id },
      transaction: t
    });

    // insert new memberships
    if (req.args.departmentIds.length > 0) {
      await models.userDepartment.bulkCreate(
        req.args.departmentIds.map(departmentId => ({ userId: req.user.id, departmentId })),
        { transaction: t }
      );
    }

    await t.commit();

    const userDepts = await models.userDepartment.findAll({
      where: { userId: req.user.id },
      include: [{ model: models.department, as: 'department' }]
    });

    const departments = userDepts
      .map(ud => ud.department.dataValues)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      status: 200,
      success: true,
      departments
    };
  } catch (error) {
    if (!t.finished)
      await t.rollback();

    throw error;
  }
} // END V1UpdateMyDepartments
