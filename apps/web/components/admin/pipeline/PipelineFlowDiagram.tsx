'use client';

import { useEffect, useRef, useState } from 'react';
import { PIPELINE_FLOW_EDGES, PIPELINE_STAGE_LABELS, type PipelineStageId, type PipelineStageView } from '@/lib/admin/pipeline-flow-view-model';
import styles from './PipelineFlowDiagram.module.css';

export function formatPipelineDuration(seconds: number | null): string {
  if (seconds === null) return '시간 미확인';
  if (seconds >= 3600) return `${(seconds / 3600).toLocaleString('ko-KR', { notation: 'compact', maximumFractionDigits: 1 })}시간`;
  if (seconds < 60) return `${seconds.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
  return `${Math.floor(seconds / 60)}분 ${(seconds % 60).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
}

export function PipelineFlowDiagram({ stages, selected, onSelect }: { stages: PipelineStageView[]; selected: PipelineStageId; onSelect: (id: PipelineStageId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width) setWidth(Math.max(260, Math.floor(width))); });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const compact = width < 760;
  const cols = compact ? 2 : 5;
  const cell = width / cols;
  const nodeWidth = Math.min(compact ? 210 : 170, cell - 28);
  const nodeHeight = 70;
  const compactOrder: PipelineStageId[] = ['collect', 'media', 'transcript', 'extract', 'select', 'evaluate', 'persist', 'review'];
  const wide: Record<PipelineStageId, [number, number]> = { collect: [0, 1], media: [1, 0], transcript: [1, 2], extract: [2, 0], select: [2, 2], evaluate: [3, 2], persist: [4, 2], review: [4, 0] };
  const positions = new Map(stages.map(stage => {
    const index = compactOrder.indexOf(stage.id);
    const [column, row] = compact ? [index % 2, Math.floor(index / 2)] : wide[stage.id];
    return [stage.id, { x: cell * (column + 0.5), y: compact ? 48 + row * 103 : 48 + row * 83 }];
  }));
  const move = (id: PipelineStageId, direction: number) => {
    const index = compactOrder.indexOf(id), next = compactOrder[(index + direction + compactOrder.length) % compactOrder.length];
    onSelect(next);
    svg.current?.querySelector<SVGGElement>(`[data-pipeline-stage="${next}"]`)?.focus();
  };
  return <div ref={host} className="min-w-0" data-pipeline-flow-diagram>
    <svg ref={svg} width="100%" height={compact ? 405 : 267} viewBox={`0 0 ${width} ${compact ? 405 : 267}`} className={styles.diagram} role="group" aria-label="크롤러 데이터 흐름 · 방향키로 단계 이동">
      <defs><marker id="pipeline-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" className={styles.arrow} /></marker></defs>
      {PIPELINE_FLOW_EDGES.map(edge => {
        const a = positions.get(edge.from)!, b = positions.get(edge.to)!;
        let path: string;
        if (a.x === b.x) path = `M${a.x},${a.y + (b.y > a.y ? nodeHeight / 2 : -nodeHeight / 2)}V${b.y + (b.y > a.y ? -nodeHeight / 2 : nodeHeight / 2)}`;
        else if (compact && b.y > a.y) { const mid = (a.y + b.y) / 2; path = `M${a.x},${a.y + nodeHeight / 2}V${mid}H${b.x}V${b.y - nodeHeight / 2}`; }
        else { const start = a.x + nodeWidth / 2, end = b.x - nodeWidth / 2, mid = (start + end) / 2; path = `M${start},${a.y}H${mid}V${b.y}H${end}`; }
        return <path key={`${edge.from}-${edge.to}`} d={path} className={selected === edge.from || selected === edge.to ? styles.activeEdge : styles.edge} markerEnd="url(#pipeline-flow-arrow)"><title>{edge.label}</title></path>;
      })}
      {stages.map(stage => {
        const p = positions.get(stage.id)!;
        return <g key={stage.id} role="button" tabIndex={0} aria-pressed={selected === stage.id} aria-label={`${stage.label}: ${PIPELINE_STAGE_LABELS[stage.state]}, ${formatPipelineDuration(stage.durationSeconds)}`} data-pipeline-stage={stage.id} data-stage-state={stage.state} className={`${styles.node} ${styles[stage.state]} ${selected === stage.id ? styles.selected : ''}`} onClick={() => onSelect(stage.id)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(stage.id); }
          if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); move(stage.id, event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1); }
        }}>
          <rect x={p.x - nodeWidth / 2} y={p.y - nodeHeight / 2} width={nodeWidth} height={nodeHeight} rx="9" />
          <text x={p.x} y={p.y - 12} textAnchor="middle" className={styles.title}>{stage.label}</text>
          <text x={p.x} y={p.y + 8} textAnchor="middle" className={styles.status}>{PIPELINE_STAGE_LABELS[stage.state]}</text>
          <text x={p.x} y={p.y + 25} textAnchor="middle" className={styles.time}>{formatPipelineDuration(stage.durationSeconds)}</text>
        </g>;
      })}
    </svg>
  </div>;
}
