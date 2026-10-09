# Double-missing warning compatibility

The source archives are text, so frozen TypeScript is excluded from project compilation. The original run used Bun1.4.0, the project tsconfig override, a mocked server-only marker and synthetic PostgREST replies. It executed seven paired cold-cache reads in alternating order. No database, network or model request occurred.

The baseline archive changes import resolution only; its original and relocated hashes are recorded. The script binds this checkout by absolute path. For a different checkout, restore the two `.txt` archives as `baseline.ts` and `paired-counts.ts` in a private temporary directory, update only the declared import paths, retain both original and relocated hashes, and invoke Bun with that checkout's exact tsconfig. Count results must not be interpreted as latency.

The first two harness attempts failed before any result. The tsconfig-override attempt returned all seven results with exit0 and an internal Bun directory-mismatch warning. These conditions are preserved in summary.json.
