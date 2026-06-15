# Per-job spot/on-demand runner routing — design

**Date:** 2026-06-15
**Status:** approved design, pre-implementation
**Repos touched:** `pr-dashboard` (optimizer, API, UI, writer) + `cairnea/KinDash` (ci.yml consumes a variable)

## Goal

Route each PR-tier CI job to **spot** (`kindash-arc-spot`, cheap, reclaimable) or
**on-demand** (`kindash-arc`, reliable, pricier) automatically, optimized per job
from the live spot-reclaim rate, with **manual per-job overrides** and a single
**configurable aggressiveness knob**. Builds on the spot-reclaim-rate metric
already shipped (PR #122).

### What "real-time per job" means (and its hard constraint)

GitHub evaluates `runs-on` **when a workflow run starts** — a running job cannot
be migrated between pools. So "real-time" = **per-run routing from a decision map
that a controller keeps current**: the next CI run reflects conditions as of
seconds ago, but in-flight jobs are not moved. This is the closest GitHub allows
and is sufficient: the routing adapts run-to-run as spot health changes.

## Architecture & data flow

```
dashboard (dobby, localhost / tailnet)                cairnea/KinDash
┌───────────────────────────────────┐                ┌─────────────────────────┐
│ optimizer (cost model)             │   gh variable  │ vars.RUNNER_MAP (JSON)   │
│  • per-job p90 duration (history)  │   set, on      │                          │
│  • live spot-reclaim rate          │   change only  │ ci.yml runs-on reads:    │
│  • config: knob + overrides        │ ─────────────▶ │  merge_group → on-demand │
│ serves GET /api/runner-plan + UI   │   (gh keyring  │  PR → map[key] || spot   │
└───────────────────────────────────┘   token)       └─────────────────────────┘
```

**Why a push (dashboard → KinDash), not a pull:** the dashboard runs on the dev
host (localhost / tailnet); the CI runners are in EKS and cannot reach it. And
`runs-on` can only read a **repo variable** (set at trigger time). Writing an
Actions variable needs an elevated token — the dashboard's **gh keyring token
already has `repo` scope, which covers Actions variables**, so the dashboard
writes `RUNNER_MAP` directly. **No new permissions** (no GitHub App bump).

**Hybrid essence preserved:** dashboard = brains (it owns the data + the model);
KinDash only *consumes* the variable in its own ci.yml.

**merge_group invariant preserved:** merge_group / push:main jobs stay hard-pinned
to `kindash-arc` (on-demand) so the queue can never be spot-ejected. The map
governs **PR-event jobs only** (today's `kindash-arc-spot` tier).

## The cost model + the one knob

For each PR-tier job `j`:

- `expectedReworkMinutes(j) = reclaimRate × p90duration(j)` — expected minutes
  wasted if `j` is reclaimed. Longer jobs lose more; scales with the live rate.
- Decision: **on-demand when `expectedReworkMinutes(j) ≥ shedThreshold`**, else spot.
- **The one knob = `shedThreshold` (minutes).** Lower → sheds to on-demand sooner
  (reliability-leaning); higher → keeps more on spot (cost-leaning). It encodes
  the cost trade-off: *"pay the on-demand premium once a reclaim would be expected
  to waste more than N minutes of this job."*
- Equivalent intuition — at reclaim rate `p` the duration cutoff is
  `shedThreshold / p`: 1% → ~100 min (nothing flips, spot healthy); 9% → ~11 min
  (heavy shards flip); 30% → ~3 min (most flip). "Shed the longest jobs first as
  spot degrades."
- **Time-based on purpose:** durations are always tracked; $ rates are optional
  config. If `poolMeta` $ rates exist, the UI may *also* show dollars, but the
  decision uses the always-available time proxy.
- **Manual `overrides[j] ∈ {spot, ondemand}` win unconditionally.**

**Inputs — exact sources (no recomputation, no unit traps):**
- `reclaimRate` = `MetricsPayload.reclaims[targetRepo].spot.ratePct / 100` (the
  PR #122 metric is a **percent**; normalize to a fraction at the `runner-plan.ts`
  boundary). `spot.ratePct` is **`null` when no spot jobs ran** in the window —
  treat `null` as `0` (assume healthy spot), never as on-demand.
- `p90duration(j)` = the job's existing p90 from `history.expected(repo,name,event)`
  / the `slowestJobs` projection the poller already computes — **not** a new
  percentile or a per-job query. Cold start (no history for a key) → omit the key
  from the map (falls through to spot) and render it as **"collecting"** in the UI.
- Both inputs are read from the **poller's cached metrics** (recomputed on a
  throttle, e.g. the existing `COST_SUMMARY_INTERVAL_MS` 3-min cadence / the
  `reclaimWindow`), **never a fresh SQLite scan per poll tick**. `reclaimWindow`
  is a single configurable trailing window that drives **both** the decision and
  the rate the UI displays, so they can't diverge; constrain it to a value the
  metric supports.

## Map schema + the ci.yml change

`RUNNER_MAP` repo variable = JSON object keyed by a **stable per-job key**:

```json
{ "unit": "kindash-arc", "integration": "kindash-arc-spot", "server": "kindash-arc-spot" }
```

Each PR-tier `runs-on` (ci.yml + reusable `_*.yml`) becomes:

```yaml
runs-on: ${{ github.event_name == 'merge_group' && 'kindash-arc'
             || fromJSON(vars.RUNNER_MAP || '{}')['unit']
             || 'kindash-arc-spot' }}
```

**Triple fail-safe:** missing var → `'{}'`; key absent → `|| 'kindash-arc-spot'`;
merge_group → hard-pinned on-demand. With no/empty map, CI behaves exactly as
today. Job keys are a fixed vocabulary that is the **cross-repo contract**: a single
`RUNNER_JOB_KEYS` const (e.g. `unit`, `integration`, `server`, `build`,
`build-test`, `tsc`, `db`, `eslint`, `security`). The optimizer only emits keys
it knows; unknown jobs fall through to spot. **Drift guard:** a pr-dashboard test
parses the live `cairnea/KinDash` `ci.yml` + reusable `_*.yml` `runs-on` lines
and asserts every PR-tier key they reference is in `RUNNER_JOB_KEYS` (catches a
renamed/added job silently defeating the feature). The API also surfaces
`noHistoryKeys` so the UI can show "no duration data yet" for un-emitted keys.

## Dashboard components

- **`server/estimator/runner-plan.ts`** — pure function:
  `(jobs: {key, p90Secs}[], reclaimRate, config) → { map: Record<key,label>, plan: PlanRow[] }`
  where `PlanRow = { key, p90Secs, score, decision, reason, source: 'auto'|'override' }`.
  Unit-tested in isolation (no I/O).
  Plan is computed **even when disabled** (read-only preview). Override beats auto.
- **`GET /api/runner-plan`** — returns the full state, distinguishing *computed*
  from *actually-live*:
  `{ plan, map, enabled, shedThresholdMinutes, reclaimRatePct, shedCount, noHistoryKeys, lastPushedAt, lastPushedHash, lastVerifiedAt, lastError }`.
  `lastError` / `lastVerifiedAt` let the UI show "plan computed but **push failed
  / not yet live**" instead of implying CI uses the displayed plan.
- **Writer** — a serialized, single-in-flight controller in the poller cycle:
  - **`execFile('gh', ['variable','set','RUNNER_MAP','--repo',targetRepo,'--body',json], {env})`**
    — never a shell (the JSON body is an injection surface); same `delete
    env.GITHUB_TOKEN; delete env.GH_TOKEN` hygiene as `auth.ts`. (REST via the
    token provider is an acceptable alternative — same no-shell property.)
  - **Push gating:** only when `enabled`; **on change only** vs a *canonical*
    (sorted-key JSON) hash; plus a **min re-push interval** (≈5 min) and a
    *hold-stable-one-cycle* damper so boundary jitter can't thrash the variable
    (it shares the 5k/hr REST budget).
  - **Validation before any write:** emit only valid JSON whose values ∈
    {`kindash-arc`,`kindash-arc-spot`}; never anything that could break `fromJSON`.
  - **Startup reconciliation:** read the current `RUNNER_MAP` first so a restart
    with a cached hash doesn't skip a needed write.
  - **Kill switch:** `enabled=false` → **delete** the variable; surface success/
    failure (don't just flip a local flag). **Every** gh-write path is gated on
    `enabled` (no debug/UI bypass) to preserve inert-by-default.
  - **Audit:** append every push/delete to a local `logs/runner-map.jsonl`
    (timestamp, map, reason summary, reclaim rate, knob).
- **Config** — split by trust tier, mirroring the existing file-only vs
  PUT-writable boundary:
  - **PUT-writable** via a dedicated **`PUT /api/runner-routing`** endpoint
    (origin-guarded; the generic `PUT /api/config` allowlist stays unchanged):
    `enabled` (default `false`), `shedThresholdMinutes` (validated `> 0`, finite),
    `overrides: Record<jobKey,'spot'|'ondemand'>` (values validated).
  - **File-only** (write/network targets — a malicious page must not redirect the
    writer): `targetRepo` (validated against an allowlist, e.g. `['cairnea/KinDash']`)
    and `reclaimWindow`. `loadConfig` validates the whole `runnerRouting` block.
- **UI** — a "Runner routing" `Panel` in the Reliability section (`section="reliability"`):
  - per-job row: assignment, score vs threshold, reason, **decision shown as
    text/icon (never color alone)**, and a `.source-tag`/`.source-override` pill
    distinguishing auto vs override (and, for overridden rows, what auto *would* be).
  - the **`shedThreshold` control**: a labeled native input (`<label htmlFor>` +
    `aria-valuetext` with the unit), with its ends labeled **Reliability ↔ Cost**
    so direction is obvious under stress.
  - **three-state override per job** — force-spot / force-on-demand / **clear-to-auto**
    (two `aria-pressed` buttons + a clear, or a radiogroup; a 2-state toggle can't
    express "auto").
  - **enable/kill switch** — `aria-pressed` + an `aria-label` encoding the effect.
  - **push-status line** via `role="status"` (live), with a non-color-only
    **failed** state, and a **shed-count** with a warning when high (on-demand
    contends with the merge queue).
  - All new interactive controls added to the shared `:focus-visible` rule; the
    job list wrapped in a labeled `role="group"`. Fetch lifecycle: the panel is
    permanently mounted (CSS `display:none`), so fetch on section-active + re-fetch
    after a save so scores aren't stale.

## Safety / rollout (production CI)

Phased and **inert by default**:

1. **Merge the ci.yml read** (with the triple fallback) — a **no-op**; with no
   `RUNNER_MAP` nothing changes. Safe to land independently.
2. **Ship the dashboard optimizer + API + UI in read-only mode** (`enabled=false`)
   — observe the plan it *would* push, tune the knob, with zero CI effect.
3. **Flip `enabled=true`** once the plan looks right; the writer starts pushing.

Guards:

- **Kill switch:** `enabled=false` → dashboard deletes `RUNNER_MAP` → instant
  revert to all-spot.
- **Validation:** the writer only emits values ∈ {`kindash-arc`,`kindash-arc-spot`}
  and valid JSON; it never writes anything that could break `fromJSON`. The
  ci.yml `|| '{}'` / `|| 'kindash-arc-spot'` guards are belt-and-suspenders.
- **On-demand capacity:** shedding PR jobs to on-demand adds load to `kindash-arc`
  (shared with merge_group; ARC cap 100, AWS on-demand quota 534 vCPU). v1 only
  *notes* this; a shed-count cap is a later refinement.

## YAGNI / scope cuts

- No mid-run migration (impossible on GitHub Actions).
- Single `targetRepo` (no org-level / multi-repo).
- No auto-tuning of the knob — one manual knob + per-job overrides.
- No on-demand-capacity throttle in v1 (note it; add only if shedding overloads).

## Spec review (8 standard personas, 2026-06-15)

Reviewed by the 8 standard personas. Child-psych & COPPA correctly returned
**N/A** (no child-facing surface). All **Critical** and key **Important** findings
are folded into the sections above; the recurring high-signal ones were:

- **Config trust tiers** (Architecture/Security/QA/Frontend): `runnerRouting`
  writable subset via a dedicated `PUT /api/runner-routing`; `targetRepo`/`reclaimWindow`
  file-only; validated. *(folded into Dashboard › Config)*
- **No shell, no injection** (Architecture/Security): `execFile`, env hygiene.
  *(folded into Writer)*
- **reclaimRate units + null + no per-cycle scan** (Architecture/Perf/QA): `/100`,
  null→0, read from cached metrics. *(folded into Cost model › Inputs)*
- **p90 reuse + cold-start "collecting"** (Architecture/Perf/QA). *(Inputs / UI)*
- **Canonical hash + debounce + startup reconcile + serialized writes**
  (QA/Security/Perf). *(Writer)*
- **Plan vs. live-map state machine** (`lastError`/`lastVerified`) + kill-switch
  confirmation (Frontend/UX/Security). *(API / Writer / UI)*
- **Three-state override** (Frontend/UX/A11y). *(UI)*
- **Job-key drift guard** (Architecture/Security/QA). *(ci.yml change)*
- **Full a11y bar** — labeled knob, `aria-pressed` overrides, `role="status"`
  push line, shared focus ring, no color-only, group label (A11y/Frontend). *(UI)*
- **Knob direction (Reliability↔Cost) + shed-count warning** (UX). *(UI)*

**Deferred (Minor — tracked, not v1):** fine-grained PAT scoped to Actions-variables
as future hardening (vs. the `repo`-scope keyring token); Storybook stories +
`data-testid` conventions for the panel; a plan-change history log ("what did it do
while I wasn't watching"); the on-demand shed-count *cap* (v1 surfaces the count +
warning only — file a tracking issue); dangling-override cleanup when a job key
disappears. None block implementation.

## Out-of-band step for go-live

The ci.yml change spans many jobs across `ci.yml` and the reusable `_*.yml`
workflows; it lands in `cairnea/KinDash` via its normal PR/merge-queue path,
independent of the dashboard work. The dashboard work (phases 2–3) lands in
`pr-dashboard`. Enabling the writer (`enabled=true`) is the final, reversible flip.
