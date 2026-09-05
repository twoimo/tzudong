"""Unit tests for the Schema_Mirror_Report (Requirements 9.3, 9.4, 9.5, 9.9, 9.10).

Feature: platform-modernization, Task 6.

These exercise the pure report builder in ``backend/bin/schema_mirror_report.py``
without a live database. ``backend/bin`` scripts are standalone, so the module
is loaded by path.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import importlib.util
import unittest
import os
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "backend" / "bin" / "schema_mirror_report.py"

_spec = importlib.util.spec_from_file_location("schema_mirror_report", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
smr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smr)


def _table(columns=(), constraints=()):
    return smr.TableShape(
        columns=frozenset(columns), constraints=frozenset(constraints)
    )


def _snapshot(tables=None, rpcs=()):
    return smr.SchemaSnapshot(tables=dict(tables or {}), rpcs=frozenset(rpcs))


class CategoryEnumerationTests(unittest.TestCase):
    """Requirement 9.3: all five classes present, zero-count classes included."""

    def test_identical_schemas_enumerate_five_empty_classes(self) -> None:
        snap = _snapshot(
            tables={"public.restaurants": _table(("id", "name"), ("pk_r",))},
            rpcs={"public.batch_upsert_restaurants"},
        )
        report = smr.build_schema_mirror_report(local=snap, hosted=snap)

        self.assertTrue(report["complete"])
        self.assertTrue(report["mirrorPass"])
        self.assertIsNone(report["errorCode"])
        self.assertEqual(set(report["categories"].keys()), set(smr.CATEGORY_KEYS))
        for key in smr.CATEGORY_KEYS:
            self.assertEqual(report["categories"][key]["count"], 0)
            self.assertEqual(report["categories"][key]["items"], [])

    def test_every_item_carries_schema_object_and_class(self) -> None:
        local = _snapshot(
            tables={
                "public.restaurants": _table(("id",), ("pk_r",)),
                "local_analytics.parity_results": _table(("id",), ()),
            }
        )
        hosted = _snapshot(tables={"public.restaurants": _table(("id",), ("pk_r",))})
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        items = report["categories"]["localOnlyTables"]["items"]
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertIn("schemaName", item)
        self.assertIn("objectName", item)
        self.assertIn("differenceClass", item)
        self.assertEqual(item["schemaName"], "local_analytics")
        self.assertEqual(item["objectName"], "parity_results")


class DefectClassificationTests(unittest.TestCase):
    def test_hosted_only_table_is_defect(self) -> None:
        local = _snapshot(tables={"public.restaurants": _table(("id",))})
        hosted = _snapshot(
            tables={
                "public.restaurants": _table(("id",)),
                "public.secret_hosted": _table(("id",)),
            }
        )
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        self.assertFalse(report["mirrorPass"])
        self.assertEqual(report["errorCode"], smr.SCHEMA_MIRROR_DEFECT)
        self.assertEqual(report["categories"]["hostedOnlyTables"]["count"], 1)
        self.assertTrue(
            any(d["objectName"] == "secret_hosted" for d in report["defects"])
        )

    def test_hosted_only_column_is_defect_but_local_only_column_is_not(self) -> None:
        # Hosted has an extra column -> defect.
        local = _snapshot(tables={"public.videos": _table(("id",))})
        hosted = _snapshot(tables={"public.videos": _table(("id", "hosted_extra"))})
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)
        self.assertEqual(report["errorCode"], smr.SCHEMA_MIRROR_DEFECT)
        col_item = report["categories"]["columnSetDifferences"]["items"][0]
        self.assertEqual(col_item["hostedOnlyColumns"], ["hosted_extra"])
        self.assertEqual(col_item["localOnlyColumns"], [])

        # Local has an extra column, hosted has none extra -> difference is
        # reported but is NOT a defect (no hosted-only item).
        local2 = _snapshot(tables={"public.videos": _table(("id", "local_extra"))})
        hosted2 = _snapshot(tables={"public.videos": _table(("id",))})
        report2 = smr.build_schema_mirror_report(local=local2, hosted=hosted2)
        self.assertTrue(report2["mirrorPass"])
        self.assertIsNone(report2["errorCode"])
        self.assertEqual(report2["categories"]["columnSetDifferences"]["count"], 1)
        self.assertEqual(report2["defects"], [])

    def test_hosted_only_constraint_is_defect(self) -> None:
        local = _snapshot(tables={"public.restaurants": _table(("id",), ("pk_r",))})
        hosted = _snapshot(
            tables={"public.restaurants": _table(("id",), ("pk_r", "uniq_hosted"))}
        )
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)
        self.assertEqual(report["errorCode"], smr.SCHEMA_MIRROR_DEFECT)
        con_item = report["categories"]["constraintDifferences"]["items"][0]
        self.assertEqual(con_item["hostedOnlyConstraints"], ["uniq_hosted"])

    def test_hosted_only_rpc_is_defect_local_only_rpc_is_not(self) -> None:
        local = _snapshot(tables={}, rpcs={"public.local_rpc"})
        hosted = _snapshot(tables={}, rpcs={"public.hosted_rpc"})
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        self.assertEqual(report["categories"]["rpcNameDifferences"]["count"], 2)
        # Only the hosted-only RPC is a defect.
        self.assertEqual(report["errorCode"], smr.SCHEMA_MIRROR_DEFECT)
        defect_objs = {d["objectName"] for d in report["defects"]}
        self.assertIn("hosted_rpc", defect_objs)
        self.assertNotIn("local_rpc", defect_objs)


class LocalOnlyApprovalTests(unittest.TestCase):
    """Requirement 9.5: enumerated local-only tables are approved, not defects."""

    def test_enumerated_local_only_table_is_approved(self) -> None:
        local = _snapshot(
            tables={
                "public.restaurants": _table(("id",)),
                "local_analytics.publish_jobs": _table(("publish_job_id",)),
            }
        )
        hosted = _snapshot(tables={"public.restaurants": _table(("id",))})
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        self.assertTrue(report["mirrorPass"])
        self.assertIsNone(report["errorCode"])
        item = report["categories"]["localOnlyTables"]["items"][0]
        self.assertTrue(item["approvedLocalOnly"])
        self.assertEqual(
            item["operatorApprovalReference"], smr.LOCAL_ONLY_APPROVAL_REFERENCE
        )
        self.assertEqual(report["defects"], [])

    def test_unenumerated_local_only_table_is_defect(self) -> None:
        local = _snapshot(
            tables={
                "public.restaurants": _table(("id",)),
                "public.rogue_local": _table(("id",)),
            }
        )
        hosted = _snapshot(tables={"public.restaurants": _table(("id",))})
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        self.assertFalse(report["mirrorPass"])
        self.assertEqual(report["errorCode"], smr.SCHEMA_MIRROR_DEFECT)
        rogue = next(
            i
            for i in report["categories"]["localOnlyTables"]["items"]
            if i["objectName"] == "rogue_local"
        )
        self.assertFalse(rogue["approvedLocalOnly"])
        self.assertIsNone(rogue["operatorApprovalReference"])
        self.assertTrue(
            any(d["objectName"] == "rogue_local" for d in report["defects"])
        )


class HostedReadUnavailableTests(unittest.TestCase):
    """Requirement 9.9, 9.10: hosted read failure fails closed."""

    def test_none_hosted_marks_incomplete_and_not_passing(self) -> None:
        local = _snapshot(tables={"public.restaurants": _table(("id",))})
        report = smr.build_schema_mirror_report(local=local, hosted=None)

        self.assertFalse(report["complete"])
        self.assertFalse(report["mirrorPass"])
        self.assertEqual(report["errorCode"], smr.HOSTED_SCHEMA_READ_UNAVAILABLE)
        # All five classes still enumerated at zero count.
        for key in smr.CATEGORY_KEYS:
            self.assertEqual(report["categories"][key]["count"], 0)

    def test_hosted_read_ok_false_fails_closed(self) -> None:
        local = _snapshot(tables={"public.restaurants": _table(("id",))})
        hosted = _snapshot(tables={"public.restaurants": _table(("id",))})
        report = smr.build_schema_mirror_report(
            local=local, hosted=hosted, hosted_read_ok=False
        )
        self.assertFalse(report["complete"])
        self.assertFalse(report["mirrorPass"])
        self.assertEqual(report["errorCode"], smr.HOSTED_SCHEMA_READ_UNAVAILABLE)

    def test_generate_report_swallows_hosted_reader_exception(self) -> None:
        local_snap = _snapshot(tables={"public.restaurants": _table(("id",))})

        def local_reader():
            return local_snap

        def hosted_reader():
            raise RuntimeError("connection refused: secret-host:5432 password=abc")

        report = smr.generate_report(
            local_reader=local_reader, hosted_reader=hosted_reader
        )
        self.assertEqual(report["errorCode"], smr.HOSTED_SCHEMA_READ_UNAVAILABLE)
        # The provider/db error string must never leak into the bounded report.
        serialized = repr(report)
        self.assertNotIn("connection refused", serialized)
        self.assertNotIn("password", serialized)
        self.assertNotIn("secret-host", serialized)


class PublicationIsolationTests(unittest.TestCase):
    """Requirement 9.6: intersection is zero and check count is recorded."""

    def test_default_local_only_is_isolated_from_publication_set(self) -> None:
        snap = _snapshot(tables={"public.restaurants": _table(("id",))})
        report = smr.build_schema_mirror_report(
            local=snap,
            hosted=snap,
            publication_set_tables=["public.restaurants", "public.videos"],
        )
        iso = report["publicationIsolation"]
        self.assertEqual(iso["intersectionSize"], 0)
        self.assertTrue(iso["isolated"])
        self.assertEqual(iso["intersectionTables"], [])
        # One membership check per Local_Only_Schema table.
        self.assertEqual(
            iso["intersectionCheckCount"], len(smr.LOCAL_ONLY_QUALIFIED_TABLES)
        )
        self.assertEqual(iso["publicationSetTableCount"], 2)

    def test_intersection_detected_when_publication_set_overlaps(self) -> None:
        snap = _snapshot(tables={})
        report = smr.build_schema_mirror_report(
            local=snap,
            hosted=snap,
            local_only_tables=["local_analytics.parity_results"],
            publication_set_tables=["local_analytics.parity_results"],
        )
        iso = report["publicationIsolation"]
        self.assertEqual(iso["intersectionSize"], 1)
        self.assertFalse(iso["isolated"])
        self.assertEqual(iso["intersectionCheckCount"], 1)


class DifferenceUniquenessTests(unittest.TestCase):
    """Each injected difference appears in exactly one class exactly once."""

    def test_each_difference_classified_once(self) -> None:
        local = _snapshot(
            tables={
                "public.shared": _table(("id",), ("pk",)),
                "public.col_diff": _table(("id", "a"), ("pk",)),
                "public.con_diff": _table(("id",), ("pk", "extra")),
                "local_analytics.publish_jobs": _table(("id",)),
                "public.rogue": _table(("id",)),
            },
            rpcs={"public.shared_rpc", "public.local_rpc"},
        )
        hosted = _snapshot(
            tables={
                "public.shared": _table(("id",), ("pk",)),
                "public.col_diff": _table(("id",), ("pk",)),
                "public.con_diff": _table(("id",), ("pk",)),
                "public.hosted_only": _table(("id",)),
            },
            rpcs={"public.shared_rpc", "public.hosted_rpc"},
        )
        report = smr.build_schema_mirror_report(local=local, hosted=hosted)

        cats = report["categories"]
        # Collect every reported (objectName, class) pair across categories.
        reported = []
        for key in smr.CATEGORY_KEYS:
            for item in cats[key]["items"]:
                reported.append((item["objectName"], item["differenceClass"]))

        self.assertEqual(cats["localOnlyTables"]["count"], 2)  # publish_jobs, rogue
        self.assertEqual(cats["hostedOnlyTables"]["count"], 1)  # hosted_only
        self.assertEqual(cats["columnSetDifferences"]["count"], 1)  # col_diff
        self.assertEqual(cats["constraintDifferences"]["count"], 1)  # con_diff
        self.assertEqual(cats["rpcNameDifferences"]["count"], 2)  # local_rpc, hosted_rpc
        # No duplicate classification.
        self.assertEqual(len(reported), len(set(reported)))




@unittest.skipUnless(os.environ.get('TZUDONG_TEST_POSTGRES_BIN'), 'disposable postgres opt-in absent')
class CatalogDefinitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.pg = psycopg2
        cls.tmp = tempfile.TemporaryDirectory(prefix='tzmirror-', dir='/tmp')
        cls.addClassCleanup(cls.tmp.cleanup)
        bindir = Path(os.environ['TZUDONG_TEST_POSTGRES_BIN'])
        data = str(Path(cls.tmp.name) / 'data')
        def run(*args):
            subprocess.run([str(bindir / args[0]), *args[1:]], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run('initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8')
        run('pg_ctl', '-D', data, '-l', str(Path(cls.tmp.name) / 'server.log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{cls.tmp.name}'", '-w', 'start')
        cls.addClassCleanup(lambda: run('pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'))
        cls.dsn = f'dbname=postgres user=postgres host={cls.tmp.name}'

    def test_not_null_is_compared_by_column_without_catalog_oid_noise(self):
        conn = self.pg.connect(self.dsn, options='-c search_path=pg_catalog')
        try:
            with conn.cursor() as cur:
                cur.execute('CREATE TABLE public.nullability_fixture(value int NOT NULL)')
            before = smr.read_schema_snapshot(conn)
            with conn.cursor() as cur:
                cur.execute('ALTER TABLE public.nullability_fixture ALTER COLUMN value DROP NOT NULL')
            after = smr.read_schema_snapshot(conn)
            report = smr.build_schema_mirror_report(local=before, hosted=after)
            self.assertFalse(report['mirrorPass'])
            self.assertEqual(report['categories']['constraintDifferences']['items'][0]['nullabilityDifferences'], ['value'])
            conn.rollback()
        finally:
            conn.close()

    def test_same_constraint_name_detects_check_fk_type_and_validation_drift(self):
        cases = [
            ('CHECK (value > 0)', 'CHECK (value >= 0)'),
            ('FOREIGN KEY (value) REFERENCES public.ref_a(id)',
             'FOREIGN KEY (value) REFERENCES public.ref_b(id)'),
            ('FOREIGN KEY (value) REFERENCES public.ref_a(id)',
             'FOREIGN KEY (value) REFERENCES public.ref_a(id) ON DELETE CASCADE'),
            ('CHECK (value > 0) NOT VALID', 'CHECK (value > 0)'),
            ('UNIQUE (value)', 'PRIMARY KEY (value)'),
            ('UNIQUE (value)', 'UNIQUE (value) DEFERRABLE INITIALLY DEFERRED'),
        ]
        for before, after in cases:
            with self.subTest(before=before, after=after):
                conn = self.pg.connect(self.dsn, options='-c search_path=pg_catalog')
                try:
                    with conn.cursor() as cur:
                        cur.execute('CREATE TABLE public.ref_a(id int PRIMARY KEY); '
                                    'CREATE TABLE public.ref_b(id int PRIMARY KEY); '
                                    'CREATE TABLE public.target(value int NOT NULL); '
                                    'ALTER TABLE public.target ADD CONSTRAINT same_name ' + before)
                    conn.commit()
                    conn.set_session(readonly=True)
                    original = smr.read_schema_snapshot(conn)
                    conn.rollback()
                    conn.set_session(readonly=False)
                    with conn.cursor() as cur:
                        cur.execute('ALTER TABLE public.target DROP CONSTRAINT same_name; '
                                    'ALTER TABLE public.target ADD CONSTRAINT same_name ' + after)
                    conn.commit()
                    conn.set_session(readonly=True)
                    changed = smr.read_schema_snapshot(conn)
                    self.assertEqual(original.tables['public.target'].constraints,
                                     changed.tables['public.target'].constraints)
                    report = smr.build_schema_mirror_report(local=original, hosted=changed)
                    self.assertFalse(report['mirrorPass'])
                    self.assertEqual(report['errorCode'], 'schema_mirror_defect')
                    differences = report['categories']['constraintDifferences']['items']
                    self.assertEqual(differences[0]['definitionDifferences'], ['same_name'])
                    self.assertNotIn(before, __import__('json').dumps(report))
                    self.assertTrue(smr.build_schema_mirror_report(local=changed, hosted=changed)['mirrorPass'])
                    conn.rollback()
                    conn.set_session(readonly=False)
                    with conn.cursor() as cur:
                        cur.execute('DROP TABLE public.target, public.ref_a, public.ref_b')
                    conn.commit()
                finally:
                    conn.close()


if __name__ == "__main__":
    unittest.main()
