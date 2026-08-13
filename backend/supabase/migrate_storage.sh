#!/bin/bash
set -euo pipefail

# This historical helper downloaded only public URLs into a predictable shared
# directory, accepted unbound endpoints, and had no checksum/readback or Auth
# and bucket-policy coverage. Keeping it executable would make a partial copy
# look like a completed recovery. Hosted data recovery is intentionally a
# separate, externally approved operation; see the runbook boundary.
echo "Disabled: this legacy script is not an admitted Supabase recovery path." >&2
echo "See docs/operations/nightly-regression.md#hosted-data-recovery-boundary." >&2
exit 2
