import * as Sentry from '@sentry/nextjs';
import { sentryPrivacyOptions, validSentryDsn } from '@/lib/monitoring/sentry-privacy';

const dsn = validSentryDsn(process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  Sentry.init({
    ...sentryPrivacyOptions,
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
