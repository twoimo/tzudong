import { createPublicStoryboardCompatibilityResponse } from './runtime-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return createPublicStoryboardCompatibilityResponse();
}
