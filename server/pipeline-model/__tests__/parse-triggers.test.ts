import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { parseTriggers } from '../parse-triggers';

const on = (yaml: string) => parseTriggers(parse(yaml).on);

describe('parseTriggers', () => {
  it('normalizes the common CI trigger set', () => {
    const spec = on(`on:\n  pull_request:\n  merge_group:\n  push:\n    branches: [main]`);
    expect(spec.events).toEqual([
      { kind: 'pull_request' },
      { kind: 'merge_group' },
      { kind: 'push', branches: ['main'] },
    ]);
  });

  it('parses schedule, workflow_dispatch, and workflow_run', () => {
    const spec = on(`on:\n  schedule:\n    - cron: '0 7 * * *'\n  workflow_dispatch:\n  workflow_run:\n    workflows: [Post-deploy smoke]\n    types: [completed]`);
    expect(spec.events).toContainEqual({ kind: 'schedule', cron: '0 7 * * *' });
    expect(spec.events).toContainEqual({ kind: 'workflow_dispatch' });
    expect(spec.events).toContainEqual({ kind: 'workflow_run', workflows: ['Post-deploy smoke'], types: ['completed'] });
  });

  it('handles the array form (`on: [push, pull_request]`)', () => {
    const spec = on(`on: [push, pull_request]`);
    expect(spec.events).toEqual([{ kind: 'push' }, { kind: 'pull_request' }]);
  });

  it('treats workflow_call as no triggering event (reusable workflows inherit the caller)', () => {
    const spec = on(`on:\n  workflow_call:`);
    expect(spec.events).toEqual([]);
  });
});
