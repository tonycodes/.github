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

### `cursor-agent-dispatch.yml` — Cursor cloud agent

Launches a Cursor cloud agent for `issues` opened and `pull_request` ready for review, so calling repositories do not need a polling agent. The workflow is `workflow_call` with no inputs and reads `github.event` from the caller.

The agent runs only when the issue or pull request author is `tonycodes`, or the item has the `agent-ok` label. It skips forks, bot authors, pull request head branches that start with `cursor/`, and items that already have the `agent-started` label. On a launch it creates `agent-started` if missing and adds it. If the Cursor API call fails, it removes that label so a rerun can try again.

An opened issue gets a test-first fix: failing test first, then the change that makes it pass, then a pull request for the normal gates (dev tests, PO after-green review, QA G3). A pull request marked ready for review gets review comments only. That agent is told not to push.

`CURSOR_API_KEY` is required to launch an agent. Pass it with `secrets: inherit` or set `CURSOR_API_KEY` explicitly. The workflow masks the key and sends it only in an `Authorization: Bearer` header. Fork pull requests cannot receive secrets, so a skipped fork does not need the key and `workflow_call` does not mark the secret required. A real launch without the key fails.

```yaml
name: Cursor Agent

on:
  issues:
    types: [opened]
  pull_request:
    types: [ready_for_review]

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  dispatch:
    uses: tonycodes/.github/.github/workflows/cursor-agent-dispatch.yml@main
    secrets: inherit
```

The launch call is `POST https://api.cursor.com/v1/agents`. That is the current Create Agent endpoint in the [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints). Authentication is the bearer header described in the [Cursor APIs overview](https://cursor.com/docs/api). `POST /v0/agents` is the legacy surface and is not called.

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
