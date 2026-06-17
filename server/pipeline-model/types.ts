/** Confidence in a statically-derived fact. 'low' means a construct could not be
 *  fully resolved (complex if:, unexpandable matrix, unresolved uses:) and the
 *  broadest interpretation was kept (spec §5.5: parse gaps → drift, not failure). */
export type Confidence = 'high' | 'low';

export type TriggerEvent =
  | { kind: 'pull_request' }
  | { kind: 'merge_group' }
  | { kind: 'push'; branches?: string[] }
  | { kind: 'schedule'; cron: string }
  | { kind: 'workflow_dispatch' }
  | { kind: 'workflow_run'; workflows: string[]; types: string[] };

export interface TriggerSpec {
  events: TriggerEvent[];
}
