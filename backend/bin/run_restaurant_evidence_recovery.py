#!/usr/bin/env python3
"""One explicitly queued recovery, draft only. Existing journals are never replayed.

The worker RPC owns authorization and source/policy guards. This executable has
no restaurant writer, scheduling, queue creation, approval, or freeze controls.
Its default is metadata-only read. A journal contains only UUIDs, fixed stages,
channel identity and digests; originals/results stay in memory or evaluator scratch.
"""
from __future__ import annotations

import argparse
import base64
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.bin.run_restaurant_review_automation import (
    RESULT_FIELDS, SOURCE_FAILURE_CODES, WorkerFailure, evaluate,
    bounded_gemini_contract_outcome, manual_failure_reason, review_target, youtube_id,
)
from backend.utils.supabase_rest import resolve_privileged_supabase_rest_credentials

PROJECT = 'aqlcofblfxdrjhhdmarw'
ENDPOINT = f'https://{PROJECT}.supabase.co'
RPC = 'restaurant_evidence_recovery_worker'
MAX_RESPONSE = 262144
MAX_RESULT = 65536  # The central privacy boundary is tighter than SQL's 128 KiB.
MAX_JOURNAL = 16384
RPC_TIMEOUT = 20
SHA = re.compile(r'^[a-f0-9]{64}$')
PREPAID_FAILURES = SOURCE_FAILURE_CODES | {
    'source_unavailable', 'source_incomplete', 'gemini_configuration_invalid',
}
UNCERTAIN_FAILURES = {
    'evaluation_incomplete', 'result_invalid', 'evaluation_failed',
    'gemini_result_uncertain', 'gemini_decision_invalid',
    'gemini_decision_incomplete', 'worker_timeout', 'result_unconfirmed',
}
REASONS = PREPAID_FAILURES | UNCERTAIN_FAILURES | {
    'request_preview', 'queued', 'claimed', 'evidence_ready', 'evidence_applied',
    'source_changed', 'policy_changed',
}
STATES = {'preview', 'queued', 'running', 'draft', 'applied', 'failed', 'uncertain'}
BINDING = ('jobId', 'restaurantId', 'policyVersion', 'rowSha256', 'inputSha256', 'videoId')
VOLATILE = {'search_count', 'weekly_search_count', 'review_count', 'updated_at'}


