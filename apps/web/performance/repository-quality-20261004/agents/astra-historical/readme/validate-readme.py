#!/usr/bin/env python3
"""Read-only checks for this README patch; no install, server, DB, or remote call."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

REPO = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong')
OUT = Path(__file__).resolve().parent
SHA = '7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd'
FILES = ('README.md', 'README.ko.md')


def git(*args, data=None):
    return subprocess.check_output(['git', *args], cwd=REPO, input=data)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def links(text):
    markdown = re.findall(r'\]\(([^\s)]+)(?:\s+[^)]*)?\)', text)
    html = re.findall(r'(?:href|src)=["\']([^"\']+)["\']', text)
    return markdown + html


def check_links(name, text):
    ids = set(re.findall(r'id=["\']([^"\']+)["\']', text))
    for heading in re.findall(r'^#{1,6}\s+(.+)$', text, flags=re.M):
        ids.add(re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-'))
    missing = []
    local_count = 0
    anchor_count = 0
    external_count = 0
    for url in links(text):
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc:
            external_count += 1
            continue
        if parsed.path:
            local_count += 1
            if not (REPO / Path(name).parent / unquote(parsed.path)).exists():
                missing.append(url)
        elif parsed.fragment:
            anchor_count += 1
            if unquote(parsed.fragment) not in ids:
                missing.append(url)
    return {'local_path_references': local_count, 'same_document_anchors': anchor_count,
            'external_references_not_requested': external_count, 'missing': sorted(set(missing))}


result = {'authority_sha': SHA, 'current_head': git('rev-parse', 'HEAD').decode().strip(),
          'checks': {}, 'readmes': {}}
result['checks']['head_matches_authority'] = result['current_head'] == SHA
for name in FILES:
    before = git('show', f'{SHA}:{name}')
    after = (REPO / name).read_bytes()
    before_text, after_text = before.decode(), after.decode()
    old_links, new_links = check_links(name, before_text), check_links(name, after_text)
    tour_heading, privacy_heading = ('## Product tour', '## Privacy') if name == 'README.md' else ('## 제품 투어', '## 개인정보')
    preserved_before = before_text.split(tour_heading, 1)[1].split(privacy_heading, 1)[0]
    preserved_after = after_text.split(tour_heading, 1)[1].split(privacy_heading, 1)[0]
    gifs = re.findall(r'apps/web/public/images/readme-[^\s"\')]+\.gif', after_text)
    gif_rows = []
    for file in gifs:
        data = (REPO / file).read_bytes()
        gif_rows.append({'path': file, 'matches_integration': data == git('show', f'{SHA}:{file}'),
                         'sha256': sha256(data), 'gif_signature': data[:6].decode('ascii')})
    result['readmes'][name] = {
        'before_sha256': sha256(before), 'after_sha256': sha256(after),
        'before_links': old_links, 'after_links': new_links,
        'introduced_missing_references': sorted(set(new_links['missing']) - set(old_links['missing'])),
        'tour_architecture_performance_and_historical_release_text_unchanged': preserved_before == preserved_after,
        'preserved_section_sha256': sha256(preserved_before.encode()),
        'gifs': gif_rows,
    }
    result['checks'][name + ':new_links_resolve'] = not result['readmes'][name]['introduced_missing_references']
    result['checks'][name + ':historical_sections_unchanged'] = preserved_before == preserved_after
    result['checks'][name + ':six_gifs_preserved'] = len(gif_rows) == 6 and all(g['matches_integration'] and g['gif_signature'] in ('GIF87a', 'GIF89a') for g in gif_rows)
    result['checks'][name + ':shell_syntax'] = all(
        subprocess.run(['bash', '-n'], input=block.encode(), capture_output=True).returncode == 0
        for block in re.findall(r'```bash\n(.*?)\n```', after_text, flags=re.S)
    )

package = json.loads(git('show', f'{SHA}:apps/web/package.json'))
lock = json.loads(git('show', f'{SHA}:apps/web/package-lock.json'))
result['source_contract'] = {
    'root_package_exists': (REPO / 'package.json').exists(),
    'root_env_example_exists': (REPO / '.env.example').exists(),
    'web_package_exists': (REPO / 'apps/web/package.json').is_file(),
    'web_env_example_exists': (REPO / 'apps/web/.env.example').is_file(),
    'node_engine': package['engines']['node'], 'package_manager': package['packageManager'],
    'dev_script': package['scripts']['dev'],
    'default_port': 3000, 'documented_explicit_port': 8080,
    'versions': {k: package['dependencies'].get(k) or package['devDependencies'].get(k)
                 for k in ('next', 'react', 'tailwindcss', 'lucide-react', '@typescript/native', 'typescript')},
}
result['checks']['package_lock_agrees_with_manifest'] = all(
    lock['packages'][''][key] == package[key] for key in ('dependencies', 'devDependencies', 'engines')
)
runner = git('show', f'{SHA}:apps/web/scripts/run-local-dev.mjs').decode()
stack = git('show', f'{SHA}:backend/supabase/scripts/local-stack.py').decode()
result['checks']['documented_dev_command_resolves'] = (
    package['scripts']['dev'] == 'node scripts/run-local-dev.mjs --port 3000'
    and "if (name === '--port' && value)" in runner and 'rawPort = value;' in runner
    and 'http://127.0.0.1:8080' in stack
)
local_patch = (OUT / 'pr2903-exact.diff').read_bytes()
github_patch = (OUT / 'pr2903-github.diff').read_bytes()
result['old_patch_id'] = git('patch-id', '--stable', data=local_patch).decode().split()[0]
result['github_patch_id'] = git('patch-id', '--stable', data=github_patch).decode().split()[0]
result['checks']['exact_old_diff_matches_github'] = result['old_patch_id'] == result['github_patch_id']
result['checks']['direct_base_and_merge_base_match'] = (
    git('rev-parse', 'da096e04baf979ac35531172c7a1de95090aa649^').decode().strip()
    == git('merge-base', '67df460dee73f90b93eee203ebcbe7bd9976cb03', 'da096e04baf979ac35531172c7a1de95090aa649').decode().strip()
    == '67df460dee73f90b93eee203ebcbe7bd9976cb03'
)
patch_check = subprocess.run(['git', 'diff', '--check', '--', *FILES], cwd=REPO, capture_output=True)
result['checks']['git_diff_check'] = patch_check.returncode == 0
result['validation_scope'] = 'Static documentation, source/package/lock contract, local links, original diff identity, preserved history/assets, shell syntax. No npm install/ci/dev, unit suite, build, provider, hosted, deployment, or browser validation executed.'
result['passed'] = all(result['checks'].values())
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(0 if result['passed'] else 1)
