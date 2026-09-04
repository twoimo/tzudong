"""Backend-only durable consumer for the local admin publication queue.

Preview and explicit hash confirmation are separate from Apply. A committed
applying claim is never automatically retried after a process crash. Operators
must reconcile that job's hosted state before issuing a new request.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import threading
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.parse import urlparse, parse_qs
from uuid import UUID

from backend.pipeline_control.dsn_guard import (
    admit_dsn, extract_project_ref, HOSTED_PROJECT_REF, is_supabase_production_pg_host,
)
from backend.pipeline_control.publication_adapter import PublicationSqlAdapter
from backend.pipeline_control.publish_worker import (
    PublishWorker, PublishPreview, TablePreview,
    PUBLISH_APPLY_ABORTED, is_publish_schedule_active,
)

MAX_SOURCE_ROWS = 10000


def _rows(cursor) -> list[dict]:
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def canonical_pg_value(value):
    """Lossless JSON form shared by source hashing and destination readback."""
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("publish_scalar_invalid")
        # A JSON string lets PostgreSQL cast NUMERIC exactly on publication;
        # float would round large/precise values before hashing or readback.
        number = format(value, "f")
        number = number.rstrip("0").rstrip(".") if "." in number else number
        return "0" if value.is_zero() else number
    if isinstance(value, datetime):
        return (value.astimezone(timezone.utc) if value.tzinfo else value).isoformat()
    if isinstance(value, (date, UUID)):
        return value.isoformat() if isinstance(value, date) else str(value)
    if isinstance(value, dict):
        return {key: canonical_pg_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [canonical_pg_value(item) for item in value]
    return value


class PublishQueueStore:
    """One local connection; each transition commits before hosted mutations."""
    def __init__(self, connection):
        self.connection = connection

    def claim(self, status: str, job_id: str | None = None) -> dict | None:
        # Lock ownership lasts until save_preview/finish or release. Applying is
        # committed before returning, so a second process cannot claim it again.
        if status not in {"requested", "confirmed", "preview"}:
            raise ValueError("publish_queue_state_invalid")
        with self.connection.cursor() as c:
            c.execute("SELECT publish_job_id::text, status, preview_hash, updated_at "
                      "FROM local_analytics.publish_jobs WHERE status=%s "
                      "AND (%s::uuid IS NULL OR publish_job_id=%s::uuid) "
                      "ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1", (status, job_id, job_id))
            rows = _rows(c)
            if not rows:
                self.connection.rollback(); return None
            row = rows[0]
            if status == "confirmed":
                c.execute("UPDATE local_analytics.publish_jobs SET status='applying',updated_at=now() "
                          "WHERE publish_job_id=%s::uuid", (row["publish_job_id"],))
        if status == "confirmed": self.connection.commit()
        return row

    def append(self, history, audit):
        with self.connection.cursor() as c:
            for row in history:
                c.execute("INSERT INTO local_analytics.publish_history "
                          "(publish_job_id,stage,target_table,insert_row_count,update_row_count,"
                          "total_row_count,batch_index,readback_rows,matched_rows,mismatched_rows,preview_hash,result_code) "
                          "VALUES (%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", tuple(row.get(key, default) for key, default in (
                              ('publish_job_id', None), ('stage', None), ('target_table', ''),
                              ('insert_row_count', 0), ('update_row_count', 0), ('total_row_count', 0),
                              ('batch_index', None), ('readback_rows', None), ('matched_rows', None),
                              ('mismatched_rows', None), ('preview_hash', None), ('result_code', None))))
            for row in audit:
                c.execute("INSERT INTO local_analytics.publish_audit_events "
                          "(publish_job_id,stage,target_table,row_count,result_code) VALUES (%s::uuid,%s,%s,%s,%s)",
                          tuple(row[key] for key in ('publish_job_id','stage','target_table','row_count','result_code')))

    def transition(self, job_id, status, code=None, preview_hash=None):
        with self.connection.cursor() as c:
            c.execute("UPDATE local_analytics.publish_jobs SET status=%s,result_code=%s,"
                      "preview_hash=COALESCE(%s,preview_hash),updated_at=now() WHERE publish_job_id=%s::uuid",
                      (status, code, preview_hash, job_id))
            if c.rowcount != 1: raise ValueError("publish_queue_state_invalid")
        self.connection.commit()

    def stored_preview(self, job_id) -> PublishPreview:
        with self.connection.cursor() as c:
            c.execute("SELECT target_table,insert_row_count,update_row_count,total_row_count,preview_hash,"
                      "extract(epoch FROM stage_at)::float8 AS created_at FROM local_analytics.publish_history "
                      "WHERE publish_job_id=%s::uuid AND stage='preview' ORDER BY target_table", (job_id,))
            rows = _rows(c)
        if not rows: raise ValueError("publish_queue_preview_unavailable")
        return PublishPreview(job_id, rows[0]['preview_hash'], min(r['created_at'] for r in rows), tuple(
            TablePreview(*r['target_table'].split('.'), r['insert_row_count'],r['update_row_count'],r['total_row_count'])
            for r in rows))

    def fail(self, job_id, code, stage='apply'):
        self.append([], [{'publish_job_id': job_id,'stage': stage,'target_table': '',
                          'row_count': 0,'result_code': code}])
        self.transition(job_id, 'failed', code)


def load_source_request(connection, worker, job_id):
    tables = []
    with connection.cursor() as c:
        for key, table in sorted(worker.publication_set.tables.items()):
            # Validate the ledger against the fixed SQL adapter before identifier
            # composition; identifiers below are entirely source-owned.
            adapter = PublicationSqlAdapter(worker.publication_set, execute_one=lambda *_: None,
                                            execute_all=lambda *_: [])
            plan = adapter._admitted_plan(key)
            columns = sorted(plan.published_columns | {'id'})
            c.execute('SELECT ' + ','.join(columns) + ' FROM ' + key + ' ORDER BY id LIMIT %s',
                      (MAX_SOURCE_ROWS + 1,))
            rows = _rows(c)
            if len(rows) > MAX_SOURCE_ROWS: raise ValueError('publish_source_limit')
            # PostgreSQL scalar timestamps have a stable JSON representation;
            # no raw rows are written to disk, logs, queue or audit columns.
            rows = canonical_pg_value(rows)
            tables.append({'schema': table.schema,'table': table.table,'rows': rows})
    return {'publishJobId': job_id,'tables': tables}


class PublishQueueConsumer:
    def __init__(self, store, worker, source_request, hosted):
        self.store, self.worker, self.source_request, self.hosted = store, worker, source_request, hosted

    def preview_once(self):
        job = self.store.claim('requested')
        if job is None: return {'status': 'idle'}
        job_id = job['publish_job_id']
        try:
            # Check approved ledgers before reading local or hosted row content.
            if not self.worker.publication_set.is_approved:
                self.store.fail(job_id, 'publication_target_not_admitted', 'preview')
                return {'status': 'failed'}
            if not is_publish_schedule_active(self.worker.schedule):
                self.store.fail(job_id, 'publish_schedule_not_approved', 'preview')
                return {'status': 'failed'}
            request = self.source_request(job_id)
            existing = {}
            for table in request['tables']:
                key = table['schema'] + '.' + table['table']
                rows = self.hosted.read(key, [(r['id'],) for r in table['rows']])
                existing[key] = [(r['id'],) for r in rows]
            result = self.worker.preview(request, existing_identity_keys=existing)
            if not result.admitted:
                self.store.fail(job_id, result.code, 'preview'); return {'status': 'failed'}
            preview = result.preview
            self.store.append(preview.history_rows(), preview.audit_events())
            self.store.transition(job_id, 'preview', preview_hash=preview.preview_hash)
            return {'status': 'preview', 'publishJobId': job_id,'previewHash': preview.preview_hash,
                    'rowCount': preview.total_row_count}
        except Exception:
            self.store.connection.rollback()
            self.store.fail(job_id, PUBLISH_APPLY_ABORTED, 'preview')
            return {'status': 'failed'}

    def confirm(self, job_id, presented_hash):
        job = self.store.claim('preview', job_id)
        if job is None: return {'status': 'not_claimed'}
        preview = self.store.stored_preview(job_id)
        result = self.worker.confirm(preview, presented_hash)
        # Confirmation evidence and state transition commit in one transaction,
        # before an applying claim can become durable or a hosted write starts.
        self.store.append([result.history_row()], [{
            'publish_job_id': job_id, 'stage': 'confirm', 'target_table': '',
            'row_count': 0, 'result_code': result.history_row()['result_code'],
        }])
        if not result.admitted:
            self.store.transition(job_id, 'failed', result.code)
            return {'status': 'failed','code': result.code}
        # Preserve original preview creation time in history; confirming does
        # not extend its 900-second lifetime.
        self.store.transition(job_id, 'confirmed')
        return {'status': 'confirmed'}

    def apply_once(self):
        job = self.store.claim('confirmed')
        if job is None: return {'status': 'idle'}
        job_id = job['publish_job_id']
        try:
            preview = self.store.stored_preview(job_id)
            request = self.source_request(job_id)
            result = self.worker.apply(preview, request, job['preview_hash'],
                                       hosted_apply=self.hosted.apply, hosted_read=self.hosted.read,
                                       on_readback=lambda: self.store.transition(job_id, 'readback'))
        except Exception:
            self.store.connection.rollback()
            self.store.fail(job_id, PUBLISH_APPLY_ABORTED)
            return {'status': 'failed'}
        # Preview was durably recorded before confirmation. Avoid duplicate
        # history keys and audit events; terminal status and remaining audit
        # commit together. Persistence failure leaves a non-retryable job.
        self.store.append([r for r in result.history_rows if r['stage'] not in {'preview', 'confirm'}],
                          [r for r in result.audit_events if r['stage'] not in {'preview', 'confirm'}])
        self.store.transition(job_id, 'succeeded' if result.succeeded else 'failed', result.code)
        return {'status': 'succeeded' if result.succeeded else 'failed','code': result.code}


def admit_runtime(environment):
    local = environment.get('PIPELINE_CONTROL_DSN')
    admit_dsn(data_env='local_db', dsn=local)
    if environment.get('TZUDONG_PUBLISH_QUEUE_ENABLED') != '1':
        raise ValueError('publish_queue_unavailable')
    target = environment.get('TZUDONG_PUBLICATION_DSN')
    mode = environment.get('TZUDONG_PUBLICATION_DATA_ENV')
    admit_dsn(data_env=mode, dsn=target)
    if mode == 'hosting_db':
        parsed = urlparse(target)
        if (environment.get('G037_WRITE_FREEZE') != 'cleared'
            or environment.get('TZUDONG_HOSTED_DATA_PLANE_APPROVED') != '1'
            or not is_supabase_production_pg_host(parsed.hostname)
            or extract_project_ref(parsed.hostname, parsed.username) != HOSTED_PROJECT_REF
            or parse_qs(parsed.query).get('sslmode') != ['verify-full']):
            raise ValueError('publication_target_not_admitted')
    elif mode != 'local_db':
        raise ValueError('publication_target_not_admitted')
    return local, target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preview', 'confirm', 'apply', 'run'])
    parser.add_argument('--job-id', type=UUID)
    parser.add_argument('--preview-hash')
    args = parser.parse_args()
    try:
        local_dsn, target_dsn = admit_runtime(os.environ)
        import psycopg2
        with psycopg2.connect(local_dsn, connect_timeout=10) as local, psycopg2.connect(target_dsn, connect_timeout=10) as target:
            def execute_all(sql, params):
                try:
                    with target.cursor() as c:
                        c.execute(sql, params); result = _rows(c)
                    target.commit()
                    return canonical_pg_value(result)
                except Exception:
                    target.rollback(); raise
            def execute_one(sql, params):
                try:
                    with target.cursor() as c:
                        c.execute(sql, params); result = c.fetchone()[0]
                    target.commit(); return result
                except Exception:
                    target.rollback(); raise
            worker = PublishWorker.from_ledger(clock=time.time)
            hosted = PublicationSqlAdapter(worker.publication_set, execute_one=execute_one, execute_all=execute_all)
            consumer = PublishQueueConsumer(PublishQueueStore(local), worker,
                                           lambda job: load_source_request(local, worker, job), hosted)
            if args.command == 'run':
                stop = threading.Event()
                signal.signal(signal.SIGTERM, lambda *_: stop.set())
                signal.signal(signal.SIGINT, lambda *_: stop.set())
                while not stop.is_set():
                    for operation in (consumer.preview_once, consumer.apply_once):
                        result = operation()
                        if result['status'] != 'idle':
                            print(json.dumps(result), flush=True)
                    stop.wait(5)
                return 0
            if args.command == 'confirm':
                if args.job_id is None or not re.fullmatch('[0-9a-f]{64}', args.preview_hash or ''):
                    raise ValueError('publish_confirmation_required')
                result = consumer.confirm(str(args.job_id), args.preview_hash)
            else:
                result = getattr(consumer, args.command + '_once')()
            print(json.dumps(result))
            return 0 if result['status'] not in {'failed','not_claimed'} else 1
    except Exception:
        print('{"status":"failed","code":"publish_apply_aborted"}')
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
