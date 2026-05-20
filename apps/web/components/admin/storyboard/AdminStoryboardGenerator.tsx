"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Loader2, Play, Sparkles, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { StoryboardGenerationResult, StoryboardTone } from "@/lib/admin/storyboard/types";
import { cn } from "@/lib/utils";

type GeneratorForm = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
};

const DEFAULT_FORM: GeneratorForm = {
  prompt: "구독자들이 가장 많이 돌려본 먹방 피크를 바탕으로 다음 영상 소재와 씬 구성을 제안해줘.",
  tone: "warm",
  targetLengthMinutes: 18,
  sourceLimit: 80,
  segmentCount: 7,
  includeProductionNotes: true,
};

const toneOptions: Array<{ value: StoryboardTone; label: string; description: string }> = [
  { value: "warm", label: "따뜻한 맛집형", description: "동네 맛집과 쯔양님 리액션을 자연스럽게 살립니다." },
  { value: "energetic", label: "초반 몰입형", description: "오프닝 훅과 리플레이 포인트를 강하게 배치합니다." },
  { value: "documentary", label: "다큐형", description: "음식·가게·과정의 맥락을 차분하게 쌓습니다." },
  { value: "comfort", label: "힐링형", description: "편안하게 오래 보는 흐름과 소리·질감을 강조합니다." },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatScore(value: number) {
  return `${value.toFixed(2)}점`;
}

async function postStoryboardRequest(form: GeneratorForm): Promise<StoryboardGenerationResult> {
  const response = await fetch("/api/admin/storyboard", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(form),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "스토리보드를 생성하지 못했습니다.");
  }

  return response.json() as Promise<StoryboardGenerationResult>;
}

