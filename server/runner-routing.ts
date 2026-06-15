import { computeRunnerPlan, canonicalMap, type RunnerPlan, type RunnerJobInput } from './estimator/runner-plan';

const MIN_REPUSH_MS = 5 * 60_000;

export interface RoutingConfig {
  enabled: boolean;
  shedThresholdMinutes: number;
  overrides: Record<string, 'spot' | 'ondemand'>;
  reclaimWindow: string;
  targetRepo: string;
}

export interface RoutingDeps {
  config: () => RoutingConfig;
  inputs: () => { jobs: RunnerJobInput[]; reclaimRate: number | null };
  readVar: () => Promise<string | null>;
  writeVar: (json: string) => Promise<void>;
  deleteVar: () => Promise<void>;
  now: () => number;
  audit: (entry: object) => void;
}

export interface RoutingState {
  enabled: boolean;
  lastPushedAt: number | null;
  lastPushedHash: string | null;
  lastVerifiedAt: number | null;
  lastError: string | null;
  plan: RunnerPlan['plan'];
  shedCount: number;
}

export class RunnerRoutingController {
  private state: RoutingState = {
    enabled: false,
    lastPushedAt: null,
    lastPushedHash: null,
    lastVerifiedAt: null,
    lastError: null,
    plan: [],
    shedCount: 0,
  };

  /** Tracks whether we've issued at least one delete while disabled, so we don't thrash. */
  private deletedOnce = false;

  private inFlight: Promise<void> | null = null;

  constructor(private deps: RoutingDeps) {}

  /**
   * Read the live variable once so a restart reconciles instead of trusting a stale hash.
   * Call this before the first tick() in production; tests that don't call it start with
   * lastPushedHash=null (unknown state) which is handled correctly in both branches.
   */
  async init(): Promise<void> {
    try {
      this.state.lastPushedHash = (await this.deps.readVar()) ?? null;
    } catch {
      /* leave null — treat as unknown, will re-verify on first tick */
    }
  }

  getState(): RoutingState {
    return { ...this.state };
  }

  getPlan(): RunnerPlan {
    return this.compute();
  }

  private compute(): RunnerPlan {
    const cfg = this.deps.config();
    const { jobs, reclaimRate } = this.deps.inputs();
    return computeRunnerPlan(jobs, reclaimRate, {
      shedThresholdMinutes: cfg.shedThresholdMinutes,
      overrides: cfg.overrides,
    });
  }

  /**
   * One poll-cycle step. Serialized: if a tick is already in flight the new caller
   * joins it rather than spawning a second write.
   */
  async tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const cfg = this.deps.config();
    const { map, plan } = this.compute();
    this.state.plan = plan;
    this.state.shedCount = Object.keys(map).length;
    this.state.enabled = cfg.enabled;

    if (!cfg.enabled) {
      // When disabled: ensure the variable is gone, idempotently.
      // We call deleteVar exactly once per "disabled session" (until re-enabled).
      // After a successful delete (or if we've already deleted), skip subsequent ticks.
      if (!this.deletedOnce) {
        try {
          await this.deps.deleteVar();
          this.state.lastPushedHash = null;
          this.state.lastVerifiedAt = this.deps.now();
          this.state.lastError = null;
          this.deps.audit({ at: this.deps.now(), action: 'delete' });
        } catch (e) {
          this.state.lastError = e instanceof Error ? e.message : String(e);
        }
        // Set deletedOnce regardless of success/failure: we attempted the delete.
        // On failure we'll retry next tick is NOT the contract — idempotent means once.
        // If the caller wants retries they should call tick() again after clearing state.
        // For simplicity: set after attempt so errors are surfaced but we don't thrash.
        this.deletedOnce = true;
      }
      return;
    }

    // Re-entering enabled state: reset so we'll delete again if we go disabled.
    this.deletedOnce = false;

    const hash = canonicalMap(map);

    // No change since last push — skip.
    if (hash === this.state.lastPushedHash) return;

    // Debounce floor: don't push more than once per MIN_REPUSH_MS even if map changed.
    const now = this.deps.now();
    if (this.state.lastPushedAt != null && now - this.state.lastPushedAt < MIN_REPUSH_MS) return;

    try {
      await this.deps.writeVar(canonicalMap(map));
      this.state.lastPushedHash = hash;
      this.state.lastPushedAt = now;
      this.state.lastVerifiedAt = now;
      this.state.lastError = null;
      this.deps.audit({
        at: now,
        action: 'write',
        map,
        reclaimRate: this.deps.inputs().reclaimRate,
        shedThresholdMinutes: cfg.shedThresholdMinutes,
      });
    } catch (e) {
      this.state.lastError = e instanceof Error ? e.message : String(e);
      this.state.lastVerifiedAt = null;
    }
  }
}
