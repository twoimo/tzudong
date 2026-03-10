"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Loader2, Play, RefreshCw } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  AdminWorkflowRunRecord,
  CanonicalWorkflowStepView,
  WorkflowStepStatus,
  summarizeRowSignals,
} from '@/lib/admin/workflow-contract';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { GlobalLoader } from '@/components/ui/global-loader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface WorkflowListResponse {
  total: number;
  records: Array<
    AdminWorkflowRunRecord & {
      progress_percent: number;
      failure_point: {
        canonical_step_no: number;
        name: string;
        status: WorkflowStepStatus;
      } | null;
    }
  >;
}

interface WorkflowStatusResponse {
  run: AdminWorkflowRunRecord;
  steps: CanonicalWorkflowStepView[];
  progress_percent: number;
  failure_point: {
    canonical_step_no: number;
    name: string;
    status: WorkflowStepStatus;
    message: string | null;
  } | null;
  github_html_url: string | null;
  refresh_error: string | null;
}

interface TriggerResponse {
  run_id: string;
  dispatch_request_id: string;
  correlation_state: string;
}

const statusLabelMap: Record<WorkflowStepStatus, string> = {
  queued: '대기',
  running: '진행중',
  success: '성공',
  failed: '실패',
  timeout: '타임아웃',
  partial: '부분완료',
  skipped: '스킵',
};

