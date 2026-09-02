import type { Metadata } from 'next';

import { RestaurantClaimPanel } from './restaurant-claim-panel';
import { isUuid } from '@/lib/claim/contract';
import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata({
  title: '맛집 소유권 인증 - 쯔동여지도',
  description: '사업자등록증 지문으로 공개 맛집의 사장님 소유권을 인증합니다.',
});

export const dynamic = 'force-dynamic';

export default async function RestaurantClaimPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const normalized = decodeURIComponent(restaurantId || '').trim();
  return (
    <RestaurantClaimPanel
      restaurantId={isUuid(normalized) ? normalized : '00000000-0000-4000-8000-000000000000'}
    />
  );
}
