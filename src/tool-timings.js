import { AsyncLocalStorage } from 'node:async_hooks';

const timings = new AsyncLocalStorage();

export function withToolTimings(callback) {
  return timings.run({ phases: [] }, callback);
}

export function recordPhase(phase, startedAt, attributes = {}) {
  const current = timings.getStore();
  if (!current || current.phases.length >= 12) return;
  current.phases.push({ phase, durationMs: Math.round(performance.now() - startedAt), ...attributes });
}

export function toolPhases() {
  return timings.getStore()?.phases ?? [];
}
