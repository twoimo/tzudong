import assert from 'node:assert/strict';
import { computeTimeoutMs } from '../split_video_chunks.mjs';

assert.equal(Number.isInteger(computeTimeoutMs(1805.6000000000004)), true);
assert.equal(computeTimeoutMs(1805.6000000000004), 3731201);
assert.equal(computeTimeoutMs(1), 15 * 60 * 1000);
assert.equal(Number.isInteger(computeTimeoutMs(1807.8999999999996)), true);
