import { useFocusedPipeline } from './PipelineSwitcher';

/** Resolve the focused repo: controlled (host-owned, no persist/adopt) or sticky.
 *  When uncontrolled, the focus is shareable via ?pipeline= (#191) unless the host
 *  opts out with allowPipelineInUrl=false. */
export function useFocusedRepo(
  { controlled, onChange, repos, allowPipelineInUrl = true }:
  { controlled?: string; onChange?: (repo: string) => void; repos: readonly string[]; allowPipelineInUrl?: boolean },
): [string | null, (repo: string) => void] {
  const isControlled = controlled !== undefined;
  // Controlled mode (host owns focus + URL) never reads/writes the URL or storage.
  const [sticky, setSticky] = useFocusedPipeline(repos, !isControlled, !isControlled && allowPipelineInUrl);
  if (isControlled) return [controlled as string, (r) => onChange?.(r)];
  return [sticky, setSticky];
}
