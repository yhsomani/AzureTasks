import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ReadCoordinator } from '../src/presentation/api/read-coordinator.ts';

const consumers = 20;
const delayMs = 50;
async function measure(shared) {
  const coordinator = new ReadCoordinator();
  let upstreamCalls = 0;
  const load = async () => {
    upstreamCalls += 1;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { source: 'synthetic', records: 100 };
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: consumers }, () => shared ? coordinator.run('sample:week', load) : load()));
  return { upstreamCalls, elapsedMs: Number((performance.now() - started).toFixed(2)) };
}
const baseline = await measure(false);
const coordinated = await measure(true);
assert.equal(baseline.upstreamCalls, consumers);
assert.equal(coordinated.upstreamCalls, 1);
console.log(JSON.stringify({
  workload: { consumers, delayMs, scope: 'one identical authorized read' }, baseline, coordinated,
  interpretation: 'Synthetic concurrent call reduction only; no live latency or provider throughput claim.',
}, null, 2));