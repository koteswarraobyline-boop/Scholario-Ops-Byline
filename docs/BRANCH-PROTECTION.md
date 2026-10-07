# Branch protection for `main`

Every push to `main` deploys to production (see [CI-CD.md](CI-CD.md)), so `main` has to be protected. Set this up in GitHub. CI/CD does not change repository settings.

## Ruleset for `main`

Settings → Rules → Rulesets → **New branch ruleset** (or the classic Settings → Branches → Add rule):

| Setting | Value | Why |
|---|---|---|
| Target branches | `main` (Include default branch) | |
| Restrict deletions | on | `main` can't be deleted |
| Block force pushes | on | history that was deployed can't be rewritten |
| Require a pull request before merging | on | no direct pushes, so nothing reaches production without a PR |
| Required approvals | 1 (if more than one person works on the repo) | a second pair of eyes before production |
| Dismiss stale approvals when new commits are pushed | on | the approved code is the merged code |
| Require conversation resolution | on | |
| Require status checks to pass | on: **`test`** (job of workflow *CI/CD*) | broken lint/build/tests can't be merged |
| Require branches to be up to date before merging | on | CI ran against the code that will actually be on `main` |
| Bypass list | empty (or only an admin for emergencies) | |

The `test` check appears in the status-check picker after the workflow has run once, for example on the PR that adds it.

## Environment `production`

Settings → Environments → `production`:

| Setting | Value |
|---|---|
| Deployment branches and tags | **Selected branches → `main`**. A feature branch can't deploy, even with an edited workflow. |
| Required reviewers | optional. Each deploy then waits for an approval in the Actions tab. |
| Environment secrets | `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_PORT`, `PRODUCTION_SSH_KEY`, `PRODUCTION_SSH_KNOWN_HOSTS` |

Keep these secrets as **environment** secrets, not repository secrets. Workflows on other branches, and pull requests, then can't read them.

## How this prevents accidental production deploys

- The workflow's `deploy-production` job only runs when `github.ref == refs/heads/main` and the event is `push` or a manual run on `main`. Pull requests only run `test`.
- `main` only changes through reviewed PRs with a green `test` check.
- Only `main` can use the `production` environment and its SSH key.
- `concurrency` plus the server-side lock allow only one deployment at a time.
