import copy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from backend.bin import run_restaurant_review_automation as worker
from backend.bin import review_recheck_meta as adapter


VIDEO = 'ABCDEFGHIJK'
LINK = 'https://www.youtube.com/watch?v=' + VIDEO
CHANNEL_ID = worker.review_target('tzuyang')['channel_id']


def original():
    return {'channel_name': 'tzuyang', 'youtube_link': LINK, 'origin_name': 'fixture restaurant',
            'reasoning_basis': 'original supported basis', 'tzuyang_review': 'original review',
            'origin_address': {'address': 'synthetic public business address'},
            'youtube_meta': {}, 'recollect_version': {}}


def meta(**updates):
    return {'youtube_link': LINK, 'channel_name': 'tzuyang', 'channel_id': CHANNEL_ID,
            'title': 'verified fixture title', 'recollect_id': 0, **updates}


def write_record(root, directory, record):
    path = root / directory / (VIDEO + '.jsonl')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record) + '\n')
    return path


class ReviewInputRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.corpus = self.root / 'corpus'
        self.scratch = self.root / 'scratch'
        self.scratch.mkdir(mode=0o700)
        self.transcript = {'youtube_link': LINK, 'channel_name': 'tzuyang', 'recollect_id': 0,
                           'transcript': [{'start': 0, 'text': 'fixture evidence'}]}
        write_record(self.corpus / 'tzuyang', 'transcript', self.transcript)

    def snapshot(self):
        return {str(p.relative_to(self.corpus)): p.read_bytes() for p in self.corpus.rglob('*') if p.is_file()}

    def prepare(self, row, command):
        return worker.prepare_review_inputs(row, self.corpus, self.scratch, run_command=command)

    def test_missing_meta_hydrates_exact_video_without_mutating_corpus_or_original(self):
        row = original(); before = copy.deepcopy(row); corpus = self.snapshot(); calls = []
        def command(argv, **kwargs):
            calls.append(argv)
            self.assertEqual(Path(argv[1]).name, 'review_recheck_meta.py')
            self.assertEqual(argv[2:], ['tzuyang', VIDEO, str(self.scratch)])
            self.assertEqual(kwargs['timeout'], 480)
            write_record(self.scratch, 'meta', meta())
            return subprocess.CompletedProcess(argv, 0)
        prepared = self.prepare(row, command)
        self.assertEqual({key:prepared[key] for key in ('channel','videoId','crawlingPath')},
                         {'channel': 'tzuyang', 'videoId': VIDEO, 'crawlingPath': self.scratch})
        proof=prepared['sourceProof']
        self.assertTrue(proof['metadataUploaderVerified'])
        self.assertEqual(proof['channelBinding'],'original_registered_channel')
        self.assertEqual({item['kind'] for item in proof['sources']},{'crawling','meta','transcript'})
        for item in proof['sources']:
            self.assertRegex(item['sha256'],r'^[a-f0-9]{64}$')
        serialized=json.dumps(proof)
        self.assertLess(len(serialized),2048)
        for private in [str(self.scratch),row['reasoning_basis'],row['tzuyang_review'],self.transcript['transcript'][0]['text']]:
            self.assertNotIn(private,serialized)
        self.assertEqual(len(calls), 1)
        self.assertEqual(row, before); self.assertEqual(self.snapshot(), corpus)
        crawl = worker.last_record(self.scratch / 'crawling' / (VIDEO + '.jsonl'))
        self.assertEqual(crawl['restaurants'][0]['reasoning_basis'], row['reasoning_basis'])

    def test_stored_meta_and_cached_transcript_need_no_provider(self):
        row = original(); row['youtube_meta'] = {'title': 'original title'}
        prepared=self.prepare(row, lambda *a, **k: self.fail('unexpected provider call'))
        self.assertFalse(prepared['sourceProof']['metadataUploaderVerified'])
        self.assertEqual(next(item['source'] for item in prepared['sourceProof']['sources'] if item['kind']=='meta'),
                         'stored_original_metadata')
        self.assertEqual(worker.last_record(self.scratch / 'meta' / (VIDEO + '.jsonl'))['title'], 'original title')

    def test_legacy_metadata_alias_is_normalized_only_in_scratch_before_transcript_repair(self):
        source=write_record(self.corpus / 'tzuyang', 'meta', {
            'youtube_link': 'https://youtu.be/' + VIDEO, 'title': 'original title', 'recollect_id': 0})
        before=source.read_bytes()
        (self.corpus / 'tzuyang/transcript' / (VIDEO + '.jsonl')).unlink()
        calls=[]
        def command(argv, **kwargs):
            calls.append(argv)
            self.assertEqual(Path(argv[1]).name, 'review_recheck_transcript.mjs')
            stored=worker.last_record(self.scratch / 'meta' / (VIDEO + '.jsonl'))
            self.assertEqual(stored['youtube_link'], LINK); self.assertEqual(stored['channel_name'], 'tzuyang')
            write_record(self.scratch, 'transcript', self.transcript)
            return subprocess.CompletedProcess(argv, 0)
        self.prepare(original(), command)
        self.assertEqual(len(calls), 1); self.assertEqual(source.read_bytes(), before)

    def test_missing_basis_or_unverified_channel_never_starts_provider(self):
        for field, value, code in [('reasoning_basis', None, 'source_original_evidence_missing'),
                                   ('channel_name', None, 'source_channel_unverified'),
                                   ('channel_name', 'unknown', 'source_channel_unverified')]:
            row = original(); row[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(worker.WorkerFailure) as raised:
                self.prepare(row, lambda *a, **k: self.fail('unexpected provider call'))
            self.assertEqual(raised.exception.code, code)
            self.assertEqual(list(self.scratch.iterdir()), [])

    def test_null_channel_needs_explicit_claim_and_fresh_uploader_verification(self):
        row=original();row['channel_name']=None;before=copy.deepcopy(row);calls=[]
        def command(argv, **kwargs):
            calls.append(argv)
            self.assertEqual(Path(argv[1]).name,'review_recheck_meta.py')
            self.assertEqual(argv[2:4],['tzuyang',VIDEO])
            write_record(self.scratch,'meta',meta())
            return subprocess.CompletedProcess(argv,0)
        prepared=worker.prepare_review_inputs(row,self.corpus,self.scratch,run_command=command,expected_channel='tzuyang')
        self.assertEqual(len(calls),1);self.assertEqual(row,before)
        self.assertEqual(prepared['sourceProof']['channelBinding'],'verified_metadata_for_claim_channel')
        self.assertTrue(prepared['sourceProof']['metadataUploaderVerified'])
        self.assertEqual(worker.last_record(self.scratch/'crawling'/(VIDEO+'.jsonl'))['channel_name'],'tzuyang')

    def test_expected_channel_is_not_proof_and_never_overrides_a_known_channel(self):
        row=original();row['channel_name']=None;calls=[]
        def command(argv, **kwargs):
            calls.append(argv);write_record(self.scratch,'meta',meta(channel_id='UC'+'x'*22))
            return subprocess.CompletedProcess(argv,0)
        with self.assertRaises(worker.WorkerFailure) as raised:
            worker.prepare_review_inputs(row,self.corpus,self.scratch,run_command=command,expected_channel='tzuyang')
        self.assertEqual(raised.exception.code,'source_identity_mismatch');self.assertIsNone(row['channel_name'])
        self.assertEqual(len(calls),1)
        with self.assertRaises(worker.WorkerFailure) as raised:
            worker.prepare_review_inputs(original(),self.corpus,self.scratch,run_command=command,expected_channel='other')
        self.assertEqual(raised.exception.code,'source_identity_mismatch');self.assertEqual(len(calls),1)

    def test_channel_proof_does_not_manufacture_missing_original_basis(self):
        row=original();row['channel_name']=None;row['reasoning_basis']=None
        with self.assertRaises(worker.WorkerFailure) as raised:
            worker.prepare_review_inputs(row,self.corpus,self.scratch,expected_channel='tzuyang',
                run_command=lambda *a,**k:self.fail('provider called despite missing extraction'))
        self.assertEqual(worker.manual_failure_reason(raised.exception),{
            'code':'source_incomplete','sourceCode':'source_original_evidence_missing',
            'automaticRetryAllowed':False,'removalEligible':False})

    def test_failure_mapping_is_bounded_and_does_not_authorize_replay_or_removal(self):
        for code in [*worker.SOURCE_FAILURE_CODES,'gemini_result_uncertain','result_unconfirmed','private provider diagnostic']:
            reason=worker.manual_failure_reason(code)
            self.assertFalse(reason['automaticRetryAllowed']);self.assertFalse(reason['removalEligible'])
            self.assertNotIn('private',json.dumps(reason))
        self.assertEqual(worker.manual_failure_reason('source_local_missing')['code'],'source_incomplete')
        self.assertEqual(worker.manual_failure_reason(RuntimeError('private detail'))['code'],'result_unconfirmed')

    def test_existing_cache_identity_and_recollect_mismatch_are_not_repaired(self):
        for record, code in [(meta(youtube_link='https://youtu.be/ZZZZZZZZZZZ'), 'source_identity_mismatch'),
                             (meta(recollect_id=7), 'source_recollect_mismatch')]:
            path = write_record(self.corpus / 'tzuyang', 'meta', record); before = path.read_bytes()
            row = original(); row['recollect_version'] = {'meta': 0}
            with self.subTest(code=code), self.assertRaises(worker.WorkerFailure) as raised:
                self.prepare(row, lambda *a, **k: self.fail('unexpected provider call'))
            self.assertEqual(raised.exception.code, code); self.assertEqual(path.read_bytes(), before)

    def test_fresh_metadata_keeps_local_version_separate_from_claim_reference(self):
        row = original(); row['recollect_version'] = {'meta': 9}; calls = []
        def command(argv, **kwargs):
            calls.append(argv); write_record(self.scratch, 'meta', meta())
            return subprocess.CompletedProcess(argv, 0)
        before=copy.deepcopy(row); corpus=self.snapshot()
        proof=self.prepare(row,command)['sourceProof']
        self.assertEqual(len(calls), 1)
        self.assertEqual(worker.last_record(self.scratch / 'meta' / (VIDEO + '.jsonl'))['recollect_id'], 0)
        self.assertEqual(proof['claimRecollectReferences'], {'meta':9})
        packet=next(item for item in proof['sources'] if item['kind']=='meta')
        self.assertEqual(packet['versionBinding'],'fresh_local_packet')
        self.assertEqual(packet['recollectId'],0)
        self.assertEqual(packet['recollectVersion'],{})
        self.assertIsNotNone(datetime.fromisoformat(packet['acquiredAt']).tzinfo)
        self.assertEqual(row,before);self.assertEqual(self.snapshot(),corpus)

    def test_old_meta_and_transcript_claims_accept_fresh_zero_without_restamping(self):
        (self.corpus/'tzuyang/transcript'/(VIDEO+'.jsonl')).unlink()
        row=original();row['recollect_version']={'meta':2,'transcript':7}
        before=copy.deepcopy(row);corpus=self.snapshot();calls=[];written={}
        def command(argv,**kwargs):
            name=Path(argv[1]).name;calls.append(name)
            directory='meta' if name=='review_recheck_meta.py' else 'transcript'
            packet=meta() if directory=='meta' else {**self.transcript,'recollect_version':{'meta':0}}
            path=write_record(self.scratch,directory,packet);written[directory]=path.read_bytes()
            return subprocess.CompletedProcess(argv,0)
        proof=self.prepare(row,command)['sourceProof']
        self.assertEqual(calls,['review_recheck_meta.py','review_recheck_transcript.mjs'])
        self.assertEqual(proof['claimRecollectReferences'],{'meta':2,'transcript':7})
        for directory in ('meta','transcript'):
            packet=next(item for item in proof['sources'] if item['kind']==directory)
            self.assertEqual(packet['versionBinding'],'fresh_local_packet')
            self.assertEqual(packet['recollectId'],0)
            self.assertEqual(packet['sha256'],hashlib.sha256(written[directory]).hexdigest())
            self.assertEqual((self.scratch/directory/(VIDEO+'.jsonl')).read_bytes(),written[directory])
            self.assertIsNotNone(datetime.fromisoformat(packet['acquiredAt']).tzinfo)
        self.assertEqual(next(item['recollectVersion'] for item in proof['sources'] if item['kind']=='transcript'),{'meta':0})
        stored=worker.last_record(self.scratch/'crawling'/(VIDEO+'.jsonl'))
        self.assertEqual(stored['recollect_version'],before['recollect_version'])
        self.assertEqual(row,before);self.assertEqual(self.snapshot(),corpus)

    def test_matching_cached_meta_and_fresh_transcript_have_separate_version_bindings(self):
        (self.corpus/'tzuyang/transcript'/(VIDEO+'.jsonl')).unlink()
        write_record(self.corpus/'tzuyang','meta',meta(recollect_id=2))
        row=original();row['recollect_version']={'meta':2,'transcript':7}
        before=copy.deepcopy(row);corpus=self.snapshot()
        def command(argv,**kwargs):
            self.assertEqual(Path(argv[1]).name,'review_recheck_transcript.mjs')
            # Existing collector uses the actual local metadata packet's version.
            write_record(self.scratch,'transcript',{**self.transcript,'recollect_id':2})
            return subprocess.CompletedProcess(argv,0)
        proof=self.prepare(row,command)['sourceProof']
        packets={p['kind']:p for p in proof['sources']}
        self.assertEqual(packets['meta']['versionBinding'],'claim_references')
        self.assertNotIn('acquiredAt',packets['meta'])
        self.assertEqual(packets['transcript']['versionBinding'],'fresh_local_packet')
        self.assertEqual(packets['transcript']['recollectId'],2)
        self.assertEqual(row,before);self.assertEqual(self.snapshot(),corpus)

    def test_existing_zero_cache_cannot_claim_fresh_provenance_to_bypass_old_reference(self):
        for directory in ('meta','transcript'):
            row=original();row['recollect_version']={directory:2}
            record=meta() if directory=='meta' else self.transcript
            path=write_record(self.corpus/'tzuyang',directory,{**record,'source':'single_video_metadata_fetch',
                'versionBinding':'fresh_local_packet','acquiredAt':'2026-11-04T00:00:00Z'})
            before=path.read_bytes()
            with self.subTest(directory=directory),self.assertRaises(worker.WorkerFailure) as raised:
                self.prepare(row,lambda *a,**k:self.fail('existing mismatched cache must not fetch'))
            self.assertEqual(raised.exception.code,'source_recollect_mismatch')
            self.assertEqual(path.read_bytes(),before)
            if directory=='meta':path.unlink()

    def test_malformed_claim_references_fail_before_any_adapter(self):
        for references in (False,0,'',[],{'meta':True},{'transcript':-1},{'meta':'2'}):
            row=original();row['recollect_version']=references
            with self.subTest(references=references),self.assertRaises(worker.WorkerFailure) as raised:
                self.prepare(row,lambda *a,**k:self.fail('malformed original references fetched'))
            self.assertEqual(raised.exception.code,'source_input_invalid')
            self.assertEqual(list(self.scratch.iterdir()),[])

    def test_fresh_adapter_output_still_requires_identity_and_valid_local_versions(self):
        updates=[({'youtube_link':'https://youtu.be/ZZZZZZZZZZZ'},'source_identity_mismatch'),
                 ({'channel_name':None},'source_identity_mismatch'),
                 ({'channel_id':'UC'+'x'*22},'source_identity_mismatch'),
                 ({'recollect_id':True},'source_input_invalid'),
                 ({'recollect_id':None},'source_input_invalid'),
                 ({'recollect_id':-1},'source_input_invalid'),
                 ({'recollect_version':[]},'source_input_invalid'),
                 ({'recollect_version':{'meta':'2'}},'source_input_invalid')]
        row=original();row['recollect_version']={'meta':2}
        for index,(update,code) in enumerate(updates):
            scratch=self.root/f'fresh-{index}';scratch.mkdir(mode=0o700)
            def command(argv,**kwargs):
                write_record(scratch,'meta',meta(**update))
                return subprocess.CompletedProcess(argv,0)
            with self.subTest(update=update),self.assertRaises(worker.WorkerFailure) as raised:
                worker.prepare_review_inputs(row,self.corpus,scratch,run_command=command)
            self.assertEqual(raised.exception.code,code)

    def test_fresh_metadata_bytes_cannot_change_between_fetch_and_final_proof(self):
        (self.corpus/'tzuyang/transcript'/(VIDEO+'.jsonl')).unlink()
        row=original();row['recollect_version']={'meta':2,'transcript':7}
        def command(argv,**kwargs):
            if Path(argv[1]).name=='review_recheck_meta.py':write_record(self.scratch,'meta',meta())
            else:
                write_record(self.scratch,'transcript',self.transcript)
                write_record(self.scratch,'meta',meta(recollect_id=2))
            return subprocess.CompletedProcess(argv,0)
        with self.assertRaises(worker.WorkerFailure) as raised:self.prepare(row,command)
        self.assertEqual(raised.exception.code,'source_input_invalid')

    def test_null_channel_old_metadata_reference_accepts_verified_fresh_local_packet(self):
        row=original();row['channel_name']=None;row['recollect_version']={'meta':2}
        before=copy.deepcopy(row)
        def command(argv,**kwargs):
            write_record(self.scratch,'meta',meta())
            return subprocess.CompletedProcess(argv,0)
        proof=worker.prepare_review_inputs(row,self.corpus,self.scratch,run_command=command,expected_channel='tzuyang')['sourceProof']
        self.assertTrue(proof['metadataUploaderVerified'])
        self.assertEqual(proof['channelBinding'],'verified_metadata_for_claim_channel')
        self.assertEqual(proof['claimRecollectReferences'],{'meta':2})
        self.assertEqual(row,before)

    def test_success_exit_still_requires_verified_uploader_and_output(self):
        def command(argv, **kwargs):
            write_record(self.scratch, 'meta', meta(channel_id='UC' + 'x' * 22))
            return subprocess.CompletedProcess(argv, 0)
        with self.assertRaises(worker.WorkerFailure) as raised: self.prepare(original(), command)
        self.assertEqual(raised.exception.code, 'source_identity_mismatch')

    def test_adapter_failures_and_timeout_are_bounded_and_never_retried(self):
        for exit_code, code in worker.SOURCE_ADAPTER_EXITS.items():
            command = Mock(return_value=subprocess.CompletedProcess(['fixture'], exit_code))
            with self.subTest(exit_code=exit_code), self.assertRaises(worker.WorkerFailure) as raised:
                worker.run_source_adapter(['fixture'], command)
            self.assertEqual(raised.exception.code, code); self.assertEqual(command.call_count, 1)
        command = Mock(side_effect=subprocess.TimeoutExpired('private command', 480))
        with self.assertRaises(worker.WorkerFailure) as raised: worker.run_source_adapter(['fixture'], command)
        self.assertEqual(str(raised.exception), 'source_provider_transient'); self.assertEqual(command.call_count, 1)

    def test_missing_local_input_is_distinct_from_unrecoverable_evidence(self):
        with self.assertRaises(worker.WorkerFailure) as raised: worker.last_record(self.root / 'missing.jsonl')
        self.assertEqual(raised.exception.code, 'source_local_missing')

    def test_scratch_must_be_empty_private_canonical_and_owned(self):
        self.scratch.chmod(0o755)
        with self.assertRaises(worker.WorkerFailure) as raised:
            self.prepare(original(), lambda *a, **k: self.fail('unexpected provider call'))
        self.assertEqual(raised.exception.code, 'source_input_invalid')
        self.scratch.chmod(0o700)
        (self.scratch / 'existing').write_text('preserve')
        with self.assertRaises(worker.WorkerFailure): self.prepare(original(), lambda *a, **k: self.fail('provider'))
        self.assertEqual((self.scratch / 'existing').read_text(), 'preserve')

    def test_new_source_codes_keep_legacy_pending_rpc_vocabulary(self):
        for code in worker.SOURCE_FAILURE_CODES:
            calls = []
            def rpc(name, body):
                calls.append((name, body))
                if name.endswith('_status'):
                    return {'judgmentEngine': {'provider': 'gemini', 'model': 'gemini-3.8-flash',
                        'promptVersion': 'restaurant-review-v1', 'requiredForApproval': True, 'maxCallsPerClaim': 1}}
                if name.endswith('_tick'): return {'approved': 0}
                if body['action'] == 'claim': return {'id': 'fixture', 'restaurant': {}}
                self.assertEqual(body['action'], 'fail'); self.assertEqual(body['result'], {'code': 'source_unavailable'})
                return {'state': 'failed'}
            def evaluator(*a, **k): raise worker.WorkerFailure(code)
            with self.subTest(code=code):
                result = worker.run_once(rpc, recheck_limit=1, evaluator=evaluator)
                self.assertEqual(result['sourceFailureCode'], code)
                self.assertEqual(len(calls), 4)

    def test_meta_adapter_passes_only_one_video_and_owned_path_to_existing_collector(self):
        collector = Mock(); collector.get_latest_meta.return_value = meta()
        collector.get_channel_info.return_value = {'channel_id': CHANNEL_ID}
        self.assertEqual(adapter.repair_metadata('tzuyang', VIDEO, self.scratch, collector=collector), 0)
        self.assertEqual(collector.collect_channel_meta.call_count, 1)
        args = collector.collect_channel_meta.call_args
        self.assertEqual(args.kwargs, {'video_id': VIDEO, 'review_data_path': self.scratch})
        self.assertEqual(adapter.repair_metadata(None, VIDEO, self.scratch, collector=collector), 24)
        self.assertEqual(collector.collect_channel_meta.call_count, 1)


if __name__ == '__main__': unittest.main()