export function AdminStoryboardGenerator() {
  const [form, setForm] = useState<GeneratorForm>(DEFAULT_FORM);
  const [result, setResult] = useState<StoryboardGenerationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const selectedTone = useMemo(() => toneOptions.find((option) => option.value === form.tone), [form.tone]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    setCopyState("idle");

    try {
      const generated = await postStoryboardRequest(form);
      setResult(generated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스토리보드를 생성하지 못했습니다.");
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
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className="space-y-4 p-4 sm:p-5 lg:p-6">
        <div className="rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-background p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <Badge className="w-fit gap-1 rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                쯔양 유튜브 히트맵 기반
              </Badge>
              <div>
                <h2 className="text-2xl font-bold tracking-[-0.04em] text-foreground md:text-3xl">
                  스토리보드 생성
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
                  기존 영상의 “가장 많이 다시 본 장면” 데이터를 읽어 PD 회의에서 바로 검토할 수 있는 다음 영상안, 씬 구성, 촬영 체크리스트를 생성합니다.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-background/80 p-4 text-sm text-muted-foreground shadow-sm lg:w-72">
              <p className="font-semibold text-foreground">로컬 우선 실행</p>
              <p className="mt-2 leading-6">
                현재 단계는 백엔드의 히트맵 jsonl 자료를 서버에서 직접 읽습니다. Supabase/OpenAI 키가 없어도 관리자 콘솔에서 생성 흐름을 검증할 수 있습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
          <Card className="h-fit rounded-3xl border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>생성 조건</CardTitle>
              <CardDescription>PD가 소재 방향과 근거 영상 범위를 조정합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="storyboard-prompt">소재 요청</Label>
                <Textarea
                  id="storyboard-prompt"
                  value={form.prompt}
                  onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                  className="min-h-28 resize-y"
                  maxLength={400}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>톤</Label>
                  <Select value={form.tone} onValueChange={(value) => setForm((current) => ({ ...current, tone: value as StoryboardTone }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="톤 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {toneOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">{selectedTone?.description}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="target-length">목표 길이(분)</Label>
                  <Input
                    id="target-length"
                    type="number"
                    min={6}
                    max={60}
                    value={form.targetLengthMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, targetLengthMinutes: Number(event.target.value) }))}
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
                    onChange={(event) => setForm((current) => ({ ...current, sourceLimit: Number(event.target.value) }))}
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
                    onChange={(event) => setForm((current) => ({ ...current, segmentCount: Number(event.target.value) }))}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                <p className="font-semibold text-foreground">전문가 위원회 평가 기준</p>
                <p className="mt-1">히트맵 근거성, 스토리보드 디테일, 운영자 조작성, 로컬 실행 신뢰성, 브랜드 안전성을 가중 평가합니다.</p>
              </div>

              {errorMessage ? (
                <div className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>{errorMessage}</p>
                </div>
              ) : null}

              <Button type="button" className="w-full gap-2 rounded-2xl" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                {isGenerating ? "히트맵 근거 분석 중" : "스토리보드 생성"}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {result ? (
              <>
                <Card className="rounded-3xl border-border/80 shadow-sm">
                  <CardHeader className="space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <CardTitle>{result.storyboard.title}</CardTitle>
                        <CardDescription className="mt-2 leading-6">{result.storyboard.logline}</CardDescription>
                      </div>
                      <Badge
                        className={cn(
                          "w-fit rounded-full",
                          result.ahp.status === "passed" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100",
                        )}
                      >
                        AHP {formatScore(result.ahp.score)}
                      </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <MetricCard label="스캔 파일" value={`${formatNumber(result.sourceSummary.scannedFiles)}개`} />
                      <MetricCard label="사용 가능 영상" value={`${formatNumber(result.sourceSummary.usableSources)}개`} />
                      <MetricCard label="선택 영상" value={`${formatNumber(result.sourceSummary.selectedSources)}개`} />
                      <MetricCard label="최상위 리플레이" value={`${(result.sourceSummary.topReplayScore * 100).toFixed(1)}%`} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                      {result.storyboard.operatorBrief}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="gap-2 rounded-2xl" onClick={handleCopyMarkdown}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        회의용 Markdown 복사
                      </Button>
                      {copyState === "copied" ? <span className="self-center text-sm text-emerald-700">복사했습니다.</span> : null}
                      {copyState === "failed" ? <span className="self-center text-sm text-destructive">복사 권한이 없어 실패했습니다.</span> : null}
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-3">
                  {result.storyboard.scenes.map((scene) => (
                    <Card key={`${scene.sceneNo}-${scene.heatmapEvidence.videoId}`} className="rounded-3xl border-border/80 shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <CardTitle className="text-lg">{scene.sceneNo}. {scene.title}</CardTitle>
                            <CardDescription className="mt-1">약 {scene.durationSec}초 · {scene.operatorIntent}</CardDescription>
                          </div>
                          <Badge variant="outline" className="w-fit rounded-full">
                            {scene.heatmapEvidence.peakTime} · {(scene.heatmapEvidence.replayScore * 100).toFixed(1)}%
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                        <div className="space-y-2 text-sm leading-6">
                          <p><span className="font-semibold text-foreground">화면 연출:</span> {scene.visualDirection}</p>
                          <p><span className="font-semibold text-foreground">멘트 후보:</span> {scene.hostBeat}</p>
                          <p><span className="font-semibold text-foreground">자막:</span> {scene.captionIdea}</p>
                        </div>
                        <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3 text-sm leading-6">
                          <p className="font-semibold text-foreground">히트맵 근거</p>
                          <p className="mt-1 text-muted-foreground">{scene.heatmapEvidence.reason}</p>
                          <a
                            href={scene.heatmapEvidence.youtubeLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          >
                            {scene.heatmapEvidence.videoId}
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card className="rounded-3xl border-border/80 shadow-sm">
                  <CardHeader>
                    <CardTitle>위원회 AHP 평가</CardTitle>
                    <CardDescription>99.8점 이상이면 로컬 근거 기반 내부 제작안으로 통과합니다.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {result.ahp.criteria.map((criterion) => (
                      <div key={criterion.id} className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">{criterion.label} <span className="text-muted-foreground">({criterion.weight}%)</span></span>
                          <span className="font-semibold">{formatScore(criterion.score)}</span>
                        </div>
                        <Progress value={criterion.score} aria-label={`${criterion.label} 점수`} />
                        <p className="text-xs leading-5 text-muted-foreground">{criterion.evidence}</p>
                      </div>
                    ))}
                    <Separator />
                    <div className="grid gap-2 md:grid-cols-2">
                      {result.ahp.committee.map((member) => (
                        <div key={member.role} className="rounded-2xl border border-border bg-muted/20 p-3 text-sm leading-6">
                          <p className="font-semibold text-foreground">{member.role}</p>
                          <p className="text-muted-foreground">{member.focus}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <p>현재 로컬 증거 기준 {formatScore(result.ahp.score)}입니다. 운영 배포 전에는 Supabase 자막/프레임 캡션 연결을 추가 검증 항목으로 남깁니다.</p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="flex min-h-[520px] items-center justify-center rounded-3xl border-dashed border-border/80 bg-muted/10 shadow-sm">
                <CardContent className="max-w-xl space-y-3 p-8 text-center">
                  <Sparkles className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
                  <h3 className="text-xl font-bold tracking-[-0.03em] text-foreground">아직 생성된 스토리보드가 없습니다.</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    왼쪽 조건을 확인한 뒤 생성하면, 씬별 연출안과 히트맵 근거, AHP 위원회 점수가 이 영역에 표시됩니다.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
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
