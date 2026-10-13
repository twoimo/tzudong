"""Read-only detached-pin, complete-set and byte verification for this packet format."""
import hashlib
import json
import sys
from pathlib import Path


def verify(repo, pin_path):
    repo = Path(repo).resolve(strict=True)
    pin = json.loads(Path(pin_path).read_bytes())
    map_path = (repo / pin['map']).resolve(strict=True)
    if repo not in map_path.parents:
        raise ValueError('MAP_OUTSIDE_REPO')
    if hashlib.sha256(map_path.read_bytes()).hexdigest() != pin['sha256']:
        raise ValueError('MAP_HASH_MISMATCH')
    mapping = json.loads(map_path.read_bytes())
    root = (repo / mapping['root']).resolve(strict=True)
    if root != map_path.parent or repo not in root.parents:
        raise ValueError('ROOT_MISMATCH')
    files = mapping['files']
    if not isinstance(files, dict) or len(files) != pin['mappedFiles']:
        raise ValueError('COUNT_MISMATCH')
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p != map_path}
    if actual != set(files):
        raise ValueError('FILE_SET_MISMATCH')
    for relative, expected in files.items():
        path = root / relative
        if path.is_symlink() or root not in path.resolve(strict=True).parents:
            raise ValueError('UNSAFE_PATH')
        data = path.read_bytes()
        if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise ValueError('FILE_BYTES_MISMATCH')
    return {'verified': True, 'files': len(files), 'mapSha256': pin['sha256']}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(sys.argv[1], sys.argv[2]), sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        print('{"verified":false,"error":"PACKET_REJECTED"}')
        sys.exit(1)
