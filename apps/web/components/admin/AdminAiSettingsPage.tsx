'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Loader2, Plus, RefreshCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  type AdminAiCandidateModel,
  type AdminAiProvider,
  type AdminAiProviderKeySummary,
  type AdminAiSettingsResponse,
  OCR_ROUTING_PROVIDERS,
  getProviderLabel,
} from '@/lib/admin/ai-settings-store';

const PROVIDERS: AdminAiProvider[] = ['gemini', 'openai', 'nvidia_nim'];
const ROUTING_PROVIDERS: AdminAiProvider[] = [...OCR_ROUTING_PROVIDERS];

type SettingsFormState = {
  routingMode: 'automatic' | 'manual';
  manualProvider: AdminAiProvider;
  manualModel: string;
  candidateModels: AdminAiCandidateModel[];
};

type AiLeaderboardSnapshotPayload = {
  id?: string;
  fetchedAt: string;
  leaderboardConfig: string;
  candidates: Array<AdminAiCandidateModel & {
    arenaRank?: number | null;
    arenaRating?: number | null;
    voteCount?: number | null;
    publishedAt?: string | null;
  }>;
};

const EMPTY_SETTINGS: SettingsFormState = {
  routingMode: 'automatic',
  manualProvider: 'nvidia_nim',
  manualModel: '',
  candidateModels: [],
};

function createEmptyCandidateModel(index: number): AdminAiCandidateModel {
  return {
    id: `draft-${Date.now()}-${index}`,
    provider: 'nvidia_nim',
    model: '',
    label: '',
  };
}

function toSettingsFormState(payload?: AdminAiSettingsResponse | null): SettingsFormState {
  if (!payload) return EMPTY_SETTINGS;

  return {
    routingMode: payload.settings.routingMode,
    manualProvider: payload.settings.manualProvider ?? payload.settings.candidateModels[0]?.provider ?? 'nvidia_nim',
    manualModel: payload.settings.manualModel ?? payload.settings.candidateModels[0]?.model ?? '',
    candidateModels: payload.settings.candidateModels,
  };
}

