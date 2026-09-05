"""Bounded, read-only catalog observation. Never certifies release or legal state."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import ipaddress
import ssl
import tempfile

SQL_PATH = Path(__file__).with_suffix('.sql')
REPOSITORY_ROOT = SQL_PATH.resolve().parents[3]
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
    if connection.info.transaction_status != 0:
        raise ObservationError('release_observation_transaction_not_idle')
    with connection.cursor() as cursor:
        cursor.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        cursor.execute("SELECT current_setting('transaction_read_only')='on', current_setting('transaction_isolation')='repeatable read'")
        require(cursor.fetchone() == (True, True))
        cursor.execute(sql.decode('utf-8'))
        row=cursor.fetchone()
        require(row is not None and len(row)==1)
        return validate(row[0])


def collect(connection):
    """Unbound metadata only; local observations are never production receipts."""
    with _owned_connection(connection):
        return _observe(connection, SQL_PATH.read_bytes())


def _verified_peer(connection):
    info=connection.info
    require(info.host==DIRECT_HOST and info.dbname=='postgres' and info.port==5432
            and info.status==0 and connection.pgconn.ssl_in_use is True
            and info.get_parameters().get('sslmode')=='verify-full')
    address=ipaddress.ip_address(info.hostaddr)
    require(address.is_global)
    return hashlib.sha256(address.packed).hexdigest()


def _receipt_from_bundle(bundle, user, password):
    """Private executor entry; supported only through the source-file launcher."""
    require(globals().get('__verified_source_bundle__') is bundle)
    import psycopg
    try:
        ca_der=ssl.PEM_cert_to_DER_cert(bundle['ca_bytes'].decode('ascii'))
        ca_hash=hashlib.sha256(ca_der).hexdigest()
        require(ca_hash=='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa')
        with tempfile.TemporaryDirectory(prefix='tzudong-observation-ca-') as directory:
            ca_path=Path(directory)/'root.crt'
            ca_path.write_bytes(bundle['ca_bytes']);ca_path.chmod(0o600)
            # The launcher strips PG* environment settings. Caller inputs contain
            # credentials only: neither an existing connection nor trust/peer
            # overrides cross this interface. The approved CA is copied from the
            # verified bundle and held for this newly-created connection.
            connection=psycopg.connect(host=DIRECT_HOST,hostaddr='',port=5432,
                dbname='postgres',user=user,password=password,autocommit=True,
                sslmode='verify-full',sslrootcert=str(ca_path),sslcert='',sslkey='',
                sslcrl='',sslcrldir='',gssencmode='disable',options='',
                ssl_min_protocol_version='TLSv1.2',connect_timeout=10,
                application_name='tzudong-release-observation')
            with _owned_connection(connection):
                peer=_verified_peer(connection)
                observation=_observe(connection,bundle['sql_bytes'])
                require(_verified_peer(connection)==peer)
                body={'schemaVersion':3,'kind':'release_readiness_observation',
                      'projectRef':PROJECT_REF,'targetIdentity':{
                        'kind':'owned_direct_postgres_tls','projectRef':PROJECT_REF,
                        'host':DIRECT_HOST,'database':'postgres','port':5432,
                        'tlsHostnameVerified':True,'trustAnchorSha256':ca_hash,
                        'peerAddressSha256':peer},
                      'sourceSha':bundle['source_sha'],
                      'sqlSha256':hashlib.sha256(bundle['sql_bytes']).hexdigest(),
                      'executorSha256':hashlib.sha256(bundle['executor_bytes']).hexdigest(),
                      'launcherSha256':bundle['launcher_sha256'],
                      'observation':observation,'releaseApprovalEstablished':False,
                      'legalReviewEstablished':False,'backupPitrEstablished':False}
                body['receiptSha256']=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
                return body
    except ObservationError:
        raise
    except Exception:
        raise ObservationError('release_observation_unavailable') from None
