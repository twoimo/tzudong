import { expect, test } from 'bun:test';
import { formatKnowledgeEvidence } from '../lib/admin/knowledge-graph-evidence';
import type { KnowledgeEvidence } from '../types/knowledge-graph';

const evidence = (overrides: Partial<KnowledgeEvidence> = {}): KnowledgeEvidence => ({
  videoId: 'ABCDEFGHIJK',
  startSeconds: 0,
  endSeconds: null,
  url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
  status: 'unverified',
  ...overrides,
});

test('identifies the YouTube source without implying viewing coverage for untimed evidence', () => {
  expect(formatKnowledgeEvidence(evidence())).toEqual({
    source: 'YouTube · ABCDEFGHIJK',
    range: '시간 정보 없음',
    status: '미확인',
  });
});

test('formats exact bounded and open timestamps without flooring fractional seconds', () => {
  expect(formatKnowledgeEvidence(evidence({ startSeconds: 12.5, endSeconds: 75.25 }))).toMatchObject({ range: '0:12.5–1:15.25' });
  expect(formatKnowledgeEvidence(evidence({ startSeconds: 3723.125, endSeconds: null }))).toMatchObject({ range: '1:02:03.125부터' });
});

test('keeps a zero-length verified range as one exact timestamp', () => {
  expect(formatKnowledgeEvidence(evidence({ startSeconds: 191, endSeconds: 191, status: 'verified' }))).toEqual({
    source: 'YouTube · ABCDEFGHIJK',
    range: '3:11',
    status: '근거 있음',
  });
});
