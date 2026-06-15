import { describe, it, expect, vi } from 'vitest';
import { RunnerRoutingController } from '../runner-routing';

const baseCfg = { enabled: true, shedThresholdMinutes: 1, overrides: {}, reclaimWindow: '24h', targetRepo: 'cairnea/KinDash' };
function make(over = {}, cfgOver = {}) {
  const writeVar = vi.fn().mockResolvedValue(undefined);
  const deleteVar = vi.fn().mockResolvedValue(undefined);
  let t = 0;
  const ctl = new RunnerRoutingController({
    config: () => ({ ...baseCfg, ...cfgOver }),
    inputs: () => ({ jobs: [{ key: 'integration', p90Secs: 12 * 60 }], reclaimRate: 0.09 }),
    readVar: vi.fn().mockResolvedValue(null),
    writeVar, deleteVar, now: () => t, audit: vi.fn(), ...over,
  });
  return { ctl, writeVar, deleteVar, setTime: (v: number) => { t = v; } };
}

describe('RunnerRoutingController', () => {
  it('pushes the map on first tick when enabled and the map changed', async () => {
    const { ctl, writeVar } = make();
    await ctl.tick();
    expect(writeVar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeVar.mock.calls[0][0])).toEqual({ integration: 'kindash-arc' });
  });

  it('does not re-push an unchanged map (canonical hash compare)', async () => {
    const { ctl, writeVar } = make();
    await ctl.tick();
    await ctl.tick();
    expect(writeVar).toHaveBeenCalledTimes(1);
  });

  it('respects the min re-push interval even when the map changes', async () => {
    let jobs = [{ key: 'integration', p90Secs: 12 * 60 }];
    const { ctl, writeVar, setTime } = make({ inputs: () => ({ jobs, reclaimRate: 0.09 }) });
    await ctl.tick();                       // t=0 push #1
    jobs = [{ key: 'integration', p90Secs: 12 * 60 }, { key: 'unit', p90Secs: 12 * 60 }];
    setTime(60_000); await ctl.tick();      // 1 min later — within 5-min floor → no push
    expect(writeVar).toHaveBeenCalledTimes(1);
    setTime(6 * 60_000); await ctl.tick();  // 6 min — allowed
    expect(writeVar).toHaveBeenCalledTimes(2);
  });

  it('deletes the variable and never writes when disabled', async () => {
    const { ctl, writeVar, deleteVar } = make({}, { enabled: false });
    await ctl.tick();
    expect(writeVar).not.toHaveBeenCalled();
    expect(deleteVar).toHaveBeenCalledTimes(1);
  });

  it('the kill switch retries delete until it succeeds (must converge to deleted)', async () => {
    const deleteVar = vi.fn()
      .mockRejectedValueOnce(new Error('network'))   // first disabled tick fails
      .mockResolvedValueOnce(undefined);             // second succeeds
    const { ctl } = make({ deleteVar }, { enabled: false });
    await ctl.tick();
    expect(deleteVar).toHaveBeenCalledTimes(1);
    expect(ctl.getState().lastError).toMatch(/network/);
    await ctl.tick();                                 // retries because the first failed
    expect(deleteVar).toHaveBeenCalledTimes(2);
    expect(ctl.getState().lastError).toBeNull();
    await ctl.tick();                                 // now converged — no more deletes
    expect(deleteVar).toHaveBeenCalledTimes(2);
  });

  it('records lastError when a push fails and exposes it in getState()', async () => {
    const { ctl } = make({ writeVar: vi.fn().mockRejectedValue(new Error('rate limited')) });
    await ctl.tick();
    expect(ctl.getState().lastError).toMatch(/rate limited/);
    expect(ctl.getState().lastVerifiedAt).toBeNull();
  });
});
