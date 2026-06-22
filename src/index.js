'use strict';

const path = require('path');
const { execSync } = require('child_process');

const ora = require('ora');
const chalk = require('chalk');

const { runPrompts } = require('./prompts');
const { copyTemplate, replaceTokens, removeAdminFeature, removeSocketIO } = require('./scaffold');

const INTEGRATION_MODULES = {
  google_oauth: { apply: require('./integrations/google-oauth').applyGoogleOAuth },
  sendgrid:     { apply: require('./integrations/sendgrid').applySendGrid },
  stripe:       { apply: require('./integrations/stripe').applyStripe },
  aws_s3:       { apply: require('./integrations/aws-s3').applyAWSS3 },
};

async function run(projectName) {
  // ── Step 1: collect remaining answers ───────────────────────────────────
  let answers;
  try {
    answers = await runPrompts({ projectName });
  } catch (err) {
    if (err.name === 'ExitPromptError' || err.message === 'User force closed the prompt') {
      console.log(chalk.yellow('\nCancelled.'));
      process.exit(0);
    }
    console.error(chalk.red('Prompt error:'), err.message);
    process.exit(1);
  }

  const {
    databaseName,
    includeAdmin,
    integrations = [],
    installDependencies,
  } = answers;

  const dbName     = databaseName;
  const dbNameTest = `${databaseName}_test`;
  const targetDir  = path.join(process.cwd(), projectName);

  // ── Step 2: scaffold template ────────────────────────────────────────────
  const scaffoldSpinner = ora('Copying template…').start();
  try {
    await copyTemplate(projectName, targetDir);
    await replaceTokens(targetDir, { projectName, dbName });

    if (!includeAdmin) {
      await removeAdminFeature(targetDir);
    }

    if (!integrations.includes('socketio')) {
      await removeSocketIO(targetDir);
    }

    scaffoldSpinner.succeed('Template copied and configured.');
  } catch (err) {
    scaffoldSpinner.fail('Failed to copy template.');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── Step 3: apply selected integrations ──────────────────────────────────
  for (const key of integrations) {
    if (key === 'socketio') continue; // handled above

    const mod = INTEGRATION_MODULES[key];
    if (!mod) {
      console.warn(chalk.yellow(`  Unknown integration "${key}" — skipping.`));
      continue;
    }

    const intSpinner = ora(`Applying integration: ${chalk.bold(key)}…`).start();
    try {
      await mod.apply(targetDir, answers);
      intSpinner.succeed(`Integration applied: ${chalk.bold(key)}`);
    } catch (err) {
      intSpinner.fail(`Integration failed: ${chalk.bold(key)}`);
      console.error(chalk.red(`  ${err.message}`));
    }
  }

  // ── Step 4: yarn install ─────────────────────────────────────────────────
  if (installDependencies) {
    const installSpinner = ora('Installing dependencies (yarn install)…').start();
    try {
      execSync('yarn install', { cwd: targetDir, stdio: 'pipe' });
      installSpinner.succeed('Dependencies installed.');
    } catch (err) {
      installSpinner.fail('yarn install failed.');
      console.error(chalk.red(err.stderr ? err.stderr.toString() : err.message));
      console.log(chalk.yellow('\nRun yarn install manually inside the project directory.'));
    }
  }

  // ── Step 5: success message ──────────────────────────────────────────────
  const rel = path.relative(process.cwd(), targetDir) || projectName;

  console.log(`
${chalk.bold.green('  ✓ Project created!')}

  ${chalk.cyan('Next steps:')}

    ${chalk.bold(`cd ${rel}`)}
    ${chalk.bold('cp config/.env.template config/.env.development')}
    ${chalk.dim('# fill in your environment variables')}
    ${chalk.bold(`createdb ${dbName}`)}
    ${chalk.bold(`createdb ${dbNameTest}`)}
    ${chalk.bold('yarn db:migrate')}
    ${chalk.bold('yarn s')}

  ${chalk.dim('Full setup guide: https://hackbyrd.github.io/orbital-express/')}
`);
} // END run

module.exports = run;
