'use strict';

function toSnakeCase(str) {
  return str.replace(/[-\s]+/g, '_');
}

function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function printSuccess(projectName) {
  const steps = [
    `cd ${projectName}`,
    'cp config/.env.template config/.env.development',
    '# Fill in your .env values',
    'yarn migrate',
    'yarn s',
  ];

  const maxLen = Math.max(...steps.map(s => s.length));
  const border = '─'.repeat(maxLen + 4);

  console.log('');
  console.log('\x1b[32m' + `┌${border}┐` + '\x1b[0m');
  console.log('\x1b[32m' + `│  \x1b[1mNext steps:\x1b[0m\x1b[32m${' '.repeat(maxLen - 7)}  │` + '\x1b[0m');
  console.log('\x1b[32m' + `├${border}┤` + '\x1b[0m');
  for (const step of steps) {
    const padding = ' '.repeat(maxLen - step.length);
    console.log('\x1b[32m' + `│  \x1b[0m${step}${padding}\x1b[32m  │` + '\x1b[0m');
  }
  console.log('\x1b[32m' + `└${border}┘` + '\x1b[0m');
  console.log('');
}

function printError(msg) {
  console.error('\x1b[31m' + `Error: ${msg}` + '\x1b[0m');
}

module.exports = {
  toSnakeCase,
  toPascalCase,
  printSuccess,
  printError,
};
