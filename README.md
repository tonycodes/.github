# Shared GitHub Actions Workflows

Reusable CI/CD workflows for all tonycodes repositories.

## Available Workflows

### `reusable-ci.yml` — PR Quality Gate

Runs typecheck, lint, and tests in parallel on pull requests.

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  ci:
    uses: tonycodes/.github/.github/workflows/reusable-ci.yml@main
    with:
      has_prisma: true
      has_client: true
```

**Inputs:** `runs_on`, `node_version`, `has_prisma`, `has_client`, `has_mcp`

### `reusable-deploy.yml` — Production Deploy

Builds Docker image on VPS and deploys via Docker Swarm.

```yaml
# .github/workflows/deploy.yml (partial)
jobs:
  deploy:
    uses: tonycodes/.github/.github/workflows/reusable-deploy.yml@main
    with:
      app_name: my-app
      prod_domain: my-app.com
      migration_command: 'npx prisma migrate deploy'
    secrets: inherit
```

**Inputs:** `app_name`, `prod_domain`, `vps_host`, `network`, `migration_command`, `seed_command`, `worker_name`, `worker_command`, `vite_env_from_swarm`, `build_args`, `post_deploy_script`, `health_endpoint`, `docker_volumes`

### `reusable-release.yml` — Semantic Versioning

Auto-creates tags and GitHub releases using semantic-release after successful deploy.

```yaml
# .github/workflows/deploy.yml (partial)
jobs:
  release:
    needs: deploy
    uses: tonycodes/.github/.github/workflows/reusable-release.yml@main
    permissions:
      contents: write
    secrets: inherit
```

## Adding to a New Repo

1. Create `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` (see examples above)
2. Add `.releaserc.json` (copy `releaserc-template.json`)
3. Add `semantic-release` to devDependencies: `npm i -D semantic-release`
4. Use conventional commits: `feat:`, `fix:`, `BREAKING CHANGE:`
