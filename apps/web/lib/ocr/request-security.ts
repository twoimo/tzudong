import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export const OCR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const OCR_MAX_INPUT_PIXELS = 24_000_000;
export const OCR_MAX_MULTIPART_BYTES = OCR_MAX_UPLOAD_BYTES + 64 * 1024;

const OCR_FORM_STRING_LIMITS = new Map<string, number>([
  ['force', 5],
  ['selectedRestaurantId', 64],
  ['selectedRestaurantName', 256],
  ['selectedRestaurantRoadAddress', 256],
  ['selectedRestaurantJibunAddress', 256],
  ['selectedRestaurantCategory', 64],
]);

type OcrAuthResult =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: User;
      accessToken: string | null;
    }
  | {
      ok: false;
      status: 401;
      error: string;
    };

export function getOcrUploadRejectionForRequest(headers: Headers): { status: 400 | 413; error: string } | null {
  const rawContentLength = headers.get('content-length');
  if (!rawContentLength) return null;
  if (!/^\d+$/.test(rawContentLength)) {
    return { status: 400, error: '유효하지 않은 업로드 길이입니다.' };
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > OCR_MAX_MULTIPART_BYTES) {
    return {
      status: 413,
      error: `이미지 파일은 최대 ${Math.floor(OCR_MAX_UPLOAD_BYTES / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
    };
  }

  return null;
}

type OcrFormDataResult =
  | { ok: true; formData: FormData }
  | { ok: false; status: 400 | 413; error: string };

export async function readBoundedOcrFormData(req: Request): Promise<OcrFormDataResult> {
  const contentType = req.headers.get('content-type') ?? '';
  if (
    contentType.length > 200
    || !/^multipart\/form-data;\s*boundary=[A-Za-z0-9'()+_,./:=?-]{1,120}$/i.test(contentType)
    || !req.body
  ) {
    return { ok: false, status: 400, error: '유효하지 않은 multipart 요청입니다.' };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > OCR_MAX_MULTIPART_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          status: 413,
          error: `이미지 파일은 최대 ${Math.floor(OCR_MAX_UPLOAD_BYTES / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
        };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let formData: FormData;
  try {
    formData = await new Request('http://localhost/ocr-upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bytes,
    }).formData();
  } catch {
    return { ok: false, status: 400, error: 'multipart 요청을 해석할 수 없습니다.' };
  }

  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key) || (key !== 'image' && !OCR_FORM_STRING_LIMITS.has(key))) {
      return { ok: false, status: 400, error: '허용되지 않은 multipart 필드입니다.' };
    }
    seen.add(key);

    if (key === 'image') {
      if (!(value instanceof File)) {
        return { ok: false, status: 400, error: '이미지가 제공되지 않았습니다.' };
      }
      continue;
    }

    const maximum = OCR_FORM_STRING_LIMITS.get(key);
    if (typeof value !== 'string' || maximum === undefined || value.length > maximum) {
      return { ok: false, status: 400, error: 'multipart 필드가 너무 깁니다.' };
    }
  }

  if (!seen.has('image')) {
    return { ok: false, status: 400, error: '이미지가 제공되지 않았습니다.' };
  }
  return { ok: true, formData };
}

export async function authenticateOcrRequest(req: Request): Promise<OcrAuthResult> {
  const supabase = await createClient();
  const {
    data: { user: initialUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (!authError && initialUser) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      ok: true,
      supabase,
      user: initialUser,
      accessToken: session?.access_token ?? null,
    };
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: '로그인이 필요한 서비스입니다' };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, error: '로그인이 필요한 서비스입니다 (Token Invalid)' };
  }

  const {
    data: { user: headerUser },
    error: headerError,
  } = await supabase.auth.getUser(token);

  if (headerError || !headerUser) {
    return { ok: false, status: 401, error: '로그인이 필요한 서비스입니다 (Token Invalid)' };
  }

  return {
    ok: true,
    supabase,
    user: headerUser,
    accessToken: token,
  };
}

function hasSupportedImageSignature(buffer: Buffer) {
  if (buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isGif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isHeifFamily = buffer.subarray(4, 8).toString('ascii') === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(buffer.subarray(8, 12).toString('ascii'));

  return isJpeg || isPng || isGif || isWebp || isHeifFamily;
}

export async function readOcrImageFile(file: File): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: 400 | 413; error: string }> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, status: 400, error: '유효하지 않은 파일 형식입니다' };
  }

  if (file.size <= 0) {
    return { ok: false, status: 400, error: '비어 있는 이미지는 분석할 수 없습니다.' };
  }

  if (file.size > OCR_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `이미지 파일은 최대 ${Math.floor(OCR_MAX_UPLOAD_BYTES / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasSupportedImageSignature(buffer)) {
    return { ok: false, status: 400, error: '지원하지 않는 이미지 파일입니다.' };
  }

  return { ok: true, buffer };
}
