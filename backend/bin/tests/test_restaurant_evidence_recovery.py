import base64
import contextlib
import copy
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.bin import run_restaurant_evidence_recovery as worker

JOB = '11111111-1111-4111-8111-111111111111'
RESTAURANT = '22222222-2222-4222-8222-222222222222'
OTHER = '33333333-3333-4333-8333-333333333333'
TOKEN = '44444444-4444-4444-8444-444444444444'
PRIVATE = 'private-source-canary@example.invalid'


class Transport:
    def __init__(self):
        self.original = {'id': RESTAURANT, 'status': 'hold', 'channel_name': None,
                         'youtube_link': 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
                         'origin_name': 'synthetic business', 'tzuyang_review': PRIVATE,
                         'updated_at': 'synthetic timestamp', 'search_count': 0,
                         'lat': Decimal('37.1200')}
        self.meta = {'schemaVersion': 1, 'jobId': JOB, 'restaurantId': RESTAURANT,
                     'policyVersion': 2, 'rowSha256': worker.digest(self.original),
                     'inputSha256': worker.digest({k: v for k, v in self.original.items() if k not in worker.VOLATILE}),
                     'videoId': 'ABCDEFGHIJK', 'resultSha256': None, 'receipt': None,
                     'state': 'queued', 'reason': 'queued'}
        self.calls = []
        self.claim_transform = lambda response: response
        self.complete_mode = 'ok'

    def __call__(self, phase, job_id, token, result=None):
        self.calls.append((phase, job_id, token, copy.deepcopy(result)))
        if phase in {'read', 'next'}:
            return copy.deepcopy(self.meta)
        if phase == 'claim':
            self.meta.update(state='running', reason='claimed')
            return self.claim_transform({**copy.deepcopy(self.meta), 'restaurant': copy.deepcopy(self.original),
                                         'decisionContext': {'inputSha256': self.meta['inputSha256']}})
        if phase == 'complete':
            if self.complete_mode != 'unaccepted':
                self.meta.update(state='draft', reason='evidence_ready', resultSha256=worker.digest(result))
            if self.complete_mode == 'wrong_digest':
                self.meta['resultSha256'] = 'f' * 64
            if self.complete_mode in {'lost_ack', 'unaccepted'}:
                raise TimeoutError(PRIVATE)
            return copy.deepcopy(self.meta)
        if phase == 'fail':
            code = result['code']
            self.meta.update(state='failed' if code in worker.PREPAID_FAILURES else 'uncertain', reason=code)
            return copy.deepcopy(self.meta)
        raise AssertionError(phase)


def result(input_sha):
    return {'evaluation_results': {}, 'geocoding_success': False, 'categories': [],
            'gemini_decision': {'schemaVersion': 1, 'model': 'gemini-3.8-flash',
                               'modelVersion': 'gemini-3.8-flash', 'promptVersion': 'restaurant-review-v1',
                               'inputSha256': input_sha, 'promptSha256': 'a' * 64,
                               'recommendation': 'recheck', 'evidenceCodes': ['insufficient_evidence']}}


