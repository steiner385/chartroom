import { sectionFromPath, pathForSection, joinPath } from '../shell/sections';

describe('sectionFromPath', () => {
  const B = '/console/ci';
  it('reads the first segment after the basename', () => {
    expect(sectionFromPath('/console/ci/diagnose', B)).toBe('diagnose');
  });
  it('returns null (→ default) for the exact basename or a trailing slash', () => {
    expect(sectionFromPath('/console/ci', B)).toBeNull();
    expect(sectionFromPath('/console/ci/', B)).toBeNull();
  });
  it('takes only the first segment of a nested tail', () => {
    expect(sectionFromPath('/console/ci/diagnose/pr/42', B)).toBe('diagnose');
  });
  it('returns null when the basename is not a prefix', () => {
    expect(sectionFromPath('/elsewhere/health', B)).toBeNull();
  });
  it('resolves retired aliases the same as hash mode', () => {
    expect(sectionFromPath('/console/ci/metrics', B)).toBe('insights');
  });
});

describe('joinPath / pathForSection', () => {
  it('joins with one slash and trims a trailing basename slash', () => {
    expect(joinPath('/console/ci', 'diagnose')).toBe('/console/ci/diagnose');
    expect(joinPath('/console/ci/', 'diagnose')).toBe('/console/ci/diagnose');
    expect(pathForSection('health', '/console/ci')).toBe('/console/ci/health');
  });
});
