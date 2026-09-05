#!/usr/bin/env python3
"""Run as a Python source-file entrypoint; never import the project executor.

The verified Git source is compiled directly, so timestamp-based .pyc caches
cannot select the executor. Credential input is an owner-only JSON file with
exactly user/password, outside the checkout. No DSN or TLS overrides accepted.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
PREFIX='backend/supabase/scripts/'


class ReceiptError(ValueError):
    pass


def bundle_for(source_sha):
    if not re.fullmatch('[a-f0-9]{40}',source_sha):
        raise ReceiptError('release_observation_source_unverified')
    try:
        # -C alone does not override inherited repository/object-store settings.
        env={key:value for key,value in os.environ.items() if not key.startswith('GIT_')}
        env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull)
        def discover(*args):
            return subprocess.check_output(['git','--no-replace-objects','-C',str(ROOT),
                'rev-parse','--path-format=absolute',*args],env=env,
                stderr=subprocess.DEVNULL,timeout=10).decode().strip()
        git_dir=discover('--absolute-git-dir')
        object_dir=discover('--git-path','objects')
        env['GIT_OBJECT_DIRECTORY']=object_dir
        env['GIT_ALTERNATE_OBJECT_DIRECTORIES']=''
        def git(*args):
            return subprocess.check_output(['git','--no-replace-objects',
                '--git-dir='+git_dir,'--work-tree='+str(ROOT),*args],env=env,
                cwd=ROOT,stderr=subprocess.DEVNULL,timeout=10)
        if git('cat-file','-t',source_sha).strip()!=b'commit':raise ValueError()
        paths={'executor_bytes':PREFIX+'release_readiness_observation.py',
               'sql_bytes':PREFIX+'release_readiness_observation.sql',
               'ca_bytes':'backend/supabase/certificates/prod-ca-2021.crt',
               'launcher_bytes':PREFIX+'release_readiness_receipt.py'}
        bundle={'source_sha':source_sha}
        for key,path in paths.items():
            size=int(git('cat-file','-s',f'{source_sha}:{path}'))
            if not 0<size<=65536:raise ValueError()
            blob=git('cat-file','blob',f'{source_sha}:{path}')
            if blob!=(ROOT/path).read_bytes():raise ValueError()
            bundle[key]=blob
        bundle['launcher_sha256']=hashlib.sha256(bundle.pop('launcher_bytes')).hexdigest()
        return bundle
    except Exception:
        raise ReceiptError('release_observation_source_unverified') from None


def compiled_executor(bundle):
    path=str(ROOT/PREFIX/'release_readiness_observation.py')
    namespace={'__name__':'_verified_release_observation','__file__':path,
               '__verified_source_bundle__':bundle}
    exec(compile(bundle['executor_bytes'],path,'exec',dont_inherit=True),namespace)
    return namespace


def credentials_from(path):
    path=Path(path)
    descriptor=None
    try:
        if not path.is_absolute() or path.resolve().is_relative_to(ROOT):raise ValueError()
        descriptor=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        info=os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or not 0<info.st_size<=65536
            or (hasattr(os,'getuid') and info.st_uid!=os.getuid())
            or (os.name!='nt' and info.st_mode&0o077)):raise ValueError()
        with os.fdopen(descriptor,'r',encoding='utf-8') as stream:
            descriptor=None;raw=stream.read(65537)
            if len(raw.encode('utf-8'))>65536:raise ValueError()
            value=json.loads(raw)
        if type(value) is not dict or set(value)!={'user','password'}:raise ValueError()
        if any(type(value[k]) is not str or not value[k] or len(value[k])>4096 or '\x00' in value[k]
               for k in value):raise ValueError()
        return value
    except Exception:
        raise ReceiptError('release_observation_credentials_unavailable') from None
    finally:
        if descriptor is not None:os.close(descriptor)


class BoundedArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ReceiptError('release_observation_arguments_invalid')


def main():
    parser=BoundedArgumentParser(description=__doc__)
    parser.add_argument('--source-sha',required=True)
    parser.add_argument('--credentials-file')
    parser.add_argument('--output')
    parser.add_argument('--verify-source-only',action='store_true')
    try:
        args=parser.parse_args()
        # This source-file launcher is the trusted entrypoint, not an imported
        # .pyc or runpy module. The committed launcher bytes are also checked.
        if not sys.flags.isolated or not __file__.endswith('.py'):raise ReceiptError('release_observation_source_unverified')
        bundle=bundle_for(args.source_sha);executor=compiled_executor(bundle)
        if args.verify_source_only:
            if args.credentials_file or args.output:raise ReceiptError('release_observation_arguments_invalid')
            print(json.dumps({'sourceSnapshotCompiled':True,'projectRef':executor['PROJECT_REF'],
                  'sourceSha':args.source_sha,'executorSha256':hashlib.sha256(bundle['executor_bytes']).hexdigest()}))
            return 0
        if not args.credentials_file or not args.output:raise ReceiptError('release_observation_arguments_invalid')
        output=Path(args.output)
        if not output.is_absolute() or output.resolve().is_relative_to(ROOT) or output.exists():
            raise ReceiptError('release_observation_output_invalid')
        credentials=credentials_from(args.credentials_file)
        for name in list(os.environ):
            if name.startswith('PG'):os.environ.pop(name,None)
        result=executor['_receipt_from_bundle'](bundle,credentials['user'],credentials['password'])
        del credentials
        raw=(json.dumps(result,sort_keys=True,indent=2)+'\n').encode()
        descriptor=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'wb') as stream:stream.write(raw)
        print(json.dumps({'status':'collected','schemaVersion':3,'receiptSha256':result['receiptSha256'],
                          'fileSha256':hashlib.sha256(raw).hexdigest()}))
        return 0
    except Exception:
        print(json.dumps({'status':'failed','code':'release_observation_receipt_unavailable'}))
        return 1


if __name__=='__main__':
    raise SystemExit(main())
