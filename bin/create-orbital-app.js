#!/usr/bin/env node

'use strict';

const chalk = require('chalk');
const validateProjectName = require('validate-npm-package-name');
const { createInterface } = require('readline');
const path = require('path');
const { version } = require('../package.json');

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nAborted. No files were created.\n'));
  process.exit(0);
});

function showBanner() {
  console.log();
  console.log(chalk.bold.cyan('  ╔═══════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║') + chalk.bold.white('     🚀 Orbital Express 🚀      ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('  ║') + chalk.dim(`       create-orbital-app v${version}`) + chalk.bold.cyan('   ║'));
  console.log(chalk.bold.cyan('  ╚═══════════════════════════════╝'));
  console.log();
}

function validateName(name) {
  const result = validateProjectName(name);
  if (result.validForNewPackages) return null;
  const errors = [...(result.errors || []), ...(result.warnings || [])];
  return errors[0] || 'Invalid project name';
}

async function promptForName() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.on('SIGINT', () => {
      rl.close();
      process.emit('SIGINT');
    });
    rl.question(chalk.bold('? Project name: '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  showBanner();

  let projectName = process.argv[2];

  if (!projectName) {
    projectName = await promptForName();
  }

  if (!projectName) {
    console.error(chalk.red('Error: Project name is required.\n'));
    process.exit(1);
  }

  const validationError = validateName(projectName);
  if (validationError) {
    console.error(chalk.red(`Error: "${projectName}" is not a valid package name.`));
    console.error(chalk.red(`  ${validationError}\n`));
    process.exit(1);
  }

  const run = require('../src/index.js');
  await run(projectName);
}

main().catch((err) => {
  console.error(chalk.red('\nUnexpected error:'), err.message || err);
  process.exit(1);
});
