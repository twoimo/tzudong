import { createStoryboardAssistantApi } from '@/lib/admin/storyboard/assistant-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 35;
const api = createStoryboardAssistantApi();
export const GET = api.GET;
export const POST = api.POST;
