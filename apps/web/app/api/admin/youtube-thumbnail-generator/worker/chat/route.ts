import { thumbnailQueueApi } from '@/lib/admin/youtube-thumbnail-generator/queue-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = thumbnailQueueApi.workerChatGET;
export const POST = thumbnailQueueApi.workerChatPOST;
