import type { KnowledgeEvidence } from '@/types/knowledge-graph';

export type KnowledgeEvidenceDisplay = {
  source: string;
  range: string;
  status: string;
};

function clock(seconds: number): string {
  const raw = String(seconds);
  if (/[eE]/.test(raw)) return `${raw}초`;
  const [wholeText, fraction] = raw.split('.');
  const whole = Number(wholeText);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secondsPart = whole % 60;
  const tail = fraction ? `.${fraction}` : '';
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}${tail}`
    : `${minutes}:${String(secondsPart).padStart(2, '0')}${tail}`;
}

export function formatKnowledgeEvidence(evidence: KnowledgeEvidence): KnowledgeEvidenceDisplay {
  const range = evidence.startSeconds === 0 && evidence.endSeconds === null
    ? '시간 정보 없음'
    : evidence.endSeconds === null
      ? `${clock(evidence.startSeconds)}부터`
      : evidence.endSeconds === evidence.startSeconds
        ? clock(evidence.startSeconds)
        : `${clock(evidence.startSeconds)}–${clock(evidence.endSeconds)}`;
  return {
    source: `YouTube · ${evidence.videoId}`,
    range,
    status: evidence.status === 'verified' ? '근거 있음' : '미확인',
  };
}
