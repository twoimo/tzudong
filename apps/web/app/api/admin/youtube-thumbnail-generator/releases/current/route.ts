import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import type { AdminProviderReadiness as ProviderReadiness } from '@/types/admin-system-status';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

const THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID = 'youtube-thumbnail-durable-release' as const;


function createFailureReadiness(reasonCode: string): ProviderReadiness {
  return {
    provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
    status: 'unavailable',
    reasonCode,
    checkedAt: new Date().toISOString(),
    remediation: 'durable release registry 상태를 확인하고 안전한 현재 릴리즈를 다시 publish하세요.',
    diagnostics: {
      durableRegistryAvailable: false,
      route: 'releases/current',
    },
  };
}
async function readCurrentThumbnailDurableReleaseFromRoute() {
  const { readCurrentThumbnailDurableRelease } = await import('@/lib/admin/youtube-thumbnail-generator/release-registry');
  return readCurrentThumbnailDurableRelease(process.env);
}


export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const payload = await readCurrentThumbnailDurableReleaseFromRoute();
    if (payload.status === 'unavailable') {
      return NextResponse.json(payload, { status: 503, headers: noStoreHeaders });
    }
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/releases/current] unexpected failure', {
      domain: 'youtube_thumbnail_generator',
      action: 'read_current_release',
      step: 'unexpected',
      errorName: getAdminSafeErrorName(error),
    });
    return NextResponse.json(
      {
        status: 'unavailable',
        updatedAt: null,
        release: null,
        diagnostics: {
          durableRegistryAvailable: false,
          releaseKey: 'youtube-thumbnail-generator/current',
          reason: 'thumbnail_durable_release_current_failed',
          warnings: [],
        },
        readiness: createFailureReadiness('thumbnail_durable_release_current_failed'),
      },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