class RecoveryTests(unittest.TestCase):
    def test_other_registered_channels_cannot_select_or_claim_the_tzuyang_queue(self):
        for write in (False, True):
            for exact_job in (False, True):
                with self.subTest(write=write, exact_job=exact_job), \
                        patch.object(worker, 'review_target', return_value={'channel_id': 'synthetic'}) as registry:
                    options = dict(channel='meatcreator', state_dir=self.state, allow_worker_write=write)
                    with self.assertRaisesRegex(worker.RecoveryFailure, 'recovery_channel_unsupported'):
                        if exact_job:
                            worker.run_recovery(self.rpc, job_id=JOB, **options)
                        else:
                            worker.run_next_recovery(self.rpc, **options)
                    registry.assert_not_called()
                    self.assertEqual(self.rpc.calls, [])
                    self.assertEqual(self.rpc.meta['state'], 'queued')
                    self.assertFalse(self.state.exists())

    def test_unsupported_cli_channel_rejects_before_credentials_or_transport(self):
        for selection in (['--next'], ['--job-id', JOB]):
            output = io.StringIO()
            with self.subTest(selection=selection), \
                    patch.object(worker, 'resolve_privileged_supabase_rest_credentials') as credentials, \
                    patch.object(worker, 'RestTransport') as transport, contextlib.redirect_stdout(output):
                self.assertEqual(worker.main([*selection, '--channel', 'meatcreator', '--allow-worker-write']), 1)
            credentials.assert_not_called()
            transport.assert_not_called()
            value = json.loads(output.getvalue())
            self.assertEqual(value['code'], 'recovery_channel_unsupported')
            self.assertFalse(value['attempted'])
            self.assertFalse(value['paid_attempted'])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = self.root / 'state'
        self.rpc = Transport()
        self.paid_calls = 0
        self.evaluations = 0

    def command(self, argv, **kwargs):
        self.assertEqual(Path(argv[1]).name, 'review_decision_gemini.mjs')
        journal = (self.state / (JOB + '.jsonl')).read_text()
        self.assertIn('paid_intent', journal)
        self.assertEqual(kwargs['stdout'], subprocess.DEVNULL)
        self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
        self.assertLessEqual(kwargs['timeout'], 480)
        self.paid_calls += 1
        return subprocess.CompletedProcess(argv, 0)

    def evaluator(self, original, crawling_root, **kwargs):
        self.evaluations += 1
        self.assertEqual(kwargs['expected_channel'], 'tzuyang')
        self.assertIsNone(original['channel_name'])  # uploader proof remains evaluator-owned
        self.assertEqual(kwargs['decision_context']['inputSha256'], self.rpc.meta['inputSha256'])
        self.assertIn('evaluation_intent', (self.state / (JOB + '.jsonl')).read_text())
        kwargs['source_proof_sink']({'videoId': 'ABCDEFGHIJK', 'sha256': 'a' * 64})
        kwargs['run_command'](['node', 'review_decision_gemini.mjs'], timeout=480)
        return result(kwargs['decision_context']['inputSha256'])

    def run_worker(self, **kwargs):
        options = dict(job_id=JOB, channel='tzuyang', state_dir=self.state,
                       allow_worker_write=True, evaluator=self.evaluator,
                       privacy_validator=lambda value: None, run_command=self.command)
        options.update(kwargs)
        return worker.run_recovery(self.rpc, **options)

    def phases(self):
        return [call[0] for call in self.rpc.calls]

    def test_dry_read_only_no_state_no_evaluation(self):
        observed = self.run_worker(allow_worker_write=False)
        self.assertEqual(observed['code'], 'dry_run')
        self.assertEqual(observed['reserved_slots'], 0)
        self.assertFalse(observed['attempted'])
        self.assertEqual(self.phases(), ['read'])
        self.assertFalse(self.state.exists())
        self.assertEqual(self.evaluations, 0)

    def test_single_draft_and_private_durable_journal(self):
        observed = self.run_worker()
        self.assertEqual(observed['state'], 'draft')
        self.assertEqual(observed['reserved_slots'], 1)
        self.assertTrue(observed['attempted'])
        self.assertTrue(observed['paid_attempted'])
        self.assertFalse(observed['outstanding'])
        self.assertEqual(self.phases(), ['read', 'claim', 'complete'])
        self.assertEqual(self.paid_calls, 1)
        self.assertEqual(len({call[2] for call in self.rpc.calls}), 1)
        path = self.state / (JOB + '.jsonl')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        raw = path.read_text()
        self.assertNotIn(PRIVATE, raw + json.dumps(observed))
        self.assertNotIn(self.rpc.calls[0][2], json.dumps(observed))
        self.assertEqual(json.loads(raw.splitlines()[0])['stage'], 'intent')

    def test_existing_journal_never_replays_even_after_success(self):
        self.run_worker()
        before = len(self.rpc.calls)
        observed = self.run_worker()
        self.assertEqual(observed['code'], 'journal_exists_no_replay')
        self.assertEqual(observed['reserved_slots'], 1)
        self.assertTrue(observed['outstanding'])
        self.assertFalse(observed['attempted'])
        self.assertIsNone(observed['paid_attempted'])
        self.assertEqual(len(self.rpc.calls), before)
        self.assertEqual(self.paid_calls, 1)

    def test_dry_read_existing_uses_same_token(self):
        self.run_worker()
        token = self.rpc.calls[0][2]
        self.run_worker(allow_worker_write=False)
        self.assertEqual(self.rpc.calls[-1][:3], ('read', JOB, token))
        self.assertEqual(self.paid_calls, 1)

    def test_exclusive_intent_exists_before_read_and_claim(self):
        real = self.rpc
        def checked(*args):
            self.assertTrue((self.state / (JOB + '.jsonl')).is_file())
            if args[0] == 'claim':
                self.assertIn('claim_intent', (self.state / (JOB + '.jsonl')).read_text())
            return real(*args)
        self.rpc = checked
        self.run_worker(evaluator=lambda *a, **kw: result(real.meta['inputSha256']))

    def test_repeated_metadata_claim_never_evaluates(self):
        self.rpc.claim_transform = lambda value: {k: v for k, v in value.items() if k not in {'restaurant', 'decisionContext'}}
        self.assertEqual(self.run_worker()['state'], 'uncertain')
        self.assertEqual(self.phases(), ['read', 'claim'])
        self.assertEqual(self.evaluations, 0)

    def test_wrong_claim_bindings_block_before_evaluation(self):
        mutations = [lambda v: v.update(jobId=OTHER),
                     lambda v: v.update(restaurantId=OTHER),
                     lambda v: v['decisionContext'].update(inputSha256='b' * 64),
                     lambda v: v['restaurant'].update(tzuyang_review='tampered'),
                     lambda v: v['restaurant'].update(id=OTHER),
                     lambda v: v['restaurant'].update(channel_name='other'),
                     lambda v: v.update(inputSha256='c' * 64)]
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index):
                self.rpc = Transport()
                self.rpc.claim_transform = lambda v: (mutation(v), v)[1]
                observed = self.run_worker(state_dir=self.root / str(index))
                self.assertEqual(observed['state'], 'uncertain')
                self.assertEqual(self.phases(), ['read', 'claim'])
        self.assertEqual(self.evaluations, 0)

    def test_known_source_incomplete_is_failed_without_paid_call(self):
        def missing(*args, **kwargs):
            raise worker.WorkerFailure('source_original_evidence_missing')
        observed = self.run_worker(evaluator=missing)
        self.assertEqual((observed['state'], observed['code']), ('failed', 'source_incomplete'))
        self.assertEqual(self.rpc.calls[-1][3], {'code': 'source_incomplete'})
        self.assertEqual(self.paid_calls, 0)

    def test_source_code_after_paid_intent_is_uncertain(self):
        def after_paid(*args, **kwargs):
            kwargs['run_command'](['node', 'review_decision_gemini.mjs'])
            raise worker.WorkerFailure('source_provider_transient')
        observed = self.run_worker(evaluator=after_paid)
        self.assertEqual((observed['state'], observed['code']), ('uncertain', 'result_unconfirmed'))
        self.assertEqual(self.paid_calls, 1)

    def test_unknown_error_is_uncertain_and_never_logged(self):
        def unknown(*args, **kwargs):
            raise RuntimeError(PRIVATE)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            observed = self.run_worker(evaluator=unknown)
        self.assertEqual(observed['state'], 'uncertain')
        self.assertNotIn(PRIVATE, output.getvalue() + (self.state / (JOB + '.jsonl')).read_text())

    def test_second_paid_dispatch_blocked(self):
        def repeated(*args, **kwargs):
            kwargs['run_command'](['node', 'review_decision_gemini.mjs'])
            kwargs['run_command'](['node', 'review_decision_gemini.mjs'])
        self.assertEqual(self.run_worker(evaluator=repeated)['state'], 'uncertain')
        self.assertEqual(self.paid_calls, 1)

    def test_wrong_result_input_not_saved(self):
        self.assertEqual(self.run_worker(evaluator=lambda *a, **kw: result('f' * 64))['state'], 'uncertain')
        self.assertNotIn('complete', self.phases())

    def test_privacy_rejection_never_completes(self):
        def reject(value):
            raise worker.RecoveryFailure('privacy_rejected')
        self.assertEqual(self.run_worker(privacy_validator=reject)['state'], 'uncertain')
        self.assertNotIn('complete', self.phases())
        self.assertEqual(self.paid_calls, 1)

    def test_lost_complete_ack_reads_same_job_token_once(self):
        self.rpc.complete_mode = 'lost_ack'
        self.assertEqual(self.run_worker()['state'], 'draft')
        self.assertEqual(self.phases(), ['read', 'claim', 'complete', 'read'])
        self.assertEqual(len({call[2] for call in self.rpc.calls}), 1)
        self.assertEqual(self.paid_calls, 1)

    def test_unconfirmed_complete_never_sends_opposite_fail(self):
        self.rpc.complete_mode = 'unaccepted'
        observed = self.run_worker()
        self.assertEqual(observed['state'], 'uncertain')
        self.assertTrue(observed['outstanding'])
        self.assertEqual(observed['reserved_slots'], 1)
        self.assertEqual(self.phases(), ['read', 'claim', 'complete', 'read'])
        self.assertEqual(self.paid_calls, 1)

    def test_wrong_complete_digest_not_accepted(self):
        self.rpc.complete_mode = 'wrong_digest'
        self.assertEqual(self.run_worker()['state'], 'uncertain')
        self.assertEqual(self.phases(), ['read', 'claim', 'complete', 'read'])

    def test_claim_guard_unspent_terminal_metadata_no_evaluator(self):
        for reason in ['source_changed', 'policy_changed']:
            self.rpc = Transport()
            self.rpc.claim_transform = lambda v: {**v, 'state': 'failed', 'reason': reason}
            observed = self.run_worker(state_dir=self.root / reason)
            self.assertEqual((observed['state'], observed['code']), ('failed', reason))
        self.assertEqual(self.evaluations, 0)

    def test_running_is_not_reclaimed(self):
        self.rpc.meta.update(state='running', reason='claimed')
        self.assertEqual(self.run_worker()['code'], 'not_queued')
        self.assertEqual(self.phases(), ['read'])
        self.assertEqual(self.evaluations, 0)

    def test_next_dry_only_selects_and_empty_is_idle(self):
        observed = worker.run_next_recovery(self.rpc, channel='tzuyang', state_dir=self.state)
        self.assertEqual((observed['jobId'], observed['code']), (JOB, 'dry_run'))
        self.assertEqual(self.phases(), ['next'])
        self.assertFalse(self.state.exists())
        self.assertEqual(worker.run_next_recovery(lambda *a: None, channel='tzuyang', state_dir=self.state)['state'], 'idle')

    def test_next_write_freezes_selected_job_and_token(self):
        observed = worker.run_next_recovery(self.rpc, channel='tzuyang', state_dir=self.state,
                                           allow_worker_write=True, evaluator=self.evaluator,
                                           privacy_validator=lambda v: None, run_command=self.command)
        self.assertEqual(observed['state'], 'draft')
        self.assertEqual(self.phases(), ['next', 'read', 'claim', 'complete'])
        self.assertIsNone(self.rpc.calls[0][1])
        self.assertTrue(all(c[1] == JOB for c in self.rpc.calls[1:]))
        self.assertEqual(len({c[2] for c in self.rpc.calls}), 1)

    def test_next_does_not_admit_running_or_source_payload(self):
        for update in [{'state': 'running'}, {'restaurant': self.rpc.original}]:
            with self.assertRaises(worker.RecoveryFailure):
                worker.run_next_recovery(lambda *a: {**self.rpc.meta, **update}, channel='tzuyang', state_dir=self.state)

    def test_lost_claim_ack_is_not_compensated_or_evaluated(self):
        real = self.rpc
        def lost(*args):
            value = real(*args)
            if args[0] == 'claim':
                raise TimeoutError(PRIVATE)
            return value
        self.rpc = lost
        observed = self.run_worker()
        self.assertEqual(observed['state'], 'uncertain')
        self.assertTrue(observed['outstanding'])
        self.assertFalse(observed['attempted'])
        self.assertEqual([c[0] for c in real.calls], ['read', 'claim'])
        self.assertEqual(self.paid_calls, 0)

    def test_next_read_binding_change_prevents_claim(self):
        selected = copy.deepcopy(self.rpc.meta)
        selected['inputSha256'] = 'a' * 64
        observed = self.run_worker(selected=selected)
        self.assertEqual(observed['state'], 'uncertain')
        self.assertEqual(self.phases(), ['read'])
        self.assertEqual(self.evaluations, 0)

    def test_node24_missing_never_creates_journal_or_claims(self):
        observed = self.run_worker(privacy_validator=None,
                                  run_command=lambda *a, **k: subprocess.CompletedProcess(a, 1, b''))
        self.assertEqual(observed['code'], 'node24_required')
        self.assertFalse(self.state.exists())
        self.assertEqual(self.phases(), [])

    def test_journal_fsync_failure_prevents_claim(self):
        with patch.object(worker.os, 'fsync', side_effect=OSError(PRIVATE)):
            observed = self.run_worker()
        self.assertEqual(observed['code'], 'journal_invalid')
        self.assertEqual(self.phases(), [])
        self.assertEqual(self.evaluations, 0)
        self.assertNotIn(PRIVATE, json.dumps(observed))

    def test_truncated_journal_cannot_resume_or_dispatch(self):
        self.state.mkdir(mode=0o700)
        path = self.state / (JOB + '.jsonl')
        path.write_text('{"stage":"intent"'); path.chmod(0o600)
        self.assertEqual(self.run_worker()['code'], 'journal_exists_no_replay')
        with self.assertRaises(worker.RecoveryFailure):
            self.run_worker(allow_worker_write=False)
        self.assertEqual(self.phases(), [])

    def test_all_known_prepaid_codes_map_to_manifest_failed(self):
        for index, code in enumerate(worker.PREPAID_FAILURES - {'source_incomplete'}):
            self.rpc = Transport()
            def rejected(*args, **kwargs):
                raise worker.WorkerFailure(code)
            observed = self.run_worker(state_dir=self.root / str(index), evaluator=rejected)
            self.assertEqual(observed['state'], 'failed', code)
            self.assertEqual(observed['reserved_slots'], 1)
            self.assertFalse(observed['paid_attempted'])
        self.assertEqual(self.paid_calls, 0)

    def test_insecure_and_symlink_journals_rejected(self):
        self.run_worker()
        path = self.state / (JOB + '.jsonl')
        path.chmod(0o644)
        with self.assertRaises(worker.RecoveryFailure):
            self.run_worker(allow_worker_write=False)
        path.unlink()
        path.symlink_to(self.root / 'absent')
        with self.assertRaises(OSError):
            self.run_worker(allow_worker_write=False)


