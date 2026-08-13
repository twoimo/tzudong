"use client";

import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAdminStatusCenter } from '@/hooks/use-admin-status-center';
import type { AdminStatusCenterState } from '@/lib/admin/system-status/view-model';

function getStateTone(state: AdminStatusCenterState) {
  switch (state) {
    case 'healthy':
      return {
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
        panel: 'border-emerald-500/20 bg-emerald-500/5',
        icon: CheckCircle2,
      };
    case 'partial':
      return {
        badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
        panel: 'border-amber-500/20 bg-amber-500/5',
        icon: AlertTriangle,
      };
    case 'degraded':
      return {
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-200',
        panel: 'border-rose-500/20 bg-rose-500/5',
        icon: AlertTriangle,
      };
    default:
      return {
        badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-200',
        panel: 'border-slate-500/20 bg-slate-500/5',
        icon: HelpCircle,
      };
  }
}

export function AdminSystemStatusCenter({
  isAdmin,
  className,
}: {
  isAdmin: boolean;
  className?: string;
}) {
  const { viewModel, isLoading, hasError, systemStatusQuery } = useAdminStatusCenter(isAdmin);
  const tone = getStateTone(viewModel.overallState);
  const StatusIcon = tone.icon;

  return (
    <Card
      className={cn('flex min-h-[220px] flex-col overflow-hidden border border-border/70 bg-card/90 shadow-sm', className)}
      data-admin-system-status-center="true"
      data-admin-system-status-state={viewModel.overallState}
    >
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold">운영 상태 센터</CardTitle>
            <p className="text-xs text-muted-foreground">
              run_daily, 나이틀리 회귀, GDrive 후속, 검수 대기 상태를 한 곳에서 fail-closed로 봅니다.
            </p>
          </div>
          <Badge className={cn('rounded-full px-2 py-1 text-[11px] font-semibold', tone.badge)}>
            <StatusIcon className="mr-1 h-3.5 w-3.5" />
            {viewModel.overallLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <div data-admin-system-status-loading="true" className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <>
            <div
              className={cn('rounded-2xl border px-3 py-2.5', tone.panel)}
              data-admin-system-status-summary="true"
            >
              <p className="text-xs font-semibold">{viewModel.summary}</p>
              {hasError ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  일부 API 응답을 읽지 못해 보수적으로 표시 중입니다.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {viewModel.metrics.map((metric) => {
                const metricTone = getStateTone(metric.state);
                return (
                  <div
                    key={metric.id}
                    className={cn('rounded-2xl border px-3 py-2.5', metricTone.panel)}
                    data-admin-system-status-metric={metric.id}
                    data-admin-system-status-metric-state={metric.state}
                    data-admin-run-daily-state={metric.id === 'run_daily' ? metric.state : undefined}
                    data-admin-nightly-regression-state={metric.id === 'nightly' ? metric.state : undefined}
                    data-admin-run-daily-artifact-state={metric.id === 'artifacts' ? metric.state : undefined}
                    data-admin-system-status-pending-counts={metric.id === 'pending' ? 'true' : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-muted-foreground">{metric.label}</p>
                      <Badge className={cn('rounded-full px-2 py-0.5 text-[10px]', metricTone.badge)}>
                        {metric.value}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-5">{metric.detail}</p>
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-2.5" data-admin-system-status-checklist="true">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-muted-foreground">즉시 확인할 체크리스트</p>
                <span className="text-[10px] text-muted-foreground">
                  as of {systemStatusQuery.data?.asOf ?? '—'}
                </span>
              </div>
              {viewModel.checklist.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-xs leading-5">
                  {viewModel.checklist.map((item) => (
                    <li key={item.id} className="flex gap-2" data-admin-system-status-checklist-item={item.id}>
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
                      <span>{item.action}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">run_daily와 나이틀리 회귀 기준으로 즉시 튀는 경고는 없습니다.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
