'use strict';

const fs = require('fs');
const path = require('path');

async function applySentry(targetDir) {
  // 1. Overwrite services/sentry.js with the real implementation
  const servicesDir = path.join(targetDir, 'services');
  fs.mkdirSync(servicesDir, { recursive: true });

  const sentryServiceContent = `/**
 * Sentry error tracking service.
 *
 * Wraps @sentry/node so the rest of the app never imports Sentry directly.
 * Called from server.js and worker.js via sentry.init(), and from
 * middleware/error.js via sentry.captureException(err, req).
 */

'use strict';

const Sentry = require('@sentry/node');
const { SENTRY_DSN, NODE_ENV } = process.env;

/**
 * Initialize Sentry. Call once at startup, before routes or queue processors.
 * No-op if SENTRY_DSN is not set.
 */
function init() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: NODE_ENV || 'development',
  });
} // END init

/**
 * Capture an exception and send it to Sentry.
 * Attaches the requestId and authenticated user to the event for easy filtering.
 * No-op if SENTRY_DSN is not set.
 *
 * @param {Error} err
 * @param {object} [req] - Express request object (optional, used in worker tasks)
 */
function captureException(err, req) {
  if (!SENTRY_DSN) return;
  Sentry.withScope(scope => {
    if (req?.requestId) scope.setTag('requestId', req.requestId);
    if (req?.user?.id)  scope.setUser({ id: String(req.user.id) });
    else if (req?.admin?.id) scope.setUser({ id: String(req.admin.id), segment: 'admin' });
    Sentry.captureException(err);
  });
} // END captureException

module.exports = { init, captureException };
`;

  fs.writeFileSync(path.join(servicesDir, 'sentry.js'), sentryServiceContent);

  // 2. Add @sentry/node to package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['@sentry/node'] = '9.18.0';

  // Sort dependencies alphabetically (keep the file tidy)
  packageJson.dependencies = Object.fromEntries(
    Object.entries(packageJson.dependencies).sort(([a], [b]) => a.localeCompare(b))
  );

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  // 3. Add SENTRY_DSN to config/.env.template (it's already there as a stub — skip if present)
  const envPath = path.join(targetDir, 'config', '.env.template');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    if (!envContent.includes('SENTRY_DSN')) {
      fs.appendFileSync(envPath, `\n# SENTRY (error tracking)\nSENTRY_DSN=''\n`);
    }
  }
} // END applySentry

module.exports = { applySentry };