const statusColorMap: Record<WorkflowStepStatus, string> = {
  queued: 'bg-slate-200 text-slate-800',
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  timeout: 'bg-orange-100 text-orange-700',
  partial: 'bg-amber-100 text-amber-700',
  skipped: 'bg-zinc-100 text-zinc-700',
};

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function fetchWorkflowRuns(): Promise<WorkflowListResponse> {
  const response = await fetch('/api/admin/workflows/runs?limit=40', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function fetchWorkflowStatus(runId: string): Promise<WorkflowStatusResponse> {
  const response = await fetch(`/api/admin/workflows/runs/${runId}/status`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function WorkflowAdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAdmin, isLoading: authLoading } = useAuth();

  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState('-1');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      router.push('/');
    }
  }, [authLoading, user, isAdmin, router]);

  const runsQuery = useQuery({
    queryKey: ['admin-workflows-runs'],
    queryFn: fetchWorkflowRuns,
    refetchOnWindowFocus: false,
  });

  const selectedRunQuery = useQuery({
    queryKey: ['admin-workflows-run-status', selectedRunId],
    queryFn: () => fetchWorkflowStatus(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    refetchInterval: realtimeConnected ? false : 15000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const firstRunId = runsQuery.data?.records?.[0]?.run_id;
    if (!selectedRunId && firstRunId) {
      setSelectedRunId(firstRunId);
    }

    if (selectedRunId && runsQuery.data?.records && !runsQuery.data.records.some((record) => record.run_id === selectedRunId)) {
      setSelectedRunId(firstRunId || null);
    }
  }, [runsQuery.data, selectedRunId]);

  useEffect(() => {
    if (!user || !isAdmin) {
      setRealtimeConnected(false);
      return;
    }

    const realtimeChannel = supabase
      .channel('admin-workflows-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'admin_workflow_runs' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['admin-workflows-runs'] });
          if (selectedRunId) {
            void queryClient.invalidateQueries({ queryKey: ['admin-workflows-run-status', selectedRunId] });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'admin_workflow_steps' },
        (payload) => {
          const runId = (payload.new as { run_id?: string } | null)?.run_id || (payload.old as { run_id?: string } | null)?.run_id;
          void queryClient.invalidateQueries({ queryKey: ['admin-workflows-runs'] });
          if (runId) {
            void queryClient.invalidateQueries({ queryKey: ['admin-workflows-run-status', runId] });
          }
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [queryClient, selectedRunId, user, isAdmin]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/admin/workflows/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelUrl, maxVideos }),
      });

      const payload = (await response.json()) as TriggerResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '워크플로 트리거에 실패했습니다.');
      }
      return payload;
    },
    onSuccess: async (data) => {
      toast({ title: '워크플로 트리거 완료', description: `Run ID: ${data.run_id}` });
      await queryClient.invalidateQueries({ queryKey: ['admin-workflows-runs'] });
      setSelectedRunId(data.run_id);
    },
    onError: (error) => {
      toast({ title: '워크플로 트리거 실패', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const selectedRun = selectedRunQuery.data?.run || null;
  const steps = selectedRunQuery.data?.steps || [];

  const runStateBadge = useMemo(() => {
    if (!selectedRun) return null;
    return `${selectedRun.correlation_state} / ${selectedRun.github_status || '-'}${selectedRun.github_conclusion ? ` (${selectedRun.github_conclusion})` : ''}`;
  }, [selectedRun]);

  if (authLoading || !user || !isAdmin) {
    return <GlobalLoader />;
  }

  return (
    <div className="min-h-screen bg-[#fdfbf7] font-serif">
      <div className="relative z-10 container mx-auto p-4 md:p-6 max-w-[1400px]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="hover:bg-stone-200/50 h-8 w-8 md:h-10 md:w-10">
              <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-stone-900">워크플로 운영</h1>
              <p className="text-sm text-stone-500">관리자 전용 실행/상태 모니터링 (realtime 우선, polling fallback)</p>
            </div>
          </div>
          <Badge variant={realtimeConnected ? 'default' : 'secondary'}>{realtimeConnected ? 'Realtime 연결됨' : 'Polling fallback 중'}</Badge>
        </div>

        <Card className="p-4 md:p-5 mb-5 border-stone-200 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-3 items-end">
            <div>
              <Label htmlFor="workflow-channel-url">채널 URL</Label>
              <Input
                id="workflow-channel-url"
                value={channelUrl}
                onChange={(event) => setChannelUrl(event.target.value)}
                placeholder="https://www.youtube.com/@tzuyang"
              />
            </div>
            <div>
              <Label htmlFor="workflow-max-videos">MAX_CONTEXT_VIDEOS</Label>
              <Input id="workflow-max-videos" value={maxVideos} onChange={(event) => setMaxVideos(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                className="bg-stone-800 hover:bg-stone-700"
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending || !channelUrl.trim()}
              >
                {triggerMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                실행
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['admin-workflows-runs'] });
                  if (selectedRunId) {
                    void queryClient.invalidateQueries({ queryKey: ['admin-workflows-run-status', selectedRunId] });
                  }
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />새로고침
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-[620px_1fr] gap-5">
          <Card className="border-stone-200 bg-white overflow-hidden">
            <Table>
              <TableHeader className="bg-stone-50">
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>채널</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>진행률</TableHead>
                  <TableHead>실패 지점</TableHead>
                  <TableHead>요청 시각</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      로딩 중...
                    </TableCell>
                  </TableRow>
                )}
                {!runsQuery.isLoading && (runsQuery.data?.records?.length || 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      실행 이력이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
                {(runsQuery.data?.records || []).map((record) => (
                  <TableRow
                    key={record.run_id}
                    className={`cursor-pointer ${record.run_id === selectedRunId ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                    onClick={() => setSelectedRunId(record.run_id)}
                  >
                    <TableCell className="font-mono text-xs">{record.run_id.slice(0, 8)}...</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={record.channel_url_normalized}>
                      @{record.channel_slug}
                    </TableCell>
                    <TableCell className="text-xs">{record.correlation_state}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="h-2 w-24 rounded bg-stone-200 overflow-hidden">
                          <div className="h-full bg-emerald-600" style={{ width: `${record.progress_percent}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">{record.progress_percent}%</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{record.failure_point ? `${record.failure_point.canonical_step_no}. ${record.failure_point.name}` : '-'}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(record.requested_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="border-stone-200 bg-white p-4">
            {!selectedRunId && <p className="text-sm text-muted-foreground">좌측에서 실행을 선택해주세요.</p>}
            {selectedRunId && selectedRunQuery.isLoading && <p className="text-sm text-muted-foreground">상세 정보를 불러오는 중...</p>}
            {selectedRun && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <h2 className="text-lg font-semibold">Run 상세</h2>
                  <div className="flex items-center gap-2">
                    {runStateBadge && <Badge variant="secondary">{runStateBadge}</Badge>}
                    {selectedRunQuery.data?.github_html_url && (
                      <Button asChild variant="outline" size="sm">
                        <a href={selectedRunQuery.data.github_html_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />GitHub
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Run ID:</span> <span className="font-mono">{selectedRun.run_id}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Dispatch ID:</span>{' '}
                    <span className="font-mono">{selectedRun.dispatch_request_id}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">채널 URL:</span> {selectedRun.channel_url_normalized}
                  </p>
                  <p>
                    <span className="text-muted-foreground">진행률:</span> {selectedRunQuery.data?.progress_percent ?? 0}%
                  </p>
                  <p>
                    <span className="text-muted-foreground">요청:</span> {formatDateTime(selectedRun.requested_at)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">완료:</span> {formatDateTime(selectedRun.completed_at)}
                  </p>
                </div>

                {selectedRunQuery.data?.failure_point && (
                  <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    실패 지점: {selectedRunQuery.data.failure_point.canonical_step_no}. {selectedRunQuery.data.failure_point.name}
                    {selectedRunQuery.data.failure_point.message ? ` — ${selectedRunQuery.data.failure_point.message}` : ''}
                  </div>
                )}

                {selectedRunQuery.data?.refresh_error && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    GitHub 상태 새로고침 실패: {selectedRunQuery.data.refresh_error}
                  </div>
                )}

                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-stone-50">
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>단계</TableHead>
                        <TableHead>상태</TableHead>
                        <TableHead>시작/종료</TableHead>
                        <TableHead>메시지</TableHead>
                        <TableHead>Row signals</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {steps.map((step) => {
                        const rowSignals = summarizeRowSignals(step.row_delta);
                        return (
                          <TableRow key={step.canonical_step_no}>
                            <TableCell>{step.canonical_step_no}</TableCell>
                            <TableCell>
                              <p className="font-medium">{step.name}</p>
                              <p className="text-xs text-muted-foreground">{step.script_step_label || step.canonical_step_key}</p>
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColorMap[step.status]}>{statusLabelMap[step.status]}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              <p>{formatDateTime(step.started_at)}</p>
                              <p>{formatDateTime(step.ended_at)}</p>
                            </TableCell>
                            <TableCell className="text-xs max-w-[220px] whitespace-normal">{step.message || '-'}</TableCell>
                            <TableCell className="text-xs">
                              {rowSignals.length === 0 ? (
                                '-'
                              ) : (
                                <div className="flex flex-col gap-1">
                                  {rowSignals.map((signal) => (
                                    <span key={signal}>{signal}</span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AdminWorkflowPageWrapper() {
  return (
    <Suspense fallback={<GlobalLoader />}>
      <WorkflowAdminPage />
    </Suspense>
  );
}
