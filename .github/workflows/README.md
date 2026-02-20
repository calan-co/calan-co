# GitHub Actions Workflows

This directory contains CI/CD workflows for a node/TypeScript monorepo.

## Workflows Overview

### 1. CI Pipeline (`ci.yml`)

**Triggers:**

- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Scheduled runs (nightly at 2 AM UTC)

**Jobs:**

- **Install**: Sets up pnpm with caching
- **Lint**: Runs ESLint and Prettier checks on affected packages
- **Type Check**: Validates TypeScript compilation
- **Test**: Runs tests with coverage on Node 18 and 20
- **Build**: Builds all affected packages

**Features:**

- ✅ Nx affected commands for efficient execution
- ✅ pnpm store caching for faster installs
- ✅ Nx cache restoration between runs
- ✅ Codecov integration for coverage reports
- ✅ Parallel job execution
- ✅ Build artifact upload

### 2. Release Workflow (`release.yml`)

**Triggers:**

- Manual workflow dispatch with release type selection
- Push to `release/**` branches

**Jobs:**

- **Version and Publish**:
  - Uses Changesets for version management
  - Publishes packages to npm (@templjs scope)
  - Creates GitHub releases with changelog
- **Publish VS Code Extension**:
  - Packages and publishes to VS Code Marketplace
  - Optionally publishes to Open VSX Registry

**Features:**

- ✅ Automated version bumping via Changesets
- ✅ npm publishing with scope support
- ✅ VS Code Marketplace publishing
- ✅ GitHub release creation
- ✅ Changelog generation

### 3. Security Scanning (`codeql.yml`)

**Triggers:**

- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Scheduled runs (weekly on Monday at 3 AM UTC)

**Jobs:**

- **Analyze**: Runs CodeQL analysis for JavaScript/TypeScript

**Features:**

- ✅ Security and quality queries
- ✅ Automatic vulnerability detection
- ✅ Results uploaded to GitHub Security tab
- ✅ Weekly scheduled scans

## Configuration Files

### `codecov.yml`

Codecov configuration with:

- Project coverage target: 90%
- Patch coverage target: 85%
- PR comments with coverage diffs
- Ignore patterns for test/build files

### `.changeset/config.json`

Changesets configuration for release automation:

- Public access for all packages
- Main branch as base
- Automatic peer dependency updates

## Required Secrets

See [SECRETS.md](./SECRETS.md) for detailed setup instructions.

| Secret                   | Required    | Purpose                      |
| ------------------------ | ----------- | ---------------------------- |
| `NPM_TOKEN`              | Yes         | Publish npm packages         |
| `VSCODE_PUBLISHER_TOKEN` | Yes         | Publish VS Code extension    |
| `OPEN_VSX_TOKEN`         | No          | Publish to Open VSX Registry |
| `CODECOV_TOKEN`          | Recommended | Upload coverage reports      |

## Usage

### Running CI Locally

```bash
# Install dependencies
pnpm install

# Run linting (affected)
pnpm nx affected -t lint

# Run type checking
pnpm type-check

# Run tests with coverage
pnpm nx affected -t test --coverage

# Build packages
pnpm nx affected -t build
```

### Creating a Release

1. Create changeset files for changes:

   ```bash
   pnpm changeset
   ```

2. Commit the changeset files

3. Either:
   - **Automatic**: Push to `release/v1.x` branch to trigger workflow
   - **Manual**: Go to Actions → Release → Run workflow

4. Workflow will:
   - Create a PR with version bumps
   - Merge PR to publish packages
   - Create GitHub release
   - Publish VS Code extension

### Viewing Coverage

Coverage reports are uploaded to [Codecov](https://codecov.io) after test runs.
View detailed coverage at: `https://codecov.io/gh/yourusername/templjs`

### Security Scanning

CodeQL results appear in the Security tab after each scan.
View results at: `https://github.com/yourusername/templjs/security/code-scanning`

## Nx Affected Commands

The CI workflow uses Nx affected commands to only process changed packages:

```bash
# Compare against origin/main
nx affected:test --base=origin/main
nx affected:lint --base=origin/main
nx affected:build --base=origin/main

# With parallel execution
nx affected -t test --parallel=3
```

## Caching Strategy

1. **pnpm Store**: Cached using pnpm-lock.yaml hash
2. **Nx Cache**: Cached using lockfile + SHA for precise cache hits
3. **Build Artifacts**: Uploaded for 7 days

## Troubleshooting

### CI Fails on First Run

- Ensure secrets are configured (see SECRETS.md)
- Check Codecov token is set (can work without, but recommended)

### Release Workflow Fails

- Verify NPM_TOKEN has publish permissions
- Check package names aren't already taken on npm
- Ensure @templjs scope is registered

### Security Scan Fails

- CodeQL requires successful build
- Check TypeScript compilation errors first

## Badge Examples

Add these to your README.md:

```markdown
[![CI](https://github.com/yourusername/templjs/workflows/CI/badge.svg)](https://github.com/yourusername/templjs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yourusername/templjs/branch/main/graph/badge.svg)](https://codecov.io/gh/yourusername/templjs)
[![CodeQL](https://github.com/yourusername/templjs/workflows/CodeQL/badge.svg)](https://github.com/yourusername/templjs/actions/workflows/codeql.yml)
```
