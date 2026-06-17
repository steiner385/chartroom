import type { TriggerEvent, TriggerSpec } from './types';

/** Normalize a workflow `on:` block (object or array form) into a TriggerSpec.
 *  `workflow_call` yields no event — reusable-workflow jobs run under the caller's
 *  event, so the callee's own `on:` never triggers anything. */
export function parseTriggers(onBlock: unknown): TriggerSpec {
  const events: TriggerEvent[] = [];
  const add = (name: string, cfg: unknown) => {
    switch (name) {
      case 'pull_request': events.push({ kind: 'pull_request' }); break;
      case 'merge_group': events.push({ kind: 'merge_group' }); break;
      case 'push': {
        const branches = isObj(cfg) && Array.isArray(cfg.branches)
          ? (cfg.branches as unknown[]).map(String) : undefined;
        events.push(branches ? { kind: 'push', branches } : { kind: 'push' });
        break;
      }
      case 'workflow_dispatch': events.push({ kind: 'workflow_dispatch' }); break;
      case 'schedule': {
        const list = Array.isArray(cfg) ? cfg : [];
        for (const e of list) if (isObj(e) && typeof e.cron === 'string') events.push({ kind: 'schedule', cron: e.cron });
        break;
      }
      case 'workflow_run': {
        const workflows = isObj(cfg) && Array.isArray(cfg.workflows) ? (cfg.workflows as unknown[]).map(String) : [];
        const types = isObj(cfg) && Array.isArray(cfg.types) ? (cfg.types as unknown[]).map(String) : [];
        events.push({ kind: 'workflow_run', workflows, types });
        break;
      }
      // workflow_call: intentionally produces no event.
      default: break;
    }
  };

  if (Array.isArray(onBlock)) {
    for (const name of onBlock) if (typeof name === 'string') add(name, undefined);
  } else if (isObj(onBlock)) {
    for (const [name, cfg] of Object.entries(onBlock)) add(name, cfg);
  } else if (typeof onBlock === 'string') {
    add(onBlock, undefined);
  }
  return { events };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
