from pathlib import Path
import json
P=Path(__file__).resolve().parents[1]
pin=json.loads((P/'reports/manifest-pin.json').read_text())['sha256']
orig=(P/'original/.github/workflows/supabase-migration-apply.yml').read_text()
s=orig.replace('  RELEASE_MIGRATION_MANIFEST_SHA256:',f'  READINESS_RELEASE_MANIFEST_SHA256: "{pin}"\n  RELEASE_MIGRATION_MANIFEST_SHA256:',1)
s=s.replace("  validate:\n    if: >-\n", "  validate:\n    if: >-\n      github.event.inputs.migration_id != 'review_media_readiness11_v1' &&\n",1)
addition='''
  readiness_validate:
    if: >-
      github.event_name == 'workflow_dispatch' &&
      github.event.inputs.migration_id == 'review_media_readiness11_v1' &&
      github.repository == 'twoimo/tzudong' &&
      github.event.repository.full_name == 'twoimo/tzudong' &&
      github.event.repository.default_branch == 'main' &&
      github.ref == 'refs/heads/main' &&
      github.ref_name == 'main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      sha: ${{ steps.validate.outputs.sha }}
      manifest_sha256: ${{ steps.validate.outputs.manifest_sha256 }}
    steps:
      - name: Checkout exact readiness commit
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: '24'
      - name: Validate readiness bytes without credentials
        id: validate
        run: |
          set -euo pipefail
          test "$GITHUB_SHA" = "$(git rev-parse --verify HEAD)"
          test -z "$(git symbolic-ref --quiet HEAD || true)"
          [[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
          actual="$(sha256sum .github/supabase-readiness-release-manifest.v1.json)"
          test "${actual%% *}" = "$READINESS_RELEASE_MANIFEST_SHA256"
          generic="$(sha256sum .github/supabase-migration-release-manifest.v1.json)"
          test "${generic%% *}" = "$RELEASE_MIGRATION_MANIFEST_SHA256"
          node apps/web/scripts/apply-readiness-release.mjs --dry-run --json
          printf 'sha=%s\\n' "$GITHUB_SHA" >> "$GITHUB_OUTPUT"
          printf 'manifest_sha256=%s\\n' "${actual%% *}" >> "$GITHUB_OUTPUT"

  readiness_apply:
    needs: readiness_validate
    if: >-
      needs.readiness_validate.result == 'success' &&
      github.event_name == 'workflow_dispatch' &&
      github.event.inputs.migration_id == 'review_media_readiness11_v1' &&
      github.event.inputs.dry_run == 'false' &&
      github.event.inputs.provider_receipt == '' &&
      needs.readiness_validate.outputs.sha == github.sha &&
      github.repository == 'twoimo/tzudong' &&
      github.event.repository.full_name == 'twoimo/tzudong' &&
      github.event.repository.default_branch == 'main' &&
      github.ref == 'refs/heads/main' &&
      github.ref_name == 'main' &&
      vars.G037_WRITE_FREEZE == 'active'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout validated readiness commit
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          ref: ${{ needs.readiness_validate.outputs.sha }}
          persist-credentials: false
      - name: Recheck readiness pin and exact detached commit
        env:
          VALIDATED_SHA: ${{ needs.readiness_validate.outputs.sha }}
          VALIDATED_MANIFEST_SHA: ${{ needs.readiness_validate.outputs.manifest_sha256 }}
        run: |
          set -euo pipefail
          test "$GITHUB_SHA" = "$VALIDATED_SHA"
          test "$GITHUB_SHA" = "$(git rev-parse --verify HEAD)"
          test -z "$(git symbolic-ref --quiet HEAD || true)"
          [[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
          actual="$(sha256sum .github/supabase-readiness-release-manifest.v1.json)"
          test "${actual%% *}" = "$READINESS_RELEASE_MANIFEST_SHA256"
          test "${actual%% *}" = "$VALIDATED_MANIFEST_SHA"
          generic="$(sha256sum .github/supabase-migration-release-manifest.v1.json)"
          test "${generic%% *}" = "$RELEASE_MIGRATION_MANIFEST_SHA256"
      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: '24'
      - name: Install PostgreSQL client
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-client
      - name: Apply only the pinned eleven units or verify final state
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          G037_WRITE_FREEZE: ${{ vars.G037_WRITE_FREEZE }}
          READINESS_VALIDATED_SHA: ${{ needs.readiness_validate.outputs.sha }}
          VERIFY_TERMINAL_STATE: ${{ github.event.inputs.verify_terminal_state }}
        run: |
          set -euo pipefail
          args=(--json)
          if [ "$VERIFY_TERMINAL_STATE" = "true" ]; then
            args+=(--verify-terminal-state)
          fi
          node apps/web/scripts/apply-readiness-release.mjs "${args[@]}"
'''
s=s.replace('\n  apply:\n',addition+'\n  apply:\n',1)
(P/'candidate/.github/workflows/supabase-migration-apply.yml').write_text(s)
print(json.dumps({'readinessJobs':2,'genericPinUnchanged':True,'concurrencyGroup':'supabase-migration-apply'}))
