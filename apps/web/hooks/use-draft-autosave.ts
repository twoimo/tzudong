'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { captureBrowserDraftEpoch, assertBrowserDraftWrite, isBrowserDraftEpochCurrent } from '@/lib/privacy/browser-draft-lifecycle';
import { supabase } from '@/integrations/supabase/client';

import { enqueueDraftWrite, draftWriteCompletion, cancelPendingDraftWrite, blockDraftUnload } from '@/lib/draft-write-queue';
export { waitForDraftAutosave } from '@/lib/draft-write-queue';

export function useDraftAutosave<T extends { userId: string }>({
  scope, open, enabled, value, persist, unpersistedChanges = false,
}: { scope: string; open: boolean; enabled: boolean; value: T; persist: (value: T) => Promise<unknown>; unpersistedChanges?: boolean }) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const token = useRef<object>({});
  const suspended = useRef(false);
  const committed = useRef<string | null>(null);
  const latest = useRef({ scope, open, enabled, value, persist, unpersistedChanges });
  useLayoutEffect(() => { latest.current = { scope, open, enabled, value, persist, unpersistedChanges }; }, [scope, open, enabled, value, persist, unpersistedChanges]);
  useLayoutEffect(() => {
    suspended.current = false; committed.current = null;
    setLastSavedAt(null); setFailed(false); setIsSaving(false);
  }, [scope, open]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const settle = useCallback(() => draftWriteCompletion(latest.current.scope) ?? Promise.resolve(true), []);
  const cancel = useCallback(() => {
    suspended.current = true;
    cancelPendingDraftWrite(latest.current.scope, token.current);
  }, []);
  const resume = useCallback(() => { suspended.current = false; }, []);
  const flush = useCallback((): Promise<boolean> => {
    const input = latest.current;
    if (!input.open || !input.enabled || suspended.current) return settle();
    const epoch = captureBrowserDraftEpoch(input.value.userId);
    const fingerprint = input.scope + ':' + JSON.stringify(input.value);
    if (committed.current === fingerprint && !draftWriteCompletion(input.scope)) return Promise.resolve(true);
    if (mounted.current) { setIsSaving(true); setFailed(false); }
    const completion = enqueueDraftWrite(input.scope, { owner: token.current, isCurrent: () => isBrowserDraftEpochCurrent(input.value.userId, epoch, true), async run() {
      if (committed.current === fingerprint) return true;
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== input.value.userId) return false;
      assertBrowserDraftWrite(input.value.userId, epoch);
      await input.persist(input.value);
      committed.current = fingerprint;
      if (mounted.current && latest.current.scope === input.scope && latest.current.open && isBrowserDraftEpochCurrent(input.value.userId, epoch, true)) setLastSavedAt(new Date());
      return true;
    } });
    void completion.then(saved => {
      if (mounted.current && latest.current.scope === input.scope && latest.current.open && isBrowserDraftEpochCurrent(input.value.userId, epoch, true)) {
        setIsSaving(false); setFailed(!saved);
      }
    });
    return completion;
  }, [settle]);
  // A rejected save no longer has a pending queue, but the open form still owns
  // unsaved text. Warn on reload without retaining that text after unmount.
  useEffect(() => {
    if (!open || (!enabled && !unpersistedChanges)) return;
    if (!unpersistedChanges && committed.current === scope + ':' + JSON.stringify(value)) return;
    const epoch = captureBrowserDraftEpoch(value.userId);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const input = latest.current;
      if (input.open && isBrowserDraftEpochCurrent(value.userId, epoch, true)
          && (input.unpersistedChanges || (input.enabled && !suspended.current
            && committed.current !== input.scope + ':' + JSON.stringify(input.value)))) blockDraftUnload(event);
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [open, enabled, scope, value, unpersistedChanges, lastSavedAt]);
  // Admit the committed input before route unmount. No cleanup callback writes
  // stale form state after a successful submit/delete has removed the draft.
  useLayoutEffect(() => { if (open && enabled && !suspended.current) void flush(); }, [open, enabled, scope, value, flush]);
  return { flush, settle, cancel, resume, isSaving, lastSavedAt, failed };
}
