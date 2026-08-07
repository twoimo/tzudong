import { under14SignupUnavailableResponse } from '@/lib/privacy/onboarding';

export const runtime = 'nodejs';

export function GET() {
  return under14SignupUnavailableResponse();
}

export function POST() {
  return under14SignupUnavailableResponse();
}
