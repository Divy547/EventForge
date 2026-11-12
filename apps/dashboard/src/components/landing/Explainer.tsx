import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** One caption per step; the loop moves through them in order. */
const CAPTIONS = [
  'Your app sends an event. The API answers 202 Accepted right away.',
  'The event and its deliveries are saved in one database transaction (the outbox).',
  'The worker picks them up and fans the event out to every subscribed endpoint.',
  'One endpoint returns 503. The worker waits 4 s plus jitter, retries, and it succeeds.',
  'Another endpoint keeps failing. Out of retries, its delivery lands in the dead-letter queue, ready to replay.',
] as const;

/** 5 steps x 3.2 s = a 16 s loop. */
const STEP_MS = 3200;

interface NodeSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Steps during which the node is highlighted. */
  steps: number[];
}

const W = 112;
const H = 44;

const NODES: NodeSpec[] = [
  { id: 'app', label: 'Your app', x: 8, y: 108, steps: [0] },
  { id: 'api', label: 'API', x: 156, y: 108, steps: [0, 1] },
  { id: 'outbox', label: 'Outbox', x: 304, y: 108, steps: [1, 2] },
  { id: 'worker', label: 'Worker', x: 452, y: 108, steps: [2, 3, 4] },
  { id: 'a', label: 'Endpoint A', x: 640, y: 28, steps: [2] },
  { id: 'b', label: 'Endpoint B', x: 640, y: 108, steps: [3] },
  { id: 'c', label: 'Endpoint C', x: 640, y: 188, steps: [4] },
];

const EDGES: [string, string][] = [
  ['app', 'api'],
  ['api', 'outbox'],
  ['outbox', 'worker'],
  ['worker', 'a'],
  ['worker', 'b'],
  ['worker', 'c'],
];

/** Where the travelling event sits at each step (centre of the node it has reached). */
const DOT_AT: { x: number; y: number }[] = [
  { x: 156 + W / 2, y: 108 + H / 2 },
  { x: 304 + W / 2, y: 108 + H / 2 },
  { x: 452 + W / 2, y: 108 + H / 2 },
  { x: 640 + W / 2, y: 108 + H / 2 },
  { x: 640 + W / 2, y: 188 + H / 2 },
];

/** Outcome badges. `from` is the first step at which the badge shows. */
const BADGES = [
  { node: 'a', text: '200 OK', from: 2 },
  { node: 'b', text: '503, then 200 OK', from: 3 },
  { node: 'c', text: 'Dead letter', from: 4 },
] as const;

const byId = (id: string): NodeSpec => {
  const node = NODES.find((n) => n.id === id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
};

export function Explainer() {
  const reducedMotion = useReducedMotion() ?? false;
  const [playing, setPlaying] = useState(true);
  const [step, setStep] = useState(0);

  const animated = !reducedMotion;

  useEffect(() => {
    if (!animated || !playing) return;
    const timer = window.setInterval(() => setStep((s) => (s + 1) % CAPTIONS.length), STEP_MS);
    return () => window.clearInterval(timer);
  }, [animated, playing]);

  // Reduced motion shows everything at once: every node lit, every outcome visible, no movement.
  const lit = (node: NodeSpec): boolean => !animated || node.steps.includes(step);
  const badgeShown = (from: number): boolean => !animated || step >= from;

  return (
    <section aria-labelledby="explainer-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="explainer-title" className="text-xl font-semibold">
          How an event travels
        </h2>
        {animated && (
          <Button
            variant="outline"
            onClick={() => setPlaying((p) => !p)}
            className="border-navy-foreground/30 bg-transparent text-navy-foreground hover:bg-navy-foreground/10 hover:text-navy-foreground"
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            {playing ? 'Pause animation' : 'Play animation'}
          </Button>
        )}
      </div>

      {/* On phones the diagram keeps its size and scrolls sideways instead of shrinking. */}
      <div
        className="overflow-x-auto rounded-lg border border-navy-foreground/15 bg-navy-foreground/5"
        // Keyboard users need to be able to scroll the box.
        tabIndex={0}
        role="group"
        aria-label="Diagram of an event moving from your app through the API, outbox and worker to three endpoints"
      >
        <svg viewBox="0 0 760 240" className="h-auto min-w-[640px] w-full" aria-hidden>
          {EDGES.map(([from, to]) => {
            const a = byId(from);
            const b = byId(to);
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x + W}
                y1={a.y + H / 2}
                x2={b.x}
                y2={b.y + H / 2}
                className="stroke-navy-foreground/30"
                strokeWidth={2}
              />
            );
          })}
          {NODES.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={W}
                height={H}
                rx={8}
                className={
                  lit(node)
                    ? 'fill-navy-foreground stroke-navy-foreground'
                    : 'fill-navy-foreground/10 stroke-navy-foreground/30'
                }
                strokeWidth={2}
              />
              <text
                x={node.x + W / 2}
                y={node.y + H / 2 + 5}
                textAnchor="middle"
                className={
                  'font-sans text-[14px] font-semibold ' +
                  (lit(node) ? 'fill-navy' : 'fill-navy-foreground')
                }
              >
                {node.label}
              </text>
            </g>
          ))}
          {BADGES.map(({ node, text, from }) => {
            const n = byId(node);
            return (
              <text
                key={node}
                x={n.x + W / 2}
                y={n.y + H + 16}
                textAnchor="middle"
                className="fill-navy-foreground font-mono text-[12px]"
                opacity={badgeShown(from) ? 1 : 0}
              >
                {text}
              </text>
            );
          })}
          {animated && (
            <motion.circle
              r={9}
              className="fill-navy-foreground stroke-navy"
              strokeWidth={2}
              initial={false}
              animate={{ cx: DOT_AT[step]!.x, cy: DOT_AT[step]!.y }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
            />
          )}
        </svg>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {CAPTIONS.map((caption, index) => {
          const current = animated && index === step;
          return (
            <li
              key={caption}
              aria-current={current ? 'step' : undefined}
              className={
                'rounded-md border p-3 text-sm transition-colors ' +
                (current
                  ? 'border-navy-foreground bg-navy-foreground/15'
                  : 'border-navy-foreground/15 text-navy-foreground/80')
              }
            >
              <span className="mr-1 font-mono font-semibold">{index + 1}.</span>
              {caption}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-navy-foreground/70">
        Endpoint names and the retry story are illustrative, not live data.
      </p>
    </section>
  );
}
