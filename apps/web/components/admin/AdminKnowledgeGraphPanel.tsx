'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, List, Network, RefreshCw, Search } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isKnowledgeGraphPage, KNOWLEDGE_KINDS, type KnowledgeGraphPage, type KnowledgeKind, type KnowledgeNode } from '@/types/knowledge-graph';

const labels: Record<KnowledgeKind, string> = { hub: '프로젝트', video: '영상', restaurant: '맛집', menu: '메뉴', claim: '분석' };
const colors: Record<KnowledgeKind, string> = { hub: '#e11d48', video: '#0d9488', restaurant: '#d97706', menu: '#7c3aed', claim: '#2563eb' };
const nodeTitle = (node: KnowledgeNode) => node.displayTitle ?? node.label;
const shortTitle = (node: KnowledgeNode) => { const chars = Array.from(nodeTitle(node)), limit = node.displayTitle ? 10 : 12; return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : chars.join(''); };
const number = new Intl.NumberFormat('ko-KR');

export function AdminKnowledgeGraphPanel() {
  const [search, setSearch] = useState(''), [kind, setKind] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | null>>([null]), [scale, setScale] = useState(1);
  const [edgeCursors, setEdgeCursors] = useState<Array<string | null>>([null]);
  const [detailOpen, setDetailOpen] = useState(false), [listOpen, setListOpen] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 620 });
  useEffect(() => {
    const host = canvas.current; if (!host) return;
    const observer = new ResizeObserver(([entry]) => setCanvasSize({ width: Math.max(320, entry.contentRect.width - 16), height: Math.max(480, entry.contentRect.height - 16) }));
    observer.observe(host); return () => observer.disconnect();
  }, []);
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { setQ(search); setCursors([null]); setEdgeCursors([null]); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const searchPending = search !== q;
  const cursor = cursors.at(-1) ?? null, edgeCursor = edgeCursors.at(-1) ?? null;
  const query = useQuery<KnowledgeGraphPage>({ queryKey: ['admin-knowledge-graph', q, kind, cursor, edgeCursor], staleTime: 0, retry: false, refetchOnWindowFocus: false, placeholderData: previous => previous,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q, kind, limit: '100' });
      if (cursor) params.set('cursor', cursor);
      if (edgeCursor) params.set('edgeCursor', edgeCursor);
      const response = await fetch(`/api/admin/knowledge-graph?${params}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 409 ? 'knowledge_cursor_stale' : 'knowledge_unavailable');
      const value: unknown = await response.json(); if (!isKnowledgeGraphPage(value)) throw new Error('knowledge_unavailable'); return value;
    } });
  const data = query.data;
  const current = query.isPlaceholderData ? null : data?.nodes.find(node => node.id === selected) ?? (data?.selected?.id === selected ? data.selected : null);
  const pageBusy = searchPending || query.isFetching || query.isPlaceholderData || query.isError;
  const outsideEdges = data ? data.totalEdges - (data.edgePageTotal ?? data.edges.length) : 0;
  const layout = useMemo(() => {
    const nodes = data?.nodes ?? [], positions = new Map<string, { x: number; y: number }>();
    const kinds = KNOWLEDGE_KINDS.filter(value => nodes.some(node => node.kind === value));
    const compact = canvasSize.width < 640, width = canvasSize.width;
    const height = Math.max(canvasSize.height, 116 + Math.max(0, ...kinds.map(value => nodes.filter(node => node.kind === value).length)) * 58);
    let offset = 58;
    for (const [column, value] of kinds.entries()) {
      const group = nodes.filter(node => node.kind === value);
      group.forEach((node, index) => positions.set(node.id, compact
        ? { x: group.length === 1 ? width / 2 : width * (index % 2 ? .75 : .25), y: offset + Math.floor(index / 2) * 58 }
        : { x: kinds.length === 1 ? width / 2 : 78 + column * (width - 156) / (kinds.length - 1), y: height / 2 + (index - (group.length - 1) / 2) * 58 }));
      if (compact) offset += Math.ceil(group.length / 2) * 58 + 22;
    }
    return { positions, width, height: compact ? Math.max(canvasSize.height, offset + 36) : height };
  }, [data?.nodes, canvasSize]);
  const resetPage = () => { setCursors([null]); setEdgeCursors([null]); };
  const reload = () => { if (cursor === null && edgeCursor === null) void query.refetch(); else resetPage(); };
  const selectNode = (id: string) => { if (searchPending || query.isPlaceholderData) return; setSelected(id); setDetailOpen(true); setListOpen(false); };
  const changeQuery = (value: string, field: 'search' | 'kind') => {
    if (field === 'search') setSearch(value); else { setKind(value); setQ(search); resetPage(); }
    setSelected(null); setDetailOpen(false);
  };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-admin-knowledge-graph-panel>
    <AdminPageHeader title="쯔양 지식 그래프" icon={Network}
      summary={<span className="text-xs tabular-nums text-muted-foreground">분석 {data ? number.format(data.coverage.analyzedCount) : '—'} / {data?.coverage.eligibleCount == null ? '대상 확인 중' : number.format(data.coverage.eligibleCount)}</span>}
      actions={<><Button size="sm" variant="outline" onClick={() => setListOpen(true)} aria-label="지식 목록과 분석 현황 열기"><List className="mr-1 h-3.5 w-3.5" aria-hidden="true" />목록</Button><Button size="sm" variant="ghost" disabled={searchPending || query.isFetching} aria-label="지식 그래프 새로고침" onClick={reload}><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /></Button></>}
    />
    <div className="admin-cms-toolbar" aria-busy={searchPending || query.isFetching}>
      <label className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><input aria-label="지식 검색" value={search} onChange={event => changeQuery(event.target.value, 'search')} maxLength={256} placeholder="영상·맛집·메뉴 검색" className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs" /></label>
      <select aria-label="지식 종류" value={kind} onChange={event => changeQuery(event.target.value, 'kind')} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="">전체</option>{KNOWLEDGE_KINDS.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select>
      {data ? <span className="text-xs tabular-nums text-muted-foreground">{number.format(data.totalNodes)}개 · 연결 {number.format(data.totalEdges)}</span> : null}
    </div>
    {query.isError ? <div role="alert" className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive">{query.error.message === 'knowledge_cursor_stale' ? '그래프가 변경되었습니다. 첫 페이지부터 새로고침하세요.' : '지식 그래프를 불러오지 못했습니다.'}<Button size="sm" variant="outline" onClick={reload}>새로고침</Button></div> : null}
    <div ref={canvas} className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden rounded-lg border bg-background" data-knowledge-canvas style={{ backgroundImage: 'radial-gradient(hsl(var(--border) / .65) .75px, transparent .75px)', backgroundSize: '20px 20px' }}>
      <div className="absolute right-2 top-2 z-10 flex gap-1"><Button size="sm" variant="outline" aria-label="그래프 축소" disabled={scale <= .5} onClick={() => setScale(value => Math.max(.5, value - .25))}>−</Button><Button size="sm" variant="outline" aria-label="그래프 확대" disabled={scale >= 2} onClick={() => setScale(value => Math.min(2, value + .25))}>+</Button></div>
      <div className="absolute inset-0 overflow-auto p-2" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="knowledge-graph-canvas">
        {data?.nodes.length ? <svg width={layout.width * scale} height={layout.height * scale} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="지식 연결 그래프" className="block">
          {data.edges.map(edge => { const a = layout.positions.get(edge.source), b = layout.positions.get(edge.target); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-muted-foreground/30" strokeWidth="1.5" strokeDasharray={edge.relation === 'derived-from' ? '4 3' : undefined} /> : null; })}
          {data.nodes.map(node => { const position = layout.positions.get(node.id)!; return <g key={node.id} role="button" tabIndex={0} aria-label={`${labels[node.kind]}: ${nodeTitle(node)}${node.displayStage ? ' · 자막 1차 검토 · 미확인' : ''}`} aria-pressed={selected === node.id} data-knowledge-node={node.id} data-knowledge-selected={selected === node.id} onClick={() => selectNode(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } }} className="group cursor-pointer outline-none"><title>{nodeTitle(node)}{node.displayStage ? ' · 자막 1차 검토 · 미확인' : ''}</title><rect x={position.x - 66} y={position.y - 22} width="132" height="44" rx="8" className={selected === node.id ? 'fill-muted stroke-primary group-focus-visible:stroke-primary' : 'fill-card stroke-border group-focus-visible:stroke-primary'} strokeWidth={selected === node.id ? 2 : 1} /><circle cx={position.x - 54} cy={position.y} r="4" fill={colors[node.kind]} /><text x={position.x - 43} y={position.y + (node.displayStage ? -2 : 4)} className={node.displayTitle ? 'fill-foreground text-[10px]' : 'fill-foreground text-[11px]'}>{shortTitle(node)}</text>{node.displayStage ? <text x={position.x - 43} y={position.y + 12} className="fill-muted-foreground text-[9px]">자막 1차 · 미확인</text> : null}</g>; })}
        </svg> : <div className="grid h-full place-content-center text-xs text-muted-foreground">{query.isLoading ? '그래프 조회 중' : '일치하는 지식이 없습니다.'}</div>}
      </div>
    </div>
    <footer className="admin-cms-footer"><span className="flex flex-wrap items-center gap-2">{KNOWLEDGE_KINDS.map(value => <span key={value} className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors[value] }} aria-hidden="true" />{labels[value]}</span>)}</span>{outsideEdges ? <span>화면 밖 연결 {number.format(outsideEdges)}</span> : null}
      {data?.edgePageTotal !== undefined && (data.nextEdgeCursor || edgeCursors.length > 1) ? <div className="flex items-center gap-1"><span aria-live="polite">화면 내 연결 {number.format(data.edges.length)} / {number.format(data.edgePageTotal)} · {edgeCursors.length}페이지</span><Button size="sm" variant="ghost" disabled={edgeCursors.length <= 1 || pageBusy} aria-label="이전 연결 페이지" onClick={() => setEdgeCursors(value => value.slice(0, -1))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={!data.nextEdgeCursor || pageBusy} aria-label="다음 연결 페이지" onClick={() => { const next = data.nextEdgeCursor; if (next) setEdgeCursors(value => [...value, next]); }}><ChevronRight className="h-4 w-4" /></Button></div> : null}<div className="ml-auto flex gap-1"><Button size="sm" variant="ghost" disabled={cursors.length <= 1 || pageBusy} aria-label="이전 지식 페이지" onClick={() => { setCursors(value => value.slice(0, -1)); setEdgeCursors([null]); }}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={!data?.nextCursor || pageBusy} aria-label="다음 지식 페이지" onClick={() => { if (data?.nextCursor) { setCursors(value => [...value, data.nextCursor]); setEdgeCursors([null]); } }}><ChevronRight className="h-4 w-4" /></Button></div></footer>
    <Sheet open={listOpen} onOpenChange={setListOpen}><SheetContent className="w-full overflow-y-auto p-4 sm:max-w-md"><SheetHeader><SheetTitle>지식 목록</SheetTitle><SheetDescription>{data ? `전체 ${number.format(data.totalNodes)}개 · 현재 페이지 ${data.nodes.length}개` : '조회 중'}</SheetDescription></SheetHeader><ul className="mt-3 divide-y" aria-label="지식 목록">{data?.nodes.map(node => <li key={node.id}><button type="button" aria-pressed={selected === node.id} onClick={() => selectNode(node.id)} className="w-full px-3 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><span className="text-[10px] text-muted-foreground">{labels[node.kind]}</span><p className="truncate text-xs font-medium">{nodeTitle(node)}</p>{node.displayStage ? <p className="text-[10px] text-muted-foreground">자막 1차 검토 · 미확인</p> : null}</button></li>)}</ul><div className="mt-4 border-t pt-3 text-xs text-muted-foreground">{data?.coverage.pendingCount == null ? '대기 수 확인 중' : `대기 ${number.format(data.coverage.pendingCount)}`} · 실패 {data ? number.format(data.coverage.failedCount) : '—'}</div></SheetContent></Sheet>
    <Sheet open={detailOpen} onOpenChange={setDetailOpen}><SheetContent className="w-full overflow-y-auto p-4 sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<SVGGElement>('[data-knowledge-selected="true"]')?.focus(); }}><SheetHeader><SheetTitle>지식 근거</SheetTitle><SheetDescription>미확인 근거는 독립 검증 전입니다.</SheetDescription></SheetHeader><div className="mt-3" aria-label="지식 근거 상세">{current ? <><span className="text-[10px] text-muted-foreground">{labels[current.kind]}</span><h2 className="mt-1 break-words text-sm font-semibold">{nodeTitle(current)}</h2>{current.displayStage ? <p className="mt-1 text-xs text-muted-foreground">자막 1차 검토 · 미확인</p> : null}<p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{current.summary}</p><h3 className="mb-1 mt-4 text-xs font-semibold">영상 근거</h3>{current.evidence.length ? <ul className="space-y-1">{current.evidence.map((evidence, index) => <li key={`${evidence.videoId}-${evidence.startSeconds}-${index}`}><a href={evidence.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs hover:bg-muted/50"><span className="mr-auto">{Math.floor(evidence.startSeconds / 60)}:{String(Math.floor(evidence.startSeconds % 60)).padStart(2, '0')} · {evidence.status === 'verified' ? '근거 있음' : '미확인'}</span><ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">영상에서 근거 확인</span></a></li>)}</ul> : <p className="text-xs text-muted-foreground">연결된 영상 근거가 없습니다.</p>}</> : <p className="text-xs text-muted-foreground">{query.isFetching ? '근거 조회 중' : '선택한 근거를 불러오지 못했습니다.'}</p>}</div></SheetContent></Sheet>
  </div>;
}
