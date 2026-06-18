import { renderHook } from '@testing-library/react';
import { joinApiUrl, ApiBaseProvider, useApiBase } from '../embed/ApiBaseContext';

describe('joinApiUrl', () => {
  it('joins base + path with exactly one slash', () => {
    expect(joinApiUrl('/api', '/events')).toBe('/api/events');
    expect(joinApiUrl('/api/ci/', '/events')).toBe('/api/ci/events'); // trailing slash trimmed
    expect(joinApiUrl('/api', 'events')).toBe('/api/events');         // missing leading slash added
  });
});

describe('useApiBase', () => {
  it('defaults to /api with no provider', () => {
    const { result } = renderHook(() => useApiBase());
    expect(result.current.apiUrl('/events')).toBe('/api/events');
    expect(result.current.withCredentials).toBe(false);
  });
  it('uses the provider base + withCredentials', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <ApiBaseProvider base="/api/ci" withCredentials>{children}</ApiBaseProvider>;
    const { result } = renderHook(() => useApiBase(), { wrapper });
    expect(result.current.apiUrl('/events')).toBe('/api/ci/events');
    expect(result.current.withCredentials).toBe(true);
  });
});
