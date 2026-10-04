'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { PIPELINE_FLOW_EDGES, type PipelineStageState, type PipelineStageId, type PipelineStageView } from '@/lib/admin/pipeline-flow-view-model';
import styles from './PipelineFlowDiagram.module.css';

export const COMPACT_STAGE_LABELS: Record<PipelineStageState, string> = { completed: '완료', failed: '실패', skipped: '선택 생략', blocked: '선행 단계로 생략', partial: '일부 기록', unknown: '미확인', manual: '검수' };

export function formatPipelineDuration(seconds: number | null): string {
  if (seconds === null) return '시간 미확인';
  if (seconds >= 3600) return `${(seconds / 3600).toLocaleString('ko-KR', { notation: 'compact', maximumFractionDigits: 1 })}시간`;
  if (seconds < 60) return `${seconds.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
  return `${Math.floor(seconds / 60)}분 ${(seconds % 60).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
}

export function PipelineFlowDiagram({ stages, selected, onSelect }: { stages: PipelineStageView[]; selected: PipelineStageId; onSelect: (id: PipelineStageId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const arrowId = useId().replace(/:/g, "");
  const [{ width, height }, setSize] = useState({ width: 960, height: 640 });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box?.width && box.height) setSize({ width: Math.max(260, Math.floor(box.width)), height: Math.max(1, Math.floor(box.height)) });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const vertical = width < 1050;
  const nodeWidth = vertical ? Math.min(196, width / 2 - 24) : Math.min(164, (width - 40) / 7 - 18);
  const nodeHeight = 64;
  const order: PipelineStageId[] = ['collect', 'media', 'transcript', 'extract', 'select', 'evaluate', 'persist', 'review'];
  const rank: Record<PipelineStageId, number> = { collect: 0, media: 1, transcript: 1, extract: 2, select: 3, evaluate: 4, persist: 5, review: 6 };
  const horizontalInset = nodeWidth / 2 + 22;
  const verticalInset = 64;
  const positions = new Map(stages.map(stage => {
    const branch = stage.id === 'media' ? -1 : stage.id === 'transcript' ? 1 : 0;
    return [stage.id, vertical
      ? { x: width / 2 + branch * Math.min(width / 4, 160), y: verticalInset + rank[stage.id] * (height - 2 * verticalInset) / 6 }
      : { x: horizontalInset + rank[stage.id] * (width - 2 * horizontalInset) / 6, y: height / 2 + branch * Math.min(170, height * .28) }];
  }));
  const move = (id: PipelineStageId, direction: number) => {
    const index = order.indexOf(id), next = order[(index + direction + order.length) % order.length];
    svg.current?.querySelector<SVGGElement>(`[data-pipeline-stage="${next}"]`)?.focus();
  };
  return <div ref={host} className={styles.diagramHost} data-pipeline-flow-diagram data-flow-direction={vertical ? "vertical" : "horizontal"}>
    <svg ref={svg} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className={styles.diagram} role="group" aria-label="크롤러 데이터 흐름 · 방향키로 이동, Enter로 단계 상세 열기">
      <defs><marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" className={styles.arrow} /></marker></defs>
      {PIPELINE_FLOW_EDGES.map(edge => {
        const a = positions.get(edge.from)!, b = positions.get(edge.to)!;
        const path = vertical
          ? `M${a.x},${a.y + nodeHeight / 2}V${(a.y + b.y) / 2}H${b.x}V${b.y - nodeHeight / 2}`
          : `M${a.x + nodeWidth / 2},${a.y}H${(a.x + b.x) / 2}V${b.y}H${b.x - nodeWidth / 2}`;
        return <path key={`${edge.from}-${edge.to}`} d={path} className={selected === edge.from || selected === edge.to ? styles.activeEdge : styles.edge} markerEnd={`url(#${arrowId})`}><title>{edge.label}</title></path>;
      })}
      {stages.map(stage => {
        const p = positions.get(stage.id)!;
        return <g key={stage.id} role="button" tabIndex={0} aria-haspopup="dialog" aria-pressed={selected === stage.id} aria-label={`${stage.label}: ${COMPACT_STAGE_LABELS[stage.state]}, ${formatPipelineDuration(stage.durationSeconds)}`} data-pipeline-stage={stage.id} data-stage-state={stage.state} className={`${styles.node} ${styles[stage.state]} ${selected === stage.id ? styles.selected : ''}`} onClick={() => onSelect(stage.id)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(stage.id); }
          if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); move(stage.id, event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1); }
        }}>
          <rect x={p.x - nodeWidth / 2} y={p.y - nodeHeight / 2} width={nodeWidth} height={nodeHeight} rx="12" />
          <text x={p.x} y={p.y - 6} textAnchor="middle" className={styles.title}>{stage.label}</text>
          <text x={p.x} y={p.y + 16} textAnchor="middle" className={styles.status}>{COMPACT_STAGE_LABELS[stage.state]}</text>
        </g>;
      })}
    </svg>
  </div>;
}
