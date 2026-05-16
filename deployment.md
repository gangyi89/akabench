# Deployment — AKAbench Production Release

Routine release flow for the production cluster (`default` namespace on the
shared Linode LKE cluster).

For one-time cluster setup (Envoy Gateway, cert-manager, GPU Operator, DNS,
secrets) see [README.md](README.md). This document covers only what changes
between releases.

---

## Cluster safety reminder

The shared Linode cluster runs production (`default` namespace) alongside the
operator's local development workload. **`default` is production.**

- Never run destructive `kubectl` against `default` outside the steps below.
- All dev work goes in `akabench-dev`.
- The migration step in this doc is the only routine write into `default`
  outside of CI-driven deploys. Confirm `kubectl config current-context`
  before running it.

---

## Release flow

```
git push origin main
  │
  ├─→ .github/workflows/docker-publish.yml  (automatic on push)
  │      Builds and pushes:
  │        gangyi89/akabench-web:<short-sha>
  │        gangyi89/akabench-job-controller:<short-sha>
  │
  ├─→ apply any new DB migrations  (manual — see Step 1)
  │
  └─→ .github/workflows/deploy.yml  (manual workflow_dispatch with sha input)
         kubectl set image deployment/web -n default web=…:<sha>
         kubectl set image deployment/job-controller -n default …:<sha>
         kubectl rollout status (waits up to 5 min per Deployment)
```

The CI build is the source of truth — only deploy SHAs that
`docker-publish.yml` has already built. Never `kubectl set image` from a
laptop.

---

## Step 1 — Apply DB migrations (only when new files exist under `db/migrations/`)

Postgres in production runs as a Pod in `default`. Migrations are idempotent
(every statement uses `IF NOT EXISTS` / `NOT EXISTS`-guarded inserts) so
re-running a migration is safe.

**Apply migrations before deploying the new image** — new code typically
reads or writes the new columns/tables and will crash if they're absent.
Old code ignores added columns, so the migration-first ordering is
backwards-compatible.

```bash
# 0. Confirm context
kubectl config current-context
kubectl get pods -n default -l app=postgres

# 1. Find the postgres pod
POD=$(kubectl get pod -n default -l app=postgres -o jsonpath='{.items[0].metadata.name}')
echo "Target pod: $POD"

# 2. Read the DB user from the secret (don't hardcode)
PG_USER=$(kubectl get secret postgres-secrets -n default -o jsonpath='{.data.username}' | base64 -d)
echo "Connecting as: $PG_USER"

# 3. Apply the migration file. ON_ERROR_STOP=1 aborts on first error so a
#    partial migration can't slip through.
kubectl exec -i -n default "$POD" -- psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d akabench \
  < db/migrations/000X_<filename>.sql

# 4. Verify (example — list new tables/columns)
kubectl exec -n default "$POD" -- psql -U "$PG_USER" -d akabench -c "\d+ <new_table_or_table_being_altered>"
```

### Migration index

Run any migrations that have been added since the currently-deployed SHA.
Check the running release with:
```bash
kubectl get deployment job-controller -n default -o jsonpath='{.spec.template.spec.containers[0].image}'
```
then `git log <that-sha>..HEAD -- db/migrations/` to see what's new.

| File | Adds | Breaks old code? |
|---|---|---|
| `0001_seed_models.sql` | Initial model catalogue rows | No |
| `0002_job_status_engine_image.sql` | Nullable `engine_image` column on `job_status` | No |
| `0003_reports_table.sql` | New `reports` table; backfills existing completed jobs | No (only new code reads it) |

A new migration row is added here whenever a `db/migrations/000N_*.sql` is
introduced.

---

## Step 2 — Wait for the image build

The CI build is triggered automatically by your `git push`. It typically
completes in 3–5 minutes.

```bash
gh run watch -R gangyi89/akabench
# or
gh run list -R gangyi89/akabench -w "Build and push Docker images" --limit 3
```

Both images (web + job-controller) are tagged with the short SHA — for
example `gangyi89/akabench-web:17fabf7`. Never deploy a SHA that the build
hasn't completed for; the deploy workflow will fail to pull the image.

---

## Step 3 — Trigger the deploy workflow

The deploy is a manual `workflow_dispatch` so production releases are an
explicit operator action, not a side-effect of pushing.

```bash
# Get the short SHA you want to deploy
SHA=$(git rev-parse --short HEAD)

gh workflow run deploy.yml -R gangyi89/akabench -f sha="$SHA"
gh run watch -R gangyi89/akabench
```

Or via the UI: **Actions → "Deploy to production" → Run workflow** → enter
the short SHA. The workflow blocks on the `production` environment approval
gate until a reviewer approves.

**What the workflow does:**

1. Verifies the SHA matches `^[0-9a-f]{7,40}$`.
2. Confirms the deploy SA has `patch` (not `delete`) on both Deployments —
   this is a tripwire against an over-broad RBAC grant.
3. `kubectl set image deployment/web -n default web=…:<sha>`
4. `kubectl set image deployment/job-controller -n default job-controller=…:<sha>`
5. `kubectl rollout status` on both, with a 5-minute timeout.

The job-controller Deployment uses `strategy: Recreate` (the NATS durable
consumer `job-controller` rejects a second subscriber), so there is a brief
window where no controller is running. NATS holds the queue durably — any
job submissions during the gap will be picked up when the new pod comes up.

---

## Verification

```bash
# Confirm both Deployments are running the new SHA
kubectl get deployment -n default -o jsonpath='{range .items[?(@.metadata.name=="web")]}web={.spec.template.spec.containers[0].image}{"\n"}{end}'
kubectl get deployment -n default -o jsonpath='{range .items[?(@.metadata.name=="job-controller")]}job-controller={.spec.template.spec.containers[0].image}{"\n"}{end}'

# Check pods came up clean
kubectl get pods -n default -l 'app in (web, job-controller)'

# Tail the controller for the NATS subscribe line (proves DB + NATS + K8s
# clients all initialised successfully)
kubectl logs -n default deployment/job-controller --tail=20
```

Expected controller startup lines:
```
INFO job_controller.scheduler — Subscribed to NATS subject 'jobs'.
INFO __main__ — Job controller running — HTTP on 0.0.0.0:8080
```

---

## Rollback

To roll back, re-run the deploy workflow with the previous SHA — same
mechanism, same RBAC. Migrations are not auto-rolled-back; rolling code
forward across a new migration and then back requires the old code to
tolerate the new column/table, which it does for every migration in the
index above (all are additive). If a future migration is destructive
(`DROP COLUMN`, value-narrowing `ALTER TYPE`, etc.) it MUST be paired with
a forward-only deploy plan documented in the PR.

```bash
# Previous prod SHA (last deployed)
PREV=$(kubectl get deployment job-controller -n default \
  -o jsonpath='{.spec.template.spec.containers[0].image}' | awk -F: '{print $2}')
echo "Rolling back to: $PREV"

gh workflow run deploy.yml -R gangyi89/akabench -f sha="$PREV"
```

---

## What you do NOT need to do

The deploy workflow does **not** require any of these:

- `kubectl apply -f deploy/app/*.yaml` — the Deployments already exist; the
  workflow only updates the image tag. Re-applying the manifests would
  reset image tags to whatever the file currently says (often `:latest`,
  which we never want in prod).
- Pod restarts — `kubectl set image` triggers the rolling update
  automatically.
- Postgres or NATS redeploys — those manifests don't change between
  releases.

The only things outside this flow are infra changes
(`deploy/infra/*`, RBAC, secrets, cluster Helm charts). Those are
one-time `kubectl apply` operations, run manually, and never via the
deploy workflow.