export default function AdminAiSettingsPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const [payload, setPayload] = useState<AdminAiSettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsFormState>(EMPTY_SETTINGS);
  const [keyDrafts, setKeyDrafts] = useState<Record<AdminAiProvider, string>>({
    gemini: '',
    openai: '',
    nvidia_nim: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [savingProvider, setSavingProvider] = useState<AdminAiProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<AdminAiProvider | null>(null);
  const [leaderboardSnapshot, setLeaderboardSnapshot] = useState<AiLeaderboardSnapshotPayload | null>(null);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [isLeaderboardSyncing, setIsLeaderboardSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storageWarning = useMemo(() => {
    if (!payload) return null;
    if (!payload.storage.serviceRoleConfigured) {
      return 'SUPABASE_SERVICE_ROLE_KEY가 없어 현재는 환경변수 fallback 상태만 확인할 수 있습니다.';
    }
    if (!payload.storage.databaseConfigured) {
      return 'DB 테이블이 아직 준비되지 않았거나 읽을 수 없습니다. 마이그레이션 적용 후 서버 저장이 활성화됩니다.';
    }
    return null;
  }, [payload]);

  const promotionGate = payload?.promotionGate ?? null;

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/ai-settings', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      setPayload(data as AdminAiSettingsResponse);
      setForm(toSettingsFormState(data as AdminAiSettingsResponse));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'AI 설정을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadLeaderboardSnapshot = useCallback(async () => {
    setIsLeaderboardLoading(true);

    try {
      const response = await fetch('/api/admin/ai-settings/leaderboard', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      setLeaderboardSnapshot((data.snapshot ?? null) as AiLeaderboardSnapshotPayload | null);
    } catch {
      setLeaderboardSnapshot(null);
    } finally {
      setIsLeaderboardLoading(false);
    }
  }, []);

  const syncLeaderboardSnapshot = useCallback(async () => {
    setIsLeaderboardSyncing(true);

    try {
      const response = await fetch('/api/admin/ai-settings/leaderboard/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      setLeaderboardSnapshot((data.snapshot ?? null) as AiLeaderboardSnapshotPayload | null);
      toast({ title: 'Arena.ai 동기화 완료', description: '최신 Vision 리더보드 스냅샷을 저장했습니다.' });
    } catch (syncError) {
      toast({
        title: 'Arena.ai 동기화 실패',
        description: syncError instanceof Error ? syncError.message : '리더보드 스냅샷을 저장하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLeaderboardSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      router.push('/');
      return;
    }

    if (!authLoading && user && isAdmin) {
      void loadSettings();
      void loadLeaderboardSnapshot();
    }
  }, [authLoading, isAdmin, loadLeaderboardSnapshot, loadSettings, router, user]);

  const updateCandidate = useCallback((index: number, patch: Partial<AdminAiCandidateModel>) => {
    setForm((current) => ({
      ...current,
      candidateModels: current.candidateModels.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    }));
  }, []);

  const addCandidate = useCallback(() => {
    setForm((current) => ({
      ...current,
      candidateModels: [...current.candidateModels, createEmptyCandidateModel(current.candidateModels.length)],
    }));
  }, []);

  const removeCandidate = useCallback((index: number) => {
    setForm((current) => ({
      ...current,
      candidateModels: current.candidateModels.filter((_, itemIndex) => itemIndex !== index),
    }));
  }, []);

  const saveSettings = useCallback(async () => {
    setIsSavingSettings(true);

    try {
      const response = await fetch('/api/admin/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      const nextPayload = data as AdminAiSettingsResponse;
      setPayload(nextPayload);
      setForm(toSettingsFormState(nextPayload));
      toast({ title: '저장 완료', description: 'OCR 라우팅 설정을 저장했습니다.' });
    } catch (saveError) {
      toast({
        title: '저장 실패',
        description: saveError instanceof Error ? saveError.message : '설정을 저장하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [form]);

  const upsertKey = useCallback(async (provider: AdminAiProvider) => {
    setSavingProvider(provider);

    try {
      const response = await fetch(`/api/admin/ai-settings/keys/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: keyDrafts[provider] }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      setPayload((current) => {
        if (!current) return current;
        return {
          ...current,
          providers: current.providers.map((item) => (item.provider === provider ? (data as AdminAiProviderKeySummary) : item)),
        };
      });
      setKeyDrafts((current) => ({ ...current, [provider]: '' }));
      toast({ title: 'API 키 저장 완료', description: `${getProviderLabel(provider)} 키를 서버에 저장했습니다.` });
    } catch (saveError) {
      toast({
        title: 'API 키 저장 실패',
        description: saveError instanceof Error ? saveError.message : 'API 키를 저장하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSavingProvider(null);
    }
  }, [keyDrafts]);

  const deleteKey = useCallback(async (provider: AdminAiProvider) => {
    setDeletingProvider(provider);

    try {
      const response = await fetch(`/api/admin/ai-settings/keys/${provider}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
      }

      setPayload((current) => {
        if (!current) return current;
        return {
          ...current,
          providers: current.providers.map((item) => (item.provider === provider ? (data as AdminAiProviderKeySummary) : item)),
        };
      });
      toast({ title: 'API 키 삭제 완료', description: `${getProviderLabel(provider)} 저장 키를 삭제했습니다.` });
    } catch (deleteError) {
      toast({
        title: 'API 키 삭제 실패',
        description: deleteError instanceof Error ? deleteError.message : 'API 키를 삭제하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setDeletingProvider(null);
    }
  }, []);

  if (authLoading || !user || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <Loader2 className="h-5 w-5 animate-spin text-stone-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-6 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <p className="text-sm font-medium text-emerald-700">Admin AI Settings</p>
              <h1 className="text-2xl font-semibold text-stone-900">OCR AI 라우팅 / 키 관리</h1>
              <p className="text-sm text-stone-500">수동 모델 라우팅, 후보 모델 목록, provider API 키를 서버 저장소 기준으로 관리합니다.</p>
              <p className="mt-1 text-xs text-amber-700">
                현재 기본 OCR 라우팅은 Gemini baseline을 우선하고 NVIDIA NIM을 장애 fallback/실험 후보로 사용합니다. 기본 모델/프롬프트 승격은 평가 게이트 통과 후에만 저장됩니다.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void loadSettings()} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            새로고침
          </Button>
        </div>

        {error ? (
          <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>
        ) : null}
        {storageWarning ? (
          <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{storageWarning}</Card>
        ) : null}
        {promotionGate ? (
          <Card className={promotionGate.ok ? 'border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900' : 'border-amber-200 bg-amber-50 p-4 text-sm text-amber-900'}>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-medium">OCR 프로덕션 승격 게이트: {promotionGate.ok ? '통과' : '차단 중'}</p>
                <p className="mt-1 text-xs">
                  검증 fixture {promotionGate.fixtureCount}개 / 한국 음식점·주문 fixture {promotionGate.koreanRestaurantFixtureCount}개입니다.
                  기준 미달 상태에서는 기본 OCR 모델/프롬프트/전처리 변경 저장이 막힙니다.
                </p>
              </div>
              <Badge variant="outline" className={promotionGate.ok ? 'border-emerald-300 bg-white text-emerald-700' : 'border-amber-300 bg-white text-amber-700'}>
                {promotionGate.ok ? 'promotion allowed' : 'promotion blocked'}
              </Badge>
            </div>
            {!promotionGate.ok && promotionGate.reasons.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                {promotionGate.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            ) : null}
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <Card className="p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">OCR 라우팅 설정</h2>
                <p className="text-sm text-stone-500">자동/수동 모드와 수동 provider/model, 후보 모델 목록을 저장합니다.</p>
              </div>
              {payload?.settings.updatedAt ? (
                <Badge variant="outline">업데이트 {new Date(payload.settings.updatedAt).toLocaleString('ko-KR')}</Badge>
              ) : null}
            </div>

            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="routing-mode">라우팅 모드</Label>
                <select
                  id="routing-mode"
                  value={form.routingMode}
                  onChange={(event) => setForm((current) => ({ ...current, routingMode: event.target.value as SettingsFormState['routingMode'] }))}
                  className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"
                >
                  <option value="automatic">automatic</option>
                  <option value="manual">manual</option>
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="manual-provider">수동 provider</Label>
                  <select
                    id="manual-provider"
                    value={form.manualProvider}
                    onChange={(event) => setForm((current) => ({ ...current, manualProvider: event.target.value as AdminAiProvider }))}
                    className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"
                  >
                    {ROUTING_PROVIDERS.map((provider) => (
                      <option key={provider} value={provider}>{getProviderLabel(provider)}</option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500">Gemini baseline을 기본으로 두고, NIM 후보는 평가셋 기준 통과 후 승격합니다.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manual-model">수동 model</Label>
                  <Input
                    id="manual-model"
                    value={form.manualModel}
                    onChange={(event) => setForm((current) => ({ ...current, manualModel: event.target.value }))}
                    placeholder="예: nvidia/nemotron-nano-12b-v2-vl"
                  />
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>후보 모델</Label>
                    <p className="mt-1 text-xs text-stone-500">automatic 모드에서 비교/선택할 후보 모델 목록입니다.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addCandidate}>
                    <Plus className="mr-2 h-4 w-4" /> 후보 추가
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Provider</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="w-[72px] text-right">삭제</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.candidateModels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-sm text-stone-500">등록된 후보 모델이 없습니다.</TableCell>
                      </TableRow>
                    ) : form.candidateModels.map((candidate, index) => (
                      <TableRow key={candidate.id}>
                        <TableCell>
                          <select
                            value={candidate.provider}
                            onChange={(event) => updateCandidate(index, { provider: event.target.value as AdminAiProvider })}
                            className="h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
                          >
                            {ROUTING_PROVIDERS.map((provider) => (
                              <option key={provider} value={provider}>{getProviderLabel(provider)}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input value={candidate.label} onChange={(event) => updateCandidate(index, { label: event.target.value })} placeholder="표시명" />
                        </TableCell>
                        <TableCell>
                          <Input value={candidate.model} onChange={(event) => updateCandidate(index, { model: event.target.value })} placeholder="실제 모델 ID" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeCandidate(index)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-end gap-3">
                <Button variant="outline" type="button" onClick={() => setForm(toSettingsFormState(payload))} disabled={!payload || isSavingSettings}>
                  초기화
                </Button>
                <Button type="button" onClick={() => void saveSettings()} disabled={isSavingSettings}>
                  {isSavingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  설정 저장
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid gap-6">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Provider API 키</h2>
              <p className="text-sm text-stone-500">raw secret은 반환하지 않고, 새 저장 키는 서버에서 암호화한 뒤 보관합니다.</p>
                </div>
              </div>
              <div className="grid gap-4">
                {PROVIDERS.map((provider) => {
                  const summary = payload?.providers.find((item) => item.provider === provider);
                  const sourceTone = summary?.source === 'database'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : summary?.source === 'environment'
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-stone-100 text-stone-600 border-stone-200';

                  return (
                    <Card key={provider} className="border border-stone-200 p-4 shadow-none">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-stone-500" />
                            <h3 className="font-medium text-stone-900">{getProviderLabel(provider)}</h3>
                          </div>
                          <p className="mt-1 text-xs text-stone-500">활성 소스: {summary?.source ?? 'none'} / 마스킹: {summary?.maskedSecret ?? '없음'}</p>
                        </div>
                        <Badge className={sourceTone} variant="outline">{summary?.source ?? 'none'}</Badge>
                      </div>

                      <div className="grid gap-2 text-xs text-stone-500">
                        <p>DB 저장 여부: {summary?.hasStoredKey ? '있음' : '없음'}</p>
                        <p>환경변수 fallback: {summary?.hasEnvKey ? '있음' : '없음'}</p>
                        <p>마지막 저장: {summary?.updatedAt ? new Date(summary.updatedAt).toLocaleString('ko-KR') : '없음'}</p>
                      </div>

                      <div className="mt-4 grid gap-2">
                        <Label htmlFor={`provider-secret-${provider}`}>새 API 키 저장 / 교체</Label>
                        <Input
                          id={`provider-secret-${provider}`}
                          type="password"
                          value={keyDrafts[provider]}
                          onChange={(event) => setKeyDrafts((current) => ({ ...current, [provider]: event.target.value }))}
                          placeholder={`${getProviderLabel(provider)} secret 입력`}
                          className="font-mono text-xs"
                        />
                      </div>

                      <div className="mt-4 flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void deleteKey(provider)}
                          disabled={deletingProvider === provider || !summary?.hasStoredKey}
                        >
                          {deletingProvider === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          저장 키 삭제
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void upsertKey(provider)}
                          disabled={savingProvider === provider || !keyDrafts[provider].trim()}
                        >
                          {savingProvider === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                          키 저장
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </Card>


            <Card className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Arena.ai 라우팅 스냅샷</h2>
                  <p className="text-sm text-stone-500">
                    무료 플랜에서는 요청마다 실시간 조회하지 않고, 관리자/크론 동기화 스냅샷을 automatic 라우팅 후보 앞단에 반영합니다.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void syncLeaderboardSnapshot()} disabled={isLeaderboardSyncing}>
                  {isLeaderboardSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                  동기화
                </Button>
              </div>

              {isLeaderboardLoading ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> 스냅샷 확인 중...
                </div>
              ) : leaderboardSnapshot ? (
                <div className="grid gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{leaderboardSnapshot.leaderboardConfig}</Badge>
                    <Badge variant="outline">후보 {leaderboardSnapshot.candidates.length}개</Badge>
                    <span className="text-xs text-stone-500">동기화 {new Date(leaderboardSnapshot.fetchedAt).toLocaleString('ko-KR')}</span>
                  </div>
                  <div className="grid gap-2">
                    {leaderboardSnapshot.candidates.length ? leaderboardSnapshot.candidates.slice(0, 4).map((candidate) => (
                      <div key={candidate.id} className="rounded-md border border-stone-200 bg-white p-3">
                        <p className="font-medium text-stone-900">{candidate.label}</p>
                        <p className="mt-1 font-mono text-xs text-stone-500">{candidate.model}</p>
                      </div>
                    )) : (
                      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                        현재 Arena Vision 상위권에서 NVIDIA NIM으로 안전하게 매핑 가능한 후보가 없습니다. 기존 관리자 후보/환경변수 후보로 fallback합니다.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-stone-500">저장된 Arena.ai 스냅샷이 없습니다. 필요할 때 수동 동기화하거나 Vercel Cron에서 하루 1회 호출하도록 설정할 수 있습니다.</p>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="text-lg font-semibold text-stone-900">응답/보안 메모</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-stone-600">
                <li>GET 응답에는 provider별 마스킹된 secret 상태만 포함됩니다.</li>
                <li>새로 저장하는 DB 키는 AES-GCM 암호화 blob으로 저장되며, 기존 plaintext 행은 읽기 호환만 유지합니다.</li>
                <li>저장된 DB 키가 없으면 환경변수 키 존재 여부로 fallback 상태를 보여줍니다.</li>
                <li>manual 모드에서도 candidate 모델 목록은 유지되어 이후 automatic 모드 복귀 시 그대로 사용됩니다.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
