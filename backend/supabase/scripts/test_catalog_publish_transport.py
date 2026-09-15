import io
import json
import unittest
from http.client import IncompleteRead
from urllib.error import HTTPError, URLError

import catalog_publish_transport as transport
import local_catalog_workspace as catalog


class Response:
    def __init__(self, body=b'{"ok":true}', status=200):
        self.body, self.status = body, status
    def read(self, limit): return self.body[:limit]
    def __enter__(self): return self
    def __exit__(self, *_): return False


class Opener:
    def __init__(self, result): self.result, self.calls = result, []
    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if isinstance(self.result, Exception): raise self.result
        return self.result


class PublishTransportTests(unittest.TestCase):
    def test_pins_rpc_url_and_uses_bounded_post_without_retry(self):
        opener = Opener(Response())
        rpc = transport.HostedCatalogRpc('injected-test-key', opener=opener)
        self.assertEqual(rpc.call(transport.PREPARE, {'p_actor': 'fixture'}), {'ok': True})
        request, timeout = opener.calls[0]
        self.assertEqual(request.full_url, catalog.HOSTED_URL + '/rest/v1/rpc/' + transport.PREPARE)
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'p_actor': 'fixture'})
        self.assertEqual(timeout, 30)
        self.assertEqual(len(opener.calls), 1)

    def test_apply_requires_explicit_capability_and_unknown_names_never_send(self):
        opener = Opener(Response())
        rpc = transport.HostedCatalogRpc('injected-test-key', opener=opener)
        for name in (transport.APPLY, '../other', 'https://example.com'):
            with self.assertRaises(transport.PublishRpcError): rpc.call(name, {})
        self.assertEqual(opener.calls, [])

    def test_timeout_retains_uncertainty_without_retry_or_diagnostics(self):
        opener = Opener(URLError('private provider diagnostics'))
        rpc = transport.HostedCatalogRpc('injected-test-key', allow_apply=True, opener=opener)
        with self.assertRaises(transport.PublishRpcError) as caught:
            rpc.call(transport.APPLY, {})
        self.assertTrue(caught.exception.outcome_unknown)
        self.assertEqual(str(caught.exception), 'publish_outcome_unknown')
        self.assertEqual(len(opener.calls), 1)

    def test_sql_conflicts_are_definite_rejections_without_raw_details(self):
        error = HTTPError('https://unretained.invalid', 409, 'private', {},
                          io.BytesIO(b'{"code":"40001","details":"private provider diagnostics"}'))
        rpc = transport.HostedCatalogRpc('injected-test-key', allow_apply=True, opener=Opener(error))
        with self.assertRaises(transport.PublishRpcError) as caught:
            rpc.call(transport.APPLY, {})
        self.assertFalse(caught.exception.outcome_unknown)
        self.assertEqual(str(caught.exception), 'publish_conflict')

    def test_malformed_or_oversized_apply_success_stays_unknown(self):
        for body in (b'[]', b'not json', b'x' * (transport.MAX_BYTES + 1)):
            rpc = transport.HostedCatalogRpc('injected-test-key', allow_apply=True, opener=Opener(Response(body)))
            with self.assertRaises(transport.PublishRpcError) as caught:
                rpc.call(transport.APPLY, {})
            self.assertTrue(caught.exception.outcome_unknown)

    def test_oversized_or_nonfinite_request_fails_before_transport(self):
        opener = Opener(Response())
        rpc = transport.HostedCatalogRpc('injected-test-key', opener=opener)
        for args in ({'value': float('nan')}, {'value': 'x' * transport.MAX_BYTES}):
            with self.assertRaises(transport.PublishRpcError): rpc.call(transport.PREPARE, args)
        self.assertEqual(opener.calls, [])

    def test_redirect_rejection_is_fixed_and_does_not_retry_apply(self):
        opener = Opener(catalog.CatalogError('source_redirect_denied'))
        rpc = transport.HostedCatalogRpc('injected-test-key', allow_apply=True, opener=opener)
        with self.assertRaises(transport.PublishRpcError) as caught:
            rpc.call(transport.APPLY, {})
        self.assertTrue(caught.exception.outcome_unknown)
        self.assertEqual(len(opener.calls), 1)

    def test_incomplete_response_and_malformed_error_code_remain_unknown(self):
        malformed = HTTPError('https://unretained.invalid', 500, 'private', {}, io.BytesIO(b'{"code":[]}'))
        for failure in (IncompleteRead(b'private partial data'), malformed):
            rpc = transport.HostedCatalogRpc('injected-test-key', allow_apply=True, opener=Opener(failure))
            with self.assertRaises(transport.PublishRpcError) as caught:
                rpc.call(transport.APPLY, {})
            self.assertTrue(caught.exception.outcome_unknown)
            self.assertEqual(str(caught.exception), 'publish_outcome_unknown')


if __name__ == '__main__':
    unittest.main()
