'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { ArrowUpRight, Bot, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queries = useQueries({ queries: OPERATIONS_SOURCES.map(sourceId => ({
    queryKey: ['admin-operations', sourceId],
    queryFn: ({ signal }: { signal: AbortSignal }) => readSource(sourceId, signal),
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
  })) });
  const snapshots: Partial<Record<OperationsSourceId, OperationsSnapshot>> = {};
  queries.forEach((query, index) => { if (query.data) snapshots[OPERATIONS_SOURCES[index]] = query.data; });
  const model = buildOperationsViewModel(snapshots);
  const rows = filterOperationsRows(model.rows, search, attentionOnly);
  const selected = rows.find(row => row.id === selectedId) ?? rows[0] ?? null;
  const busy = queries.some(query => query.isFetching);
  const refresh = () => { void Promise.all(queries.map(query => query.refetch())); };
  const selectedQuery = selected ? queries[OPERATIONS_SOURCES.indexOf(selected.sourceId)] : null;

  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" aria-labelledby="admin-operations-title" data-admin-operations-panel data-admin-embedded-module-shell="true" data-admin-embedded-module-id="llm">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" data-admin-module-header="compact" data-admin-module-header-module="llm">
      <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <h1 id="admin-operations-title" className="mr-auto text-base font-semibold leading-6">운영 보조</h1>
      <span className="text-xs text-muted-foreground">읽기 전용</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={refresh} aria-label="운영 상태 새로고침" className="gap-1.5">
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />새로고침
      </Button>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 divide-y border-b sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="운영 집계">
        {model.summaries.map(item => <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5 sm:block">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="text-base font-semibold tabular-nums leading-6 sm:mt-1" data-operations-summary={item.id}>
            {item.value === null ? <span className="text-sm font-normal text-muted-foreground">{snapshots[item.id as OperationsSourceId] ? '확인 불가' : '조회 중'}</span> : <>{number.format(item.value)}<span className="ml-1 text-xs font-normal text-muted-foreground">건</span></>}
          </p>
        </div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <label className="relative min-w-[150px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input aria-label="운영 항목 검색" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="운영 항목 검색" className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm" />
        </label>
        <Button size="sm" variant={attentionOnly ? 'secondary' : 'outline'} aria-pressed={attentionOnly} onClick={() => setAttentionOnly(value => !value)}>
          확인 필요 <span className="tabular-nums">{model.attentionCount}</span>
        </Button>
        <span className="text-xs text-muted-foreground">실패·확인 필요 우선</span>
      </div>

      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
          <ul className="divide-y" aria-label="운영 우선순위 목록">
            {rows.map(row => <li key={row.id}>
              <button type="button" aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)} className={`w-full min-w-0 px-3 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected?.id === row.id ? 'bg-muted/50' : ''}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{row.title}</span>
                  <span className={`ml-auto rounded border px-1.5 py-0.5 text-[11px] ${row.priority === 'failure' ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-border text-muted-foreground'}`}>
                    {row.state === 'loading' ? '조회 중' : row.state !== 'ready' ? OPERATIONS_STATE_LABELS[row.state] : PRIORITY_LABELS[row.priority]}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{row.summary}</span>
                {row.metrics.length > 0 ? <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                  {row.metrics.slice(0, 3).map(item => <span key={item.id}><span className="text-muted-foreground">{item.label} </span>{item.value === null ? '미확인' : number.format(item.value)}</span>)}
                </span> : null}
              </button>
            </li>)}
          </ul>
          {rows.length === 0 ? <p className="px-3 py-6 text-sm text-muted-foreground" role="status">조건에 맞는 운영 항목이 없습니다.</p> : null}
        </div>

        <aside className="min-w-0 p-3" aria-label="운영 항목 상세">
          {selected ? <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-base font-semibold leading-6">{selected.title}</h2>
              <Button asChild size="sm" variant="outline"><Link href={selected.href}>{selected.title} 열기<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></Button>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.summary}</p>
            {selected.metrics.length > 0 ? <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3">
              {selected.metrics.map(item => <div key={item.id} className="min-w-0"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{item.value === null ? '확인 불가' : `${number.format(item.value)}건`}</dd></div>)}
            </dl> : null}
            <dl className="mt-3 space-y-2 text-xs leading-5">
              <div><dt className="text-muted-foreground">조회 상태</dt><dd>{OPERATIONS_STATE_LABELS[selected.state]}{selectedQuery?.dataUpdatedAt ? ` · ${formatTime(selectedQuery.dataUpdatedAt)} 조회` : ''}</dd></div>
              {selected.details.map(item => <div key={item.label}><dt className="text-muted-foreground">{item.label}</dt><dd className="break-words">{item.value}</dd></div>)}
            </dl>
            {selected.state !== 'loading' && selected.state !== 'ready' ? <Button className="mt-3" size="sm" variant="outline" disabled={selectedQuery?.isFetching} onClick={() => { void selectedQuery?.refetch(); }}>이 항목 다시 조회</Button> : null}
          </> : <p className="text-sm text-muted-foreground">검색 조건을 바꾸면 항목을 확인할 수 있습니다.</p>}
        </aside>
      </div>
    </div>

    <footer className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground" aria-live="polite">
      {model.sources.map(source => <span key={source.sourceId}>{SOURCE_LABELS[source.sourceId]} · {OPERATIONS_STATE_LABELS[source.state]}</span>)}
      <span className="sm:ml-auto">변경은 각 관리 화면에서 확인 후 적용</span>
    </footer>
  </section>;
}
