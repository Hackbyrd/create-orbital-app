'use strict';

const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');

// File patterns to apply token replacement
const TOKEN_FILE_PATTERNS = [
  '**/*.js',
  '**/*.json',
  '**/*.md',
  '**/*.sql',
  '**/*.txt',
  '**/.env',
  '**/.env.*',
  '**/env',
  '**/env.*',
];

// Glob options shared across pattern searches
const GLOB_OPTIONS = { dot: true, nodir: true };

/**
 * Copies the template/ folder adjacent to this file into the target directory.
 * @param {string} projectName - The project name (used for logging/future use).
 * @param {string} targetDir - Absolute path to the destination directory.
 */
async function copyTemplate(projectName, targetDir) {
  const templateDir = path.resolve(__dirname, '..', 'template');

  if (!await fs.pathExists(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  await fs.copy(templateDir, targetDir, {
    overwrite: false,
    errorOnExist: false,
    filter: (src) => {
      // Skip node_modules and .git inside the template if present
      const rel = path.relative(templateDir, src);
      return !rel.startsWith('node_modules') && !rel.startsWith('.git');
    },
  });
} // END copyTemplate

/**
 * Recursively walks matching files under targetDir and replaces template tokens.
 * @param {string} targetDir - Root directory to walk.
 * @param {{ projectName: string, dbName: string }} tokens - Token values.
 */
async function replaceTokens(targetDir, tokens) {
  const { projectName, dbName } = tokens;

  const replacements = [
    { token: '{{PROJECT_NAME}}', value: projectName },
    { token: '{{DB_NAME}}', value: dbName },
    { token: '{{DB_NAME_TEST}}', value: `${dbName}_test` },
    { token: '{{DB_NAME_PROD}}', value: dbName },
  ];

  // Collect all matching files
  const allFiles = new Set();
  for (const pattern of TOKEN_FILE_PATTERNS) {
    const matches = await glob(pattern, { cwd: targetDir, ...GLOB_OPTIONS });
    for (const match of matches) {
      allFiles.add(match);
    }
  }

  await Promise.all(
    Array.from(allFiles).map(async (relPath) => {
      const filePath = path.join(targetDir, relPath);
      let content = await fs.readFile(filePath, 'utf8');
      let modified = false;

      for (const { token, value } of replacements) {
        if (content.includes(token)) {
          content = content.split(token).join(value);
          modified = true;
        }
      }

      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
      }
    })
  );
} // END replaceTokens

/**
 * Removes the Admin feature scaffolding from the project.
 * Deletes app/Admin/, and removes Admin references from routes.js, models.js, worker.js.
 * @param {string} targetDir - Root directory of the scaffolded project.
 */
async function removeAdminFeature(targetDir) {
  // Delete the Admin feature folder
  const adminDir = path.join(targetDir, 'app', 'Admin');
  await fs.remove(adminDir);

  // Files that may reference Admin
  const filesToPatch = [
    path.join(targetDir, 'app', 'routes.js'),
    path.join(targetDir, 'app', 'models.js'),
    path.join(targetDir, 'worker.js'),
  ];

  for (const filePath of filesToPatch) {
    if (!await fs.pathExists(filePath)) continue;

    let content = await fs.readFile(filePath, 'utf8');
    const original = content;

    // Remove require/import lines referencing Admin
    content = content
      .split('\n')
      .filter((line) => !/\bAdmin\b/.test(line))
      .join('\n');

    // Clean up any double blank lines left behind
    content = content.replace(/\n{3,}/g, '\n\n');

    if (content !== original) {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
} // END removeAdminFeature

/**
 * Strips Socket.IO from the project.
 * Removes services/socket.js and strips Socket.IO setup code from server.js.
 * @param {string} targetDir - Root directory of the scaffolded project.
 */
async function removeSocketIO(targetDir) {
  // Delete the socket service
  const socketService = path.join(targetDir, 'services', 'socket.js');
  await fs.remove(socketService);

  // Patch server.js
  const serverPath = path.join(targetDir, 'server.js');
  if (!await fs.pathExists(serverPath)) return;

  let content = await fs.readFile(serverPath, 'utf8');
  const original = content;

  // Remove lines that reference socket.js / socket.io / socketService / io setup
  const socketPatterns = [
    /.*require.*socket.*\n?/gi,
    /.*socket\.io.*\n?/gi,
    /.*socketService.*\n?/gi,
    /.*\.listen\(.*io.*\).*\n?/gi,
    /.*io\.attach.*\n?/gi,
    /.*new Server\(.*\).*\n?/gi,  // socket.io Server constructor
  ];

  for (const pattern of socketPatterns) {
    content = content.replace(pattern, '');
  }

  // Clean up any double blank lines left behind
  content = content.replace(/\n{3,}/g, '\n\n');

  if (content !== original) {
    await fs.writeFile(serverPath, content, 'utf8');
  }
} // END removeSocketIO

module.exports = {
  copyTemplate,
  replaceTokens,
  removeAdminFeature,
  removeSocketIO,
};
