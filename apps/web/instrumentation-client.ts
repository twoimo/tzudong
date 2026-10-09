import * as Sentry from '@sentry/nextjs';
import { sentryPrivacyOptions, validSentryDsn } from '@/lib/monitoring/sentry-privacy';

const dsn = validSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  Sentry.init({
    ...sentryPrivacyOptions,
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
