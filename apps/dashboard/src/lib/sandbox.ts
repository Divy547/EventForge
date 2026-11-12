import type { SandboxScenario } from '@/lib/api';

export interface ScenarioInfo {
  id: SandboxScenario;
  label: string;
  description: string;
}

/** Mirrors `SANDBOX_SCENARIO_INFO` in @eventforge/common (not imported: that package is Node-only). */
export const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'succeed',
    label: 'Always succeeds',
    description: 'The receiver answers 200 straight away.',
  },
  {
    id: 'flaky',
    label: 'Fails twice, then succeeds',
    description: 'The receiver answers 503 for the first two attempts; the retries get through.',
  },
  {
    id: 'fail',
    label: 'Always fails',
    description:
      'The receiver answers 500 every time, so the delivery ends in the dead-letter queue.',
  },
  {
    id: 'slow',
    label: 'Too slow',
    description: 'The receiver takes longer than the delivery timeout, so every attempt times out.',
  },
];
