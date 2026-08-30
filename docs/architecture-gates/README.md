# Architecture Gates

This directory contains versioned, reviewable inputs and evidence for the 0818
architecture gates.  `G0` freezes the Legacy implementation; it does not
assert that the target event-driven architecture exists.

Run `pnpm verify:g0` to run the mapped backend, UI Retry, and Stop E2E
characterization tests, then validate schemas and local `$ref` closure, fixture
hygiene, whole-repository tracked-file hygiene, snapshots, canonical determinism, and five no-network benchmarks
(workspace query/command, graph read, context plan, stream commit). The runner intentionally does not overwrite
tracked evidence.  A release owner performs the two-commit evidence flow:

1. Commit changed fixtures, API/DB snapshots, registry digests, and tests. This
   commit is the exact evaluation tree recorded by the evidence manifest.
2. Create the annotated `pre-0815-engineering-baseline` tag at `b29d94f`.
3. Run `pnpm g0:evidence`; it reruns the mapped characterization tests, verifies
   the tag object and peeled commit, records five 20-warm-up/200-sample metrics,
   validates the manifest with JSON Schema, and writes `G0/evidence.json`.
4. Review and commit `G0/evidence.json` separately.

`environment-profile.json` is a CI profile. `performance-profile.json` is a
versioned 300-node workload recipe: it names a registered workspace fixture as
its base and is checksummed in evidence. The benchmark uses one persistent HTTP
server and records all 200 samples per metric; failures, HTTP timeouts, and
connection drops make the run fail rather than stopping at the first error.
Fixture registry provenance is
always `synthetic`; the runner rejects secrets, bearer/sk/cloud keys, PEM,
absolute/file paths (including private, tmp, etc, UNC, and home paths),
traversal, unregistered fixtures, and oversized content.
Locally generated evidence records the actual Node, OS, CPU, memory, and store
adapter alongside the declared CI profile. The committed local result is
archived and supplemental, never a canonical CI performance claim:
`G0/ci-performance-baseline.json` is the canonical Linux
performance baseline, attested to the GitHub Actions run and artifact that
produced it. CI additionally runs `pnpm g0:observe`, which writes a
schema-validated, untracked observation
to `$RUNNER_TEMP/g0-evidence.json` and uploads it as an artifact. It records
the checked-out SHA, GitHub Actions provenance, observed environment, metrics,
and checksums without replacing the archived baseline evidence.

`blocking` CI runs lint, types, tests, license checks, G0 verification, and the
build. Archived G0 evidence has `severity: blocking`. `observational` CI runs
separately after it, writes `severity: observational`, and uploads the G0
runtime observation; it is explicitly `continue-on-error`, visible, and does
not determine merge eligibility. The immutable pre-severity Linux artifact is
treated as observational by the verifier rather than being rewritten.
Use `pnpm g0:hygiene` to reproduce tracked-file scanning. It rejects tracked
runtime snapshots, `.DS_Store`, zip archives, credential signatures, and real
absolute paths. To debug a finding, remove the tracked artifact with `git rm`
or replace the value with a synthetic relative fixture, then rerun
`pnpm test:architecture-gates` and `pnpm verify:g0`.

Evidence exceptions must state an owner, `YYYY-MM-DD` expiry, ADR/issue, and
`blocking` or `observational` severity. The verifier rejects expired exceptions;
an expired observational exception explicitly escalates to a blocking failure.

## V4 milestone evidence

M01/M02/M03 use `milestone-evidence.schema.json`: each manifest binds its full
Git commit to the current file and Git-object checksums, named fixtures, every
gate command result, failure classification, owned/expiring exceptions, and the
observed environment. `pnpm verify:m01:v4` and `pnpm verify:m02:v4` run their
milestone checks and validate the corresponding committed manifest. Each
milestone has an intentionally separate evidence phase (`pnpm m01:evidence` or
`pnpm m02:evidence`): after the implementation commit exists, it runs the exact
gate command set, writes `<milestone>/evidence.json`, and validates the new
manifest before it is committed separately. `--write` never writes evidence
after a failed or skipped command. It also requires the worktree inputs to
match the implementation commit.

For milestone evidence, each `fixtures[].id` is the fixture identifier and its
`path` is required in `checksums`; that entry's `recorded_commit` SHA-256 is
the fixture digest. The `environment` record is the observed environment
profile (Node, OS, CPU, memory) for that exact run. This is the milestone
equivalent of `fixture_id` + `fixture_digest` + `environment_profile`; the
verifier rejects a fixture without its commit-bound digest.

The shared schema accepts V4.0 and V4.1, while the verifier fixes the allowed
architecture version per milestone: M01 and M02 remain historical V4.0
evidence; M03 is current V4.1 evidence. This keeps historical manifests
verifiable without allowing a newly written M03 manifest to regress to V4.0.

Ordinary reads, including `pnpm verify:m02:v4` in CI, validate checksums from the recorded Git object so older
milestones remain verifiable after later milestones legitimately change the
same files. Run `pnpm verify:m02:closure` once while closing M02 to also require
every checksummed worktree file to match. Later milestone CI should verify M02
historically and use strict-current only for the milestone being closed. Both modes reject
missing/non-ancestor commits, recorded-object checksum drift, unsafe paths, and
expired exceptions. M02 additionally runs
`pnpm verify:m02:boundaries --strict`: Domain/Application infrastructure imports,
illegal layer direction or cycles, HTTP persistence access, mutating routes
outside `Application.execute`, legacy route logic, and remaining M01 boundary
exceptions are blocking failures. G0 characterization remains blocking; raw
local latency deltas remain observational under the V4 roadmap.

On ordinary verification, the baseline tag must exist as an annotated tag and
peel to `b29d94f`. The archived evidence file is required: its recorded commit
must exist as a Git commit and be an ancestor of `HEAD`. It also validates the
attested CI baseline's raw-file SHA-256, GitHub Actions push provenance and
ancestor commit, declared environment profile, metric counts, and input
checksums. Verification recomputes every fixture, snapshot, and
performance-profile checksum, resolves every artifact reference, and retains
20 warm-ups, 200 samples, and zero recorded errors. Raw latency values are
observational and may differ between environments.


M06 uses V4.2. Run `pnpm run m06:checks` for the full current gate, then commit implementation and refreshed G0 snapshots/evidence before `pnpm run m06:evidence`. `pnpm run verify:m06:closure` additionally checks the current files against commit-bound evidence. Real PostgreSQL cases in `e2e/m06-runs.e2e.test.ts` are explicitly skipped without DATABASE_URL; embedded tests are mandatory. No M07 scope is included.
