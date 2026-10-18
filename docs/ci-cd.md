# CI/CD in this repository

A small, working sample of how I build, check, release and deploy. Everything
in `.github/workflows/` is real and validated with `actionlint`; the deployment
workflow is a sample that needs your own server secrets to run.

## The pipeline at a glance

```
feature branch ──► pull request ──► CI (required) ──► review ──► merge to main
                                                                      │
                          tag block-vX.Y.Z ──► Release workflow ──► GitHub release (zip + checksum)
                                                                      │
              manual: Deploy workflow ──► staging ──► (approval) ──► production
```

| Stage | Workflow | Runs when | What it does |
|---|---|---|---|
| Check the block | `block-ci.yml` | Pull request, push to `main` (block files) | JS lint and unit tests, build, **fails if the committed `build/` is stale**; PHPUnit on PHP 7.4, 8.1, 8.3; PHPCS (WordPress Coding Standards); end-to-end tests in a real WordPress |
| Check the form | `enquiry-web-ci.yml` | Pull request, push to `main` (form files) | Type-check and component tests |
| Security | `security.yml` | Lock file change, weekly | Dependency review on pull requests; `npm audit` and `composer audit` on runtime dependencies |
| Release | `release-block.yml` | Tag `block-v*` | Checks tag = plugin version, re-runs lint/tests/build, builds the zip and a SHA-256 checksum, creates the GitHub release |
| Deploy | `deploy-block.yml` | Manual | Downloads a release, verifies the checksum, installs it over SSH with WP-CLI, smoke-tests, **rolls back on failure** |
| Updates | `dependabot.yml` | Weekly | Opens grouped update pull requests, each of which runs the full CI |

The enquiry API cannot run here (it is an excerpt of a larger application), so
its pipeline is in `docs/samples/laravel-api-ci.yml` as a sample.

## Design choices

- **Fast feedback, then slow checks.** Lint, unit tests and PHP run in parallel.
  The end-to-end job starts WordPress in Docker, so it waits for them (`needs:`)
  and does not burn minutes on a pull request that already fails.
- **The pipeline checks what is committed.** `build/` is committed so the plugin
  installs without Node. `git diff --exit-code -- build` after a fresh build
  turns "I forgot to rebuild" into a failed check. The build is deterministic.
- **Least privilege.** Every workflow sets `permissions: contents: read`; only the
  release workflow can write, and only to create a release.
- **No secrets in CI for pull requests.** CI needs none. Deploy secrets live on
  the `staging` and `production` *environments*, so the wrong credentials cannot
  be used for the wrong target, and production can require a reviewer.
- **Reproducible installs.** `npm ci` and `composer install` use the lock files.
  Composer's platform is pinned to PHP 7.4 so the lock works on every version in
  the matrix.
- **Deploy what you tested.** The deploy workflow installs the zip built by the
  release workflow, not a fresh build, and checks its checksum.
- **A deploy is not done until it works.** A smoke test confirms the block is
  registered; if not, the previous version is restored.
- **Untrusted input stays out of shell.** The release tag is passed through an
  environment variable, never interpolated into a script.
- **Concurrency.** A newer push cancels the CI run it replaces; deployments to an
  environment are queued, never cancelled mid-way.

## Branches and reviews

- `main` is the only long-lived branch and always releasable.
- Work happens on short-lived feature branches and merges by pull request.
- Protect `main`: require a pull request, one approving review, and these status
  checks to pass before merging — `JavaScript (lint, unit tests, build)`,
  `PHP 7.4`, `PHP 8.1`, `PHP 8.3`, `End-to-end (real WordPress)`; block force
  pushes and deletion.
- The pull request template asks for the approach, assumptions and how it was
  tested, so a reviewer can follow the reasoning.
- Commits are small and single-purpose; the summary line is about 50 characters.

## Releasing

1. Bump the version in `price-estimator.php` (header) and `src/block.json`.
2. Merge to `main` once CI is green.
3. Tag and push: `git tag block-v1.0.1 && git push origin block-v1.0.1`.
4. The release workflow publishes the zip and checksum.
5. Run **Deploy block** for `staging`, check it, then for `production` (a reviewer
   approves).

**Rolling back:** run **Deploy block** again with the previous tag. The workflow
also restores the previous version automatically if its smoke test fails.

## Run the same checks locally

```bash
cd gutenberg-price-estimator
npm run test:all      # lint, unit tests, build
composer test && composer lint
npm run env:start && npm run test:e2e
```

## What is deliberately a sample

- `deploy-block.yml` needs `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` and
  `DEPLOY_SSH_KEY` on each environment. Without them it fails at the first step.
- `docs/samples/laravel-api-ci.yml` is not under `.github/`, so it never runs.
- Branch protection and environment reviewers are repository settings; they
  cannot be stored in files.
