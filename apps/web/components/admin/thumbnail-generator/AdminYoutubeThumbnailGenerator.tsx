"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, RotateCcw, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ProviderId = "mock" | "openai-gpt-image" | "gemini-nano-banana" | "local-codex";

type TextLayer = {
  id: string;
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  align: "left" | "center" | "right";
  rotation: number;
  zIndex: number;
};

type GenerationResult = {
  baseImage: {
    dataUrl: string;
    mime: string;
    targetWidth: 1280;
    targetHeight: 720;
    providerId: ProviderId;
    model: string;
  };
  prompt: string;
  warnings: string[];
};

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const DEFAULT_TEXT_LAYERS: TextLayer[] = [
  {
    id: "headline",
    content: "역대급 먹방",
    x: 640,
    y: 520,
    fontFamily: "Impact, Pretendard, system-ui, sans-serif",
    fontSize: 92,
    fontWeight: 900,
    fill: "#ffffff",
    stroke: "#111111",
    strokeWidth: 10,
    shadow: "0 12px 24px rgba(0,0,0,0.72)",
    align: "center",
    rotation: 0,
    zIndex: 1,
  },
  {
    id: "subHeadline",
    content: "한입만 가능?",
    x: 978,
    y: 168,
    fontFamily: "Arial Black, Pretendard, system-ui, sans-serif",
    fontSize: 46,
    fontWeight: 900,
    fill: "#fff200",
    stroke: "#111111",
    strokeWidth: 7,
    shadow: "0 8px 18px rgba(0,0,0,0.65)",
    align: "center",
    rotation: -5,
    zIndex: 2,
  },
];

const providerOptions: Array<{ value: ProviderId; label: string; help: string }> = [
  {
    value: "mock",
    label: "Mock / 안전 미리보기",
    help: "API 키 없이 1280x720 SVG 초안을 생성합니다.",
  },
  {
    value: "openai-gpt-image",
    label: "OpenAI GPT Image API",
    help: "THUMBNAIL_GENERATOR_ENABLE_LIVE_API=1 + OPENAI_API_KEY 필요. gpt-image-2는 공식 모델 확인 후 설정하세요.",
  },
  {
    value: "gemini-nano-banana",
    label: "Google Nano Banana 2 Pro API",
    help: "Nano Banana Pro 별칭은 gemini-3-pro-image-preview로 매핑합니다.",
  },
  {
    value: "local-codex",
    label: "Codex CLI gpt image 2 로컬 Probe",
    help: "현재는 codex --version/--help 탐지만 수행하고, 검증된 출력 명령이 없으면 생성하지 않습니다.",
  },
];

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  layer: TextLayer,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    if (layer.strokeWidth > 0) context.strokeText(line, x, lineY);
    context.fillText(line, x, lineY);
  });
}

