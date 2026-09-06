#!/usr/bin/env python3
"""Read-only local endpoint admission for the canonical catalog generator.

Never changes Docker context. Colima admission is Darwin/current-account/default
profile only; a socket path is not proof of any hosted database or remote daemon.
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
    if platform.system() != 'Darwin' or context != 'colima':
        raise ValueError('docker_endpoint_denied')
    home = account_home()
    socket = home / '.colima/default/docker.sock'
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


def resolve_endpoint():
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
    context=read('show')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',context):
        raise ValueError('docker_context_denied')
    return validate_endpoint(context,read('inspect',context,'--format','{{ .Endpoints.docker.Host }}'))


if __name__=='__main__':
    try:
        if len(sys.argv)!=1:
            raise ValueError('docker_context_denied')
        print(resolve_endpoint())
    except (ValueError,OSError,KeyError):
        print('catalog_local_docker_endpoint_denied',file=sys.stderr)
        sys.exit(1)
