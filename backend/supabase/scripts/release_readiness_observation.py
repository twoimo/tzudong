"""Bounded, read-only catalog observation. Never certifies release or legal state."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

SQL_PATH = Path(__file__).with_suffix('.sql')
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


def collect(connection):
    """Own one transaction; never commit. Caller supplies an authorized connection."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            cursor.execute(SQL_PATH.read_text())
            row=cursor.fetchone()
            require(row is not None and len(row)==1)
            return validate(row[0])
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


def receipt(observation, *, project_ref, source_sha):
    validate(observation)
    require(project_ref=='aqlcofblfxdrjhhdmarw')
    require(type(source_sha) is str and re.fullmatch('[a-f0-9]{40}',source_sha) is not None)
    # Presence of a reference is not proof of its approval, legal basis, or backups.
    body={'schemaVersion':1,'kind':'release_readiness_observation','projectRef':project_ref,
          'sourceSha':source_sha,'sqlSha256':hashlib.sha256(SQL_PATH.read_bytes()).hexdigest(),
          'observation':observation,'releaseApprovalEstablished':False,
          'legalReviewEstablished':False,'backupPitrEstablished':False}
    body['receiptSha256']=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
    return body
