#!/usr/bin/env python3
"""Read-only local endpoint admission for the canonical catalog generator.

Never changes Docker context. Colima admission is Darwin/current-account/default
or an explicitly selected private catalog profile; it is not hosted evidence.
"""
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys

LEGACY = frozenset(('unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine',
                    'npipe:////./pipe/dockerDesktopLinuxEngine'))


def account_home():
    if os.name == 'posix':
        import pwd
        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    return Path.home()


def validate_endpoint(context, endpoint):
    if not isinstance(context,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',context):
        raise ValueError('docker_context_denied')
    if endpoint in LEGACY:
        return endpoint
    if (platform.system() == 'Linux' and context == 'tzudong-catalog-ci'
            and os.environ.get('GITHUB_ACTIONS') == 'true'):
        return validate_ci_socket(endpoint)
    profile = 'default' if context == 'colima' else None
    task = re.fullmatch(r'colima-(tzudong-catalog-[0-9]{8}(?:-[a-f0-9]{8})?)', context)
    if task:
        profile = task.group(1)
    if platform.system() != 'Darwin' or profile is None:
        raise ValueError('docker_endpoint_denied')
    home = account_home()
    socket = home / '.colima' / profile / 'docker.sock'
    if not home.is_absolute() or endpoint != 'unix://' + str(socket):
        raise ValueError('docker_endpoint_denied')
    try:
        if home.resolve(strict=True) != home:
            raise ValueError
        for path in (home,home/'.colima',socket.parent,socket):
            info=path.lstat()
            expected_type=stat.S_ISSOCK if path==socket else stat.S_ISDIR
            if (not expected_type(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) & 0o022):
                raise ValueError
    except (OSError,ValueError):
        raise ValueError('docker_socket_denied') from None
    return endpoint


def validate_ci_socket(endpoint):
    """Admit only the action-owned ephemeral Unix socket, never TCP or SSH."""
    try:
        root = Path(os.environ['RUNNER_TEMP'])
        if not root.is_absolute() or root.resolve(strict=True) != root:
            raise ValueError
        base = root / 'tzudong-catalog-docker'
        if not isinstance(endpoint, str) or not endpoint.startswith('unix://'):
            raise ValueError
        path = Path(endpoint[7:])
        if (path.parent.parent != base or path.name != 'docker.sock'
                or not re.fullmatch(r'run-[a-f0-9]{8}', path.parent.name)
                or endpoint != 'unix://' + str(path)):
            raise ValueError
        for directory in (root, base, path.parent):
            info = directory.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) & 0o022):
                raise ValueError
        info = path.lstat()
        if (not stat.S_ISSOCK(info.st_mode) or info.st_uid not in (0, os.getuid())
                or stat.S_IMODE(info.st_mode) & 0o002):
            raise ValueError
        return endpoint
    except (OSError, KeyError, ValueError):
        raise ValueError('docker_ci_socket_denied') from None


def resolve_endpoint(context_override=None):
    # Context discovery also drops DOCKER_HOST/CONTEXT/CONFIG, TLS and API overrides.
    # Read the account's saved selection, not an inherited environment override.
    env={'PATH':os.environ.get('PATH',''),'HOME':str(account_home())}
    def read(*args):
        try:
            result=subprocess.run(['docker','context',*args],env=env,
                                  capture_output=True,text=True,timeout=10,check=False)
            if result.returncode or len(result.stdout)>4096:
                raise ValueError
            return result.stdout.rstrip('\r\n')
        except (OSError,ValueError,subprocess.TimeoutExpired):
            raise ValueError('docker_context_denied') from None
    context=context_override if context_override is not None else read('show')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',context):
        raise ValueError('docker_context_denied')
    return validate_endpoint(context,read('inspect',context,'--format','{{ .Endpoints.docker.Host }}'))


if __name__=='__main__':
    try:
        if len(sys.argv)==1:
            context=None
        elif len(sys.argv)==3 and sys.argv[1]=='--context':
            context=sys.argv[2]
        else:
            raise ValueError('docker_context_denied')
        print(resolve_endpoint(context))
    except (ValueError,OSError,KeyError):
        print('catalog_local_docker_endpoint_denied',file=sys.stderr)
        sys.exit(1)
