"use client";

import { useId, useState } from 'react';
import { Activity, Download } from 'lucide-react';
import { AdminEmbeddedModuleShell } from '@/components/admin/AdminEmbeddedModuleShell';
import { Button } from '@/components/ui/button';
import {
  AUDIT_METRIC_LABELS, formatAuditDate, formatAuditMs, getAuditComparison, getAuditResidual,
  getAuditValues, performanceAuditSnapshot as audit, summarizeAuditValues,
  type AuditMetric, type AuditMode,
} from '@/lib/admin/performance-audit';

const comparedMetrics = ['external', 'handler', 'request'] as const;
const modeLabels = { legacy: '기존 조회', rpc: 'RPC 조회' };

function exportSnapshot() {
  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${audit.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AdminPerformanceAuditSkeleton() {
  return <section className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="웹 성능 감사 불러오는 중">
    <div className="flex min-h-14 items-center border-b px-4 text-base font-medium">웹 성능 감사</div>
    <div className="grid min-h-0 flex-1 content-start gap-4 overflow-hidden p-4" aria-hidden="true">
      <div className="h-10 rounded-lg bg-muted" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]"><div className="h-64 rounded-xl bg-muted" /><div className="h-64 rounded-xl bg-muted" /></div>
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  </section>;
}

export function AdminPerformanceAudit() {
  const [mode, setMode] = useState<'all' | AuditMode>('all');
  const [metric, setMetric] = useState<AuditMetric>('external');
  const chartId = useId();
  const phases = audit.phases.filter(phase => mode === 'all' || phase.mode === mode);
  const maxMedian = Math.max(...comparedMetrics.flatMap(key => {
    const comparison = getAuditComparison(key);
    return [comparison.before?.median ?? 0, comparison.after?.median ?? 0];
  }), 1);
  const rpc = audit.phases.find(phase => phase.mode === 'rpc')!;
  const rpcResidual = summarizeAuditValues(getAuditResidual(rpc) ?? []);

  return <AdminEmbeddedModuleShell
    moduleId="web-performance" titleId="admin-performance-title" icon={Activity}
    summary={<span>분석 기록 {formatAuditDate(audit.analyzedAtUtc)} KST</span>}
    actions={<Button type="button" variant="outline" size="sm" className="h-10 gap-2" onClick={exportSnapshot}><Download className="h-4 w-4" aria-hidden="true" />측정 데이터</Button>}
    contentClassName="overflow-y-auto overscroll-contain" scrollOwner="admin-performance-audit"
  >
    <div className="grid min-h-full w-full gap-2" data-admin-performance-audit="true">
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-sm" aria-label="측정 범위">
        <span className="font-medium">맛집 영상 KPI</span>
        <span>요청 <strong className="font-medium tabular-nums">10 / 10</strong> 성공</span>
        <span>동일 영상 <strong className="font-medium tabular-nums">{audit.cohortCount}개</strong></span>
        <span>응답 일치 <strong className="font-medium tabular-nums">{audit.identicalResponseCount}건</strong></span>
        <span className="text-muted-foreground">각 5회 · 순차 요청 · 재시도 없음</span>
      </section>

      <div className="grid min-w-0 gap-2 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <section className="min-w-0 rounded-xl border p-3" aria-labelledby={`${chartId}-title`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`${chartId}-title`} className="text-base font-medium">조회 방식별 처리 시간</h2>
            <span className="text-xs text-muted-foreground">중앙값 · ms · 낮을수록 빠름</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">전체 요청에서 서버와 데이터 조회에 걸린 시간을 나눠 봅니다</p>
          <figure className="mt-4 space-y-4" aria-describedby={`${chartId}-note`}>
            {comparedMetrics.map(key => {
              const comparison = getAuditComparison(key);
              return <div key={key} className="grid gap-2">
                <div className="text-sm font-medium">{AUDIT_METRIC_LABELS[key]}</div>
                {(['legacy', 'rpc'] as const).map(currentMode => {
                  const summary = currentMode === 'legacy' ? comparison.before : comparison.after;
                  return <div key={currentMode} className="grid grid-cols-[4rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-xs sm:grid-cols-[4.5rem_minmax(0,1fr)_6rem]">
                    <span className="text-muted-foreground">{modeLabels[currentMode]}</span>
                    <span className="h-4 overflow-hidden rounded-sm bg-muted" aria-hidden="true"><span className={`block h-full ${currentMode === 'rpc' ? 'bg-primary' : 'bg-muted-foreground/50'}`} style={{ width: `${(summary?.median ?? 0) / maxMedian * 100}%` }} /></span>
                    <span className="text-right tabular-nums">{formatAuditMs(summary?.median)}</span>
                  </div>;
                })}
              </div>;
            })}
            <figcaption id={`${chartId}-note`} className="border-t pt-3 text-xs leading-5 text-muted-foreground">각 구간은 서로 포함 관계가 있어 합산하지 않습니다. 첫 요청을 포함한 전체 5회 기준입니다.</figcaption>
          </figure>
        </section>

        <section className="min-w-0 rounded-xl border p-3" aria-labelledby="audit-findings-title">
          <h2 id="audit-findings-title" className="text-base font-medium">원인 분리</h2>
          <dl className="mt-4 divide-y text-sm">
            <div className="pb-3"><dt className="text-muted-foreground">RPC의 DB 내부 처리</dt><dd className="mt-1 text-2xl font-medium tabular-nums">{formatAuditMs(getAuditComparison('database').after?.median)} <span className="text-sm text-muted-foreground">ms</span></dd></div>
            <div className="py-3"><dt className="text-muted-foreground">RPC 대기에서 DB 처리를 뺀 구간</dt><dd className="mt-1 text-xl font-medium tabular-nums">{formatAuditMs(rpcResidual?.median)} <span className="text-sm text-muted-foreground">ms</span></dd></div>
          </dl>
          <p className="text-sm leading-6 text-muted-foreground">남은 시간에는 연결, 게이트웨이, SDK, 직렬화 등이 섞여 있습니다. 네트워크 지연 하나로 단정할 수 없습니다.</p>
          <div className="mt-4 border-t pt-3">
            <h3 className="text-sm font-medium">브라우저 체감 성능</h3>
            <p className="mt-2 text-sm">LCP · INP · CLS <span className="ml-2 text-muted-foreground">미측정</span></p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{audit.browser.reason}. 아래 API 결과와 별도로 확인해야 합니다.</p>
          </div>
        </section>
      </div>

      <section className="min-w-0 rounded-xl border" aria-labelledby="audit-comparison-title">
        <div className="flex min-h-12 items-center px-4"><h2 id="audit-comparison-title" className="text-base font-medium">구간 비교</h2></div>
        <div className="overflow-x-auto" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="performance-comparison-table" tabIndex={0} role="region" aria-label="성능 구간 비교 표">
          <table className="w-full min-w-[540px] border-collapse text-sm">
            <caption className="sr-only">기존 조회와 RPC 조회의 중앙값 및 관측 범위. 단위 밀리초</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-3 font-medium">구간</th><th scope="col" className="px-4 py-3 text-right font-medium">기존 중앙값</th><th scope="col" className="px-4 py-3 text-right font-medium">RPC 중앙값</th><th scope="col" className="px-4 py-3 text-right font-medium">관측 차이</th><th scope="col" className="px-4 py-3 text-right font-medium">RPC 범위</th></tr></thead>
            <tbody>{([...comparedMetrics, 'database'] as const).map(key => {
              const comparison = getAuditComparison(key);
              return <tr key={key} className="border-t hover:bg-muted/30"><th scope="row" className="px-4 py-3 text-left font-normal">{AUDIT_METRIC_LABELS[key]}</th><td className="px-4 py-3 text-right tabular-nums">{formatAuditMs(comparison.before?.median)}</td><td className="px-4 py-3 text-right tabular-nums">{formatAuditMs(comparison.after?.median)}</td><td className="px-4 py-3 text-right tabular-nums">{comparison.percentLower == null ? '비교 불가' : `${comparison.percentLower.toFixed(1)}% 감소`}</td><td className="px-4 py-3 text-right tabular-nums">{comparison.after ? `${formatAuditMs(comparison.after.min)}–${formatAuditMs(comparison.after.max)}` : '미측정'}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">관측 차이는 이번 표본의 기술 통계입니다. 전체 사용자에 대한 개선율이나 통계적 유의성을 의미하지 않습니다.</p>
      </section>

      <section className="min-w-0 rounded-xl border" aria-labelledby="audit-samples-title">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h2 id="audit-samples-title" className="text-base font-medium">개별 요청</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">방식<select className="h-10 rounded-lg border bg-background px-3" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="all">전체</option><option value="legacy">기존 조회</option><option value="rpc">RPC 조회</option></select></label>
            <label className="flex items-center gap-2">구간<select className="h-10 rounded-lg border bg-background px-3" value={metric} onChange={event => setMetric(event.target.value as AuditMetric)}>{Object.entries(AUDIT_METRIC_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </div>
        </div>
        <div className="overflow-x-auto" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="performance-samples-table" role="region" aria-label="개별 요청 측정 표" tabIndex={0}>
          <table className="w-full min-w-[480px] text-sm"><caption className="sr-only">순서대로 보존한 개별 요청의 {AUDIT_METRIC_LABELS[metric]}, 단위 밀리초</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-3 text-left font-medium">방식</th>{Array.from({ length: audit.sampleCountPerMode }, (_, index) => <th key={index} scope="col" className="px-3 py-3 text-right font-medium">{index + 1}회</th>)}</tr></thead><tbody>{phases.map(phase => {
            const values = getAuditValues(phase, metric);
            return <tr key={phase.mode} className="border-t"><th scope="row" className="px-4 py-3 text-left font-normal">{modeLabels[phase.mode as AuditMode]}</th>{Array.from({ length: audit.sampleCountPerMode }, (_, index) => <td key={index} className="px-3 py-3 text-right tabular-nums">{formatAuditMs(values?.[index])}</td>)}</tr>;
          })}</tbody></table>
        </div>
      </section>

      <details className="min-w-0 rounded-lg border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">측정 조건과 근거</summary>
        <div className="mt-3 space-y-2 break-words text-xs leading-5 text-muted-foreground">
          <p>{audit.runtime} · 같은 실행 환경 · 요청 제한 15초 · 캐시 MISS / DYNAMIC</p>
          <p>같은 소스의 서로 다른 배포에서 기존 조회, RPC 순서로 측정했습니다. 무작위 교차 비교가 아니므로 관측 차이를 RPC 변경의 인과 효과로 확정할 수 없습니다.</p>
          <p>첫 요청과 큰 값도 제외하지 않았습니다. 지역과 동시 운영 부하는 별도 측정하지 않았습니다. DB 시간은 최종 응답 직렬화를 포함하지 않습니다.</p>
          <p>이전 403 응답 10건은 별도 실패 기록으로 보존되며 이 비교에 포함하지 않습니다.</p>
          <p>측정 당시 소스 <code className="break-all">{audit.sourceSha}</code></p>
          <p>분석 SHA-256 <code className="break-all">{audit.analysisSha256}</code></p>
          {audit.phases.map(phase => <p key={phase.mode}>{modeLabels[phase.mode as AuditMode]} · {formatAuditDate(phase.startedAtUtc)} KST · 근거 <code className="break-all">{phase.receiptSha256}</code></p>)}
          <p>갱신은 새로 검증한 측정 파일을 반영하는 방식입니다. 이 화면은 추가 운영 요청이나 측정을 자동 실행하지 않습니다.</p>
        </div>
      </details>
    </div>
  </AdminEmbeddedModuleShell>;
}
