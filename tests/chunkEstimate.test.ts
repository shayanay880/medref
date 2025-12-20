import assert from 'node:assert';
import { createChunkEstimator, CHUNK_SIZE_CHARS } from '../services/pipelineService';

const makeFakeSplitter = () => {
  let calls = 0;
  const fn = (text: string) => {
    calls += 1;
    return [{ text, start: 0, end: text.length }];
  };
  return { fn, getCalls: () => calls };
};

const makeNowProvider = (ticks: number[]) => {
  let index = 0;
  return () => ticks[Math.min(index++, ticks.length - 1)];
};

const largeText = 'x'.repeat(CHUNK_SIZE_CHARS + 5000);

const { fn: splitter, getCalls } = makeFakeSplitter();
const estimator = createChunkEstimator(splitter, makeNowProvider([0, 50, 90, 350]));

// First call should invoke the splitter once.
assert.strictEqual(estimator(largeText), 1);
assert.strictEqual(getCalls(), 1);

// Rapid small edits within the throttle window should reuse the cached result.
assert.strictEqual(estimator(`${largeText}!`), 1);
assert.strictEqual(estimator(`${largeText}!!`), 1);
assert.strictEqual(getCalls(), 1);

// After enough time has passed, the splitter can run again for a materially new edit.
assert.strictEqual(estimator(`${largeText}!!!`), 1);
assert.strictEqual(getCalls(), 2);

console.log('Chunk estimator throttling checks passed');
