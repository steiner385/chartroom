import { describe, it, expect } from 'vitest';
import { resolveJobPool } from '../pool-resolve';

describe('resolveJobPool', () => {
  it('single self-hosted ARC label → that label, not github-hosted', () => {
    expect(resolveJobPool({ labels: ['kindash-arc'], runnerGroupName: 'arc-pool' }))
      .toEqual({ pool: 'kindash-arc', githubHosted: false });
  });

  it('ubuntu-latest → github-hosted, pool = the label', () => {
    expect(resolveJobPool({ labels: ['ubuntu-latest'], runnerGroupName: 'GitHub Actions' }))
      .toEqual({ pool: 'ubuntu-latest', githubHosted: true });
  });

  it('windows-2022 / macos-14 → github-hosted by label prefix even without the group name', () => {
    expect(resolveJobPool({ labels: ['windows-2022'], runnerGroupName: 'whatever' }))
      .toEqual({ pool: 'windows-2022', githubHosted: true });
    expect(resolveJobPool({ labels: ['macos-14'], runnerGroupName: null }))
      .toEqual({ pool: 'macos-14', githubHosted: true });
  });

  it('runner_group_name === "GitHub Actions" forces github-hosted even with a non-prefixed label', () => {
    // larger hosted runners carry custom labels but the group name is the tell
    expect(resolveJobPool({ labels: ['ubuntu-latest-8-cores'], runnerGroupName: 'GitHub Actions' }))
      .toEqual({ pool: 'ubuntu-latest-8-cores', githubHosted: true });
  });

  it('self-hosted with generic labels → meaningful labels joined, generics dropped', () => {
    expect(resolveJobPool({
      labels: ['self-hosted', 'linux', 'x64', 'kindash-ondemand'],
      runnerGroupName: 'Default',
    })).toEqual({ pool: 'kindash-ondemand', githubHosted: false });
  });

  it('multiple meaningful self-hosted labels → joined with |, stable order preserved', () => {
    expect(resolveJobPool({
      labels: ['self-hosted', 'linux', 'kindash-arc', 'gpu'],
      runnerGroupName: 'Default',
    })).toEqual({ pool: 'kindash-arc|gpu', githubHosted: false });
  });

  it('only generic labels remain → fall back to runner_group_name', () => {
    expect(resolveJobPool({
      labels: ['self-hosted', 'linux', 'x64'],
      runnerGroupName: 'kindash-ondemand-group',
    })).toEqual({ pool: 'kindash-ondemand-group', githubHosted: false });
  });

  it('generic labels with arm64 dropped too', () => {
    expect(resolveJobPool({
      labels: ['self-hosted', 'linux', 'arm64', 'kindash-arm'],
      runnerGroupName: 'Default',
    })).toEqual({ pool: 'kindash-arm', githubHosted: false });
  });

  it('no usable labels and no group name → unknown', () => {
    expect(resolveJobPool({ labels: [], runnerGroupName: null }))
      .toEqual({ pool: 'unknown', githubHosted: false });
    expect(resolveJobPool({ labels: ['self-hosted'], runnerGroupName: null }))
      .toEqual({ pool: 'unknown', githubHosted: false });
  });

  it('case-insensitive generic matching (Linux, X64, Self-Hosted)', () => {
    expect(resolveJobPool({
      labels: ['Self-Hosted', 'Linux', 'X64', 'kindash-arc'],
      runnerGroupName: 'Default',
    })).toEqual({ pool: 'kindash-arc', githubHosted: false });
  });

  it('blank/whitespace labels are ignored', () => {
    expect(resolveJobPool({
      labels: ['', '  ', 'kindash-arc'],
      runnerGroupName: 'Default',
    })).toEqual({ pool: 'kindash-arc', githubHosted: false });
  });

  it('github-hosted detection takes precedence: a hosted label wins even alongside generics', () => {
    expect(resolveJobPool({
      labels: ['self-hosted', 'ubuntu-latest'],
      runnerGroupName: 'Default',
    }).githubHosted).toBe(true);
  });
});
