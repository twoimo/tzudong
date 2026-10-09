import { describe, expect, test } from 'bun:test';
import { admitStoryboardRagCandidates, type StoryboardRagAdmissionCandidate as Candidate } from '../lib/admin/storyboard/rag-candidate-admission';
const row = (id: string, content: string, score: number | null = null): Candidate => ({ id, content, metadata: { preserved: true }, denseScore: score, sparseScore: null, weightedScore: score });
describe('bounded admission across Gemini and legacy text pools', () => {
  test('exact legacy title survives a full fifty-row dense pool without old vector comparison', () => {
    const dense = Array.from({ length: 50 }, (_, i) => row(`dense-${i}`, '다른 제목\n\n국수 일부 관련', 1));
    const exact = row('exact-legacy', '국수\n\n보존된 편집');
    const result = admitStoryboardRagCandidates('국수', ['국수'], dense, [exact]);
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual(exact);
    expect(result.some((item) => item.id.startsWith('dense-'))).toBe(true);
    expect(result[0].denseScore).toBeNull();
  });
  test('lexical ranking from the dense pool also survives fifty strong legacy candidates', () => {
    const exact = row('exact-dense', '국수\n\n원본', 0.1);
    const legacy = Array.from({ length: 50 }, (_, i) => row(`legacy-${i}`, '일부\n\n국수 메뉴'));
    const result = admitStoryboardRagCandidates('국수', ['국수'], [exact], legacy);
    expect(result[0]).toEqual(exact);
    expect(result).toHaveLength(50);
  });
  test('deduplicates shared identities; empty and dense-only pools stay bounded and deterministic', () => {
    expect(admitStoryboardRagCandidates('국수', ['국수'], [], [])).toEqual([]);
    const dense = [row('same', '국수', 0.5), row('second', '기타', 0.8)];
    const result = admitStoryboardRagCandidates('국수', ['국수'], dense, [row('same', 'changed')]);
    expect(result).toEqual(dense);
    expect(admitStoryboardRagCandidates('no match', [], dense, []).map((item) => item.id)).toEqual(['second', 'same']);
  });
});
