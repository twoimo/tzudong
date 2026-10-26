"""Offline discovery regressions; synthetic receipts do not prove hosted state."""
import copy
import io
import json
import traceback
import unittest
import uuid
from contextlib import redirect_stderr, redirect_stdout
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock, patch

from backend.supabase.scripts import hosted_pending_operation as op
from backend.supabase.scripts.hosted_data_plane import HostedDataPlaneError


REV = 'a' * 40
OLD_REV = 'b' * 40
RAW_SENTINEL = 'SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC'
OVERFLOW = {'code': '54000', 'message': 'PENDING_DISCOVERY_UNBOUNDED'}


def video(number):
    return f'video{number:06d}'


def operation(number, vid, **changes):
    rid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'offline-pending:{number}'))
    row = {'video': vid, 'identitySha': f'{number:064x}',
           'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'offline-row:{number}')),
           'action': 'present'}
    return {'requestId': rid, 'state': 'committed', 'replayAllowed': False,
            'sourceRevision': REV, 'bindingSha': 'c' * 64,
            'freshness': {'contract': 'local-pipeline-candidate-set-v1', 'complete': True,
                          'inputSha256': 'd' * 64, 'sourceSha256': 'e' * 64},
            'currentRows': [row], 'rows': [{**row, 'action': 'inserted'}],
            'currentSetPresent': True, 'originalRowsStillPresent': True, **changes}


class DiscoveryStore:
    """Model the RPC's operation-count ceiling, independently of video count."""
    def __init__(self, operations, holds=()):
        self.operations = copy.deepcopy(operations)
        self.holds = list(holds)
        self.calls = []
        self.counts = []

    def __call__(self, action, body):
        self.calls.append((action, copy.deepcopy(body)))
        group = body['video_ids']
        related = [item for item in self.operations
                   if any(row['video'] in group for row in item['currentRows'])]
        self.counts.append(len(related))
        if len(related) > 100:
            raise HostedDataPlaneError('pending_discovery_unbounded')
        return {'videos': group[:], 'operations': copy.deepcopy(related),
                'legacyHeld': [vid for vid in self.holds if vid in group],
                'replayAllowed': False}


