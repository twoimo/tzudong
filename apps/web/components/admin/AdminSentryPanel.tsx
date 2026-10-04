'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bug, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { isAdminSentryResponse, type AdminSentryResponse, type SentryIssueStatus } from '@/types/admin-sentry';

const statusLabels: Record<SentryIssueStatus, string> = { unresolved: '미해결', resolved: '해결됨', ignored: '보류' };
const levelLabels = { fatal: '치명적', error: '오류', warning: '경고', info: '정보' };
const formatCount = new Intl.NumberFormat('ko-KR');
const formatDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AdminSentryPanel() {
  const [status, setStatus] = useState<SentryIssueStatus>('unresolved');
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
  const data = query.data;
  const available = data?.state === 'connected' && !query.isError;

  return (
    <div className="flex h-full min-h-[320px] min-w-0 flex-col" data-admin-sentry-panel>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Bug className="h-4 w-4 text-primary" aria-hidden="true" />
        <h1 className="mr-auto text-sm font-semibold">Sentry 오류 모니터링</h1>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="오류 목록 새로고침">
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
        </Button>
        {data?.dashboardUrl ? <Button size="sm" variant="outline" asChild><a href={data.dashboardUrl} target="_blank" rel="noopener noreferrer">Sentry 열기<ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" /></a></Button> : null}
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {(Object.keys(statusLabels) as SentryIssueStatus[]).map((value) => <Button key={value} size="sm" variant={status === value ? 'default' : 'ghost'} aria-pressed={status === value} onClick={() => { setStatus(value); setCursors([null]); }}>{statusLabels[value]}</Button>)}
        <div className="ml-auto flex flex-wrap gap-1 text-xs text-muted-foreground">
          {data ? <><span>브라우저 {data.collection.browser ? '설정됨' : '미설정'}</span><span aria-hidden="true">·</span><span>서버 {data.collection.server ? '설정됨' : '미설정'}</span></> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={query.isFetching}>
        {query.isPending ? <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full motion-reduce:animate-none" />)}</div>
          : !available ? <div className="grid min-h-[220px] place-items-center px-3 text-center text-sm text-muted-foreground"><p>{data?.state === 'not_configured' ? 'Sentry 연결 설정이 필요합니다.' : '오류 목록을 불러올 수 없습니다.'}</p></div>
          : data.issues.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{statusLabels[status]} 오류가 없습니다.</p>
          : <ul className="divide-y" aria-label="Sentry 오류 목록">{data.issues.map((issue) => <li key={issue.id}>
            <a href={issue.href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <Badge variant={issue.level === 'fatal' || issue.level === 'error' ? 'destructive' : 'secondary'} className="shrink-0 text-[10px]">{levelLabels[issue.level]}</Badge>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{issue.type}</p><p className="truncate text-[11px] text-muted-foreground">{issue.shortId}</p></div>
              <div className="shrink-0 text-right"><p className="text-xs tabular-nums">{formatCount.format(issue.count)}회</p><p className="text-[11px] text-muted-foreground">{issue.lastSeen ? formatDate.format(new Date(issue.lastSeen)) : '—'}</p></div>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Sentry에서 오류 상세 열기</span>
            </a>
          </li>)}</ul>}
      </div>
      <footer className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>{available ? `${data.issues.length}건 · ${cursors.length}페이지` : 'Sentry'}</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" aria-label="이전 오류 페이지" disabled={cursors.length <= 1 || query.isFetching} onClick={() => setCursors((values) => values.slice(0, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" aria-label="다음 오류 페이지" disabled={!available || !data.nextCursor || query.isFetching} onClick={() => { if (data?.nextCursor) setCursors((values) => [...values, data.nextCursor]); }}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </footer>
    </div>
  );
}