class RecoveryFailure(Exception):
    """Only fixed internal codes may reach reports; exception messages never do."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def require(test, code='binding_invalid'):
    if not test:
        raise RecoveryFailure(code)


def recovery_target(channel):
    # This queue admits only tzuyang (including verified legacy null-channel
    # rows). General crawler registration is not recovery-queue admission.
    require(channel == 'tzuyang', 'recovery_channel_unsupported')
    return review_target(channel)


def canonical_uuid(value):
    try:
        require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'argument_invalid')
    except (ValueError, AttributeError):
        raise RecoveryFailure('argument_invalid') from None
    return value


def json_loads(value):
    def pairs(items):
        result = {}
        for key, item in items:
            require(key not in result, 'response_invalid')
            result[key] = item
        return result
    def invalid(_):
        raise RecoveryFailure('response_invalid')
    try:
        return json.loads(value, parse_float=Decimal, parse_constant=invalid, object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError):
        raise RecoveryFailure('response_invalid') from None


def jsonb_text(value, depth=0):
    """Postgres jsonb text for the bounded JSON domain, including numeric scale.

    RPC decoding retains Decimal lexemes. Wire results use this same serializer,
    so both original-input and completed-result digests bind the actual JSONB.
    Keys sort by UTF-8 byte length then bytes, not Python's lexicographic order.
    Unsupported/oversized numbers and Unicode fail closed, never guess a hash.
    """
    require(depth <= 32, 'response_invalid')
    if value is None:
        return 'null'
    if type(value) is bool:
        return 'true' if value else 'false'
    if isinstance(value, str):
        require('\x00' not in value, 'response_invalid')
        try:
            value.encode('utf8')
        except UnicodeError:
            raise RecoveryFailure('response_invalid') from None
        return json.dumps(value, ensure_ascii=False)
    if type(value) in (int, float, Decimal):
        number = Decimal(str(value))
        require(number.is_finite() and abs(number.adjusted()) <= 1000
                and abs(number.as_tuple().exponent) <= 1000, 'response_invalid')
        return format(number.copy_abs() if number.is_zero() else number, 'f')
    if isinstance(value, list):
        return '[' + ', '.join(jsonb_text(item, depth + 1) for item in value) + ']'
    require(isinstance(value, dict) and all(isinstance(k, str) for k in value), 'response_invalid')
    keys = sorted(value, key=lambda k: (len(k.encode('utf8')), k.encode('utf8')))
    return '{' + ', '.join(jsonb_text(k) + ': ' + jsonb_text(value[k], depth + 1) for k in keys) + '}'


def digest(value):
    return hashlib.sha256(jsonb_text(value).encode('utf8')).hexdigest()


def validate_credentials(credentials):
    require(credentials.url == ENDPOINT, 'credentials_invalid')
    key = credentials.service_role_key
    if key.startswith('sb_secret_'):
        # Opaque secrets are authenticated only by the exact TLS endpoint.
        return
    try:
        parts = key.split('.')
        require(len(parts) == 3, 'credentials_invalid')
        claims = json_loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
        require(isinstance(claims, dict) and claims.get('role') == 'service_role'
                and claims.get('ref') == PROJECT
                and claims.get('iss') in ('supabase', ENDPOINT + '/auth/v1'), 'credentials_invalid')
    except Exception:
        raise RecoveryFailure('credentials_invalid') from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RecoveryFailure('rpc_unconfirmed')


class RestTransport:
    def __init__(self, credentials):
        validate_credentials(credentials)
        self.credentials = credentials
        self.opener = build_opener(NoRedirect())

    def __call__(self, phase, job_id, token, result=None):
        require(phase in {'read', 'next', 'claim', 'complete', 'fail'}, 'argument_invalid')
        require((job_id is None) == (phase == 'next'), 'argument_invalid')
        if job_id is not None:
            canonical_uuid(job_id)
        canonical_uuid(token)
        body = jsonb_text({'p_phase': phase, 'p_job_id': job_id,
                          'p_token': token, 'p_result': {} if result is None else result}).encode('utf8')
        require(len(body) <= MAX_RESULT + 1024, 'result_invalid')
        request = Request(ENDPOINT + '/rest/v1/rpc/' + RPC, data=body, method='POST', headers={
            'apikey': self.credentials.service_role_key,
            'Authorization': 'Bearer ' + self.credentials.service_role_key,
            'Content-Type': 'application/json', 'Accept': 'application/json',
        })
        try:
            with self.opener.open(request, timeout=RPC_TIMEOUT) as response:
                require(response.status == 200 and response.geturl() == request.full_url, 'rpc_unconfirmed')
                raw = response.read(MAX_RESPONSE + 1)
            require(len(raw) <= MAX_RESPONSE, 'response_invalid')
            return json_loads(raw)
        except Exception:
            raise RecoveryFailure('rpc_unconfirmed') from None


def metadata(value, job_id, previous=None):
    require(isinstance(value, dict) and value.get('schemaVersion') == 1)
    require(value.get('jobId') == job_id)
    canonical_uuid(value.get('restaurantId'))
    require(value.get('state') in STATES and value.get('reason') in REASONS)
    require(type(value.get('policyVersion')) is int and value['policyVersion'] > 0)
    for key in ('rowSha256', 'inputSha256'):
        require(isinstance(value.get(key), str) and SHA.fullmatch(value[key]))
    require(isinstance(value.get('videoId'), str) and re.fullmatch(r'[A-Za-z0-9_-]{11}', value['videoId']))
    require(value.get('resultSha256') is None or
            isinstance(value['resultSha256'], str) and SHA.fullmatch(value['resultSha256']))
    if previous is not None:
        require(all(value.get(k) == previous[k] for k in BINDING))
    # Never return the source snapshot, receipt, or arbitrary server fields.
    return {k: value[k] for k in (*BINDING, 'state', 'reason', 'resultSha256')}


def claimed_original(value, selected, channel):
    current = metadata(value, selected['jobId'], selected)
    require(current['state'] == 'running' and current['reason'] == 'claimed')
    original = value.get('restaurant')
    context = value.get('decisionContext')
    require(isinstance(original, dict) and context == {'inputSha256': selected['inputSha256']})
    require(original.get('id') == selected['restaurantId'] and original.get('status') == 'hold')
    require(not original.get('created_by') and not original.get('updated_by_admin_id')
            and original.get('source_type') not in {'admin', 'manual', 'user'}
            and original.get('is_not_selected') is not True)
    require(youtube_id(original.get('youtube_link')) == selected['videoId'])
    require(original.get('channel_name') in (None, '', channel))
    require(digest(original) == selected['rowSha256'])
    require(digest({k: v for k, v in original.items() if k not in VOLATILE}) == selected['inputSha256'])
    # The authenticated JSONB hashes have been checked with exact decimal scale.
    # The existing evaluator consumes ordinary Python JSON types in a working copy.
    return json.loads(jsonb_text(original)), dict(context)


def private_directory(path, create=False):
    require(path.is_absolute() and path.resolve() == path, 'journal_invalid')
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'journal_invalid')


class Journal:
    def __init__(self, directory, job_id, channel, token):
        private_directory(directory, create=True)
        self.path = directory / (job_id + '.jsonl')
        try:
            self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            raise RecoveryFailure('journal_exists_no_replay') from None
        try:
            os.fchmod(self.fd, 0o600)
            self.append('intent', schemaVersion=1, jobId=job_id, channel=channel, token=token)
            directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except BaseException:
            self.close()
            raise

    def append(self, stage, **fields):
        data = (json.dumps({'stage': stage, **fields}, separators=(',', ':')) + '\n').encode()
        require(os.fstat(self.fd).st_size + len(data) <= MAX_JOURNAL, 'journal_invalid')
        # All callers supply only fixed enums, UUIDs or digests. No exception text.
        while data:
            written = os.write(self.fd, data)
            require(written > 0, 'journal_invalid')
            data = data[written:]
        os.fsync(self.fd)

    def close(self):
        os.close(self.fd)


def read_token(directory, job_id, channel):
    if not directory.exists():
        return str(uuid.uuid4())
    private_directory(directory)
    path = directory / (job_id + '.jsonl')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return str(uuid.uuid4())
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'journal_invalid')
        raw = stream.read(MAX_JOURNAL + 1)
    require(len(raw) <= MAX_JOURNAL and raw.endswith(b'\n'), 'journal_invalid')
    entries = [json_loads(line) for line in raw.splitlines()]
    header = entries[0]
    require(isinstance(header, dict) and set(header) == {'stage', 'schemaVersion', 'jobId', 'channel', 'token'}
            and header['stage'] == 'intent' and header['schemaVersion'] == 1
            and header['jobId'] == job_id and header['channel'] == channel, 'journal_invalid')
    return canonical_uuid(header['token'])


def privacy_check(result, node, run_command=subprocess.run):
    body = jsonb_text(result).encode('utf8')
    require(len(body) <= MAX_RESULT, 'result_invalid')
    try:
        process = run_command([node, '--no-warnings', str(ROOT / 'backend/bin/review_recovery_privacy.mjs')],
                              input=body, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=20, check=False, cwd=ROOT)
        require(process.returncode == 0 and process.stdout == b'PRIVACY_SAFE\n', 'privacy_rejected')
    except Exception:
        raise RecoveryFailure('privacy_rejected') from None


def require_node24(node, run_command=subprocess.run):
    try:
        process = run_command([node, '--version'], stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=10, check=False)
        require(process.returncode == 0 and re.fullmatch(rb'v24\.\d+\.\d+\n', process.stdout), 'node24_required')
    except Exception:
        raise RecoveryFailure('node24_required') from None


def result_binding(result, input_sha):
    require(isinstance(result, dict) and set(result) <= RESULT_FIELDS | {'gemini_decision'}
            and {'evaluation_results', 'geocoding_success', 'categories', 'gemini_decision'} <= set(result), 'result_invalid')
    decision = result.get('gemini_decision')
    require(isinstance(decision, dict) and decision.get('inputSha256') == input_sha, 'binding_invalid')
    require(len(jsonb_text(result).encode('utf8')) <= MAX_RESULT, 'result_invalid')


def report(job_id, state, code, *, attempted=False, outstanding=False,
           reserved_slots=0, paid_attempted=False, **digests):
    return {'schemaVersion': 1, 'jobId': job_id, 'state': state, 'code': code,
            'automaticRetryAllowed': False, 'attempted': attempted,
            'outstanding': outstanding, 'reserved_slots': reserved_slots,
            'paid_attempted': paid_attempted, **digests}


def run_recovery(transport, *, job_id, channel, state_dir, allow_worker_write=False,
                 crawling_root=None, node='node', evaluator=evaluate,
                 privacy_validator=None, run_command=subprocess.run,
                 selected=None, token=None, native_visual_packet=None):
    """Exact-job transport hook. Dependencies are injectable for offline tests.

    Existing journal: no write/claim/provider dispatch, even after known failure.
    A later explicit request must use its own server-authorized job identity.
    """
    canonical_uuid(job_id)
    recovery_target(channel)
    require(native_visual_packet is None or selected is None, 'argument_invalid')
    require(type(allow_worker_write) is bool, 'argument_invalid')
    state_dir = Path(state_dir)
    if not allow_worker_write:
        token = read_token(state_dir, job_id, channel)
        current = metadata(transport('read', job_id, token), job_id)
        return report(job_id, current['state'], 'dry_run', metadataSha256=digest(current))
    token = token or str(uuid.uuid4())
    canonical_uuid(token)
    # Reject a missing/wrong runtime while the job is still untouched. Do not
    # even probe a runtime when a prior journal already forbids dispatch.
    journal_path = state_dir / (job_id + '.jsonl')
    if privacy_validator is None and not (journal_path.exists() or journal_path.is_symlink()):
        try:
            require_node24(node, run_command)
        except RecoveryFailure:
            return report(job_id, 'blocked', 'node24_required', reserved_slots=1)
    native_current = None
    checked_packet = None
    if native_visual_packet is not None and not (journal_path.exists() or journal_path.is_symlink()):
        # A rejected local packet has no claim/provider effect. Leave this
        # queued job reusable after fixing that input, without spending its
        # exclusive journal. Existing journals still forbid every redispatch.
        from backend.bin.review_native_visual_packet import validate_packet
        try:
            native_current = metadata(transport('read', job_id, token), job_id)
            if native_current['state'] == 'queued':
                checked_packet = validate_packet(native_visual_packet,native_current,node=node)
        except Exception as error:
            code = manual_failure_reason(error)['code'] if isinstance(error, WorkerFailure) else 'result_unconfirmed'
            return report(job_id, 'blocked', code, reserved_slots=1)
    try:
        # Existing journal detection precedes even the local runtime probe.
        journal = Journal(state_dir, job_id, channel, token)
    except RecoveryFailure as error:
        return report(job_id, 'blocked', error.code, outstanding=True,
                      reserved_slots=1, paid_attempted=None)
    except OSError:
        return report(job_id, 'blocked', 'journal_invalid', outstanding=True,
                      reserved_slots=1, paid_attempted=None)
    paid_intent = False
    attempted = False
    complete_intent = False
    claim_validated = False
    current = None

    def finish(state, code, **digests):
        return report(job_id, state, code, attempted=attempted, paid_attempted=paid_intent,
                      reserved_slots=1, outstanding=state in {'running', 'uncertain'}, **digests)

    try:
        current = native_current if native_current is not None else metadata(transport('read', job_id, token), job_id, selected)
        if current['state'] != 'queued':
            journal.append('not_queued', metadataSha256=digest(current))
            return finish(current['state'], 'not_queued', metadataSha256=digest(current))
        if native_visual_packet is not None:
            journal.append('native_packet_preflight', packetSha256=checked_packet['packetSha256'])
        journal.append('claim_intent', metadataSha256=digest(current))
        claim = transport('claim', job_id, token)
        checked = metadata(claim, job_id, current)
        if checked['state'] == 'failed' and checked['reason'] in {'source_changed', 'policy_changed'}:
            journal.append('unspent_guard_rejected', metadataSha256=digest(checked))
            return finish('failed', checked['reason'], metadataSha256=digest(checked))
        original, context = claimed_original(claim, current, channel)
        claim_validated = True
        native_inputs = None
        if native_visual_packet is not None:
            native_inputs = validate_packet(native_visual_packet,current,original=claim['restaurant'],node=node)
            require(native_inputs.proof['packetSha256'] == checked_packet['packetSha256'])
        journal.append('evaluation_intent', inputSha256=current['inputSha256'])

        def guarded_command(command, **kwargs):
            nonlocal paid_intent
            if len(command) > 1 and Path(command[1]).name == 'review_decision_gemini.mjs':
                require(not paid_intent, 'provider_replay_blocked')
                if native_inputs is not None:
                    rechecked = validate_packet(native_visual_packet,current,original=claim['restaurant'],node=node)
                    require(digest(rechecked.proof) == digest(native_inputs.proof))
                journal.append('paid_intent')
                paid_intent = True
            if command and command[0] == 'node':
                command = [node, *command[1:]]
            # The existing evaluator supplies suppressed output and bounded waits.
            kwargs.update(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=min(kwargs.get('timeout', 480), 480))
            return run_command(command, **kwargs)

        def proof_sink(proof):
            journal.append('source_proof', sourceProofSha256=digest(proof))

        attempted = True
        native_options = {} if native_inputs is None else {'native_visual_inputs':native_inputs}
        result = evaluator(original, crawling_root or ROOT / 'backend/restaurant-crawling/data',
                           run_command=guarded_command, decision_context=context,
                           source_proof_sink=proof_sink, expected_channel=channel, **native_options)
        result_binding(result, current['inputSha256'])
        if privacy_validator is None:
            privacy_check(result, node)
        else:
            privacy_validator(result)
        expected_sha = digest(result)
        journal.append('complete_intent', resultSha256=expected_sha)
        complete_intent = True
        try:
            ack = metadata(transport('complete', job_id, token, result), job_id, current)
            require(ack['state'] in {'draft', 'applied'} and ack['resultSha256'] == expected_sha)
        except Exception:
            # Completion may have committed. Never send fail or repeat the model.
            journal.append('complete_ack_unknown', resultSha256=expected_sha)
            ack = metadata(transport('read', job_id, token), job_id, current)
            require(ack['state'] in {'draft', 'applied'} and ack['resultSha256'] == expected_sha)
        journal.append('draft_confirmed', resultSha256=expected_sha)
        return finish(ack['state'], 'draft_confirmed', resultSha256=expected_sha)
    except Exception as error:
        code = 'result_unconfirmed'
        if claim_validated and not complete_intent:
            candidate = manual_failure_reason(error)['code'] if isinstance(error, WorkerFailure) else 'result_unconfirmed'
            if not paid_intent and candidate in PREPAID_FAILURES:
                code = candidate
            elif candidate in UNCERTAIN_FAILURES:
                code = candidate
            # After paid intent, even a source-looking error is uncertain.
            try:
                subtype = bounded_gemini_contract_outcome(code, getattr(error, 'contract_outcome_subtype', None))
                if paid_intent and isinstance(error, WorkerFailure) and subtype is not None:
                    journal.append('judge_contract_outcome', subtype=subtype)
                journal.append('fail_intent', code=code)
                ack = metadata(transport('fail', job_id, token, {'code': code}), job_id, current)
                expected = 'failed' if code in PREPAID_FAILURES else 'uncertain'
                require(ack['state'] == expected and ack['reason'] == code)
                journal.append('failure_confirmed', code=code)
                return finish(expected, code)
            except Exception:
                pass
        journal.append('uncertain', code='result_unconfirmed')
        return finish('uncertain', 'result_unconfirmed')
    finally:
        journal.close()


def run_next_recovery(transport, *, channel, state_dir, allow_worker_write=False, **kwargs):
    """Read-select at most one queued job; freeze its ID before exact-job work.

    For the parent's existing worker hook only: this creates no schedule or job.
    The SQL `next` phase is read-only and excludes running/uncertain jobs.
    """
    require(kwargs.get('native_visual_packet') is None, 'argument_invalid')
    recovery_target(channel)
    require(type(allow_worker_write) is bool, 'argument_invalid')
    token = str(uuid.uuid4())
    value = transport('next', None, token)
    if value is None:
        return report(None, 'idle', 'queue_empty')
    require(isinstance(value, dict), 'binding_invalid')
    job_id = canonical_uuid(value.get('jobId'))
    selected = metadata(value, job_id)
    require(selected['state'] == 'queued', 'binding_invalid')
    require('restaurant' not in value and 'decisionContext' not in value, 'binding_invalid')
    if not allow_worker_write:
        return report(job_id, 'queued', 'dry_run', metadataSha256=digest(selected))
    return run_recovery(transport, job_id=job_id, channel=channel, state_dir=state_dir,
                        allow_worker_write=True, selected=selected, token=token, **kwargs)


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise RecoveryFailure('argument_invalid')


def main(argv=None):
    try:
        parser = SafeArgumentParser(description=__doc__)
        selection = parser.add_mutually_exclusive_group(required=True)
        selection.add_argument('--job-id')
        selection.add_argument('--next', action='store_true')
        parser.add_argument('--channel', required=True)
        parser.add_argument('--allow-worker-write', action='store_true')
        parser.add_argument('--state-dir', type=Path,
                            default=Path.home() / '.local/state/tzudong/evidence-recovery')
        parser.add_argument('--crawling-root', type=Path)
        parser.add_argument('--node', default=shutil.which('node') or 'node')
        parser.add_argument('--native-visual-packet', type=Path)
        args = parser.parse_args(argv)
        recovery_target(args.channel)
        require(args.native_visual_packet is None or args.job_id is not None, 'argument_invalid')
        if args.job_id is not None:
            canonical_uuid(args.job_id)
        transport = RestTransport(resolve_privileged_supabase_rest_credentials())
        options = dict(channel=args.channel, state_dir=args.state_dir,
                       allow_worker_write=args.allow_worker_write,
                       crawling_root=args.crawling_root, node=args.node)
        if args.native_visual_packet is not None:options['native_visual_packet'] = args.native_visual_packet
        result = (run_next_recovery(transport, **options) if args.next else
                  run_recovery(transport, job_id=args.job_id, **options))
    except RecoveryFailure as error:
        result = report(None, 'blocked', error.code)
    except Exception:
        result = report(None, 'blocked', 'configuration_or_local_state_invalid')
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['state'] in {'preview', 'queued', 'running', 'draft', 'applied', 'idle'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
