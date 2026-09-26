'use client';

import { useLayoutEffect, useState } from 'react';

/** Keep background refreshes from restoring the initial loading surface. */
export function useInitialLoadPending(ready: boolean): boolean {
    const [hasCommittedReady, setHasCommittedReady] = useState(false);

    useLayoutEffect(() => {
        if (ready) setHasCommittedReady(true);
    }, [ready]);

    // Show ready content in this render, but only latch readiness after commit.
    // An interrupted render must not change what a later render considers loaded.
    return !hasCommittedReady && !ready;
}
