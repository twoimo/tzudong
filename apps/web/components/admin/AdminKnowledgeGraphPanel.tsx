'use client';

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, Network, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isKnowledgeGraphPage, KNOWLEDGE_KINDS, type KnowledgeKind } from '@/types/knowledge-graph';

const labels: Record<KnowledgeKind, string> = { hub: '프로젝트', video: '영상', restaurant: '맛집', menu: '메뉴', claim: '분석' };
const colors: Record<KnowledgeKind, string> = { hub: '#e11d48', video: '#0d9488', restaurant: '#d97706', menu: '#7c3aed', claim: '#2563eb' };
const number = new Intl.NumberFormat('ko-KR');

export function AdminKnowledgeGraphPanel() {
  const [search, setSearch] = useState(''), [kind, setKind] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | null>>([null]), [scale, setScale] = useState(1);
  const q = useDeferredValue(search), cursor = cursors.at(-1) ?? null;
  const query = useQuery({ queryKey: ['admin-knowledge-graph', q, kind, cursor, selected], retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q, kind, limit: '100' });
      if (cursor) params.set('cursor', cursor); if (selected) params.set('node', selected);
      const response = await fetch(`/api/admin/knowledge-graph?${params}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 409 ? 'knowledge_cursor_stale' : 'knowledge_unavailable');
      const value: unknown = await response.json(); if (!isKnowledgeGraphPage(value)) throw new Error('knowledge_unavailable'); return value;
    } });
  const data = query.data, current = data?.selected ?? data?.nodes.find(node => node.id === selected) ?? null;
  const layout = useMemo(() => {
    const nodes = data?.nodes ?? [], result = new Map<string, { x: number; y: number }>();
    const kinds = KNOWLEDGE_KINDS.filter(kind => nodes.some(node => node.kind === kind));
    for (const [column, value] of kinds.entries()) {
      const group = nodes.filter(node => node.kind === value);
      group.forEach((node, index) => result.set(node.id, { x: 82 + column * 152, y: 58 + index * 58 }));
    }
    return { positions: result, width: Math.max(320, kinds.length * 152 + 20), height: Math.max(300, 116 + Math.max(0, ...KNOWLEDGE_KINDS.map(kind => nodes.filter(node => node.kind === kind).length)) * 58) };
  }, [data?.nodes]);
  const resetPage = () => setCursors([null]);
  const reload = () => {
    if (cursor === null) void query.refetch();
    else resetPage();
  };
  return <div className="flex min-h-[360px] min-w-0 flex-col md:h-full" data-admin-knowledge-graph-panel>
    <AdminPageHeader title="쯔양 지식 그래프" icon={Network}
      summary={<span className="text-xs tabular-nums text-muted-foreground">분석 {data ? number.format(data.coverage.analyzedCount) : '—'} / {data?.coverage.eligibleCount == null ? '대상 확인 중' : number.format(data.coverage.eligibleCount)}</span>}
      actions={<><Button size="sm" variant="ghost" disabled={query.isFetching} aria-label="지식 그래프 새로고침" onClick={reload}><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /></Button></>}
    />
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <label className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><input aria-label="지식 검색" value={search} onChange={event => { setSearch(event.target.value); resetPage(); }} maxLength={256} placeholder="영상·맛집·메뉴 검색" className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs" /></label>
      <select aria-label="지식 종류" value={kind} onChange={event => { setKind(event.target.value); resetPage(); }} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="">전체</option>{KNOWLEDGE_KINDS.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select>
      {data ? <span className="text-xs tabular-nums text-muted-foreground">{number.format(data.totalNodes)}개 · 연결 {number.format(data.totalEdges)}</span> : null}
    </div>
    {query.isPending ? <p className="p-3 text-sm text-muted-foreground" role="status">지식 그래프 불러오는 중…</p> : query.isError ? <div className="p-3 text-sm" role="alert"><p>{query.error.message === 'knowledge_cursor_stale' ? '분석 결과가 갱신되었습니다.' : '지식 그래프를 불러올 수 없습니다.'}</p><Button size="sm" variant="outline" className="mt-2" onClick={reload}>다시 조회</Button></div>
      : data ? <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(140px,0.65fr)_minmax(0,2fr)_minmax(180px,0.85fr)]">
        <div className="max-h-48 min-w-0 overflow-y-auto border-b md:max-h-none md:border-b-0 md:border-r"><ul aria-label="지식 목록" className="divide-y">{data.nodes.map(node => <li key={node.id}><button type="button" aria-pressed={selected === node.id} onClick={() => setSelected(node.id)} className={`w-full min-w-0 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected === node.id ? 'bg-muted' : ''}`}><span className="text-[10px] text-muted-foreground">{labels[node.kind]}</span><p className="truncate text-xs font-medium">{node.label}</p></button></li>)}</ul>{data.nodes.length === 0 ? <p className="p-3 text-xs text-muted-foreground">일치하는 지식이 없습니다.</p> : null}</div>
        <div className="relative min-h-[300px] min-w-0 border-b md:border-b-0 md:border-r">
          <div className="absolute right-2 top-2 z-10 flex gap-1"><Button size="sm" variant="outline" aria-label="그래프 축소" disabled={scale <= 0.5} onClick={() => setScale(value => Math.max(0.5, value - 0.25))}>−</Button><Button size="sm" variant="outline" aria-label="그래프 확대" disabled={scale >= 2} onClick={() => setScale(value => Math.min(2, value + 0.25))}>+</Button></div>
          <div className="h-full max-h-[65vh] overflow-auto p-2" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="knowledge-graph-canvas">
            <svg width={layout.width * scale} height={layout.height * scale} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="지식 연결 그래프" className="block">
              {data.edges.map(edge => { const a = layout.positions.get(edge.source), b = layout.positions.get(edge.target); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-muted-foreground/30" strokeWidth="1.5" strokeDasharray={edge.relation === 'derived-from' ? '4 3' : undefined} /> : null; })}
              {data.nodes.map(node => { const p = layout.positions.get(node.id)!; return <g key={node.id} role="button" tabIndex={0} aria-label={`${labels[node.kind]}: ${node.label}`} aria-pressed={selected === node.id} onClick={() => setSelected(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(node.id); } }} className="group cursor-pointer outline-none"><title>{node.label}</title><rect x={p.x - 66} y={p.y - 20} width="132" height="40" rx="8" className={selected === node.id ? 'fill-muted stroke-primary group-focus-visible:stroke-primary' : 'fill-card stroke-border group-focus-visible:stroke-primary'} strokeWidth={selected === node.id ? 2 : 1} /><circle cx={p.x - 54} cy={p.y} r="4" fill={colors[node.kind]} /><text x={p.x - 43} y={p.y + 4} className="fill-foreground text-[11px]">{node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label}</text></g>; })}
            </svg>
          </div>
        </div>
        <aside className="min-w-0 overflow-y-auto p-3" aria-label="지식 근거 상세">{current ? <><span className="text-[10px] text-muted-foreground">{labels[current.kind]}</span><h2 className="mt-1 break-words text-sm font-semibold">{current.label}</h2><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{current.summary}</p><h3 className="mb-1 mt-4 text-xs font-semibold">영상 근거</h3>{current.evidence.length ? <ul className="space-y-1">{current.evidence.map((evidence, index) => <li key={`${evidence.videoId}-${evidence.startSeconds}-${index}`}><a href={evidence.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs hover:bg-muted/50"><span className="mr-auto">{Math.floor(evidence.startSeconds / 60)}:{String(Math.floor(evidence.startSeconds % 60)).padStart(2, '0')} · {evidence.status === 'verified' ? '근거 있음' : '미확인'}</span><ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">영상에서 근거 확인</span></a></li>)}</ul> : <p className="text-xs text-muted-foreground">연결된 영상 근거가 없습니다.</p>}</> : <p className="text-xs text-muted-foreground">노드를 선택하면 근거를 확인할 수 있습니다.</p>}</aside>
      </div> : null}
    <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground"><span>{data?.coverage.pendingCount == null ? '대기 수 확인 중' : `대기 ${number.format(data.coverage.pendingCount)}`} · 실패 {data ? number.format(data.coverage.failedCount) : '—'}</span>{data?.omittedEdges ? <span>현재 화면 밖 연결 {number.format(data.omittedEdges)}</span> : null}<div className="ml-auto flex gap-1"><Button size="sm" variant="ghost" disabled={cursors.length <= 1 || query.isFetching} aria-label="이전 지식 페이지" onClick={() => setCursors(value => value.slice(0, -1))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={!data?.nextCursor || query.isFetching} aria-label="다음 지식 페이지" onClick={() => { if (data?.nextCursor) setCursors(value => [...value, data.nextCursor]); }}><ChevronRight className="h-4 w-4" /></Button></div></footer>
  </div>;
}
