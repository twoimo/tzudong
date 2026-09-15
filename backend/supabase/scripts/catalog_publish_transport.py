"""Bounded transport for the three selected-catalog publication RPCs.

The operator must explicitly enable the apply capability after validating its
operation approval. There is no retry, arbitrary URL or generic RPC interface.
"""
from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib.request import Request, build_opener

import local_catalog_workspace as catalog

PREPARE = 'prepare_restaurant_catalog_publish'
APPLY = 'apply_restaurant_catalog_publish'
READBACK = 'readback_restaurant_catalog_publish'
MAX_BYTES = 128 * 1024
SQL_ERRORS = {
    '42501': 'publish_forbidden', '22023': 'publish_invalid',
    '40001': 'publish_conflict', '23505': 'publish_conflict',
    'P0002': 'publish_not_found', 'PGRST202': 'publish_unavailable',
    '42883': 'publish_unavailable',
}


class PublishRpcError(Exception):
    def __init__(self, code, *, outcome_unknown=False):
        super().__init__(code)
        self.code = code
        self.outcome_unknown = outcome_unknown


class HostedCatalogRpc:
    def __init__(self, key, *, allow_apply=False, opener=None):
        if not isinstance(key, str) or not key or '\n' in key or '\r' in key:
            raise PublishRpcError('publish_credentials_invalid')
        self._key = key
        self._allow_apply = allow_apply is True
        self._opener = opener if opener is not None else build_opener(catalog.NoRedirect)

    def call(self, name, args):
        if name not in {PREPARE, APPLY, READBACK}:
            raise PublishRpcError('publish_rpc_not_allowed')
        applying = name == APPLY
        if applying and not self._allow_apply:
            raise PublishRpcError('publish_apply_capability_required')
        if not isinstance(args, dict):
            raise PublishRpcError('publish_request_invalid')
        try:
            body = catalog.canonical(args)
        except (TypeError, ValueError):
            raise PublishRpcError('publish_request_invalid') from None
        if len(body) > MAX_BYTES:
            raise PublishRpcError('publish_request_too_large')
        request = Request(catalog.HOSTED_URL + '/rest/v1/rpc/' + name,
                          data=body, method='POST', headers={
                              'apikey': self._key, 'Authorization': 'Bearer ' + self._key,
                              'Content-Type': 'application/json', 'Accept': 'application/json',
                          })
        try:
            with self._opener.open(request, timeout=30) as response:
                payload = response.read(MAX_BYTES + 1)
                status = response.status
        except HTTPError as error:
            try:
                payload = error.read(MAX_BYTES + 1)
                value = json.loads(payload) if len(payload) <= MAX_BYTES else None
                sql_code = value.get('code') if isinstance(value, dict) else None
            except Exception:
                sql_code = None
            finally:
                error.close()
            if isinstance(sql_code, str) and sql_code in SQL_ERRORS and error.code in {400, 403, 404, 409}:
                raise PublishRpcError(SQL_ERRORS[sql_code]) from None
            if error.code in {401, 403}:
                raise PublishRpcError('publish_forbidden') from None
            raise PublishRpcError('publish_outcome_unknown' if applying else 'publish_unavailable',
                                  outcome_unknown=applying) from None
        except Exception:
            # A timeout or rejected redirect is not evidence that an apply failed.
            raise PublishRpcError('publish_outcome_unknown' if applying else 'publish_unavailable',
                                  outcome_unknown=applying) from None
        if status != 200 or len(payload) > MAX_BYTES:
            raise PublishRpcError('publish_outcome_unknown' if applying else 'publish_response_invalid',
                                  outcome_unknown=applying)
        try:
            value = json.loads(payload)
        except (ValueError, UnicodeError):
            raise PublishRpcError('publish_outcome_unknown' if applying else 'publish_response_invalid',
                                  outcome_unknown=applying) from None
        if not isinstance(value, dict):
            raise PublishRpcError('publish_outcome_unknown' if applying else 'publish_response_invalid',
                                  outcome_unknown=applying)
        return value
