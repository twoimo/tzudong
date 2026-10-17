import { createStoryboardPolicyReadbackResponse } from './readback-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return createStoryboardPolicyReadbackResponse();
}
