"""Owned PG15/17 runtime regression; never connects to a pre-existing database.

The inherited original 44 cases remain unchanged. This component runs exact
runtime fragments, not successful full-G014 admission; the full migration
correctly rejects this deliberately incomplete catalog before changing it.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import tempfile
import uuid
import unittest

from backend.supabase.tests import test_atomic_edit_submission_pg as original

CORRECTION = original.ROOT / 'backend/supabase/migrations/20261026130000_atomic_edit_public_business_phone.sql'
PHONE = '+886 2 2766 8876'


def owned_database(major, native, directory):
    """Journal exact ownership before creation; all child calls remain real."""
    db = original.OwnedDatabase(major, pg17=native)
    db.root.rmdir()  # Only the empty directory this constructor just created.
    root = directory / (f'owned-pg{major}-' + uuid.uuid4().hex[:12])
    root.mkdir(mode=0o700)
    db.root = root
    # macOS sockaddr_un cannot contain the long private pgdata path. Only this
    # owned socket directory is short; the data directory remains under auth-p0.
    socket_directory = Path(tempfile.mkdtemp(prefix='aeph-sock-')) if major == 17 else None
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    receipt = {'owner': 'atomic-edit-phone-component', 'major': major,
               'root': str(root), 'port': port, 'listen': 'unix-socket-only',
               'freeLoopbackPortChecked': True, 'state': 'intent',
               'originalOrV86DatabaseAccessed': False}
    if socket_directory:
        receipt['socketDirectory'] = str(socket_directory)
    journal = directory / (root.name + '-owner.json')
    journal.write_text(json.dumps(receipt, indent=2) + '\n'); journal.chmod(0o600)
    real_run = original.run

    def recorded_run(argv, **kwargs):
        args = list(argv)
        if args[:2] == ['docker', 'run']:
            name = args[args.index('--name') + 1]
            args[2:2] = ['--label', 'tzudong.atomic-edit-phone-owner=' + root.name]
            receipt.update(containerName=name, ownerLabel=root.name,
                           preExistingContainerIds=sorted(db.before))
            journal.write_text(json.dumps(receipt, indent=2) + '\n')
            args[-1] = args[-1].replace(' -p 55432 ', f' -p {port} ')
        elif args and Path(args[0]).name == 'initdb':
            receipt.update(pgdata=str(root / 'data'), binaryDirectory=str(native))
            journal.write_text(json.dumps(receipt, indent=2) + '\n')
        elif args and Path(args[0]).name == 'pg_ctl' and '-o' in args:
            i = args.index('-o') + 1
            args[i] = args[i].replace(' -p 55432 ', f' -p {port} ')
            args[i] = args[i].replace(str(root / 'socket'), str(socket_directory))
            db.sock = socket_directory
        for i in range(len(args) - 1):
            if args[i:i + 2] == ['-p', '55432']:
                args[i + 1] = str(port)
        result = real_run(args, **kwargs)
        if args[:2] == ['docker', 'run'] and result.returncode == 0:
            receipt.update(containerId=result.stdout.decode().strip(), state='created')
            journal.write_text(json.dumps(receipt, indent=2) + '\n')
        return result

    old_close = db.close

    def close():
        old_close()
        if socket_directory:
            socket_directory.rmdir()
        receipt.update(state='cleaned', preExistingContainerIdsPreserved=True)
        journal.write_text(json.dumps(receipt, indent=2) + '\n')

    db.close = close
    try:
        original.run = recorded_run
        db.start()
        db.base = [str(port) if value == '55432' else value for value in db.base]
        receipt.update(state='ready', pid=db.pid, serverVersion=db.version)
        journal.write_text(json.dumps(receipt, indent=2) + '\n')
    except BaseException:
        # No alternate backend, permission retry, or unrelated cleanup.
        db.close()
        raise
    finally:
        original.run = real_run
    return db


def core(source, corrected=False):
    start = source.index(('CREATE OR REPLACE' if corrected else 'CREATE') + ' FUNCTION pipeline_control.submit_restaurant_edit_request')
    return source[start:source.index('END $edit_request$;', start) + len('END $edit_request$;')]


def body_hash(source):
    return hashlib.sha256(re.search(r'AS \$edit_request\$(.*?)\$edit_request\$;', source, re.S)[1].encode()).hexdigest()


class PhoneCases(original.AtomicEditCases):
    @classmethod
    def setUpClass(cls):
        evidence = os.environ.get('TZUDONG_ATOMIC_EDIT_PHONE_EVIDENCE_DIR')
        if not evidence:
            raise unittest.SkipTest('explicit task-owned evidence directory required before resource creation')
        directory = Path(evidence).resolve(strict=True)
        allowed = Path('/Users/twoimo/.local/state/tzudong-unified-20261025/auth-p0').resolve()
        if not directory.is_relative_to(allowed):
            raise RuntimeError('TASK_EVIDENCE_DIRECTORY_DENIED')
        native = original.discover_native_pg17() if cls.MAJOR == 17 else None
        cls.db = owned_database(cls.MAJOR, native, directory)
        cls.addClassCleanup(cls.db.close)
        cls.source_hash = hashlib.sha256(original.CANDIDATE.read_bytes()).hexdigest()
        cls.correction_hash = hashlib.sha256(CORRECTION.read_bytes()).hexdigest()
        cls.old_core = core(original.CANDIDATE.read_text()).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
        cls.new_core = core(CORRECTION.read_text(), corrected=True)
        cls.db.sql("ALTER TABLE public.restaurants ADD COLUMN phone text; ALTER TABLE public.restaurants ADD COLUMN status text DEFAULT 'approved'; ALTER TABLE public.restaurants OWNER TO postgres;")
        old = cls.db.json("SELECT to_jsonb(encode(sha256(convert_to(prosrc,'UTF8')),'hex')) FROM pg_proc WHERE oid='pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'::regprocedure;")
        try:
            cls.db.sql('BEGIN;\n' + CORRECTION.read_text() + '\nCOMMIT;', actor='postgres')
        except original.SqlFailure as error:
            if error.code != '55000':
                raise
        else:
            raise RuntimeError('INCOMPLETE_COMPONENT_CATALOG_WAS_ADMITTED')
        observed = cls.db.json("SELECT to_jsonb(encode(sha256(convert_to(prosrc,'UTF8')),'hex')) FROM pg_proc WHERE oid='pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'::regprocedure;")
        if observed != old:
            raise RuntimeError('REJECTED_INSTALL_CHANGED_RUNTIME')
        cls.db.sql('BEGIN;\n' + cls.new_core + '\nCOMMIT;', actor='postgres')
        evidence = os.environ.get('TZUDONG_ATOMIC_EDIT_PHONE_EVIDENCE_DIR')
        if evidence:
            directory = Path(evidence).resolve(strict=True)
            allowed = Path('/Users/twoimo/.local/state/tzudong-unified-20261025/auth-p0').resolve()
            if not directory.is_relative_to(allowed):
                raise RuntimeError('TASK_EVIDENCE_DIRECTORY_DENIED')
            query = (allowed / 'edit-footprint-query-v88.sql').read_text()
            metadata = cls.db.json("BEGIN READ ONLY; SET LOCAL search_path='';\n" + query + '\nROLLBACK;', actor='postgres')
            (directory / f'phone-footprint-pg{cls.MAJOR}.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
            (directory / f'phone-pg{cls.MAJOR}-scope.json').write_text(json.dumps({
                'serverVersion': cls.db.version, 'originalMigrationSha256': cls.source_hash,
                'correctionMigrationSha256': cls.correction_hash, 'coreProsrcSha256': body_hash(cls.new_core),
                'scope': 'exact runtime/registration component; not full G014 baseline',
                'fullCorrectionOnIncompleteCatalog': 'rejected_55000_runtime_unchanged',
                'metadataQuerySha256': hashlib.sha256(query.encode()).hexdigest(),
                'readOnly': True, 'searchPath': '', 'operatingExecutionVerified': False,
            }, indent=2) + '\n')

    @classmethod
    def tearDownClass(cls):
        if cls.correction_hash != hashlib.sha256(CORRECTION.read_bytes()).hexdigest():
            raise RuntimeError('CORRECTION_CHANGED_DURING_COMPONENT_TEST')
        super().tearDownClass()

    def public_phone(self, value=PHONE, target=original.TARGET, status='approved'):
        self.db.sql('UPDATE public.restaurants SET phone=' + original.literal(value)
                    + ',status=' + original.literal(status) + ' WHERE id=' + original.literal(target))

    def international(self):
        p = self.payload()
        p['phone'] = PHONE
        return p

    def test_international_existing_business_phone_accepts_edit_and_closure(self):
        self.public_phone()
        for kind in ('edit', 'closure'):
            p = self.international(); p['requestKind'] = kind
            if kind == 'closure':
                p.update(name='', address='', category=[])
            result = self.call(p, key='edit-phone-' + kind)
            self.assertTrue(result['ok'])
            self.assertEqual(result['itemCount'], 2)
            self.assertEqual(self.call(p, key='edit-phone-' + kind), result)
        self.assertEqual(self.counts(), [2, 4, 2])

    def test_normalization_matches_but_preserves_trimmed_display_and_payload_identity(self):
        self.public_phone()
        p = self.international(); p['phone'] = '  +886(2)2766-8876  '
        result = self.call(p)
        self.assertTrue(result['ok'])
        self.assertEqual(self.db.json('SELECT to_jsonb(restaurant_phone) FROM public.restaurant_submissions;'), '+886(2)2766-8876')
        self.assertEqual(self.call(p), result)
        p['phone'] = PHONE
        self.failure(self.call(p), 'EDIT_SUBMISSION_CONFLICT')

    def test_committed_retry_survives_public_phone_change_but_new_key_is_rejected(self):
        self.public_phone()
        p = self.international(); result = self.call(p)
        self.assertTrue(result['ok'])
        self.public_phone('+886 2 9999 9999', status='pending')
        self.assertEqual(self.call(p), result)
        self.failure(self.call(p, key='edit-new-key-mismatch'), 'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_fresh_mismatched_international_never_writes_three_tables(self):
        for source in (None, '+886 2 9999 9999', '886227668876', '+886 2 extension 2766'):
            self.public_phone(source)
            self.failure(self.call(self.international()), 'EDIT_SUBMISSION_INVALID')
            self.assertEqual(self.counts(), [0, 0, 0])

    def test_existing_public_display_format_uses_the_same_digits_and_plus_normalizer(self):
        self.public_phone('Tel: +886\u00a02 2766-8876')
        self.assertTrue(self.call(self.international())['ok'])

    def test_only_main_approved_target_can_provide_business_provenance(self):
        self.public_phone(PHONE, target=original.SIBLING)
        self.failure(self.call(self.international()), 'EDIT_SUBMISSION_INVALID')
        self.public_phone(PHONE, status='pending')
        self.failure(self.call(self.international()), 'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(), [0, 0, 0])

    def test_korean_mobile_and_plus82_mobile_stay_invalid_even_when_public(self):
        for phone in ('010-1234-5678', '+82 10 1234 5678', '+82 70 1234 5678', '+82 2 123'):
            self.public_phone(phone)
            p = self.payload(); p['phone'] = phone
            self.failure(self.call(p), 'EDIT_SUBMISSION_INVALID')
            self.assertEqual(self.counts(), [0, 0, 0])

    def test_plus82_landline_still_requires_exact_normalized_public_number(self):
        self.public_phone('+82 2 1234 5678')
        p = self.payload(); p['phone'] = '+82(2)1234-5678'
        self.assertTrue(self.call(p)['ok'])
        self.public_phone('02-1234-5678')
        self.failure(self.call(p, key='edit-plus82-no-inference'), 'EDIT_SUBMISSION_INVALID')

    def test_non_ascii_extra_plus_and_out_of_bounds_international_are_invalid(self):
        for phone in ('+８８６ 2 2766 8876', '+886\u00a02 2766 8876', '++886227668876', '+886+227668876', '+01234567', '+123456', '+1234567890123456', PHONE + ' ext.12'):
            self.public_phone(phone)
            p = self.payload(); p['phone'] = phone
            self.failure(self.call(p), 'EDIT_SUBMISSION_INVALID')
            self.assertEqual(self.counts(), [0, 0, 0])

    def test_original_korean_binding_reconciles_across_actual_runtime_upgrade(self):
        self.db.sql(self.old_core, actor='postgres')
        try:
            result = self.call()
        finally:
            self.db.sql(self.new_core, actor='postgres')
        self.assertTrue(result['ok'])
        self.assertEqual(self.call(), result)
        self.assertEqual(self.counts(), [1, 2, 1])


class PublicBusinessPhonePG15(PhoneCases, unittest.TestCase):
    MAJOR = 15


class PublicBusinessPhonePG17(PhoneCases, unittest.TestCase):
    MAJOR = 17


if __name__ == '__main__':
    unittest.main()
