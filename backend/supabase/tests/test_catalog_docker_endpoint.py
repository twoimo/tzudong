"""Local endpoint admission; only temporary private sockets, no Docker mutations."""
from pathlib import Path
import json
import os
import shlex
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'backend/supabase/scripts'))
import catalog_docker_endpoint as endpoint


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp=self.enterContext(tempfile.TemporaryDirectory(dir='/tmp',prefix='catalog-socket-'))
        self.home=Path(self.temp).resolve()
        self.path=self.home/'.colima/default/docker.sock'
        self.path.parent.mkdir(parents=True)
        self.sock=socket.socket(socket.AF_UNIX)
        self.addCleanup(self.sock.close)
        self.sock.bind(str(self.path));self.path.chmod(0o600)
        self.enterContext(patch.object(endpoint,'account_home',return_value=self.home))
        self.enterContext(patch.object(endpoint.platform,'system',return_value='Darwin'))
        self.uri='unix://'+str(self.path)
    def test_exact_owned_colima_default_socket(self):
        self.assertEqual(endpoint.validate_endpoint('colima',self.uri),self.uri)
    def test_explicit_owned_catalog_profile_keeps_socket_and_context_bound(self):
        profile=self.home/'.colima/tzudong-catalog-20261007';profile.mkdir()
        sock=self.enterContext(socket.socket(socket.AF_UNIX));path=profile/'docker.sock'
        sock.bind(str(path));path.chmod(0o600)
        uri='unix://'+str(path);context='colima-tzudong-catalog-20261007'
        self.assertEqual(endpoint.validate_endpoint(context,uri),uri)
        for ctx,target in [('colima',uri),(context,self.uri),('colima-tzudong-record-storage-20261007',uri),(context+'../',uri),(context,'tcp://remote:2375')]:
            with self.subTest(ctx=ctx),self.assertRaises(ValueError):endpoint.validate_endpoint(ctx,target)
        profile.chmod(0o777)
        with self.assertRaises(ValueError):endpoint.validate_endpoint(context,uri)
    def test_explicit_context_does_not_select_or_mutate_saved_context(self):
        calls=[]
        def run(args,**kwargs):
            calls.append(args);return subprocess.CompletedProcess(args,0,self.uri+'\n','')
        with patch.object(endpoint.subprocess,'run',side_effect=run):
            self.assertEqual(endpoint.resolve_endpoint('colima'),self.uri)
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][2:4],['inspect','colima'])
        self.assertNotIn('use',calls[0])
    def test_legacy_allowlist_unchanged(self):
        for uri in endpoint.LEGACY:self.assertEqual(endpoint.validate_endpoint('default',uri),uri)
    def test_exact_private_ci_socket_and_scope(self):
        ci_root=Path(self.enterContext(tempfile.TemporaryDirectory(dir='/tmp',prefix='ci-'))).resolve()
        base=ci_root/'tzudong-catalog-docker'
        run=base/'run-a1b2c3d4';run.mkdir(parents=True)
        sock=self.enterContext(socket.socket(socket.AF_UNIX));path=run/'docker.sock'
        sock.bind(str(path));path.chmod(0o600)
        uri='unix://'+str(path)
        with patch.object(endpoint.platform,'system',return_value='Linux'),patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_TEMP':str(ci_root)}):
            self.assertEqual(endpoint.validate_endpoint('tzudong-catalog-ci',uri),uri)
            for bad in (uri+'/',uri.replace('run-a1b2c3d4','run-other'),'tcp://127.0.0.1:2375'):
                with self.subTest(uri=bad),self.assertRaises(ValueError):endpoint.validate_endpoint('tzudong-catalog-ci',bad)
            run.chmod(0o777)
            with self.assertRaises(ValueError):endpoint.validate_endpoint('tzudong-catalog-ci',uri)
            run.chmod(0o700)
            path.unlink();path.symlink_to(self.path)
            with self.assertRaises(ValueError):endpoint.validate_endpoint('tzudong-catalog-ci',uri)
        with patch.object(endpoint.platform,'system',return_value='Linux'),patch.dict(os.environ,{'GITHUB_ACTIONS':'false','RUNNER_TEMP':str(ci_root)}),self.assertRaises(ValueError):
            endpoint.validate_endpoint('tzudong-catalog-ci',uri)
    def test_remote_other_profile_traversal_suffix_and_context_denied(self):
        for uri in ('tcp://127.0.0.1:2375','ssh://localhost','unix:///tmp/docker.sock',self.uri+'/',self.uri+'\n',self.uri.replace('/default/','/other/'),self.uri.replace('/default/','/default/../default/')):
            with self.subTest(uri=uri),self.assertRaises(ValueError):endpoint.validate_endpoint('colima',uri)
        for context in ('default','colima-other','../colima','colima\n','a'*65):
            with self.subTest(context=context),self.assertRaises(ValueError):endpoint.validate_endpoint(context,self.uri)
        with patch.object(endpoint.platform,'system',return_value='Linux'),self.assertRaises(ValueError):endpoint.validate_endpoint('colima',self.uri)
    def test_socket_file_and_symlink_rejected(self):
        self.path.unlink();self.path.write_text('not a socket')
        with self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
        self.path.unlink();self.path.symlink_to(self.home/'other')
        with self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
    def test_parent_symlink_and_writable_parent_rejected(self):
        profile=self.path.parent;profile.rename(profile.with_name('other'));profile.symlink_to(profile.with_name('other'),target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
        profile.unlink();profile.with_name('other').rename(profile);profile.chmod(0o777)
        with self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
    def test_socket_ownership_and_permissions_denied(self):
        self.path.chmod(0o622)
        with self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
        self.path.chmod(0o600)
        original=Path.lstat
        def foreign(path,*args,**kwargs):
            value=original(path,*args,**kwargs)
            if path==self.path:
                row=list(value);row[4]=value.st_uid+1;return os.stat_result(row)
            return value
        with patch.object(Path,'lstat',foreign),self.assertRaisesRegex(ValueError,'docker_socket_denied'):endpoint.validate_endpoint('colima',self.uri)
    def test_context_discovery_drops_all_docker_overrides(self):
        calls=[]
        def run(args,**kwargs):
            calls.append((args,kwargs))
            return subprocess.CompletedProcess(args,0,'colima\n' if args[-1]=='show' else self.uri+'\n','')
        with patch.dict(os.environ,{'DOCKER_HOST':'tcp://remote:2375','DOCKER_CONTEXT':'remote','DOCKER_CONFIG':'/tmp/foreign','DOCKER_TLS_VERIFY':'1','DOCKER_API_VERSION':'1.1','HOME':'/tmp/foreign'}),patch.object(endpoint.subprocess,'run',side_effect=run):
            self.assertEqual(endpoint.resolve_endpoint(),self.uri)
        self.assertEqual(len(calls),2)
        for args,kwargs in calls:
            self.assertEqual(set(kwargs['env']),{'PATH','HOME'})
            self.assertEqual(kwargs['env']['HOME'],str(self.home))
            self.assertNotIn('use',args)
        self.assertEqual(calls[1][0][2:4],['inspect','colima'])
    def test_failed_or_multiline_discovery_is_fixed_denial(self):
        for result in (subprocess.CompletedProcess([],1,'','private marker'),subprocess.CompletedProcess([],0,'colima\nremote',''),subprocess.CompletedProcess([],0,'x'*4097,'')):
            with patch.object(endpoint.subprocess,'run',return_value=result),self.assertRaisesRegex(ValueError,'^docker_context_denied$'):endpoint.resolve_endpoint()


class GeneratorWiringTests(unittest.TestCase):
    def test_resolver_is_clean_bound_and_operations_remain_isolated_pinned(self):
        s=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        self.assertIn("'backend/supabase/scripts/catalog_docker_endpoint.py'",s)
        self.assertIn('docker_endpoint=$(python3 "$script_dir/catalog_docker_endpoint.py")',s)
        self.assertEqual(s.count('env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$docker_config"'),4)
        self.assertIn('db_amd64_manifest_digest=\'sha256:caae3d066f437332d593011e3e7ecf78ab005ce9b89378efd53f97f0410563ad\'',s)
        self.assertIn('db_image=\'supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b\'',s)
        self.assertIn('image inspect --platform linux/amd64',s)
        self.assertNotIn('docker context use',s)
    def test_existing_compose_cli_keeps_config_endpoint_and_arguments_isolated(self):
        source=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        start=source.index('compose() {')
        function=source[start:source.index('\n}\n',start)+3]
        with tempfile.TemporaryDirectory(prefix='catalog compose ') as directory:
            base=Path(directory);bin_dir=base/'bin';bin_dir.mkdir();config=base/'isolated config';config.mkdir()
            for version,expected_prefix in [('2.39.4',[]),('5.6.0',[]),('1.29.2',['compose'])]:
                script=f'#!{sys.executable}\nimport os,sys,json\nif sys.argv[1:]==["version","--short"]: print({version!r})\nelse: print(json.dumps({{"args":sys.argv[1:],"config":os.environ.get("DOCKER_CONFIG"),"endpoint":os.environ.get("DOCKER_HOST"),"privateMarkerPresent":"CATALOG_TEST_PRIVATE_MARKER" in os.environ}}))\n'
                for name in ('docker-compose','docker'):
                    path=bin_dir/name;path.write_text(script);path.chmod(0o700)
                env=dict(os.environ,PATH=str(bin_dir)+os.pathsep+os.environ.get('PATH',''),CATALOG_TEST_PRIVATE_MARKER='private-fixture')
                setup='\n'.join(f'{key}={shlex.quote(value)}' for key,value in {
                    'docker_config':str(config),'docker_endpoint':'unix:///tmp/fixture.sock','project':'fixture-project',
                    'env_file':str(base/'isolated env'),'compose_file':str(base/'isolated compose.yml')}.items())
                result=subprocess.run(['bash','-c',setup+'\n'+function+'\ncompose config'],env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                observed=json.loads(result.stdout)
                self.assertEqual(observed['args'],expected_prefix+['--project-name','fixture-project','--env-file',str(base/'isolated env'),'-f',str(base/'isolated compose.yml'),'config'])
                self.assertEqual(observed['config'],str(config));self.assertEqual(observed['endpoint'],'unix:///tmp/fixture.sock')
                self.assertFalse(observed['privateMarkerPresent'])
                self.assertEqual(list(config.iterdir()),[])
    def test_ci_paths_and_executable_test_lists_cover_new_boundaries(self):
        s=(ROOT/'.github/workflows/g014-catalog-contract-baseline.yml').read_text()
        paths=s.split('  workflow_dispatch:',1)[0]
        for name in ('test_catalog_docker_endpoint','test_g014_diagnostic_admission','test_restaurant_refresh_apply_boundary'):
            self.assertIn('backend/supabase/tests/'+name+'.py',paths)
            self.assertIn('backend.supabase.tests.'+name,s)
        private=s.split('- name: Exercise admin RPC',1)[1].split('- name:',1)[0]
        for name in ('test_g014_diagnostic_admission','test_restaurant_refresh_apply_boundary'):
            self.assertIn('backend.supabase.tests.'+name,private)
        self.assertIn("TZUDONG_REFRESH_PRIVATE_PG: '1'",private)
        self.assertIn("TZUDONG_ADMIN_IDS_LOCAL_PG: '1'",private)


if __name__=='__main__':unittest.main()
