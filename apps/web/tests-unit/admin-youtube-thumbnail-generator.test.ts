import { describe, expect, test } from "bun:test";

import {
  detectImageMime,
  getContentLengthRejection,
  getMultipartContentTypeRejection,
  parseThumbnailPayload,
  readThumbnailReferenceImages,
} from "../lib/admin/youtube-thumbnail-generator/request";
import {
  generateYoutubeThumbnail,
  resolveGeminiThumbnailModel,
  resolveOpenAIThumbnailModel,
} from "../lib/admin/youtube-thumbnail-generator/providers";
import { buildYoutubeThumbnailPrompt } from "../lib/admin/youtube-thumbnail-generator/prompt";
import { ThumbnailGenerationError } from "../lib/admin/youtube-thumbnail-generator/types";

const safePayload = {
  providerId: "mock" as const,
  topic: "쯔양 참고 이미지와 해외 야시장 길거리 음식 전경을 활용한 다음 업로드용 먹방 썸네일",
  headline: "역대급 먹방",
  subHeadline: "한입만 가능?",
  stylePreset: "night-market-reaction" as const,
  referenceImageRoles: ["host", "food", "not-a-role"],
  acknowledgedSafety: true,
  textLayers: [
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
      align: "center" as const,
      rotation: 0,
      zIndex: 1,
    },
  ],
};

