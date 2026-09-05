"""Bounded, read-only catalog observation. Never certifies release or legal state."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

SQL_PATH = Path(__file__).with_suffix('.sql')
REPOSITORY_ROOT = SQL_PATH.resolve().parents[3]
EXECUTOR_BYTES = Path(__file__).read_bytes()
PROJECT_REF = 'aqlcofblfxdrjhhdmarw'
DIRECT_HOST = f'db.{PROJECT_REF}.supabase.co'
AUDIT_CLASSES = frozenset({'privacy_identity_audit','privacy_marketing_audit',
    'privacy_account_deletion_audit','privacy_incident_audit','privacy_retention_run_audit',
    'notifications_operational'})
RELATIONS = frozenset({'privacy_policy_versions','privacy_retention_classes','privacy_audit_events'})


class ObservationError(ValueError):
    pass


def require(ok):
    if not ok:
        raise ObservationError('release_observation_invalid')


def keys(value, expected):
    require(type(value) is dict and set(value) == set(expected))


def timestamp(value):
    require(type(value) is str and len(value) <= 40)
    try:
        require(datetime.fromisoformat(value.replace('Z','+00:00')).utcoffset() is not None)
    except (ValueError, TypeError):
        raise ObservationError('release_observation_invalid') from None


def validate(value):
    keys(value, ['schemaVersion','observedAt','transactionReadOnly','ledger','policy',
                 'retention','privateRelations','unvalidatedPublicConstraints','mutablePublicFunctionPaths'])
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1)
    timestamp(value['observedAt'])
    require(value['transactionReadOnly'] is True)
    keys(value['ledger'], ['count','terminalVersion'])
    require(type(value['ledger']['count']) is int and 0 <= value['ledger']['count'] <= 10000)
    terminal = value['ledger']['terminalVersion']
    require((terminal is None and value['ledger']['count']==0) or
            (value['ledger']['count']>0 and type(terminal) is str and re.fullmatch(r'[0-9]{8,14}',terminal) is not None))
    policy = value['policy']
    if policy is not None:
        keys(policy, ['version','locale','status','content_sha256','effective_at','published_at','approval_reference_present'])
        require(type(policy['version']) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',policy['version']) is not None)
        require(policy['locale']=='ko-KR' and policy['status']=='published')
        require(type(policy['content_sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',policy['content_sha256']) is not None)
        timestamp(policy['effective_at']); timestamp(policy['published_at'])
        require(type(policy['approval_reference_present']) is bool)
    rows = value['retention']
    require(type(rows) is list and len(rows)==len(AUDIT_CLASSES))
    seen=set()
    for row in rows:
        keys(row,['code','present','configured'])
        require(type(row['code']) is str and row['code'] in AUDIT_CLASSES and row['code'] not in seen)
        seen.add(row['code'])
        require(type(row['present']) is bool and type(row['configured']) is bool)
        require(not row['configured'] or row['present'])
    rows=value['privateRelations']
    require(type(rows) is list and len(rows)<=len(RELATIONS))
    seen=set()
    for row in rows:
        keys(row,['name','rls','forceRls'])
        require(type(row['name']) is str and row['name'] in RELATIONS and row['name'] not in seen)
        seen.add(row['name'])
        require(type(row['rls']) is bool and type(row['forceRls']) is bool)
    for name in ['unvalidatedPublicConstraints','mutablePublicFunctionPaths']:
        require(type(value[name]) is int and 0 <= value[name] <= 100000)
    return value


@contextmanager
def _owned_connection(connection):
    try:
        yield
    except ObservationError:
        raise
    except Exception:
        raise ObservationError('release_observation_unavailable') from None
    finally:
        try:
            try:
                connection.rollback()
            finally:
                connection.close()
        except Exception:
            raise ObservationError('release_observation_cleanup_failed') from None


def _observe(connection, sql):
    with connection.cursor() as cursor:
        cursor.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        cursor.execute(sql.decode('utf-8'))
        row=cursor.fetchone()
        require(row is not None and len(row)==1)
        return validate(row[0])


def collect(connection):
    """Unbound metadata only; local observations are never production receipts."""
    with _owned_connection(connection):
        return _observe(connection, SQL_PATH.read_bytes())


def _verified_target(connection):
    # Only the direct endpoint has a project-specific TLS hostname. Poolers and
    # caller labels are not admitted as interchangeable target identities.
    info = connection.info
    parameters = info.get_parameters()
    if not (info.host == DIRECT_HOST and info.dbname == 'postgres'
            and info.port == 5432 and info.status == 0
            and parameters.get('sslmode') == 'verify-full'
            and connection.pgconn.ssl_in_use is True):
        raise ObservationError('release_observation_target_unverified')
    return {'kind':'direct_postgres_tls','projectRef':PROJECT_REF,
            'host':DIRECT_HOST,'database':'postgres','port':5432,
            'tlsHostnameVerified':True}


def _reviewed_sql(source_sha):
    require(type(source_sha) is str and re.fullmatch('[a-f0-9]{40}',source_sha) is not None)
    sql = SQL_PATH.read_bytes()
    try:
        def git(*args):
            return subprocess.check_output(
                ['git','--no-replace-objects','-C',str(REPOSITORY_ROOT),*args],
                stderr=subprocess.DEVNULL, timeout=10)
        if git('cat-file','-t',source_sha).strip() != b'commit':
            raise ValueError()
        for name, current in [('release_readiness_observation.sql',sql),
                              ('release_readiness_observation.py',EXECUTOR_BYTES)]:
            ref = f'{source_sha}:backend/supabase/scripts/{name}'
            size = int(git('cat-file','-s',ref))
            if size != len(current) or size > 65536:
                raise ValueError()
            if git('cat-file','blob',ref) != current:
                raise ValueError()
    except Exception:
        raise ObservationError('release_observation_source_unverified') from None
    return sql


def receipt(connection, *, source_sha):
    """Collect and bind one verified connection and committed SQL/executor pair.

    A raw observation or caller-supplied project label cannot issue a receipt.
    No connection strings, role names, credentials, or TLS file paths are retained.
    """
    with _owned_connection(connection):
        target = _verified_target(connection)
        sql = _reviewed_sql(source_sha)
        observation = _observe(connection, sql)
        # Bind the endpoint before and after the snapshot on the same connection.
        require(_verified_target(connection) == target)
        body={'schemaVersion':2,'kind':'release_readiness_observation',
              'projectRef':target['projectRef'],'targetIdentity':target,
              'sourceSha':source_sha,'sqlSha256':hashlib.sha256(sql).hexdigest(),
              'executorSha256':hashlib.sha256(EXECUTOR_BYTES).hexdigest(),
              'observation':observation,'releaseApprovalEstablished':False,
              'legalReviewEstablished':False,'backupPitrEstablished':False}
        body['receiptSha256']=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
        return body