export function AdminYoutubeThumbnailGenerator() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [topic, setTopic] = useState(
    "다음 업로드 주제: 해외 야시장 길거리 음식, 압도적인 양의 음식 전경, 진행자와 리액션 컷아웃",
  );
  const [headline, setHeadline] = useState(DEFAULT_TEXT_LAYERS[0]?.content ?? "역대급 먹방");
  const [subHeadline, setSubHeadline] = useState(DEFAULT_TEXT_LAYERS[1]?.content ?? "한입만 가능?");
  const [providerId, setProviderId] = useState<ProviderId>("mock");
  const [files, setFiles] = useState<File[]>([]);
  const [acknowledgedSafety, setAcknowledgedSafety] = useState(true);
  const [textLayers, setTextLayers] = useState<TextLayer[]>(DEFAULT_TEXT_LAYERS);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [providerStatus, setProviderStatus] = useState<string>("provider status loading");

  const selectedProvider = useMemo(
    () => providerOptions.find((option) => option.value === providerId) ?? providerOptions[0],
    [providerId],
  );

  useEffect(() => {
    let ignore = false;
    fetch("/api/admin/youtube-thumbnail-generator", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (ignore) return;
        setProviderStatus(
          `1280x720 · THUMBNAIL_GENERATOR_ENABLE_LIVE_API=${payload?.providers?.openai?.liveEnabled ? "1" : "0"} · OpenAI ${payload?.providers?.openai?.model ?? "미설정"} · Gemini ${payload?.providers?.gemini?.model ?? "미설정"}`,
        );
      })
      .catch(() => {
        if (!ignore) setProviderStatus("관리자 인증 후 provider 상태를 확인할 수 있습니다.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;
    context.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    context.fillStyle = "#16100d";
    context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

    const renderLayers = () => {
      [...textLayers]
        .sort((a, b) => a.zIndex - b.zIndex)
        .forEach((layer) => {
          if (!layer.content.trim()) return;
          context.save();
          context.translate(layer.x, layer.y);
          context.rotate((layer.rotation * Math.PI) / 180);
          context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
          context.textAlign = layer.align;
          context.textBaseline = "middle";
          context.lineJoin = "round";
          context.miterLimit = 2;
          context.fillStyle = layer.fill;
          context.strokeStyle = layer.stroke;
          context.lineWidth = layer.strokeWidth;
          context.shadowColor = "rgba(0,0,0,0.62)";
          context.shadowBlur = 18;
          context.shadowOffsetY = 8;
          drawWrappedText(context, layer.content, 0, 0, 760, layer.fontSize * 1.02, layer);
          context.restore();
        });
    };

    if (!result?.baseImage?.dataUrl) {
      const gradient = context.createLinearGradient(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      gradient.addColorStop(0, "#ff8a1f");
      gradient.addColorStop(0.55, "#d51f34");
      gradient.addColorStop(1, "#180f18");
      context.fillStyle = gradient;
      context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      context.fillStyle = "rgba(255,255,255,0.14)";
      context.beginPath();
      context.arc(1050, 210, 150, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(60,22,8,0.88)";
      context.beginPath();
      context.ellipse(430, 620, 480, 128, 0, 0, Math.PI * 2);
      context.fill();
      renderLayers();
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      context.drawImage(image, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      renderLayers();
    };
    image.src = result.baseImage.dataUrl;
  }, [result, textLayers]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  function updateTextLayer(id: string, patch: Partial<TextLayer>) {
    setTextLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append(
        "payload",
        JSON.stringify({
          providerId,
          topic,
          headline,
          subHeadline,
          acknowledgedSafety,
          textLayers,
        }),
      );
      files.forEach((file) => formData.append("referenceImages", file));

      const response = await fetch("/api/admin/youtube-thumbnail-generator", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail ?? payload?.error ?? "thumbnail_generation_failed");
      setResult(payload as GenerationResult);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "썸네일 생성 실패");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleExportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "tzudong-youtube-thumbnail-1280x720.png";
    link.href = dataUrl;
    link.click();
  }

  return (
    <main className="flex min-h-full flex-col gap-4 overflow-y-auto bg-muted/20 p-4" data-admin-youtube-thumbnail-generator="true">
      <section className="rounded-2xl border border-border bg-background p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">실험실</Badge>
              <Badge variant="outline">1280x720 · 16:9</Badge>
              <Badge variant="outline">고채도 먹방 콜라주</Badge>
            </div>
            <h2 className="text-2xl font-black tracking-tight">유튜브 썸네일 생성기</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              지난 먹방/여행 썸네일 문법을 참고하되 실제 채널명, 브랜드, 가격, 주소, URL은 렌더링하지 않습니다. 생성 이미지는 바탕으로만 쓰고, 폰트와 문구는 캔버스에서 별도로 자유 편집합니다.
            </p>
          </div>
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {providerStatus}
          </div>
        </div>
      </section>

      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <Card className="min-h-0">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4" /> 생성 입력
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="thumbnail-provider">이미지 생성 모델</Label>
              <Select value={providerId} onValueChange={(value) => setProviderId(value as ProviderId)}>
                <SelectTrigger id="thumbnail-provider">
                  <SelectValue placeholder="provider 선택" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedProvider.help}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumbnail-topic">영상 콘텐츠 주제</Label>
              <Textarea
                id="thumbnail-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="min-h-28"
                placeholder="예: 해외 야시장, 거대한 꼬치구이, 진행자 리액션, 현지 음식점 분위기"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="thumbnail-headline">메인 문구</Label>
                <Input
                  id="thumbnail-headline"
                  value={headline}
                  onChange={(event) => {
                    setHeadline(event.target.value);
                    updateTextLayer("headline", { content: event.target.value });
                  }}
                  maxLength={40}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="thumbnail-subheadline">스티커 문구</Label>
                <Input
                  id="thumbnail-subheadline"
                  value={subHeadline}
                  onChange={(event) => {
                    setSubHeadline(event.target.value);
                    updateTextLayer("subHeadline", { content: event.target.value });
                  }}
                  maxLength={28}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumbnail-reference-images" className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4" /> 참고 이미지 여러 장
              </Label>
              <Input
                id="thumbnail-reference-images"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 8))}
              />
              <p className="text-xs text-muted-foreground">쯔양/진행자 참고 이미지, 먹은 음식, 사물, 기타 인물 등 최대 8장 · 각 8MiB · PNG/JPEG/WebP</p>
            </div>

            <label className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledgedSafety}
                onChange={(event) => setAcknowledgedSafety(event.target.checked)}
              />
              <span>
                실제 개인 이름, 계정명, URL, 정확한 가격/주소/전화번호, 실제 브랜드 로고를 썸네일 텍스트나 생성 지시로 넣지 않겠습니다.
              </span>
            </label>

            {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                썸네일 초안 생성
              </Button>
              <Button type="button" variant="outline" onClick={() => setTextLayers(DEFAULT_TEXT_LAYERS)}>
                <RotateCcw className="mr-2 h-4 w-4" /> 텍스트 초기화
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>캔버스 편집 / PNG 내보내기</span>
              <Button type="button" size="sm" variant="secondary" onClick={handleExportPng}>
                <Download className="mr-2 h-4 w-4" /> PNG 저장
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-inner">
              <canvas
                ref={canvasRef}
                width={TARGET_WIDTH}
                height={TARGET_HEIGHT}
                className="aspect-video h-auto w-full"
                aria-label="유튜브 썸네일 1280x720 편집 캔버스"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {textLayers.map((layer) => (
                <div key={layer.id} className="rounded-xl border border-border bg-background p-3" data-thumbnail-text-layer={layer.id}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <strong className="text-sm">{layer.id === "headline" ? "메인 문구" : "스티커 문구"}</strong>
                    <Badge variant="outline">fontFamily / strokeWidth 편집</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="col-span-2 space-y-1 text-xs font-medium">
                      문구
                      <Input value={layer.content} onChange={(event) => updateTextLayer(layer.id, { content: event.target.value })} />
                    </label>
                    <label className="col-span-2 space-y-1 text-xs font-medium">
                      폰트 패밀리
                      <Input value={layer.fontFamily} onChange={(event) => updateTextLayer(layer.id, { fontFamily: event.target.value })} />
                    </label>
                    {([
                      ["x", "X"],
                      ["y", "Y"],
                      ["fontSize", "크기"],
                      ["strokeWidth", "외곽선"],
                      ["rotation", "회전"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="space-y-1 text-xs font-medium">
                        {label}
                        <Input
                          type="number"
                          value={layer[key]}
                          onChange={(event) => updateTextLayer(layer.id, { [key]: Number(event.target.value) } as Partial<TextLayer>)}
                        />
                      </label>
                    ))}
                    <label className="space-y-1 text-xs font-medium">
                      글자색
                      <Input type="color" value={layer.fill} onChange={(event) => updateTextLayer(layer.id, { fill: event.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs font-medium">
                      외곽선색
                      <Input type="color" value={layer.stroke} onChange={(event) => updateTextLayer(layer.id, { stroke: event.target.value })} />
                    </label>
                    <label className="col-span-2 space-y-1 text-xs font-medium">
                      정렬
                      <Select value={layer.align} onValueChange={(value) => updateTextLayer(layer.id, { align: value as TextLayer["align"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">left</SelectItem>
                          <SelectItem value="center">center</SelectItem>
                          <SelectItem value="right">right</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className={cn("rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground", result ? "space-y-2" : "") }>
              <p>Prompt safety: 큰 한국어 제목 placeholder, 짧은 감탄사, 군중 비식별, 브랜드/가격/URL 금지, 고채도 음식 전경 중심.</p>
              {result ? <p>Model: {result.baseImage.model} · Warnings: {result.warnings.join(" / ")}</p> : null}
              {result?.prompt ? <details><summary>생성 프롬프트 보기</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px]">{result.prompt}</pre></details> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