function expectThumbnailError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ThumbnailGenerationError);
    expect((error as ThumbnailGenerationError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ThumbnailGenerationError ${code}`);
}

async function expectThumbnailErrorAsync(fn: () => Promise<unknown>, code: string, status?: number) {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ThumbnailGenerationError);
    expect((error as ThumbnailGenerationError).code).toBe(code);
    if (typeof status === "number") expect((error as ThumbnailGenerationError).status).toBe(status);
    return;
  }
  throw new Error(`Expected ThumbnailGenerationError ${code}`);
}

describe("admin youtube thumbnail generator", () => {
  test("pins live image model allowlists and rejects unverified marketing names", () => {
    expect(resolveOpenAIThumbnailModel({} as NodeJS.ProcessEnv)).toBe("gpt-image-1.5");
    expect(resolveOpenAIThumbnailModel({ THUMBNAIL_OPENAI_IMAGE_MODEL: "gpt-image-1" } as NodeJS.ProcessEnv)).toBe("gpt-image-1");
    expect(() => resolveOpenAIThumbnailModel({ THUMBNAIL_OPENAI_IMAGE_MODEL: "gpt-image-2" } as NodeJS.ProcessEnv)).toThrow("지원하지 않는 OpenAI");

    expect(resolveGeminiThumbnailModel({} as NodeJS.ProcessEnv)).toBe("gemini-3-pro-image-preview");
    expect(resolveGeminiThumbnailModel({ THUMBNAIL_GEMINI_IMAGE_MODEL: "nano-banana" } as NodeJS.ProcessEnv)).toBe("gemini-2.5-flash-image");
    expect(resolveGeminiThumbnailModel({ THUMBNAIL_GEMINI_IMAGE_MODEL: "nano-banana-pro" } as NodeJS.ProcessEnv)).toBe("gemini-3-pro-image-preview");
    expect(() => resolveGeminiThumbnailModel({ THUMBNAIL_GEMINI_IMAGE_MODEL: "nano-banana-2-pro" } as NodeJS.ProcessEnv)).toThrow("지원하지 않는 Gemini");
  });

  test("validates multipart payload shape and image magic bytes", () => {
    expect(parseThumbnailPayload(safePayload).providerId).toBe("mock");
    expect(parseThumbnailPayload(safePayload).stylePreset).toBe("night-market-reaction");
    expect(parseThumbnailPayload({ ...safePayload, stylePreset: "bad" }).stylePreset).toBe("tzuyang-food-travel-collage");
    expect(parseThumbnailPayload(safePayload).referenceImageRoles).toEqual(["host", "food", "other"]);
    expect(() => parseThumbnailPayload({ ...safePayload, providerId: "bad" })).toThrow("providerId");

    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBe("image/png");
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(detectImageMime(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80]))).toBe("image/webp");
    expect(detectImageMime(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  test("rejects non-multipart and oversized route bodies before parsing form data", () => {
    expect(getMultipartContentTypeRejection(new Headers({ "content-type": "application/json" }))).toEqual({
      status: 415,
      error: "multipart_form_data_required",
    });
    expect(getMultipartContentTypeRejection(new Headers({ "content-type": "multipart/form-data; boundary=abc" }))).toBeNull();
    expect(getContentLengthRejection(new Headers({ "content-length": "abc" }))).toEqual({
      status: 400,
      error: "content_length_invalid",
    });
    expect(getContentLengthRejection(new Headers({ "content-length": "33554433" }))).toEqual({
      status: 413,
      error: "content_length_too_large",
    });
  });

  test("reads reference images with file-count, byte-size, and mime guards", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], "sample.png", { type: "image/png" });
    const images = await readThumbnailReferenceImages([png], ["food"]);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ name: "reference-1", mime: "image/png", role: "food" });

    const invalid = new File([new Uint8Array([1, 2, 3, 4])], "sample.txt", { type: "text/plain" });
    await expectThumbnailErrorAsync(() => readThumbnailReferenceImages([invalid]), "invalid_text", 415);
    await expectThumbnailErrorAsync(() => readThumbnailReferenceImages(Array.from({ length: 9 }, (_, index) => new File([new Uint8Array([0xff, 0xd8, 0xff])], `${index}.jpg`, { type: "image/jpeg" }))), "invalid_text", 400);
  });

  test("blocks unsafe rendered text, copied prompt chunks, contact data, prices, and brands", () => {
    expectThumbnailError(() => buildYoutubeThumbnailPrompt({ ...safePayload, acknowledgedSafety: false }, []), "required_ack");
    expectThumbnailError(() => buildYoutubeThumbnailPrompt({ ...safePayload, headline: "쯔양 먹방" }, []), "unsafe_identity");
    expectThumbnailError(() => buildYoutubeThumbnailPrompt({ ...safePayload, topic: "https://example.com 야시장" }, []), "unsafe_contact");
    expectThumbnailError(() => buildYoutubeThumbnailPrompt({ ...safePayload, topic: "10만원 어치 먹방" }, []), "unsafe_price");
    expectThumbnailError(() => buildYoutubeThumbnailPrompt({ ...safePayload, topic: "맥도날드 로고가 크게 보이는 음식" }, []), "unsafe_brand");
    expectThumbnailError(
      () => buildYoutubeThumbnailPrompt({ ...safePayload, topic: "홍콩 야시장 분위기의 붐비는 밤거리에서 촬영한 다음 영상" }, []),
      "unsafe_copy",
    );
  });

  test("generates deterministic mock 1280x720 base art and reusable prompt grammar", async () => {
    const parsed = parseThumbnailPayload(safePayload);
    const result = await generateYoutubeThumbnail(parsed, [], {} as NodeJS.ProcessEnv);

    expect(result.baseImage.providerId).toBe("mock");
    expect(result.baseImage.model).toBe("mock-svg-v1");
    expect(result.baseImage.targetWidth).toBe(1280);
    expect(result.baseImage.targetHeight).toBe(720);
    expect(result.baseImage.dataUrl).toStartWith("data:image/svg+xml;base64,");
    expect(result.prompt).toContain("16:9");
    expect(result.prompt).toContain("Style preset: night-market-reaction");
    expect(result.prompt).toContain("bold editable Korean title placeholders");
    expect(result.prompt).toContain("Do not render real names");
    expect(result.warnings.join("\n")).toContain("mock_provider");
  });

  test("keeps role-aware reference summaries in generated prompt grammar", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], "food.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "host.jpg", { type: "image/jpeg" });
    const parsed = parseThumbnailPayload({
      ...safePayload,
      stylePreset: "sushi-seafood-table",
      referenceImageRoles: ["food", "host"],
    });
    const references = await readThumbnailReferenceImages([png, jpg], parsed.referenceImageRoles);
    const prompt = buildYoutubeThumbnailPrompt(parsed, references);

    expect(prompt).toContain("Style preset: sushi-seafood-table");
    expect(prompt).toContain("1. food reference (image/png)");
    expect(prompt).toContain("2. host reference (image/jpeg)");
  });
});
