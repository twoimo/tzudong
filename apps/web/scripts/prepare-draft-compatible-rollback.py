#!/usr/bin/env python3
"""Prepare an exact-base rollback patch retaining the current draft subsystem.

Writes only a new output directory and a temporary Git index. Does not checkout,
commit, apply to the worktree, contact services or include runtime configuration.
The resulting patch is a review candidate, not release approval.
"""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def prepare(root: Path, base: str, output: Path) -> dict:
    def git(*args, **kwargs):
        return subprocess.check_output(['git', *args], cwd=root, **kwargs)
    revision = git('rev-parse', '--verify', base + '^{commit}').decode().strip()
    web = root / 'apps/web'
    modules = ['reviewDraftDB', 'submissionDraftDB', 'editRequestDraftDB',
               'privacy/browser-draft-cleanup', 'privacy/browser-draft-lifecycle',
               'privacy/draft-storage-owner', 'draft-write-queue']
    pending = [web / 'lib' / (name + '.ts') for name in modules]
    # Logout's server cookie policy and cancellation consumers are coupled to
    # AuthProvider even though they do not import the draft DAOs directly.
    auth_boundary = [
        'app/api/auth/logout/route.ts',
        # The composer entry action must share the current auth-loading guard.
        'app/home-client.tsx',
        'lib/supabase/server.ts', 'lib/supabase/middleware.ts', 'proxy.ts',
        'lib/auth/callback-session.ts', 'app/auth/callback/route.ts',
        'app/auth/complete/page.tsx',
        'app/api/privacy/onboarding/route.ts',
        'components/home/HomeMapUserMenu.tsx',
        'components/home/MobileControlOverlay.tsx',
        'components/mypage/MyPageTopActions.tsx',
        'components/mypage/MyPageSidebar.tsx',
        'app/mypage/mypage-layout-content.tsx',
        # This composer host shares the current location-disclosure and auth
        # loading contracts. The old host does not typecheck with that boundary.
        'components/home/SubmissionFloatingButton.tsx',
    ]
    pending.extend(web / name for name in auth_boundary)
    # Retain existing auth/consent/deletion callers and all composers, rather than
    # combining a new storage protocol with old session ownership behavior.
    for area in ['app', 'components', 'contexts', 'hooks', 'lib']:
        for path in (web / area).rglob('*'):
            if path.suffix in {'.ts', '.tsx'} and any(name in path.read_text() for name in modules):
                pending.append(path)
    entries = sorted({str(path.relative_to(root)) for path in pending})
    imports = re.compile(r'''(?:from\s*|import\s*\(\s*|import\s*)['"](@/[^'"]+|\.[^'"]+)['"]''')
    files = {}
    while pending:
        path = pending.pop()
        relative = str(path.relative_to(root))
        if relative in files:
            continue
        source = path.read_bytes()
        files[relative] = source
        for spec in imports.findall(source.decode()):
            target = web / spec[2:] if spec.startswith('@/') else path.parent / spec
            target = target.resolve()
            choices = [target, *(Path(str(target) + ext) for ext in ['.ts', '.tsx', '.json']),
                       target / 'index.ts', target / 'index.tsx']
            found = next((p for p in choices if p.is_file()), None)
            if found is None:
                raise ValueError('UNRESOLVED_LOCAL_IMPORT: ' + relative + ': ' + spec)
            found.relative_to(web)
            if found.suffix not in {'.ts', '.tsx', '.mjs', '.json', '.css'}:
                raise ValueError('UNSUPPORTED_SOURCE: ' + str(found.relative_to(root)))
            pending.append(found)
    changed = []
    patch = []
    for path, source in sorted(files.items()):
        existing = subprocess.run(['git', 'show', revision + ':' + path], cwd=root, capture_output=True)
        old = existing.stdout if existing.returncode == 0 else b''
        if old == source:
            continue
        if not source.endswith(b'\n') or (old and not old.endswith(b'\n')):
            raise ValueError('SOURCE_REQUIRES_CANONICAL_NEWLINE: ' + path)
        changed.append(path)
        patch.append(f'diff --git a/{path} b/{path}\n')
        if existing.returncode != 0:
            patch.append('new file mode 100644\n')
        patch.extend(difflib.unified_diff(old.decode().splitlines(keepends=True), source.decode().splitlines(keepends=True),
                                        fromfile='a/' + path if existing.returncode == 0 else '/dev/null', tofile='b/' + path))
    patch_bytes = ''.join(patch).encode()
    # A separate index proves the patch applies to exactly the requested base,
    # without changing the candidate index or any worktree.
    with tempfile.TemporaryDirectory(prefix='tzudong-rollback-index-') as temporary:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(temporary) / 'index'))
        subprocess.run(['git', 'read-tree', revision], cwd=root, env=env, check=True)
        subprocess.run(['git', 'apply', '--cached', '--check', '-'], input=patch_bytes, cwd=root, env=env, check=True)
        subprocess.run(['git', 'apply', '--cached', '-'], input=patch_bytes, cwd=root, env=env, check=True)
        tree = git('write-tree', env=env).decode().strip()
    output.mkdir(parents=True, exist_ok=False)
    for path, source in files.items():
        destination = output / 'files' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source)
    (output / 'draft-compatible-rollback.patch').write_bytes(patch_bytes)
    result = {'base_revision': revision, 'target_tree': tree, 'entries': entries,
              'auth_boundary': auth_boundary,
              'changed_paths': changed, 'patch_sha256': hashlib.sha256(patch_bytes).hexdigest(),
              'files': {p: hashlib.sha256(b).hexdigest() for p, b in sorted(files.items())},
              'release_status': 'UNVERIFIED: exact-base patch applies; full rollback app build, rendered auth/forms and external review required'}
    (output / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    result = prepare(root, args.base, args.output.resolve())
    print(json.dumps({'base_revision': result['base_revision'], 'target_tree': result['target_tree'],
                      'files': len(result['files']), 'changed': len(result['changed_paths']),
                      'patch_sha256': result['patch_sha256']}))
