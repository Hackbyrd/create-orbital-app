'use strict';

const path = require('path');
const { execSync } = require('child_process');

const ora = require('ora');
const chalk = require('chalk');

const { runPrompts } = require('./prompts');
const { scaffold } = require('./scaffold');

// Integration map — each integration module exports an `apply(projectDir, answers)` function.
const INTEGRATION_MODULES = {
  google_oauth: require('./integrations/google-oauth'),
  sendgrid: require('./integrations/sendgrid'),
  stripe: require('./integrations/stripe'),
  sentry: require('./integrations/sentry'),
  aws_s3: require('./integrations/aws-s3'),
};

// END INTEGRATION_MODULES

async function main() {
  console.log(chalk.bold.cyan('\n  create-orbital-app\n'));

  // ── Step 1: collect answers ──────────────────────────────────────────────
  let answers;
  try {
    answers = await runPrompts();
  } catch (err) {
    if (err.name === 'ExitPromptError' || err.message === 'User force closed the prompt') {
      console.log(chalk.yellow('\nCancelled.'));
      process.exit(0);
    }
    console.error(chalk.red('Prompt error:'), err.message);
    process.exit(1);
  }

  const { projectName, targetDir, dbName, dbNameTest, integrations = [] } = answers;

  // ── Step 2: scaffold template into targetDir ─────────────────────────────
  const scaffoldSpinner = ora('Copying template…').start();
  try {
    await scaffold({
      targetDir,
      tokens: {
        PROJECT_NAME: projectName,
        DB_NAME: dbName,
        DB_NAME_TEST: dbNameTest,
      },
    });
    scaffoldSpinner.succeed('Template copied and configured.');
  } catch (err) {
    scaffoldSpinner.fail('Failed to copy template.');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── Step 3: apply selected integrations ──────────────────────────────────
  for (const key of integrations) {
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
      // Non-fatal: continue with remaining integrations.
    }
  }

  // ── Step 4: yarn install ─────────────────────────────────────────────────
  const installSpinner = ora('Installing dependencies (yarn install)…').start();
  try {
    execSync('yarn install', {
      cwd: targetDir,
      stdio: 'pipe',
    });
    installSpinner.succeed('Dependencies installed.');
  } catch (err) {
    installSpinner.fail('yarn install failed.');
    const output = err.stderr ? err.stderr.toString() : err.message;
    console.error(chalk.red(output));
    console.log(chalk.yellow('\nYou can run yarn install manually inside the project directory.'));
  }

  // ── Step 5: success message ──────────────────────────────────────────────
  const rel = path.relative(process.cwd(), targetDir) || projectName;

  console.log(`
${chalk.bold.green('  Project created!')}

  ${chalk.cyan('Next steps:')}

    ${chalk.bold(`cd ${rel}`)}
    ${chalk.bold('cp .env.example .env')}     ${chalk.dim('# fill in your environment variables')}
    ${chalk.bold('createdb ' + dbName)}       ${chalk.dim('# create the development database')}
    ${chalk.bold('createdb ' + dbNameTest)}   ${chalk.dim('# create the test database')}
    ${chalk.bold('yarn db:migrate')}           ${chalk.dim('# run migrations')}
    ${chalk.bold('yarn s')}                    ${chalk.dim('# start the web server')}

  ${chalk.dim('See README.md inside the project for the full setup guide.')}
`);
} // END main

main().catch((err) => {
  console.error(chalk.red('\nUnexpected error:'), err.message);
  process.exit(1);
});
