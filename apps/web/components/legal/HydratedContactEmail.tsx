'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function HydratedContactEmail({ email }: { email: string }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  // Cloudflare rewrites visible email text in server HTML into a protected
  // anchor. Keep the server and first hydration markup equal, then reveal the
  // existing public contact value after hydration without relaxing that rule.
  return (
    <span
      className="inline-block min-w-[18ch] break-all"
      aria-busy={!hydrated}
      aria-live="polite"
      data-hydrated-contact-email="true"
    >
      {hydrated ? email : '이메일 표시 중'}
    </span>
  );
}
