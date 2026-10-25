import { retiredThumbnailGenerationApi } from '@/lib/admin/youtube-thumbnail-generator/retired-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = retiredThumbnailGenerationApi.GET;
export const POST = retiredThumbnailGenerationApi.POST;
