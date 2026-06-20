# Contributing to create-orbital-app

## How versioning works

`create-orbital-app` shares its version number with `orbital-express` and `orbital-express-mcp`. When the framework releases `v1.2.0`, all three bump to `v1.2.0` together.

See the full release process in [orbital-express/CONTRIBUTING.md](https://github.com/orbital-express/orbital-express/blob/main/CONTRIBUTING.md).

## Development setup

```bash
git clone https://github.com/orbital-express/create-orbital-app.git
cd create-orbital-app
npm install

# Test the CLI locally
node bin/create-orbital-app.js my-test-project
```

## Adding a new integration

Each integration is a single file in `src/integrations/`. To add one:

1. Create `src/integrations/<name>.js`
2. Export `async function apply<Name>(targetDir)` that:
   - Writes any new service files to `targetDir/services/`
   - Appends env vars to `targetDir/config/.env.template`
   - Adds npm deps to `targetDir/package.json`
3. Add it to `src/integrations/index.js`
4. Add it as a checkbox option in `src/prompts.js`
5. Wire it in `src/index.js`

## Pull requests

- Test the CLI end-to-end before opening a PR: `node bin/create-orbital-app.js test-project`
- Keep integrations self-contained — one file, one `apply` function
- Bump the version in `package.json` to match the current `orbital-express` version
