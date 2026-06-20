/**
 * USER V1CompleteOnboarding ACTION
 */

'use strict';

// services
const { ERROR_CODES, errorResponse } = require('../../../services/error');

// models
const models = require('../../../models');

// methods
module.exports = {
  V1CompleteOnboarding
}

/**
 * Mark the current user's onboarding as complete.
 *
 * POST /v1/users/completeonboarding
 *
 * Must be logged in
 * Roles: []
 *
 * req.args = {}
 *
 * Success: Return the updated user.
 * Errors:
 *   401: UNAUTHORIZED
 *   500: INTERNAL_SERVER_ERROR
 */
async function V1CompleteOnboarding(req, res) {
  const t = await models.db.transaction();

  try {
    await models.user.update(
      { onboardingCompleted: true },
      { where: { id: req.user.id }, transaction: t }
    );

    await t.commit();

    const updatedUser = await models.user.findByPk(req.user.id, {
      attributes: { exclude: models.user.getSensitiveData() }
    });

    return {
      status: 200,
      success: true,
      user: updatedUser.dataValues
    };
  } catch (error) {
    if (!t.finished)
      await t.rollback();

    throw error;
  }
} // END V1CompleteOnboarding