class ContractTests(unittest.TestCase):
    def test_jsonb_canonical_order_numeric_scale_and_unicode(self):
        value = worker.json_loads('{"aaa":1e2,"b":-0.00,"é":1.2300,"a":[true,null,"한글"]}')
        self.assertEqual(worker.jsonb_text(value), '{"a": [true, null, "한글"], "b": 0.00, "é": 1.2300, "aaa": 100}')
        self.assertEqual(worker.digest(value), worker.digest(worker.json_loads(worker.jsonb_text(value))))

    def test_duplicate_keys_nonfinite_and_unbounded_numbers_rejected(self):
        for raw in ['{"a":1,"a":2}', 'NaN', 'Infinity']:
            with self.assertRaises(worker.RecoveryFailure):
                worker.json_loads(raw)
        for value in [float('nan'), Decimal('1e1000000'), '\x00']:
            with self.assertRaises(worker.RecoveryFailure):
                worker.jsonb_text(value)

    def test_credentials_wrong_project_issuer_role_rejected(self):
        def credentials(**updates):
            claims = {'iss': 'supabase', 'ref': worker.PROJECT, 'role': 'service_role', **updates}
            token = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
            return SimpleNamespace(url=worker.ENDPOINT, service_role_key='header.' + token + '.signature')
        worker.validate_credentials(credentials())
        for updates in [{'iss': 'foreign'}, {'ref': 'wrong'}, {'role': 'anon'}]:
            with self.assertRaisesRegex(worker.RecoveryFailure, 'credentials_invalid'):
                worker.validate_credentials(credentials(**updates))
        item = credentials(); item.url = 'https://wrong.supabase.co'
        with self.assertRaises(worker.RecoveryFailure):
            worker.validate_credentials(item)

    def test_rpc_exact_args_size_timeout_and_no_diagnostics(self):
        transport = worker.RestTransport(SimpleNamespace(url=worker.ENDPOINT, service_role_key='sb_secret_fixture'))
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return worker.ENDPOINT + '/rest/v1/rpc/' + worker.RPC
            def read(self, size):
                self.size = size
                return b'null'
        def open_request(request, timeout):
            self.assertEqual(timeout, 20)
            self.assertEqual(json.loads(request.data), {'p_phase': 'next', 'p_job_id': None, 'p_token': TOKEN, 'p_result': {}})
            return Response()
        transport.opener = SimpleNamespace(open=open_request)
        self.assertIsNone(transport('next', None, TOKEN))
        transport.opener = SimpleNamespace(open=lambda *a, **k: (_ for _ in ()).throw(RuntimeError(PRIVATE)))
        with self.assertRaisesRegex(worker.RecoveryFailure, '^rpc_unconfirmed$'):
            transport('read', JOB, TOKEN)

    def test_redirect_rejected(self):
        with self.assertRaises(worker.RecoveryFailure):
            worker.NoRedirect().redirect_request(None, None, 302, None, None, 'https://wrong.invalid')

    def test_oversize_rpc_response_is_never_parsed_or_logged(self):
        transport = worker.RestTransport(SimpleNamespace(url=worker.ENDPOINT, service_role_key='sb_secret_fixture'))
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return worker.ENDPOINT + '/rest/v1/rpc/' + worker.RPC
            def read(self, size):
                self.requested_size = size
                return b'x' * size
        response = Response()
        transport.opener = SimpleNamespace(open=lambda *a, **k: response)
        with self.assertRaisesRegex(worker.RecoveryFailure, '^rpc_unconfirmed$'):
            transport('read', JOB, TOKEN)
        self.assertEqual(response.requested_size, worker.MAX_RESPONSE + 1)

    def test_cli_invalid_arguments_never_echo_values(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            status = worker.main(['--job-id', PRIVATE, '--channel', 'tzuyang'])
        self.assertEqual(status, 1)
        self.assertNotIn(PRIVATE, output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['code'], 'argument_invalid')

    def test_node_major_rejected_before_work(self):
        with self.assertRaisesRegex(worker.RecoveryFailure, 'node24_required'):
            worker.require_node24('node', lambda *a, **k: subprocess.CompletedProcess(a, 0, b'v26.0.0\n'))


if __name__ == '__main__':
    unittest.main()
