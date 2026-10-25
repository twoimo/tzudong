"""Exercise the installer in an isolated HOME; launchctl and the writer are fakes."""

from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / 'install_mac_hosted_pipeline_launchd.sh'
LABEL = 'dev.tzudong.hosted-new-video'


class MacHostedPipelineInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mac-hosted-install-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / 'repo & source'
        self.home = self.root / 'home & owner'
        self.support = self.home / 'Library/Application Support/tzudong'
        self.wrapper = self.support / 'run-hosted-new-video.sh'
        self.plist = self.home / f'Library/LaunchAgents/{LABEL}.plist'
        self.ffmpeg_root = self.support / 'runtime/bin'
        self.ffmpeg_root.mkdir(parents=True)
        self.ffmpeg = self.ffmpeg_root / 'ffmpeg'
        self.ffmpeg.write_text('#!/bin/sh\nexit 0\n')
        self.ffmpeg.chmod(0o755)
        self.script = self.repo / 'backend/bin' / INSTALLER.name
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(INSTALLER, self.script)
        self.commands = self.root / 'launchctl.jsonl'
        self.observation = self.root / 'writer.json'
        self.bin = self.root / 'fake-bin'
        self.bin.mkdir()
        self.runtime = self.root / 'fake-python'
        self.runtime.write_text(f'#!{sys.executable}\n' + '''import json, os, pathlib, sys
args = sys.argv[1:]
if args and args[0].endswith('/run_hosted_new_video_pipeline.py'):
    keys = ['TZUDONG_LAAJ_PROVIDER', 'TZUDONG_HOSTED_DATA_PLANE_APPROVED',
            'G037_WRITE_FREEZE', 'TZUDONG_PIPELINE_SOURCE', 'TZUDONG_REPO_ROOT',
            'ALLOW_CUSTOM_FFMPEG', 'FFMPEG_PATH', 'FFMPEG_TRUSTED_ROOT']
    pathlib.Path(os.environ['FAKE_WRITER_OBSERVATION']).write_text(json.dumps(
        {'argv': args, 'env': {key: os.environ.get(key) for key in keys}}))
    raise SystemExit(int(os.environ.get('FAKE_WRITER_EXIT', '0')))
if args and args[0] == '-c' and os.environ.get('FAKE_RUNTIME_FAILURE') == '1':
    raise SystemExit(73)
if args and args[0] == '-':
    if os.environ.get('FAKE_VALIDATION_FAILURE') == '1':
        print('private-runtime-diagnostic', file=sys.stderr)
        raise SystemExit(74)
    if os.environ.get('FAKE_CORRUPT_WRAPPER') == '1':
        pathlib.Path(args[1]).with_name('run-hosted-new-video.sh').write_text('unclosed="')
os.execv(sys.executable, [sys.executable, *args])
''')
        self.runtime.chmod(0o755)
        launcher = self.bin / 'launchctl'
        launcher.write_text(f'#!{sys.executable}\n' + '''import json, os, pathlib, plistlib, sys
log = pathlib.Path(os.environ['FAKE_LAUNCHCTL_LOG'])
previous = log.read_text().splitlines() if log.exists() else []
with log.open('a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
action = sys.argv[1]
if action == 'print':
    state = os.environ.get('FAKE_LAUNCH_STATE', 'absent')
    if state == 'appears' and previous:
        state = 'running'
    if state == 'running':
        print('state = running\\n pid = 12345')
        raise SystemExit(0)
    if state == 'idle':
        print('state = not running')
        raise SystemExit(0)
    raise SystemExit(5 if state == 'unavailable' else 113)
if action == 'bootstrap':
    with open(sys.argv[3], 'rb') as stream:
        config = plistlib.load(stream)
    assert pathlib.Path(config['ProgramArguments'][1]).is_file()
    raise SystemExit(0)
if action == 'bootout':
    raise SystemExit(0)
raise SystemExit(75)
''')
        launcher.chmod(0o755)
        self.env = {
            'HOME': str(self.home), 'PATH': f'{self.bin}:/usr/bin:/bin',
            'PYTHON_CMD': str(self.runtime), 'TMPDIR': str(self.root), 'LANG': 'C',
            'FAKE_LAUNCHCTL_LOG': str(self.commands),
            'FAKE_WRITER_OBSERVATION': str(self.observation),
        }

    def install(self, **environment):
        return subprocess.run(['/bin/bash', str(self.script)], env={**self.env, **environment},
                              capture_output=True, text=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in self.commands.read_text().splitlines()] if self.commands.exists() else []

    def seed_previous(self):
        self.plist.parent.mkdir(parents=True, exist_ok=True)
        self.wrapper.write_bytes(b'previous owned wrapper\n')
        self.plist.write_bytes(b'previous owned plist\n')

    def assert_previous_preserved(self):
        self.assertEqual(self.wrapper.read_bytes(), b'previous owned wrapper\n')
        self.assertEqual(self.plist.read_bytes(), b'previous owned plist\n')
        self.assertTrue(all(call[0] == 'print' for call in self.calls()))
        self.assertFalse(self.observation.exists())

    def test_installed_wrapper_uses_existing_gemini_review_and_media_contract(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.plist.open('rb') as stream:
            config = plistlib.load(stream)
        self.assertEqual(config['Label'], LABEL)
        self.assertEqual(config['ProgramArguments'], ['/bin/bash', str(self.wrapper)])
        self.assertEqual(config['WorkingDirectory'], str(self.support))
        self.assertEqual(config['StartCalendarInterval'], {'Hour': 5, 'Minute': 15})
        self.assertEqual(config['EnvironmentVariables']['G037_WRITE_FREEZE'], 'active')
        self.assertEqual([call[0] for call in self.calls()], ['print', 'print', 'bootstrap'])
        execution = subprocess.run(config['ProgramArguments'], env={**self.env, 'FAKE_WRITER_EXIT': '7'},
                                   capture_output=True, text=True, timeout=15)
        self.assertEqual(execution.returncode, 7)
        observed = json.loads(self.observation.read_text())
        self.assertEqual(observed['argv'], [str(self.repo / 'backend/bin/run_hosted_new_video_pipeline.py'),
                                          '--channel', 'tzuyang', '--limit', '3', '--review-automation'])
        self.assertEqual(observed['env'], {
            'TZUDONG_LAAJ_PROVIDER': 'gemini', 'TZUDONG_HOSTED_DATA_PLANE_APPROVED': '1',
            'G037_WRITE_FREEZE': 'active', 'TZUDONG_PIPELINE_SOURCE': 'mac',
            'TZUDONG_REPO_ROOT': str(self.repo), 'ALLOW_CUSTOM_FFMPEG': '1',
            'FFMPEG_PATH': str(self.ffmpeg), 'FFMPEG_TRUSTED_ROOT': str(self.ffmpeg_root),
        })
        self.assertIn('end exit=7', execution.stdout)
        self.assertIn('limit=3', result.stdout)

    def test_explicit_cleared_freeze_is_preserved(self):
        result = self.install(G037_WRITE_FREEZE='cleared')
        self.assertEqual(result.returncode, 0, result.stderr)
        execution = subprocess.run(['/bin/bash', str(self.wrapper)], env=self.env,
                                   capture_output=True, text=True, timeout=15)
        self.assertEqual(execution.returncode, 0)
        self.assertEqual(json.loads(self.observation.read_text())['env']['G037_WRITE_FREEZE'], 'cleared')

    def test_source_calendar_is_consumed_by_generated_plist(self):
        # Mutate only the isolated copy: a decorative cadence fragment would
        # pass source inspection but leave the generated schedule at 05:15.
        source = self.script.read_text()
        self.assertEqual(source.count('<integer>15</integer>'), 1)
        self.script.write_text(source.replace('<integer>15</integer>', '<integer>16</integer>'))
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.plist.open('rb') as stream:
            config = plistlib.load(stream)
        self.assertEqual(config['StartCalendarInterval'], {'Hour': 5, 'Minute': 16})

    def test_invalid_runtime_or_freeze_never_replaces_owned_files(self):
        self.seed_previous()
        for settings in [{'FAKE_RUNTIME_FAILURE': '1'}, {'G037_WRITE_FREEZE': 'invalid'}]:
            with self.subTest(settings=settings):
                result = self.install(**settings)
                self.assertNotEqual(result.returncode, 0)
                self.assert_previous_preserved()

    def test_generated_plist_and_wrapper_are_validated_before_publication(self):
        self.seed_previous()
        for setting in ['FAKE_VALIDATION_FAILURE', 'FAKE_CORRUPT_WRAPPER']:
            with self.subTest(setting=setting):
                result = self.install(**{setting: '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('generated_launch_agent_invalid', result.stderr)
                self.assertNotIn('private-runtime-diagnostic', result.stderr)
                self.assert_previous_preserved()

    def test_registered_writer_is_never_unloaded_or_replaced(self):
        self.seed_previous()
        for state in ['running', 'idle']:
            with self.subTest(state=state):
                result = self.install(FAKE_LAUNCH_STATE=state)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('launch_agent_already_registered', result.stderr)
                self.assert_previous_preserved()

    def test_unknown_state_and_late_registration_refuse_publication(self):
        self.seed_previous()
        for state, code in [('unavailable', 'launch_agent_state_unconfirmed'),
                            ('appears', 'launch_agent_already_registered')]:
            with self.subTest(state=state):
                if self.commands.exists():
                    self.commands.unlink()
                result = self.install(FAKE_LAUNCH_STATE=state)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(code, result.stderr)
                self.assert_previous_preserved()

    def test_absent_or_symlink_media_runtime_never_replaces_owned_files(self):
        self.seed_previous()
        self.ffmpeg.unlink()
        for linked in [False, True]:
            with self.subTest(linked=linked):
                if linked:
                    self.ffmpeg.symlink_to(self.runtime)
                result = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('ffmpeg_runtime_unavailable', result.stderr)
                self.assert_previous_preserved()


if __name__ == '__main__':
    unittest.main()
