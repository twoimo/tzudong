import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
  deleteProviderApiKey,
  parseProviderParam,
  upsertProviderApiKey,
} from '@/lib/admin/ai-settings-store';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    provider: string;
  }>;
};

function invalidProviderResponse() {
  return NextResponse.json({ error: '지원하지 않는 provider 입니다.' }, { status: 400 });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { provider: rawProvider } = await context.params;
  const provider = parseProviderParam(rawProvider);
  if (!provider) return invalidProviderResponse();

  try {
    const body = (await request.json()) as { secret?: string };
    const payload = await upsertProviderApiKey(provider, body.secret ?? '', auth.userId);
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API 키를 저장하지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { provider: rawProvider } = await context.params;
  const provider = parseProviderParam(rawProvider);
  if (!provider) return invalidProviderResponse();

  try {
    const payload = await deleteProviderApiKey(provider);
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API 키를 삭제하지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