class DiscoveryTests(unittest.TestCase):
    def observe(self, videos, transport):
        return op.observe_deliveries(videos, revision=REV, transport=transport)

    def assert_read_trace(self, calls, videos):
        unique = set(videos)
        groups = []
        for action, body in calls:
            self.assertEqual(action, 'read')
            self.assertEqual(set(body), {'video_ids'})
            group = body['video_ids']
            self.assertTrue(1 <= len(group) <= 100)
            self.assertEqual(group, sorted(set(group)))
            self.assertLessEqual(set(group), unique)
            groups.append(tuple(group))
        self.assertEqual(len(groups), len(set(groups)), 'a discovery group was retried')
        self.assertLessEqual(len(calls), 2 * len(unique) - 1 if unique else 0)

    def test_100_delivered_videos_plus_historical_operation_split_by_operation_count(self):
        videos = [video(i) for i in range(100)]
        records = [operation(i, vid) for i, vid in enumerate(videos)]
        records.append(operation(1000, videos[0], sourceRevision=OLD_REV))
        store = DiscoveryStore(records)
        result = self.observe(videos, store)
        self.assertEqual(result, {vid: {'state': 'delivered_snapshot', 'requestId': item['requestId']}
                                  for vid, item in zip(videos, records)})
        self.assertEqual([len(body['video_ids']) for _, body in store.calls], [100, 50, 50])
        self.assertEqual(sorted(store.counts), [50, 51, 101])
        self.assertEqual(store.operations, records)
        self.assert_read_trace(store.calls, videos)

    def test_singleton_overflow_preserves_successful_siblings_in_either_half(self):
        videos = [video(i) for i in range(8)]
        for blocked in (videos[0], videos[-1]):
            with self.subTest(blocked=blocked):
                records = [operation(i, vid) for i, vid in enumerate(videos)]
                records += [operation(1000 + i, blocked) for i in range(100)]
                store = DiscoveryStore(records)
                result = self.observe(videos, store)
                self.assertEqual(result[blocked], {'state': 'unconfirmed', 'requestId': None})
                for vid, item in zip(videos, records):
                    if vid != blocked:
                        self.assertEqual(result[vid], {'state': 'delivered_snapshot', 'requestId': item['requestId']})
                self.assertEqual(sum(body['video_ids'] == [blocked] for _, body in store.calls), 1)
                self.assert_read_trace(store.calls, videos)

    def test_worst_case_terminates_at_forest_bound_without_duplicate_requests(self):
        for count in (1, 3, 100, 205):
            with self.subTest(count=count):
                videos = [video(i) for i in range(count)]
                calls = []
                def overflow(action, body):
                    calls.append((action, copy.deepcopy(body)))
                    raise HostedDataPlaneError('pending_discovery_unbounded')
                result = self.observe(videos + videos[::-1], overflow)
                self.assertEqual(result, {vid: {'state': 'unconfirmed', 'requestId': None} for vid in videos})
                self.assertEqual(len(calls), 2 * count - (count + 99) // 100)
                self.assert_read_trace(calls, videos)

    def test_empty_and_deduplicated_multiple_batches_are_read_only(self):
        unused = Mock()
        self.assertEqual(self.observe([], unused), {})
        unused.assert_not_called()
        videos = [video(i) for i in range(205)]
        store = DiscoveryStore([operation(i, vid) for i, vid in enumerate(videos)])
        result = self.observe(videos[::-1] + videos[:100], store)
        self.assertEqual(len(result), 205)
        self.assertEqual({item['state'] for item in result.values()}, {'delivered_snapshot'})
        self.assertEqual([body['video_ids'] for _, body in store.calls],
                         [videos[:100], videos[100:200], videos[200:]])
        self.assert_read_trace(store.calls, videos)

    def test_state_folding_and_original_prepared_binding_survive_split(self):
        videos = [video(i) for i in range(10)]
        records = [operation(0, videos[0]), operation(1, videos[1], state='held'),
                   operation(2, videos[2], state='claimed'),
                   operation(3, videos[3], originalRowsStillPresent=False),
                   operation(4, videos[4], sourceRevision=OLD_REV),
                   operation(5, videos[5], state='prepared', rows=None),
                   operation(6, videos[6], state='prepared', rows=None, sourceRevision=OLD_REV),
                   operation(7, videos[7]), operation(9, videos[9], state='prepared', rows=None),
                   operation(10, videos[9], state='prepared', rows=None)]
        records += [operation(1000 + i, videos[i % 8], sourceRevision=OLD_REV) for i in range(96)]
        store = DiscoveryStore(records, holds=[videos[7]])
        result = self.observe(videos, store)
        states = ['delivered_snapshot', 'held', 'held', 'unconfirmed', 'source_changed',
                  'prepared', 'held', 'legacy_held', 'legacy_unresolved', 'held']
        self.assertEqual([result[vid]['state'] for vid in videos], states)
        self.assertEqual(result[videos[5]], {'state': 'prepared', 'requestId': records[5]['requestId'],
                                            'bindingSha': records[5]['bindingSha']})
        self.assertEqual(result[videos[6]]['requestId'], records[6]['requestId'])
        self.assertEqual(len(store.calls), 3)
        self.assert_read_trace(store.calls, videos)

    def test_malformed_child_cannot_partially_certify_or_erase_valid_sibling(self):
        videos = [video(i) for i in range(4)]
        records = [operation(i, vid) for i, vid in enumerate(videos)]
        records += [operation(1000 + i, videos[i % 4]) for i in range(100)]
        invalid = [None, {'videos': videos[2:3]}, {'replayAllowed': True},
                   {'legacyHeld': None}, {'legacyHeld': [video(999)]}, {'operations': None}]
        for changes in ({'requestId': 'invalid'}, {'state': 'unknown'}, {'replayAllowed': True},
                        {'currentRows': []}, {'currentRows': [None]},
                        {'currentRows': [{'video': video(999)}]},
                        {'state': 'prepared', 'freshness': {}},
                        {'state': 'prepared', 'bindingSha': 'invalid'}):
            invalid.append({'operations': [records[2], {**records[3], **changes}]})
        invalid.append({'operations': [records[2], None]})
        invalid.append({'operations': [records[2]] * 101})
        for number, bad in enumerate(invalid):
            with self.subTest(case=number):
                store = DiscoveryStore(records)
                def transport(action, body):
                    value = store(action, body)
                    if body['video_ids'] == videos[2:]:
                        return None if bad is None else {**value, **copy.deepcopy(bad)}
                    return value
                result = self.observe(videos, transport)
                self.assertEqual([result[vid]['state'] for vid in videos],
                                 ['delivered_snapshot'] * 2 + ['unconfirmed'] * 2)
                self.assertEqual(len(store.calls), 3)
                self.assert_read_trace(store.calls, videos)

    def test_arbitrary_failures_never_trigger_bisection(self):
        videos = [video(i) for i in range(4)]
        failures = [TimeoutError(RAW_SENTINEL), RuntimeError('pending_discovery_unbounded'),
                    HostedDataPlaneError('pending_transport_failed'),
                    HostedDataPlaneError('pending_discovery_invalid'),
                    HostedDataPlaneError('pending_discovery_unbounded ')]
        for error in failures:
            with self.subTest(error_type=type(error).__name__, code=str(error)[:32]):
                transport = Mock(side_effect=error)
                result = self.observe(videos, transport)
                self.assertEqual(result, {vid: {'state': 'unconfirmed', 'requestId': None} for vid in videos})
                transport.assert_called_once_with('read', {'video_ids': videos})
                self.assertNotIn(RAW_SENTINEL, repr(result))


class ErrorBody(io.BytesIO):
    def __init__(self, raw):
        super().__init__(raw)
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        return super().read(size)


class TransportTests(unittest.TestCase):
    observe = DiscoveryTests.observe
    assert_read_trace = DiscoveryTests.assert_read_trace

    def assert_transport_error(self, raw, expected, action='read', body=None):
        body = {'video_ids': [video(0), video(1)]} if body is None else body
        stream = ErrorBody(raw)
        error = HTTPError('https://offline.invalid/rpc', 500, RAW_SENTINEL, {}, stream)
        client = Mock()
        client.open.side_effect = error
        output = io.StringIO()
        with patch.object(op, 'build_opener', return_value=client), redirect_stdout(output), redirect_stderr(output):
            with self.assertRaises(HostedDataPlaneError) as raised:
                op.rpc_transport(action, body, service_role_key='synthetic-offline')
        self.assertEqual(str(raised.exception), expected)
        visible = ''.join(traceback.format_exception(raised.exception)) + output.getvalue()
        self.assertNotIn(RAW_SENTINEL, visible)
        self.assertNotIn('PENDING_DISCOVERY_UNBOUNDED', str(raised.exception))
        client.open.assert_called_once()
        for size in stream.read_sizes:
            self.assertTrue(0 < size <= 262145, 'HTTP error must be read with a bounded size')
        return stream

    def test_exact_http_overflow_is_classified_without_provider_diagnostics(self):
        raw = json.dumps({**OVERFLOW, 'details': RAW_SENTINEL, 'hint': RAW_SENTINEL}).encode()
        stream = self.assert_transport_error(raw, 'pending_discovery_unbounded')
        self.assertTrue(stream.read_sizes)
        self.assert_transport_error(raw, 'pending_discovery_unbounded',
                                    body={'video_ids': [video(0)], 'request_id': None})

    def test_unknown_malformed_and_oversized_http_errors_are_sanitized_and_do_not_split(self):
        cases = [{'code': '54001', 'message': OVERFLOW['message']},
                 {'code': 54000, 'message': OVERFLOW['message']},
                 {'code': '54000', 'message': OVERFLOW['message'] + ' '},
                 {'code': '54000', 'message': RAW_SENTINEL},
                 {'message': OVERFLOW['message']}, [OVERFLOW], None,
                 {**OVERFLOW, 'details': RAW_SENTINEL + 'x' * 262145}]
        raw_cases = [json.dumps(value).encode() for value in cases]
        raw_cases += [b'{"code":"54000",', b'\xff' + RAW_SENTINEL.encode(),
                      json.dumps(OVERFLOW).encode() + RAW_SENTINEL.encode()]
        for number, raw in enumerate(raw_cases):
            with self.subTest(case=number):
                self.assert_transport_error(raw, 'pending_transport_failed')
                client = Mock()
                client.open.side_effect = lambda *args, **kwargs: self.raise_http(raw)
                with patch.object(op, 'build_opener', return_value=client):
                    result = self.observe([video(0), video(1)], self.real_transport)
                self.assertEqual(result, {video(i): {'state': 'unconfirmed', 'requestId': None} for i in range(2)})
                self.assertNotIn(RAW_SENTINEL, repr(result))
                client.open.assert_called_once()

    @staticmethod
    def raise_http(raw):
        raise HTTPError('https://offline.invalid/rpc', 500, RAW_SENTINEL, {}, ErrorBody(raw))

    @staticmethod
    def real_transport(action, body):
        return op.rpc_transport(action, body, service_role_key='synthetic-offline')

    def test_write_and_request_id_http_errors_never_become_discovery_overflow(self):
        raw = json.dumps({**OVERFLOW, 'details': RAW_SENTINEL}).encode()
        rid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'offline-request'))
        cases = [(action, {'video_ids': [video(0)], 'request_id': rid})
                 for action in ('prepare', 'claim', 'apply')]
        cases += [('read', {'request_id': rid}),
                  ('read', {'request_id': rid, 'video_ids': [video(0)]})]
        for action, body in cases:
            with self.subTest(action=action, discovery='video_ids' in body):
                self.assert_transport_error(raw, 'pending_transport_failed', action, body)

    def test_real_rpc_transport_recovers_101_operations_with_only_get_requests(self):
        videos = [video(i) for i in range(100)]
        store = DiscoveryStore([operation(i, vid) for i, vid in enumerate(videos)] +
                               [operation(1000, videos[0], sourceRevision=OLD_REV)])
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            query = parse_qs(urlsplit(request.full_url).query)
            group = query['video_ids'][0][1:-1].split(',')
            try:
                value = store('read', {'video_ids': group})
            except HostedDataPlaneError:
                self.raise_http(json.dumps({**OVERFLOW, 'details': RAW_SENTINEL}).encode())
            return io.BytesIO(json.dumps(value).encode())
        client = Mock()
        client.open.side_effect = open_request
        with patch.object(op, 'build_opener', return_value=client):
            result = self.observe(videos, self.real_transport)
        self.assertEqual({value['state'] for value in result.values()}, {'delivered_snapshot'})
        self.assertEqual(len(result), 100)
        self.assertEqual(len(requests), 3)
        for request in requests:
            self.assertEqual(request.method, 'GET')
            self.assertIsNone(request.data)
            self.assertTrue(urlsplit(request.full_url).path.endswith('/hosted_pending_read'))
            self.assertEqual(set(parse_qs(urlsplit(request.full_url).query)), {'video_ids'})
        self.assert_read_trace(store.calls, videos)


if __name__ == '__main__':
    unittest.main()
