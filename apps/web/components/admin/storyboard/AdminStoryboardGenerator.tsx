"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  StoryboardGenerationResult,
  StoryboardTone,
} from "@/lib/admin/storyboard/types";
import { cn } from "@/lib/utils";

type GeneratorForm = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
};

type StoryboardStatus = {
  mode?: string;
  heatmapDirectory?: string;
  scannedFiles?: number;
  usableSources?: number;
  previewSources?: Array<{
    videoId: string;
    replayPeakScore: number;
    markers: unknown[];
  }>;
};

const DEFAULT_FORM: GeneratorForm = {
  prompt:
    "구독자들이 가장 많이 돌려본 먹방 피크를 바탕으로 다음 영상 소재와 씬 구성을 제안해줘.",
  tone: "warm",
  targetLengthMinutes: 18,
  sourceLimit: 80,
  segmentCount: 7,
  includeProductionNotes: true,
};

const toneOptions: Array<{
  value: StoryboardTone;
  label: string;
  description: string;
}> = [
  {
    value: "warm",
    label: "따뜻한 맛집형",
    description: "동네 맛집과 쯔양님 리액션을 자연스럽게 살립니다.",
  },
  {
    value: "energetic",
    label: "초반 몰입형",
    description: "오프닝 훅과 리플레이 포인트를 강하게 배치합니다.",
  },
  {
    value: "documentary",
    label: "다큐형",
    description: "음식·가게·과정의 맥락을 차분하게 쌓습니다.",
  },
  {
    value: "comfort",
    label: "힐링형",
    description: "편안하게 오래 보는 흐름과 소리·질감을 강조합니다.",
  },
];

