# Backend Gemini connectivity probe follow-through

The fixed gemini-3.7-flash model, MEDIUM thinking, 4096 output cap, single SDK attempt, timeout and configured quota remain unchanged. Sampling override is omitted under the current official [GenerateContent guidance](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6). Funded credentials win over generic/legacy aliases, with no runtime rotation on failure.

An exclusively reserved 0600 receipt is persisted before request dispatch. Lost acknowledgements, process interruption and overlapping CLI runs cannot resend under the same output. Existing CLI fields remain unchanged. SDK model provenance is separately validated and nullable; the requested model is never used to fill a missing returned model/revision.

Targeted Node 24 tests passed 10/10 using the actual lock-matched SDK and offline fetch interception. This includes one parent and nine CLI subtests. The initial active-tree run failed before execution because backend dependencies were absent. Exact GenAI 2.24.0, legacy SDK 0.24.1 and dotenv 18.0.3 were used in a private runtime; dotenv tarball integrity matches the existing lock. No shared install or pin changed.

Paid provider calls, operating calls and env changes: 0. Real 3.7 connectivity, credit attribution and billing are unverified. The root's separate real 3.6 OCR observation is not evidence from this probe or its offline tests. No measured speed/cost saving or statistical improvement is claimed.

Other caller sampling inconsistencies discovered by the scoped scan are listed in summary.json and remain outside these two owned source files. Preserve the failed attempt and pre-provenance passing log; they are not rewritten as current success.
