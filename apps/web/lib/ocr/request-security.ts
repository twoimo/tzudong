import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export const OCR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const OCR_MAX_INPUT_PIXELS = 24_000_000;

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

export function getOcrUploadRejectionForRequest(headers: Headers): { status: 413; error: string } | null {
  const rawContentLength = headers.get('content-length');
  if (!rawContentLength) return null;

  const contentLength = Number.parseInt(rawContentLength, 10);
  if (!Number.isFinite(contentLength)) return null;

  if (contentLength > OCR_MAX_UPLOAD_BYTES) {
    return {
      status: 413,
      error: `이미지 파일은 최대 ${Math.floor(OCR_MAX_UPLOAD_BYTES / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
    };
  }

  return null;
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
