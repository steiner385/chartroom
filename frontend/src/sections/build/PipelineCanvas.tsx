// Read-only pipeline DAG lanes (spec visual-editor §2.1, Increment 4 — first
// sub-step: layout → nodes). Lanes are protection tiers (columns); nodes are the
// checks that run there. Gating is shown COLOR-INDEPENDENTLY (the word is in the
// accessible name, never color alone — sibling spec §16 a11y). Drag-to-retier, the
// node inspector, and `needs:` edges are the next sub-steps.
import type { Lane, LaneNode } from './laneLayout';

function gatingWord(n: LaneNode): string {
  if (n.gates) return 'gate';
  if (n.conditional) return 'conditional';
  return 'advisory';
}

function CanvasNode({ tierId, node }: { tierId: string; node: LaneNode }) {
  const word = gatingWord(node);
  const cls = node.gates ? 'gate' : node.conditional ? 'conditional' : 'advisory';
  return (
    <li className={`canvas-node n-${cls}`} data-testid={`node-${tierId}-${node.check}`}
      aria-label={`${node.check} — ${word}`}>
      <span className="canvas-node-name">{node.check}</span>
      <span className="canvas-node-gate" aria-hidden="true">{word}</span>
    </li>
  );
}

export function PipelineCanvas({ lanes }: { lanes: Lane[] }) {
  const total = lanes.reduce((n, l) => n + l.nodes.length, 0);
  if (total === 0) return <div className="pipeline-canvas empty" role="status">No checks to lay out yet.</div>;
  return (
    <div className="pipeline-canvas" role="group" aria-label="Pipeline lanes">
      {lanes.map((lane) => (
        <section key={lane.tierId} className="canvas-lane" data-testid={`lane-${lane.tierId}`} aria-label={`${lane.label} tier`}>
          <header className="canvas-lane-head">
            <span className="canvas-lane-label">{lane.label}</span>
            <span className="canvas-lane-event">{lane.event}</span>
          </header>
          <ul className="canvas-lane-nodes" role="list">
            {lane.nodes.map((n) => <CanvasNode key={n.check} tierId={lane.tierId} node={n} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