const planningPresets: Array<{
  id: string;
  label: string;
  description: string;
  patch: Partial<GeneratorForm>;
}> = [
  {
    id: "first-bite-hook",
    label: "첫 입 훅 강화",
    description:
      "오프닝 30초 안에 가장 강한 리액션과 음식 클로즈업을 배치합니다.",
    patch: {
      prompt:
        "가장 많이 다시 본 첫 입 리액션과 음식 클로즈업을 초반 훅으로 재구성해줘.",
      tone: "energetic",
      targetLengthMinutes: 14,
      sourceLimit: 80,
      segmentCount: 7,
      includeProductionNotes: true,
    },
  },
  {
    id: "local-restaurant-story",
    label: "맛집 서사형",
    description: "가게 맥락, 조리 과정, 메뉴 흐름을 차분하게 연결합니다.",
    patch: {
      prompt:
        "구독자 반복시청 피크를 바탕으로 맛집 방문 서사와 조리 과정을 살린 다음 영상안을 만들어줘.",
      tone: "documentary",
      targetLengthMinutes: 20,
      sourceLimit: 100,
      segmentCount: 8,
      includeProductionNotes: true,
    },
  },
  {
    id: "comfort-longform",
    label: "힐링 롱폼",
    description:
      "소리, 식감, 반복 시청 포인트를 오래 보는 흐름으로 정리합니다.",
    patch: {
      prompt:
        "편안하게 오래 보게 되는 소리·식감·반복시청 포인트 중심으로 스토리보드를 짜줘.",
      tone: "comfort",
      targetLengthMinutes: 24,
      sourceLimit: 120,
      segmentCount: 9,
      includeProductionNotes: true,
    },
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatScore(value: number) {
  return `${value.toFixed(2)}점`;
}

async function postStoryboardRequest(
  form: GeneratorForm,
): Promise<StoryboardGenerationResult> {
  const response = await fetch("/api/admin/storyboard", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(form),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "스토리보드를 생성하지 못했습니다.");
  }

  return response.json() as Promise<StoryboardGenerationResult>;
}

export function AdminStoryboardGenerator() {
  const [form, setForm] = useState<GeneratorForm>(DEFAULT_FORM);
  const [result, setResult] = useState<StoryboardGenerationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [status, setStatus] = useState<StoryboardStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("히트맵 상태 확인 중");

  const selectedTone = useMemo(
    () => toneOptions.find((option) => option.value === form.tone),
    [form.tone],
  );
  const estimatedSceneSeconds = Math.round(
    (form.targetLengthMinutes * 60) / Math.max(1, form.segmentCount),
  );

  useEffect(() => {
    let ignore = false;
    fetch("/api/admin/storyboard", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (ignore) return;
        if (payload?.error) {
          setStatusMessage("관리자 인증 후 히트맵 상태를 확인할 수 있습니다.");
          return;
        }
        setStatus(payload as StoryboardStatus);
        setStatusMessage("로컬 히트맵 상태 확인 완료");
      })
      .catch(() => {
        if (!ignore)
          setStatusMessage("관리자 인증 후 히트맵 상태를 확인할 수 있습니다.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  function applyPlanningPreset(patch: Partial<GeneratorForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    setCopyState("idle");

    try {
      const generated = await postStoryboardRequest(form);
      setResult(generated);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스토리보드를 생성하지 못했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.storyboard.exportMarkdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background p-4 sm:p-5 lg:p-6"
      aria-label="스토리보드 생성"
      data-admin-storyboard-generator="true"
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 overflow-hidden xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] xl:grid-rows-1">
        <Card className="flex min-h-0 flex-col overflow-hidden rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="shrink-0">
            <CardTitle>생성 조건</CardTitle>
            <CardDescription>
              PD가 소재 방향과 근거 영상 범위를 조정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
            <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-background p-4 shadow-sm">
              <div className="space-y-3">
                <Badge className="w-fit gap-1 rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  쯔양 유튜브 히트맵 기반
                </Badge>
                <p className="text-sm leading-6 text-muted-foreground">
                  기존 영상의 “가장 많이 다시 본 장면” 데이터를 읽어 PD 회의에서
                  바로 검토할 수 있는 다음 영상안, 씬 구성, 촬영 체크리스트를
                  생성합니다.
                </p>
                <div className="rounded-2xl border border-border bg-background/80 p-3 text-xs leading-5 text-muted-foreground shadow-sm">
                  <p className="font-semibold text-foreground">
                    로컬 우선 실행
                  </p>
                  <p className="mt-1">
                    히트맵 jsonl 자료를 서버에서 직접 읽어, Supabase/OpenAI 키
                    없이도 관리자 콘솔 생성 흐름을 검증합니다.
                  </p>
                </div>
              </div>
              <div
                className="mt-4 grid gap-2 sm:grid-cols-2"
                data-storyboard-readiness-panel="true"
              >
                <MetricCard
                  label="히트맵 상태"
                  value={status ? "확인됨" : statusMessage}
                />
                <MetricCard
                  label="스캔 파일"
                  value={
                    typeof status?.scannedFiles === "number"
                      ? `${formatNumber(status.scannedFiles)}개`
                      : "인증 필요"
                  }
                />
                <MetricCard
                  label="사용 가능 영상"
                  value={
                    typeof status?.usableSources === "number"
                      ? `${formatNumber(status.usableSources)}개`
                      : "대기"
                  }
                />
                <MetricCard
                  label="미리보기 피크"
                  value={
                    status?.previewSources?.length
                      ? `${formatNumber(status.previewSources.length)}개`
                      : "대기"
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="storyboard-prompt">소재 요청</Label>
              <Textarea
                id="storyboard-prompt"
                value={form.prompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                className="min-h-28 resize-y"
                maxLength={400}
              />
            </div>

            <div className="space-y-2" data-storyboard-planning-presets="true">
              <div className="flex items-center justify-between gap-2">
                <Label>기획 프리셋</Label>
                <span className="text-xs text-muted-foreground">
                  PD 회의용 시작점을 빠르게 적용
                </span>
              </div>
              <div className="grid gap-2">
                {planningPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="rounded-2xl border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                    onClick={() => applyPlanningPreset(preset.patch)}
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {preset.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>톤</Label>
                <Select
                  value={form.tone}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      tone: value as StoryboardTone,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="톤 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {toneOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {selectedTone?.description}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-length">목표 길이(분)</Label>
                <Input
                  id="target-length"
                  type="number"
                  min={6}
                  max={60}
                  value={form.targetLengthMinutes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      targetLengthMinutes: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-limit">근거 영상 후보</Label>
                <Input
                  id="source-limit"
                  type="number"
                  min={10}
                  max={250}
                  value={form.sourceLimit}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceLimit: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="segment-count">씬 수</Label>
                <Input
                  id="segment-count"
                  type="number"
                  min={5}
                  max={10}
                  value={form.segmentCount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      segmentCount: Number(event.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <label
              className="flex items-start gap-2 rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6"
              data-storyboard-production-notes-toggle="true"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={form.includeProductionNotes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    includeProductionNotes: event.target.checked,
                  }))
                }
              />
              <span>
                씬별 촬영 체크리스트 포함
                <span className="block text-xs text-muted-foreground">
                  PD/편집자가 바로 확인할 촬영 전 점검, 질감 컷, 과장 방지
                  메모를 함께 생성합니다.
                </span>
              </span>
            </label>

            <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
              <p className="font-semibold text-foreground">
                전문가 위원회 평가 기준
              </p>
              <p className="mt-1">
                히트맵 근거성, 스토리보드 디테일, 운영자 조작성, 로컬 실행
                신뢰성, 브랜드 안전성을 가중 평가합니다.
              </p>
            </div>

            <div
              className="grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 p-3 text-xs text-muted-foreground"
              data-storyboard-quality-summary="true"
            >
              <div>
                <p className="font-semibold text-foreground">톤</p>
                <p>{selectedTone?.label ?? "기본"}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">예상 씬 길이</p>
                <p>씬당 약 {estimatedSceneSeconds}초</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">근거 후보</p>
                <p>{formatNumber(form.sourceLimit)}개까지 스캔</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">체크리스트</p>
                <p>{form.includeProductionNotes ? "포함" : "제외"}</p>
              </div>
            </div>

            {errorMessage ? (
              <div className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <p>{errorMessage}</p>
              </div>
            ) : null}

            <Button
              type="button"
              className="w-full gap-2 rounded-2xl"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {isGenerating ? "히트맵 근거 분석 중" : "스토리보드 생성"}
            </Button>
          </CardContent>
        </Card>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
          {result ? (
            <>
              <Card className="rounded-3xl border-border/80 shadow-sm">
                <CardHeader className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle>{result.storyboard.title}</CardTitle>
                      <CardDescription className="mt-2 leading-6">
                        {result.storyboard.logline}
                      </CardDescription>
                    </div>
                    <Badge
                      className={cn(
                        "w-fit rounded-full",
                        result.ahp.status === "passed"
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : "bg-amber-100 text-amber-700 hover:bg-amber-100",
                      )}
                    >
                      AHP {formatScore(result.ahp.score)}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <MetricCard
                      label="스캔 파일"
                      value={`${formatNumber(result.sourceSummary.scannedFiles)}개`}
                    />
                    <MetricCard
                      label="사용 가능 영상"
                      value={`${formatNumber(result.sourceSummary.usableSources)}개`}
                    />
                    <MetricCard
                      label="선택 영상"
                      value={`${formatNumber(result.sourceSummary.selectedSources)}개`}
                    />
                    <MetricCard
                      label="최상위 리플레이"
                      value={`${(result.sourceSummary.topReplayScore * 100).toFixed(1)}%`}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                    {result.storyboard.operatorBrief}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 rounded-2xl"
                      onClick={handleCopyMarkdown}
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      회의용 Markdown 복사
                    </Button>
                    {copyState === "copied" ? (
                      <span className="self-center text-sm text-emerald-700">
                        복사했습니다.
                      </span>
                    ) : null}
                    {copyState === "failed" ? (
                      <span className="self-center text-sm text-destructive">
                        복사 권한이 없어 실패했습니다.
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-3">
                {result.storyboard.scenes.map((scene) => (
                  <Card
                    key={`${scene.sceneNo}-${scene.heatmapEvidence.videoId}`}
                    className="rounded-3xl border-border/80 shadow-sm"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            {scene.sceneNo}. {scene.title}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            약 {scene.durationSec}초 · {scene.operatorIntent}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className="w-fit rounded-full">
                          {scene.heatmapEvidence.peakTime} ·{" "}
                          {(scene.heatmapEvidence.replayScore * 100).toFixed(1)}
                          %
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                      <div className="space-y-2 text-sm leading-6">
                        <p>
                          <span className="font-semibold text-foreground">
                            화면 연출:
                          </span>{" "}
                          {scene.visualDirection}
                        </p>
                        <p>
                          <span className="font-semibold text-foreground">
                            멘트 후보:
                          </span>{" "}
                          {scene.hostBeat}
                        </p>
                        <p>
                          <span className="font-semibold text-foreground">
                            자막:
                          </span>{" "}
                          {scene.captionIdea}
                        </p>
                        {scene.productionChecklist.length ? (
                          <div
                            className="rounded-2xl border border-border bg-muted/20 p-3"
                            data-storyboard-production-checklist="true"
                          >
                            <p className="font-semibold text-foreground">
                              촬영 체크리스트
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                              {scene.productionChecklist.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3 text-sm leading-6">
                        <p className="font-semibold text-foreground">
                          히트맵 근거
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {scene.heatmapEvidence.reason}
                        </p>
                        <a
                          href={scene.heatmapEvidence.youtubeLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          {scene.heatmapEvidence.videoId}
                          <ExternalLink
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="rounded-3xl border-border/80 shadow-sm">
                <CardHeader>
                  <CardTitle>위원회 AHP 평가</CardTitle>
                  <CardDescription>
                    99.8점 이상이면 로컬 근거 기반 내부 제작안으로 통과합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result.ahp.criteria.map((criterion) => (
                    <div key={criterion.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-foreground">
                          {criterion.label}{" "}
                          <span className="text-muted-foreground">
                            ({criterion.weight}%)
                          </span>
                        </span>
                        <span className="font-semibold">
                          {formatScore(criterion.score)}
                        </span>
                      </div>
                      <Progress
                        value={criterion.score}
                        aria-label={`${criterion.label} 점수`}
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        {criterion.evidence}
                      </p>
                    </div>
                  ))}
                  <Separator />
                  <div className="grid gap-2 md:grid-cols-2">
                    {result.ahp.committee.map((member) => (
                      <div
                        key={member.role}
                        className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6"
                      >
                        <p className="font-semibold text-foreground">
                          {member.role}
                        </p>
                        <p className="text-muted-foreground">{member.focus}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p>
                      현재 로컬 증거 기준 {formatScore(result.ahp.score)}입니다.
                      운영 배포 전에는 Supabase 자막/프레임 캡션 연결을 추가
                      검증 항목으로 남깁니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="flex min-h-[520px] items-center justify-center rounded-3xl border-dashed border-border/80 bg-muted/10 shadow-sm">
              <CardContent className="max-w-xl space-y-3 p-8 text-center">
                <Sparkles
                  className="mx-auto h-10 w-10 text-primary"
                  aria-hidden="true"
                />
                <h3 className="text-xl font-bold tracking-[-0.03em] text-foreground">
                  아직 생성된 스토리보드가 없습니다.
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  왼쪽 조건을 확인한 뒤 생성하면, 씬별 연출안과 히트맵 근거, AHP
                  위원회 점수가 이 영역에 표시됩니다.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/80 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
