'use client';

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bug, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { isAdminSentryResponse, type AdminSentryResponse, type SentryIssueStatus } from '@/types/admin-sentry';

const statusLabels: Record<SentryIssueStatus, string> = { unresolved: '미해결', resolved: '해결됨', ignored: '보류' };
const levelLabels = { fatal: '치명적', error: '오류', warning: '경고', info: '정보' };
const formatCount = new Intl.NumberFormat('ko-KR');
const formatDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const displayDate = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? formatDate.format(new Date(value)) : '시각 미확인';
const levelOrder = { fatal: 0, error: 1, warning: 2, info: 3 };

export function AdminSentryPanel() {
  const [status, setStatus] = useState<SentryIssueStatus>('unresolved');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'latest' | 'count' | 'level'>('latest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: ['admin-sentry', status, cursor],
    queryFn: async ({ signal }): Promise<AdminSentryResponse> => {
      const params = new URLSearchParams({ status });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/admin/sentry?${params}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('sentry_unavailable');
      const data: unknown = await response.json();
      if (!isAdminSentryResponse(data)) throw new Error('sentry_unavailable');
      return data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const data = query.isError ? undefined : query.data;
  const available = data?.state === 'connected' && !query.isError;

  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [search, status, sort, cursor]);
  const normalizedSearch = search.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
  const issues = available && data ? data.issues.filter(issue => `${issue.type} ${issue.shortId}`.normalize('NFKC').toLocaleLowerCase('ko-KR').includes(normalizedSearch)).sort((a, b) => {
    const delta = sort === 'count' ? b.count - a.count : sort === 'level' ? levelOrder[a.level] - levelOrder[b.level] : 0;
    const aTime = a.lastSeen ? Date.parse(a.lastSeen) : null, bTime = b.lastSeen ? Date.parse(b.lastSeen) : null;
    return delta || (aTime === null ? (bTime === null ? 0 : 1) : bTime === null ? -1 : bTime - aTime) || a.id.localeCompare(b.id);
  }) : [];
  const selected = issues.find(issue => issue.id === selectedId) ?? null;
  const connectionLabel = query.isPending ? '조회 중' : query.isError ? '조회 실패' : data?.state === 'connected' ? '연결됨' : data?.state === 'not_configured' ? '연결 미설정' : '조회 불가';
  const closeDetail = () => { setSelectedId(null); if (inlineInspector) window.requestAnimationFrame(() => rowRef.current?.focus()); };
  const inspector = selected ? <aside key={selected.id} ref={detailRef} tabIndex={-1} data-sentry-inspector aria-label="Sentry 오류 상세" className={cn('h-full min-h-0 overflow-y-auto outline-none', inlineInspector ? 'admin-cms-inspector' : 'p-3')}>
    <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words text-base font-semibold leading-6">{selected.type}</h2><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="오류 상세 닫기" onClick={closeDetail}><X className="h-3.5 w-3.5" /></Button></div>
    <p className="mt-1 break-all text-xs text-muted-foreground">{selected.shortId}</p>
    <div className="mt-3 flex flex-wrap gap-2"><Badge variant={selected.level === 'fatal' || selected.level === 'error' ? 'destructive' : 'secondary'}>{levelLabels[selected.level]}</Badge><Badge variant="outline">{statusLabels[selected.status]}</Badge></div>
    <dl className="mt-4 grid grid-cols-2 gap-4 text-xs"><div><dt className="text-muted-foreground">발생 횟수</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums">{formatCount.format(selected.count)}회</dd></div><div><dt className="text-muted-foreground">최근 발생</dt><dd className="mt-1">{displayDate(selected.lastSeen)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">조회 시각</dt><dd className="mt-1">{displayDate(data?.fetchedAt)}</dd></div></dl>
    <Button className="mt-4" size="sm" variant="outline" asChild><a href={selected.href} target="_blank" rel="noopener noreferrer">Sentry에서 상세 열기<ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></a></Button>
  </aside> : null;

  return <div className="flex h-full min-h-[320px] min-w-0 flex-col overflow-hidden" data-admin-sentry-panel data-admin-sentry-state={query.isPending ? "loading" : query.isError ? "unavailable" : data?.state ?? "unavailable"}>
    <AdminPageHeader title="Sentry 오류 모니터링" icon={Bug} summary={connectionLabel}
      actions={<><Button size="sm" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="오류 목록 새로고침"><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /></Button>{data?.dashboardUrl ? <Button size="sm" variant="outline" asChild><a href={data.dashboardUrl} target="_blank" rel="noopener noreferrer">Sentry 열기<ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" /></a></Button> : null}</>}
    />
    <div className="admin-cms-toolbar shrink-0">
      <label className="relative min-w-[150px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><input type="search" aria-label="현재 페이지 오류 검색" value={search} onChange={event => { setSearch(event.target.value); setSelectedId(null); }} maxLength={120} placeholder="오류 유형·번호 검색" className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm" /></label>
      <select aria-label="오류 처리 상태" value={status} onChange={event => { setStatus(event.target.value as SentryIssueStatus); setCursors([null]); setSelectedId(null); }} className="h-9 rounded-md border bg-background px-2 text-xs">{(Object.keys(statusLabels) as SentryIssueStatus[]).map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select>
      <select aria-label="현재 페이지 오류 정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="latest">최근 발생순</option><option value="count">발생 횟수순</option><option value="level">심각도순</option></select>
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div ref={listRef} className="admin-cms-table-container flex-1" aria-busy={query.isFetching}>
        {query.isPending ? <div className="space-y-2 p-3" role="status" aria-label="오류 목록 조회 중">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full motion-reduce:animate-none" />)}</div>
          : !available ? <div role="status" className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-4 text-center"><Bug className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><h2 className="text-base font-semibold leading-6">{data?.state === 'not_configured' ? 'Sentry 연결 미설정' : '오류 목록 조회 실패'}</h2><p className="text-xs leading-5 text-muted-foreground">{data?.state === 'not_configured' ? '연결 설정이 완료되면 오류 목록을 조회할 수 있습니다.' : '새로고침해 연결 상태를 다시 확인하세요.'}</p>{data?.state !== 'not_configured' ? <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>다시 조회</Button> : null}</div>
          : <><table className="admin-cms-table table-fixed" aria-label="Sentry 오류 목록"><thead className="sticky top-0 z-10 bg-background"><tr><th scope="col">오류 유형</th><th scope="col" className="w-20">심각도</th><th scope="col" className="w-20">발생</th><th scope="col" className="hidden w-28 xl:table-cell">최근 발생</th></tr></thead><tbody>{issues.map(issue => <tr key={issue.id} data-sentry-issue={issue.id} className={cn('cursor-pointer', selected?.id === issue.id && 'admin-cms-row-selected')} onClick={event => { rowRef.current = event.currentTarget.querySelector('button'); setSelectedId(issue.id); window.requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true })); }}>
            <td><button type="button" aria-pressed={selected?.id === issue.id} aria-haspopup={inlineInspector ? undefined : 'dialog'} className="block w-full min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate text-sm font-medium">{issue.type}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{issue.shortId}</span><span className="mt-0.5 block text-[11px] text-muted-foreground xl:hidden">{displayDate(issue.lastSeen)}</span></button></td>
            <td><Badge variant={issue.level === 'fatal' || issue.level === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">{levelLabels[issue.level]}</Badge></td><td className="tabular-nums">{formatCount.format(issue.count)}회</td><td className="hidden text-[11px] text-muted-foreground xl:table-cell">{displayDate(issue.lastSeen)}</td>
          </tr>)}</tbody></table>{issues.length === 0 ? <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground"><p>{data.issues.length === 0 ? `${statusLabels[status]} 오류가 없습니다.` : '이 페이지에 검색 조건과 일치하는 오류가 없습니다.'}</p>{search ? <Button size="sm" variant="outline" onClick={() => setSearch('')}>검색 초기화</Button> : null}</div> : null}</>}
      </div>
      {inlineInspector ? inspector : null}
    </div>
    <footer className="admin-cms-footer shrink-0"><span>{available && data ? `현재 페이지 ${issues.length} / ${data.issues.length}건 · ${cursors.length}페이지` : connectionLabel}</span>{data ? <span className="text-[11px]">브라우저 수집 {data.collection.browser ? '설정됨' : '미설정'} · 서버 수집 {data.collection.server ? '설정됨' : '미설정'}</span> : null}
      <div className="ml-auto flex gap-1"><Button size="sm" variant="ghost" aria-label="이전 오류 페이지" disabled={cursors.length <= 1 || query.isFetching} onClick={() => { setCursors(values => values.slice(0, -1)); setSelectedId(null); }}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label="다음 오류 페이지" disabled={!available || !data?.nextCursor || query.isFetching} onClick={() => { if (available && data?.nextCursor) { setCursors(values => [...values, data.nextCursor]); setSelectedId(null); } }}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></div>
    </footer>
    <Sheet open={!inlineInspector && !!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><SheetContent data-sentry-drawer className="flex w-full flex-col p-0 pt-10 sm:max-w-lg" onOpenAutoFocus={event => { event.preventDefault(); detailRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); rowRef.current?.focus(); }}><SheetHeader className="sr-only"><SheetTitle>Sentry 오류 상세</SheetTitle><SheetDescription>선택한 오류의 집계와 상세 링크</SheetDescription></SheetHeader>{!inlineInspector ? inspector : null}</SheetContent></Sheet>
  </div>;
}
