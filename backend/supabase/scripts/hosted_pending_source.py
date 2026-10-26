"""Read-only source identity for clean Git or the owner's prepared Mac archive.

The fixed owner manifest is an attestation, not a signed Git commit or permission
to send. Runtime credentials/data/dependency contents are never read here. Their
existing owner/deployment trust is separate from the complete tracked-source hash.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import stat
import subprocess
import sys

MAX_MANIFEST = 8 * 1024 * 1024
MAX_FILES = 30_000
MAX_FILE = 64 * 1024 * 1024
MAX_SOURCE = 2 * 1024 * 1024 * 1024
MANIFEST_RELATIVE = '.codex/runtime-cache/crawler-live-verification-20261025/prepared-active-runtime.json'
RUNTIME_RELATIVE = 'Library/Application Support/tzudong/runtime'
MUTABLE_DIRECTORIES = frozenset({
    'backend/restaurant-crawling/data/tzuyang',
    'backend/restaurant-evaluation/data/tzuyang', 'backend/log',
})
MOUNTS = frozenset({'.venv', 'backend/node_modules', 'backend/.env'})


class SourceAttestationError(ValueError):
    def __init__(self):
        super().__init__('pending_source_invalid')


def _reject():
    raise SourceAttestationError() from None


def _native_home():
    if os.getuid() != os.geteuid() or os.getuid() == 0:
        _reject()
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    if os.environ.get('HOME') != str(home):
        _reject()
    return home


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _metadata(path, kind, *, private=False):
    info = path.lstat()
    if info.st_uid != os.getuid() or stat.S_IFMT(info.st_mode) != kind:
        _reject()
    if kind != stat.S_IFLNK and info.st_mode & 0o022:
        _reject()
    if kind == stat.S_IFREG and (info.st_nlink != 1 or (private and info.st_mode & 0o077)):
        _reject()
    return info


def _parents(path):
    for parent in reversed(path.parents):
        info = parent.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.getuid())
                or info.st_mode & 0o022):
            _reject()


def _relative(value):
    if (not isinstance(value, str) or not value or '\\' in value or '\x00' in value
            or value.startswith('/') or any(p in ('', '.', '..') for p in value.split('/'))
            or PurePosixPath(value).as_posix() != value):
        _reject()
    return value


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            _reject()
        value[key] = item
    return value


def _read_regular(path, limit, *, private=False):
    before = _metadata(path, stat.S_IFREG, private=private)
    if before.st_size > limit:
        _reject()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        if _signature(os.fstat(stream.fileno())) != _signature(before):
            _reject()
        data = stream.read(limit + 1)
        if len(data) > limit or _signature(os.fstat(stream.fileno())) != _signature(before):
            _reject()
    if _signature(path.lstat()) != _signature(before):
        _reject()
    return data, _signature(before)


def _hash_source(path, before):
    """Stream both the prepared SHA256 and the canonical Git blob identity."""
    sha = hashlib.sha256()
    blob = hashlib.sha1(b'blob ' + str(before.st_size).encode() + b'\0')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        if _signature(os.fstat(stream.fileno())) != _signature(before):
            _reject()
        size = 0
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            size += len(block)
            if size > MAX_FILE:
                _reject()
            sha.update(block)
            blob.update(block)
        if size != before.st_size or _signature(os.fstat(stream.fileno())) != _signature(before):
            _reject()
    if _signature(path.lstat()) != _signature(before):
        _reject()
    return sha.hexdigest(), blob.digest()


def _tree(entries):
    tree = {}
    for path, (mode, digest) in entries.items():
        parts = path.split('/')
        node = tree
        for part in parts[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                _reject()
        if parts[-1] in node:
            _reject()
        node[parts[-1]] = (mode, digest)

    def encode(node):
        output = bytearray()
        for name, value in sorted(node.items(), key=lambda item: os.fsencode(item[0] + ('/' if isinstance(item[1], dict) else ''))):
            mode, digest = ('40000', encode(value)) if isinstance(value, dict) else value
            output.extend(mode.encode() + b' ' + os.fsencode(name) + b'\0' + digest)
        return hashlib.sha1(b'tree ' + str(len(output)).encode() + b'\0' + output).digest()
    return encode(tree).hex()


def _mount(root, relative, manifest, runtime):
    path = root / relative
    _metadata(path, stat.S_IFLNK)
    target = path.resolve(strict=True)
    _parents(target)
    if relative == '.venv':
        if target != Path(manifest['python']) or target.parent != runtime:
            _reject()
        _metadata(target, stat.S_IFDIR)
    elif relative == 'backend/node_modules':
        if not target.is_relative_to(runtime / 'checkouts') or target.parts[-2:] != ('backend', 'node_modules'):
            _reject()
        _metadata(target, stat.S_IFDIR)
        data, _ = _read_regular(target.parent / 'package-lock.json', MAX_FILE)
        if hashlib.sha256(data).hexdigest() != manifest['backendLockSha256']:
            _reject()
    else:
        # Credentials are excluded. Validate routing/type only, never contents.
        if target != _native_home() / 'Documents/projects/tzudong/backend/.env':
            _reject()
        _metadata(target, stat.S_IFREG, private=True)
    return str(target)


def _inventory(root, manifest, runtime):
    files, links = manifest['sourceHashes'], manifest['sourceSymlinks']
    tracked = set(files) | set(links)
    state, seen = {}, set()
    for directory, directories, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        state[str(parent)] = _signature(_metadata(parent, stat.S_IFDIR))
        for name in list(directories) + names:
            path = parent / name
            relative = path.relative_to(root).as_posix()
            info = path.lstat()
            if relative in tracked:
                seen.add(relative)
                _metadata(path, stat.S_IFREG if relative in files else stat.S_IFLNK)
                state[str(path)] = _signature(info)
            elif relative in MOUNTS:
                state[str(path)] = (_signature(info), _mount(root, relative, manifest, runtime))
            elif relative in MUTABLE_DIRECTORIES:
                _metadata(path, stat.S_IFDIR)
                # Mutable data is admitted separately by the producer receipts.
                state[str(path)] = (info.st_dev, info.st_ino, info.st_mode, info.st_uid)
            elif name == '__pycache__' and stat.S_ISDIR(info.st_mode):
                _metadata(path, stat.S_IFDIR)
                if any(not p.is_file() or p.is_symlink() or not p.name.endswith('.pyc') for p in path.iterdir()):
                    _reject()
            elif re.fullmatch(r'backend/\.runtime/media-leases/ffmpeg-slot-[0-3]\.lock', relative):
                _metadata(path, stat.S_IFREG)
            elif not stat.S_ISDIR(info.st_mode):
                _reject()
            if name in directories and (relative in MOUNTS | MUTABLE_DIRECTORIES or name == '__pycache__'):
                directories.remove(name)
    if seen != tracked or not MOUNTS <= {str(Path(p).relative_to(root)) for p in state}:
        _reject()
    return state


def _runtime_revision(root):
    if sys.platform != 'darwin':
        _reject()
    home = _native_home()
    manifest_path = home / MANIFEST_RELATIVE
    _parents(manifest_path)
    raw, manifest_stat = _read_regular(manifest_path, MAX_MANIFEST, private=True)
    manifest = json.loads(raw, object_pairs_hook=_unique)
    required = {'python', 'pythonRequirementsSha256', 'preparedAt', 'source', 'sourceCommit',
                'sourceTree', 'trackedFilesVerified', 'sourceHashes', 'sourceSymlinks',
                'backendLockSha256', 'active', 'credentialsTargetPreserved',
                'publicCachedDataPreserved', 'dotenv', 'activationReceipt'}
    if not isinstance(manifest, dict) or set(manifest) != required:
        _reject()
    for key in ('sourceCommit', 'sourceTree'):
        if not isinstance(manifest[key], str) or not re.fullmatch('[a-f0-9]{40}', manifest[key]):
            _reject()
    if (not isinstance(manifest['python'], str) or not Path(manifest['python']).is_absolute()
            or not isinstance(manifest['dotenv'], str) or not re.fullmatch(r'\d+\.\d+\.\d+', manifest['dotenv'])
            or not isinstance(manifest['preparedAt'], str)
            or datetime.fromisoformat(manifest['preparedAt']).tzinfo is None
            or any(not isinstance(manifest[k], str) or not re.fullmatch('[a-f0-9]{64}', manifest[k])
                   for k in ('pythonRequirementsSha256', 'backendLockSha256'))):
        _reject()
    runtime = home / RUNTIME_RELATIVE
    expected = runtime / 'checkouts' / ('source-' + manifest['sourceCommit'][:12])
    if root != expected or manifest['source'] != str(root):
        _reject()
    if (any(manifest[key] is not True for key in ('active', 'credentialsTargetPreserved', 'publicCachedDataPreserved'))
            or manifest['activationReceipt'] != 'mac-crawler-activation-' + manifest['sourceCommit'][:12] + '.json'
            or not isinstance(manifest['sourceHashes'], dict) or not isinstance(manifest['sourceSymlinks'], dict)
            or type(manifest['trackedFilesVerified']) is not int
            or manifest['trackedFilesVerified'] != len(manifest['sourceHashes'])
            or not 1 <= len(manifest['sourceHashes']) + len(manifest['sourceSymlinks']) <= MAX_FILES):
        _reject()
    tracked = set(manifest['sourceHashes']) | set(manifest['sourceSymlinks'])
    if set(manifest['sourceHashes']) & set(manifest['sourceSymlinks']):
        _reject()
    for path in tracked:
        _relative(path)
        if path in MOUNTS or any(path == p or path.startswith(p + '/') for p in MUTABLE_DIRECTORIES):
            _reject()
    for digest in manifest['sourceHashes'].values():
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            _reject()
    for path, field in [('backend/package-lock.json', 'backendLockSha256'),
                        ('backend/restaurant-crawling/scripts/requirements.txt', 'pythonRequirementsSha256')]:
        if manifest['sourceHashes'].get(path) != manifest[field]:
            _reject()
    before = _inventory(root, manifest, runtime)
    entries = {}
    size = 0
    for relative, expected_hash in manifest['sourceHashes'].items():
        path = root / relative
        info = _metadata(path, stat.S_IFREG)
        size += info.st_size
        if info.st_size > MAX_FILE or size > MAX_SOURCE or _signature(info) != before[str(path)]:
            _reject()
        digest, blob = _hash_source(path, info)
        if digest != expected_hash:
            _reject()
        entries[relative] = ('100755' if info.st_mode & 0o111 else '100644', blob)
    for relative, target in manifest['sourceSymlinks'].items():
        path = root / relative
        if not isinstance(target, str) or '\x00' in target or os.readlink(path) != target:
            _reject()
        resolved = path.resolve(strict=True)
        if (not resolved.is_relative_to(root) or resolved.relative_to(root).as_posix() not in manifest['sourceHashes']
                or _signature(path.lstat()) != before[str(path)]):
            _reject()
        link = os.fsencode(target)
        entries[relative] = ('120000', hashlib.sha1(b'blob ' + str(len(link)).encode() + b'\0' + link).digest())
    if (_tree(entries) != manifest['sourceTree'] or before != _inventory(root, manifest, runtime)
            or manifest_stat != _signature(manifest_path.lstat())):
        _reject()
    return manifest['sourceCommit']


def _git_revision(root):
    environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                       GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    def git(*args):
        return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(root), *args],
                              env=environment, capture_output=True, check=True, timeout=10).stdout.decode().strip()
    revision = git('rev-parse', 'HEAD')
    if (Path(git('rev-parse', '--show-toplevel')) != root
            or git('status', '--porcelain', '--untracked-files=normal')
            or not re.fullmatch('[a-f0-9]{40}', revision)):
        _reject()
    return revision


def observe_source_revision(root):
    """No CLI/environment manifest, root, SHA or trust override is accepted."""
    try:
        root = Path(root).absolute()
        _parents(root)
        _metadata(root, stat.S_IFDIR)
        # A dirty/broken/nested Git checkout NEVER falls back to a manifest.
        if any(os.path.lexists(p / '.git') for p in (root, *root.parents)):
            return _git_revision(root)
        return _runtime_revision(root)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError):
        _reject()
