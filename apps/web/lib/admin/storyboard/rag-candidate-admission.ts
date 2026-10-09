export type StoryboardRagAdmissionCandidate = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  denseScore: number | null;
  sparseScore: number | null;
  weightedScore: number | null;
};

/** Admit across both pools before the paid reranker cap; never mix stored vector spaces. */
export function admitStoryboardRagCandidates(
  query: string, tokens: string[], dense: StoryboardRagAdmissionCandidate[], legacy: StoryboardRagAdmissionCandidate[],
): StoryboardRagAdmissionCandidate[] {
  const byId = new Map<string, StoryboardRagAdmissionCandidate>();
  for (const row of [...dense, ...legacy]) if (!byId.has(row.id)) byId.set(row.id, row);
  const phrase = query.toLowerCase().trim();
  return [...byId.values()].map((row, index) => {
    const content = row.content.toLowerCase();
    const title = content.split('\n\n')[0];
    return { row, index, exactTitle: title.trim() === phrase ? 1 : 0,
      phraseMatch: phrase && content.includes(phrase) ? 1 : 0,
      lexicalMatches: tokens.filter((token) => content.includes(token)).length };
  }).sort((a, b) => b.exactTitle - a.exactTitle || b.phraseMatch - a.phraseMatch
    || b.lexicalMatches - a.lexicalMatches || (b.row.weightedScore ?? -Infinity) - (a.row.weightedScore ?? -Infinity)
    || a.index - b.index).slice(0, 50).map(({ row }) => row);
}
