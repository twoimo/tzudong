'use client';

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { ArrowUpRight, Bot, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  OPERATIONS_SOURCES,
  OPERATIONS_STATE_LABELS,
  buildOperationsViewModel,
  filterOperationsRows,
  operationsUnavailable,
  parseOperationsSnapshot,
  type OperationsPriority,
  type OperationsSnapshot,
  type OperationsSourceId,
} from '@/lib/admin/operations-view-model';

const ENDPOINTS: Record<OperationsSourceId, string> = {
  pending: '/api/admin/pending-counts',
  pipeline: '/api/admin/pipeline',
  automation: '/api/admin/evaluations/automation',
};
const SOURCE_LABELS: Record<OperationsSourceId, string> = { pending: '검수 대기', pipeline: '파이프라인', automation: '자동 검수' };
const PRIORITY_LABELS: Record<OperationsPriority, string> = { failure: '실패 확인', attention: '확인 필요', waiting: '검수 대기', running: '진행 중', idle: '대기 없음' };
const number = new Intl.NumberFormat('ko-KR');
const formatTime = (value: number) => new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function readSource(sourceId: OperationsSourceId, signal: AbortSignal): Promise<OperationsSnapshot> {
  try {
    const response = await fetch(ENDPOINTS[sourceId], {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) return operationsUnavailable(sourceId, response.status === 401 || response.status === 403 ? 'forbidden' : 'unavailable');
    // Raw provider errors, row identities and item names never enter the query cache.
    return parseOperationsSnapshot(sourceId, await response.json());
  } catch {
    return operationsUnavailable(sourceId, 'unavailable');
  }
}

export function AdminOperationsPanel() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | OperationsPriority>('all');
  const [sort, setSort] = useState<'priority' | 'name'>('priority');
  const [inlineInspector, setInlineInspector] = useState(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setInlineInspector(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [search, status, sort]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queries = useQueries({ queries: OPERATIONS_SOURCES.map(sourceId => ({
    queryKey: ['admin-operations', sourceId],
    queryFn: ({ signal }: { signal: AbortSignal }) => readSource(sourceId, signal),
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
  })) });
  const snapshots: Partial<Record<OperationsSourceId, OperationsSnapshot>> = {};
  queries.forEach((query, index) => {
    const sourceId = OPERATIONS_SOURCES[index];
    if (query.isError) snapshots[sourceId] = operationsUnavailable(sourceId, 'unavailable');
    else if (query.data) snapshots[sourceId] = query.data;
  });
  const model = buildOperationsViewModel(snapshots);
  const rows = filterOperationsRows(model.rows, search, status === 'attention')
    .filter(row => status === 'all' || status === 'attention' || (row.priority === status && row.state !== 'loading'));
  if (sort === 'name') rows.sort((a, b) => a.title.localeCompare(b.title, 'ko-KR'));
  const selected = rows.find(row => row.id === selectedId) ?? null;
  const busy = queries.some(query => query.isFetching);
  const refresh = () => { void Promise.all(queries.map(query => query.refetch())); };
  const selectedQuery = selected ? queries[OPERATIONS_SOURCES.indexOf(selected.sourceId)] : null;

  const closeDetail = () => { setSelectedId(null); if (inlineInspector) window.requestAnimationFrame(() => rowRef.current?.focus()); };
  const stateLabel = (row: (typeof rows)[number]) => row.state === 'ready' ? PRIORITY_LABELS[row.priority] : OPERATIONS_STATE_LABELS[row.state];
  const stateClass = (row: (typeof rows)[number]) => row.priority === 'failure' ? 'border-destructive/25 bg-destructive/5 text-destructive' : row.priority === 'attention' ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'border-border text-muted-foreground';
  const inspector = selected ? <aside key={selected.id} ref={detailRef} tabIndex={-1} className={cn('h-full min-h-0 overflow-y-auto outline-none', inlineInspector ? 'admin-cms-inspector' : 'p-3')} aria-label="운영 항목 상세" data-operations-inspector>
    <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 text-base font-semibold leading-6">{selected.title}</h2><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="운영 항목 상세 닫기" onClick={closeDetail}><X className="h-3.5 w-3.5" /></Button></div>
    <span className={`mt-2 inline-flex rounded border px-1.5 py-0.5 text-[11px] ${stateClass(selected)}`}>{stateLabel(selected)}</span>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">{selected.summary}</p>
    {selected.metrics.length > 0 ? <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border p-3">
      {selected.metrics.map(item => <div key={item.id} className="min-w-0"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-0.5 break-words text-sm font-medium tabular-nums">{item.value === null ? '확인 불가' : `${number.format(item.value)}건`}</dd></div>)}
    </dl> : null}
    <dl className="mt-3 space-y-3 text-xs leading-5">
      <div><dt className="text-muted-foreground">조회 출처</dt><dd>{SOURCE_LABELS[selected.sourceId]}</dd></div>
      <div><dt className="text-muted-foreground">조회 상태</dt><dd>{OPERATIONS_STATE_LABELS[selected.state]}{selectedQuery?.dataUpdatedAt ? ` · ${formatTime(selectedQuery.dataUpdatedAt)}` : ''}</dd></div>
      {selected.details.map(item => <div key={item.label}><dt className="text-muted-foreground">{item.label}</dt><dd className="break-words">{item.value}</dd></div>)}
    </dl>
    <div className="mt-4 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={selected.href}>관리 화면 열기<ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link></Button>
      {selected.state !== 'loading' && selected.state !== 'ready' ? <Button size="sm" variant="outline" disabled={selectedQuery?.isFetching} onClick={() => { void selectedQuery?.refetch(); }}>다시 조회</Button> : null}
    </div>
  </aside> : null;

  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" aria-labelledby="admin-operations-title" data-admin-operations-panel data-admin-embedded-module-shell="true" data-admin-embedded-module-id="llm">
    <AdminPageHeader title="운영 보조" icon={Bot} titleId="admin-operations-title" summary="읽기 전용" data-admin-module-header="compact" data-admin-module-header-module="llm"
      actions={<Button variant="ghost" size="sm" disabled={busy} onClick={refresh} aria-label="운영 상태 새로고침" className="gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />새로고침</Button>}
    />
    <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 border-b px-3 py-2 text-xs" aria-label="운영 집계">
      {model.summaries.map(item => <span key={item.id} className="text-muted-foreground">{item.label} <strong className="font-medium tabular-nums text-foreground" data-operations-summary={item.id}>{item.value === null ? (snapshots[item.id as OperationsSourceId] ? '확인 불가' : '조회 중') : `${number.format(item.value)}건`}</strong></span>)}
    </div>
    <div className="admin-cms-toolbar shrink-0">
      <label className="relative min-w-[150px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><input type="search" aria-label="운영 항목 검색" value={search} onChange={event => { setSearch(event.target.value); setSelectedId(null); }} maxLength={120} placeholder="운영 항목 검색" className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm" /></label>
      <select aria-label="운영 상태 필터" value={status} onChange={event => { setStatus(event.target.value as typeof status); setSelectedId(null); }} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="all">전체 상태</option><option value="attention">확인 필요 ({model.attentionCount})</option><option value="failure">실패 확인</option><option value="waiting">검수 대기</option><option value="running">진행 중</option><option value="idle">대기 없음</option></select>
      <select aria-label="운영 목록 정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="priority">우선순위순</option><option value="name">항목 이름순</option></select>
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div ref={listRef} className="admin-cms-table-container flex-1">
        <table className="admin-cms-table table-fixed" aria-label="운영 우선순위 목록"><thead className="sticky top-0 z-10 bg-background"><tr><th scope="col">운영 항목</th><th scope="col" className="hidden w-52 xl:table-cell">주요 집계</th><th scope="col" className="w-28">상태</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.id} data-operations-row={row.id} className={cn('cursor-pointer', selected?.id === row.id && 'admin-cms-row-selected')} onClick={event => { rowRef.current = event.currentTarget.querySelector('button'); setSelectedId(row.id); window.requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true })); }}>
            <td><button type="button" aria-pressed={selected?.id === row.id} aria-haspopup={inlineInspector ? undefined : 'dialog'} className="block w-full min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate text-sm font-medium">{row.title}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{SOURCE_LABELS[row.sourceId]}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] xl:hidden">{row.metrics.slice(0, 3).map(item => <span key={item.id}>{item.label} <strong className="font-medium tabular-nums">{item.value === null ? '미확인' : number.format(item.value)}</strong></span>)}</span></button></td>
            <td className="hidden xl:table-cell"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{row.metrics.length ? row.metrics.slice(0, 3).map(item => <span key={item.id} className="text-muted-foreground">{item.label} <strong className="font-medium tabular-nums text-foreground">{item.value === null ? '미확인' : number.format(item.value)}</strong></span>) : <span className="text-muted-foreground">미확인</span>}</div></td>
            <td><span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] ${stateClass(row)}`}>{stateLabel(row)}</span></td>
          </tr>)}
        </tbody></table>
        {!rows.length ? <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground"><p>조건에 맞는 운영 항목이 없습니다.</p><Button size="sm" variant="outline" onClick={() => { setSearch(''); setStatus('all'); }}>필터 초기화</Button></div> : null}
      </div>
      {inlineInspector ? inspector : null}
    </div>
    <footer className="admin-cms-footer shrink-0" aria-live="polite"><span>{rows.length} / {model.rows.length}개</span>{model.sources.map(source => <span key={source.sourceId} className="text-[11px]">{SOURCE_LABELS[source.sourceId]} · {OPERATIONS_STATE_LABELS[source.state]}</span>)}</footer>
    <Sheet open={!inlineInspector && !!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><SheetContent data-operations-drawer className="flex w-full flex-col p-0 pt-10 sm:max-w-lg" onOpenAutoFocus={event => { event.preventDefault(); detailRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); rowRef.current?.focus(); }}><SheetHeader className="sr-only"><SheetTitle>운영 항목 상세</SheetTitle><SheetDescription>선택한 항목의 상태와 조회 근거</SheetDescription></SheetHeader>{!inlineInspector ? inspector : null}</SheetContent></Sheet>
  </section>;
}
