"""Offline tests for the domain-separated G038 successor executor."""
from __future__ import annotations

import hashlib
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g038_successor_executor as executor

H = "a" * 64
ROOT = Path("/pinned")
V026, V027 = executor.SELECTED_VERSIONS
CATALOG_ROWS = (("public", "restaurants", "r", "owner"),)
ACL_ROWS = (("public", "restaurants", "owner", "owner", "SELECT", True),)
CATALOG_ROOT = executor.canonical_sha256(tuple(tuple(str(value) for value in row) for row in CATALOG_ROWS))
ACL_ROOT = executor.canonical_sha256(tuple(tuple(str(value) for value in row) for row in ACL_ROWS))
DATA_ROW = {
    "classes_count": 12, "exact_seed_count": 12, "seed_rows_exact": True,
    "class_source_count": 0, "legal_hold_count": 0, "work_item_count": 0,
    "retained_record_count": 0, "run_count": 0, "run_item_count": 0,
    "runtime_tables_empty": True,
    "seed_projection_sha256": executor._TERMINAL_SEED_PROJECTION_SHA256,
    "data_shape_sha256": executor._TERMINAL_DATA_SHA256,
}


def migration(version, name, vector):
    raw = b"x"
    return SimpleNamespace(version=version, name=name, path=f"{version}.sql",
                           sha256=hashlib.sha256(raw).hexdigest(), size=len(raw),
                           statement_count=len(vector),
                           vector_sha256=executor.canonical_sha256(list(vector)),
                           transaction_control=())


def exact_manifest(items, vector_root):
    value = object.__new__(executor.Manifest)
    fields = {
        "migrations": tuple(items), "predecessor_commit": "b" * 40,
        "predecessor_report_sha256": "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114",
        "target_fingerprint": "defdf3cc65753b4b4dcaa321b16b4347278239ae08e41f19a2d98fec9f3a0331",
        "predecessor_rows": 40, "target_rows": 42,
        "predecessor_ledger_root": executor.canonical_sha256(executor.PREDECESSOR_PAIRS),
        "statement_vector_root": vector_root,
        "terminal_spec_root": executor.TERMINAL_SPEC_ROOT, "excluded_root": executor.EXCLUDED_ROOT,
        "runtime_inventory_root": H, "runtime_inventory": (),
    }
    for field, item in fields.items():
        object.__setattr__(value, field, item)
    return value


def plan():
    one = migration(V026, "receipt", ("SELECT 26",))
    two = migration(V027, "reauth", ("BEGIN", "SELECT 27", "COMMIT"))
    return executor.SuccessorPlan(
        ROOT, SimpleNamespace(),
        (executor.CompiledMigration(one, ("SELECT 26",), ("SELECT 26",)),
         executor.CompiledMigration(two, ("BEGIN", "SELECT 27", "COMMIT"), ("SELECT transformed",))),
        H, H, H,
    )


def ledger(prefix_count=40):
    pairs = tuple(executor.PREDECESSOR_PAIRS)
    assert len(pairs) == prefix_count
    return tuple((version, name, (f"statement-{index}",)) for index, (version, name) in enumerate(pairs))


class Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.result = []
        self.calls = []
        self.fail_sql = None
        self.transaction = ("off", None, False)
        self.rehearsal = None
        self.readback = {field: True for field in executor._TERMINAL_FIELDS}
        self.catalog_rows = CATALOG_ROWS
        self.acl_rows = ACL_ROWS
        self.data_row = dict(DATA_ROW)

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if sql == self.fail_sql:
            raise RuntimeError("provider dsn=secret")
        if sql == executor._LEDGER_SQL:
            self.result = list(self.rows)
        elif sql == executor._TRANSACTION_SQL:
            self.result = [self.transaction]
        elif "g038.rehearsal_sentinel" in sql:
            self.result = [self.rehearsal]
        elif sql == executor._LEDGER_INSERT_SQL:
            self.rows.append((params[0], params[1], tuple(params[2])))
            self.result = []
        elif sql == executor._CATALOG_SQL:
            self.result = list(self.catalog_rows)
        elif sql == executor._ACL_SQL:
            self.result = list(self.acl_rows)
        elif sql == executor._DATA_IDENTITY_SQL:
            self.result = [{"identity_ok": True}]
        elif sql == executor._DATA_SQL:
            self.result = [self.data_row]
        elif "terminal_memberships_exact" in sql:
            self.result = [dict(self.readback)]
        else:
            self.result = []

    def fetchall(self):
        return self.result


class SuccessorExecutorTests(unittest.TestCase):
    def test_compatibility_transform_is_hash_bound_and_rejects_transient_grantor(self):
        statement = "DO $$\n" + executor._COMPATIBILITY_OLD.decode("ascii") + "\nEND $$"
        transformed = executor._compatibility_executable(_pinned_027_source(), (statement,))
        self.assertEqual(sum(value.count(executor._COMPATIBILITY_NEW.decode("ascii")) for value in transformed), 1)
        with patch.object(executor, "_COMPATIBILITY_START", executor._COMPATIBILITY_START + 1):
            with self.assertRaisesRegex(executor.SuccessorError, "02700_compatibility_source"):
                executor._compatibility_executable(_pinned_027_source(), (statement,))
        with self.assertRaisesRegex(executor.SuccessorError, "02700_compatibility_occurrence"):
            executor._compatibility_executable(_pinned_027_source(), ("SELECT 1",))
        compatibility = executor._COMPATIBILITY_NEW.decode("ascii")
        self.assertNotIn("pg_has_role", compatibility)
        self.assertIn("AND grantor.rolname = 'postgres'", compatibility)
        self.assertIn(
            "('privacy_workflow_owner', 'postgres', 'supabase_admin', true, false, false)",
            compatibility,
        )
        self.assertEqual(compatibility.count("OR member.rolname IN ("), 2)

        expected = {
            ("privacy_workflow_owner", "postgres", "supabase_admin", True, False, False),
            ("privacy_retention_operator_approver", "postgres", "supabase_admin", True, False, False),
            ("privacy_retention_legal_approver", "postgres", "supabase_admin", True, False, False),
            ("privacy_retention_activation_operator", "postgres", "supabase_admin", True, False, False),
        }
        transient = (
            "privacy_workflow_owner", "postgres", "postgres", False, True, True,
        )
        def membership_contract(actual):
            return actual == expected
        self.assertTrue(membership_contract(expected))
        self.assertFalse(membership_contract(expected | {transient}))

    def test_authority_prelude_and_027_source_grant_revoke_are_exact(self):
        self.assertEqual(
            executor._AUTHORITY_PRELUDE_SQL,
            "GRANT privacy_workflow_owner TO postgres "
            "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres",
        )
        self.assertIn("current_user <> 'postgres'", executor._AUTHORITY_PRECONDITION_SQL)
        self.assertIn("grantor.rolname='supabase_admin'", executor._AUTHORITY_PRECONDITION_SQL)
        self.assertIn("membership.admin_option", executor._AUTHORITY_PRECONDITION_SQL)
        self.assertIn("NOT membership.inherit_option", executor._AUTHORITY_PRECONDITION_SQL)
        self.assertIn("NOT membership.set_option", executor._AUTHORITY_PRECONDITION_SQL)
        self.assertIn("grantor.rolname='postgres'", executor._AUTHORITY_POSTCONDITION_SQL)
        self.assertIn("NOT membership.admin_option", executor._AUTHORITY_POSTCONDITION_SQL)
        self.assertIn("membership.inherit_option", executor._AUTHORITY_POSTCONDITION_SQL)
        self.assertIn("membership.set_option", executor._AUTHORITY_POSTCONDITION_SQL)
        source = _pinned_027_source().decode("utf-8")
        source_grant = "GRANT privacy_workflow_owner TO postgres;"
        source_revoke = "REVOKE privacy_workflow_owner FROM postgres;"
        self.assertEqual(source.count(source_grant), 1)
        self.assertEqual(source.count(source_revoke), 1)
        self.assertLess(source.index(source_grant), source.index(source_revoke))

    def test_compile_rejects_026_transaction_control_and_027_wrapper_drift(self):
        original_26 = ("BEGIN",)
        original_27 = ("BEGIN", "SELECT 27", "COMMIT")
        items = (migration(V026, "receipt", original_26), migration(V027, "reauth", original_27))
        root = executor.canonical_sha256([[V026, items[0].vector_sha256], [V027, items[1].vector_sha256]])
        manifest = exact_manifest(items, root)
        with patch.object(Path, "read_bytes", return_value=b"x"), \
                patch.multiple(executor, STATEMENT_VECTOR_ROOT=root,
                               statement_vectors=lambda _r, item: original_26 if item.version == V026 else original_27):
            with self.assertRaisesRegex(executor.SuccessorError, "02600_transaction_control"):
                executor.compile_plan(ROOT, manifest)

        bad_27 = ("BEGIN", "SELECT 27", "ROLLBACK")
        items = (migration(V026, "receipt", ("SELECT 26",)), migration(V027, "reauth", bad_27))
        root = executor.canonical_sha256([[V026, items[0].vector_sha256], [V027, items[1].vector_sha256]])
        manifest = exact_manifest(items, root)
        with patch.object(Path, "read_bytes", return_value=b"x"), \
                patch.multiple(executor, STATEMENT_VECTOR_ROOT=root,
                               statement_vectors=lambda _r, item: ("SELECT 26",) if item.version == V026 else bad_27):
            with self.assertRaisesRegex(executor.SuccessorError, "02700_wrapper"):
                executor.compile_plan(ROOT, manifest)

    def test_compile_rejects_forbidden_version_and_vector_drift(self):
        item = migration("20260713002500", "forbidden", ("SELECT 1",))
        manifest = exact_manifest((item,), H)
        with self.assertRaisesRegex(executor.SuccessorError, "source_contract"):
            executor.compile_plan(ROOT, manifest)

    def test_classifier_exact_40_exact_42_and_partial_states(self):
        p = plan()
        before = ledger()
        after = before + tuple((entry.migration.version, entry.migration.name, entry.original) for entry in p.compiled)
        deadline = time.monotonic() + 10
        self.assertEqual(executor.classify_cursor(Cursor(before), plan=p,
            predecessor_ledger_root=executor.canonical_sha256(tuple((v, n) for v, n, _ in before)), target_ledger_root=H,
            deadline_monotonic=deadline), executor.EXACT_40)
        self.assertEqual(executor.classify_cursor(Cursor(after), plan=p,
            predecessor_ledger_root=H, target_ledger_root=executor.canonical_sha256(tuple((v, n) for v, n, _ in after)),
            deadline_monotonic=deadline), executor.EXACT_42)
        for rows in (before + (after[-1],), after[:-1], after[:-2] + (after[-1], after[-2])):
            self.assertEqual(executor.classify_cursor(Cursor(rows), plan=p,
                predecessor_ledger_root=H, target_ledger_root=H, deadline_monotonic=deadline),
                executor.PARTIAL_OR_AMBIGUOUS)
    def test_live_observer_catalog_drift_is_derived(self):
        p = plan(); cursor = Cursor(ledger())
        baseline = _observe(cursor, p)
        cursor.catalog_rows += (("public", "unexpected", "r", "owner"),)
        self.assertNotEqual(_observe(cursor, p).catalog_root, baseline.catalog_root)

    def test_live_observer_acl_drift_is_derived(self):
        p = plan(); cursor = Cursor(ledger())
        baseline = _observe(cursor, p)
        cursor.acl_rows = (("public", "restaurants", "owner", "authenticated", "SELECT", False),)
        self.assertNotEqual(_observe(cursor, p).acl_root, baseline.acl_root)

    def test_live_observer_data_drift_is_blocked(self):
        p = plan(); cursor = Cursor(ledger())
        cursor.data_row["run_count"] = 1
        with self.assertRaisesRegex(executor.SuccessorError, "data_drift"):
            _observe(cursor, p)

    def test_live_observer_ledger_drift_is_derived(self):
        p = plan(); cursor = Cursor(tuple(ledger())[:-1])
        state = _observe(cursor, p)
        self.assertEqual((state.classification, state.rows), (executor.PARTIAL_OR_AMBIGUOUS, 39))
        self.assertEqual(state.ledger_root, executor.canonical_sha256(executor.PREDECESSOR_PAIRS[:-1]))
        observed_sql = [sql for sql, _ in cursor.calls if sql != executor._TIMEOUT_SQL]
        self.assertEqual(observed_sql, [
            executor._LEDGER_SQL, executor._CATALOG_SQL, executor._ACL_SQL,
            executor._DATA_IDENTITY_SQL, executor._DATA_SQL,
        ])
        self.assertEqual(
            sum(sql == executor._TIMEOUT_SQL for sql, _ in cursor.calls),
            len(observed_sql),
        )
    def test_terminal_sql_pins_five_signatures_and_exact_grantor_acl_rows(self):
        sql = (
            Path(__file__).parent / "g038_terminal_readback.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("function_expected(signature, grantor, grantee)", sql)
        self.assertIn("count(*) = 5 AND count(oid) = 5 FROM function_oids", sql)
        self.assertIn(
            "SELECT f.signature, COALESCE(grantor.rolname, 'PUBLIC') AS grantor",
            sql,
        )
        self.assertIn(
            "LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor",
            sql,
        )
        self.assertIn(
            "SELECT signature, grantor, grantee FROM function_expected",
            sql,
        )
        self.assertIn(
            "WHERE privilege_type <> 'EXECUTE' OR is_grantable",
            sql,
        )
        expected_rows = [
            line.strip()
            for line in sql.splitlines()
            if line.strip().startswith("('public.")
            and line.strip().endswith(("),", ")"))
        ]
        self.assertEqual(len(expected_rows), 9)
        self.assertEqual(
            sum("'privacy_workflow_owner', 'privacy_workflow_owner'" in row for row in expected_rows),
            5,
        )
        self.assertEqual(sum("'postgres'," in row for row in expected_rows), 4)
    def test_terminal_sql_rejects_hostile_acl_and_membership_rows(self):
        sql = (
            Path(__file__).parent / "g038_terminal_readback.sql"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))",
            sql,
        )
        self.assertNotIn("has_schema_privilege", sql)
        self.assertIn(
            "string_agg(conname || ':' || contype::text, ',' ORDER BY conname)",
            sql,
        )
        self.assertNotIn("conname || ':' || contype,", sql)
        self.assertIn(
            "('privacy_workflow_owner', 'privacy_workflow_owner', 'CREATE', false)",
            sql,
        )
        self.assertIn(
            "('privacy_workflow_owner', 'privacy_workflow_owner', 'USAGE', false)",
            sql,
        )
        self.assertIn(
            "SELECT * FROM schema_acl_expected EXCEPT SELECT * FROM schema_acl_actual",
            sql,
        )
        self.assertIn(
            "SELECT * FROM schema_acl_actual EXCEPT SELECT * FROM schema_acl_expected",
            sql,
        )
        # LEFT joins keep unknown grantee/grantor OIDs in the actual set so that
        # an injected ACL row cannot disappear before the bidirectional diff.
        self.assertIn(
            "LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee",
            sql,
        )
        self.assertIn(
            "LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor",
            sql,
        )
        membership_actual = sql[
            sql.index("terminal_membership_actual AS ("):
            sql.index(")\nSELECT", sql.index("terminal_membership_actual AS ("))
        ]
        self.assertIn(
            "JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member",
            membership_actual,
        )
        self.assertIn(
            "JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor",
            membership_actual,
        )
        self.assertIn("OR member.rolname IN (", membership_actual)
        transient_guard = sql[
            sql.index(") AS transient_membership_absent") - 600:
            sql.index(") AS transient_membership_absent")
        ]
        self.assertNotIn("pg_has_role", transient_guard)
        self.assertIn("AND member.rolname = 'postgres'", transient_guard)
        self.assertIn("AND grantor.rolname = 'postgres'", transient_guard)
        self.assertIn(
            "('privacy_workflow_owner', 'postgres', 'supabase_admin', true, false, false)",
            sql,
        )
        self.assertIn(
            "SELECT * FROM terminal_membership_expected EXCEPT SELECT * FROM terminal_membership_actual",
            sql,
        )
        self.assertIn(
            "SELECT * FROM terminal_membership_actual EXCEPT SELECT * FROM terminal_membership_expected",
            sql,
        )
        for role in (
            "privacy_workflow_owner",
            "privacy_retention_operator_approver",
            "privacy_retention_legal_approver",
            "privacy_retention_activation_operator",
        ):
            self.assertIn(f"'{role}'", membership_actual)
        self.assertEqual(len(executor._TERMINAL_FIELDS), 14)
        self.assertIn("terminal_memberships_exact", executor._TERMINAL_FIELDS)

    def test_terminal_result_requires_exact_named_projection(self):
        cursor = Cursor()
        p = plan()
        with patch.object(Path, "read_text", return_value="SELECT terminal_memberships_exact"):
            executor.assert_terminal_readback(
                cursor, p, deadline_monotonic=time.monotonic() + 10,
            )
        cursor.readback["unexpected"] = cursor.readback.pop("rpc_acl_exact")
        with patch.object(Path, "read_text", return_value="SELECT terminal_memberships_exact"), \
                self.assertRaisesRegex(executor.SuccessorError, "terminal_readback"):
            executor.assert_terminal_readback(
                cursor, p, deadline_monotonic=time.monotonic() + 10,
            )

    def test_valid_owned_transaction_applies(self):
        p = plan()
        cursor = Cursor(ledger())
        authorization = _authorization(p, cursor.rows)
        _own_transaction(cursor, authorization)
        with patch.object(Path, "read_text", return_value="SELECT terminal_memberships_exact"):
            evidence = executor.apply_cursor(
                cursor, plan=p, authorization=authorization, attempt=_attempt(authorization),
                deadline_monotonic=time.monotonic() + 10,
            )
        self.assertEqual(evidence.classification, executor.EXACT_42)
        self.assertEqual(len(cursor.rows), 42)

    def test_authority_prelude_is_serialized_and_asserted_before_table_locks_and_sources(self):
        p = plan()
        cursor = Cursor(ledger())
        authorization = _authorization(p, cursor.rows)
        _own_transaction(cursor, authorization)
        with patch.object(Path, "read_text", return_value="SELECT terminal_memberships_exact"):
            executor.apply_cursor(
                cursor, plan=p, authorization=authorization, attempt=_attempt(authorization),
                deadline_monotonic=time.monotonic() + 10,
            )
        sql = [statement for statement, _ in cursor.calls if statement != executor._TIMEOUT_SQL]
        advisory = sql.index(executor._LOCK_SQL[0])
        precondition = sql.index(executor._AUTHORITY_PRECONDITION_SQL)
        prelude = sql.index(executor._AUTHORITY_PRELUDE_SQL)
        postcondition = sql.index(executor._AUTHORITY_POSTCONDITION_SQL)
        self.assertEqual(sql.count(executor._AUTHORITY_PRECONDITION_SQL), 1)
        self.assertEqual(sql.count(executor._AUTHORITY_PRELUDE_SQL), 1)
        self.assertEqual(sql.count(executor._AUTHORITY_POSTCONDITION_SQL), 1)
        self.assertLess(sql.index(executor._LOCK_TIMEOUT_SQL), advisory)
        self.assertLess(sql.index(executor._IDLE_TIMEOUT_SQL), advisory)
        self.assertLess(advisory, precondition)
        self.assertLess(precondition, prelude)
        self.assertLess(prelude, postcondition)
        for statement in executor._LOCK_SQL[1:] + tuple(
                source for entry in p.compiled for source in entry.executable):
            self.assertLess(postcondition, sql.index(statement))

    def test_rehearsal_authority_failure_is_sanitized_after_advisory_before_table_locks_or_mutation(self):
        p = plan()
        starting = _observe(Cursor(ledger()), p)
        deadline = time.monotonic() + 10
        sentinel = "rehearsal-sentinel-" + "a" * 32
        cursor = Cursor(ledger())
        cursor.rehearsal = ("off", sentinel, "123")
        cursor.fail_sql = executor._AUTHORITY_PRELUDE_SQL
        capability = executor._new_rehearsal_capability(
            plan=p, starting=starting, target=None, transaction_sentinel=sentinel,
            transaction_xid="123", deadline_monotonic=deadline,
        )
        with self.assertRaises(executor.SuccessorError) as caught:
            executor.apply_rehearsal_cursor(cursor, capability=capability)
        self.assertEqual(caught.exception.code, "database_failure")
        self.assertEqual(caught.exception.evidence, {})
        self.assertNotIn("secret", str(caught.exception))
        sql = tuple(statement for statement, _ in cursor.calls)
        self.assertIn(executor._LOCK_SQL[0], sql)
        self.assertIn(executor._AUTHORITY_PRECONDITION_SQL, sql)
        self.assertIn(executor._AUTHORITY_PRELUDE_SQL, sql)
        self.assertNotIn(executor._AUTHORITY_POSTCONDITION_SQL, sql)
        self.assertFalse(any(statement in executor._LOCK_SQL[1:] for statement in sql))
        self.assertFalse(any(
            statement in sql for entry in p.compiled for statement in entry.executable
        ))
        self.assertNotIn(executor._LEDGER_INSERT_SQL, sql)
        self.assertEqual(len(cursor.rows), 40)
        self.assertFalse(any(
            statement.strip().upper() in {"BEGIN", "COMMIT", "ROLLBACK"} for statement in sql
        ))

    def test_preexisting_authority_drift_denies_after_advisory_before_grant_or_mutation(self):
        p = plan()
        starting = _observe(Cursor(ledger()), p)
        deadline = time.monotonic() + 10
        sentinel = "rehearsal-sentinel-" + "b" * 32
        cursor = Cursor(ledger())
        cursor.rehearsal = ("off", sentinel, "124")
        cursor.fail_sql = executor._AUTHORITY_PRECONDITION_SQL
        capability = executor._new_rehearsal_capability(
            plan=p, starting=starting, target=None, transaction_sentinel=sentinel,
            transaction_xid="124", deadline_monotonic=deadline,
        )
        with self.assertRaisesRegex(executor.SuccessorError, "database_failure"):
            executor.apply_rehearsal_cursor(cursor, capability=capability)
        sql = tuple(statement for statement, _ in cursor.calls)
        self.assertIn(executor._LOCK_SQL[0], sql)
        self.assertIn(executor._AUTHORITY_PRECONDITION_SQL, sql)
        self.assertNotIn(executor._AUTHORITY_PRELUDE_SQL, sql)
        self.assertNotIn(executor._AUTHORITY_POSTCONDITION_SQL, sql)
        self.assertFalse(any(statement in executor._LOCK_SQL[1:] for statement in sql))
        self.assertFalse(any(
            statement in sql for entry in p.compiled for statement in entry.executable
        ))

    def test_terminal_readback_still_requires_transient_membership_absence(self):
        p = plan()
        before = ledger()
        authorization = _authorization(p, before)
        for field in ("transient_membership_absent", "terminal_memberships_exact"):
            with self.subTest(field=field):
                cursor = Cursor(before)
                _own_transaction(cursor, authorization)
                cursor.readback[field] = False
                with patch.object(Path, "read_text", return_value="SELECT terminal_memberships_exact"), \
                        self.assertRaisesRegex(executor.SuccessorError, "terminal_readback"):
                    executor.apply_cursor(
                        cursor, plan=p, authorization=authorization,
                        attempt=_attempt(authorization),
                        deadline_monotonic=time.monotonic() + 10,
                    )
                self.assertIn(
                    executor._AUTHORITY_PRELUDE_SQL,
                    tuple(statement for statement, _ in cursor.calls),
                )

    def test_autocommit_false_xid_readonly_and_wrong_sentinel_fail_before_locks_or_mutation(self):
        p = plan()
        for name, transaction in (
            ("autocommit", ("off", None, False)),
            ("false-xid", ("off", "EXPECTED", False)),
            ("readonly", ("on", "EXPECTED", True)),
            ("wrong-sentinel", ("off", H, True)),
        ):
            with self.subTest(name=name):
                cursor = Cursor(ledger())
                authorization = _authorization(p, cursor.rows)
                expected = executor._transaction_attempt_binding(authorization, _attempt(authorization))
                cursor.transaction = tuple(expected if value == "EXPECTED" else value for value in transaction)
                with self.assertRaisesRegex(executor.SuccessorError, "transaction_ownership"):
                    executor.apply_cursor(
                        cursor, plan=p, authorization=authorization, attempt=_attempt(authorization),
                        deadline_monotonic=time.monotonic() + 10,
                    )
                sql = tuple(call[0] for call in cursor.calls)
                self.assertFalse(any(statement in executor._LOCK_SQL for statement in sql))
                self.assertNotIn(executor._LEDGER_SQL, sql)
                self.assertNotIn(executor._LEDGER_INSERT_SQL, sql)
        with self.assertRaisesRegex(executor.SuccessorError, "deadline"):
            executor.classify_cursor(Cursor(ledger()), plan=p, predecessor_ledger_root=H,
                                     target_ledger_root=H, deadline_monotonic=time.monotonic())

    def test_statement_failure_is_bounded_and_executor_never_owns_transaction(self):
        p = plan()
        cursor = Cursor(ledger())
        cursor.fail_sql = "SELECT 26"
        authorization = _authorization(p, cursor.rows)
        _own_transaction(cursor, authorization)
        with self.assertRaises(executor.SuccessorError) as caught:
            executor.apply_cursor(cursor, plan=p, authorization=authorization,
                                  attempt=_attempt(authorization),
                                  deadline_monotonic=time.monotonic() + 10)
        self.assertEqual(caught.exception.code, "statement_failure")
        self.assertEqual(set(caught.exception.evidence), {"version", "ordinal", "statement_sha256"})
        sql = tuple(call[0].strip().upper() for call in cursor.calls)
        self.assertFalse(any(value in {"BEGIN", "COMMIT", "ROLLBACK"} for value in sql))
        self.assertNotIn("secret", str(caught.exception))
    def test_each_claimed_starting_root_drift_blocks_before_mutation(self):
        p = plan()
        for attribute in ("ledger_root", "catalog_root", "acl_root", "data_root"):
            with self.subTest(attribute=attribute):
                cursor = Cursor(ledger())
                authorization = _authorization(p, cursor.rows)
                _own_transaction(cursor, authorization)
                observed = _observe(cursor, p)
                values = dict(observed.__dict__)
                values[attribute] = "f" * 64
                with patch.object(executor, "observe_live_state",
                                  return_value=executor.LiveState(**values)), \
                        self.assertRaisesRegex(executor.SuccessorError, "destructive_admission"):
                    executor.apply_cursor(
                        cursor, plan=p, authorization=authorization, attempt=_attempt(authorization),
                        deadline_monotonic=time.monotonic() + 10,
                    )
                self.assertNotIn(executor._LEDGER_INSERT_SQL, [sql for sql, _ in cursor.calls])

    def test_terminal_acl_overload_policy_role_and_force_rls_drift_fail(self):
        p = plan()
        before = ledger()
        authorization = _authorization(p, before)
        for field in executor._TERMINAL_FIELDS:
            cursor = Cursor(before)
            _own_transaction(cursor, authorization)
            cursor.readback[field] = False
            with self.assertRaisesRegex(executor.SuccessorError, "terminal_readback"):
                executor.apply_cursor(cursor, plan=p, authorization=authorization,
                                      attempt=_attempt(authorization),
                                      deadline_monotonic=time.monotonic() + 10)


def _pinned_027_source():
    return (Path(__file__).parents[1] / "migrations/20260713002700_g028_account_deletion_reauth_proof.sql").read_bytes()


def _observe(cursor, p):
    return executor.observe_live_state(
        cursor, plan=p,
        predecessor_ledger_root=executor.canonical_sha256(executor.PREDECESSOR_PAIRS),
        target_ledger_root=H, deadline_monotonic=time.monotonic() + 10,
    )


def _authorization(p, predecessor_rows):
    value = object.__new__(executor.VerifiedAuthorization)
    target_rows = tuple(predecessor_rows) + tuple(
        (entry.migration.version, entry.migration.name, entry.original) for entry in p.compiled
    )
    fields = {
        "predecessor_report_sha256": "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114",
        "target_fingerprint": "defdf3cc65753b4b4dcaa321b16b4347278239ae08e41f19a2d98fec9f3a0331",
        "predecessor_rows": 40, "target_rows": 42, "selected_versions": list(executor.SELECTED_VERSIONS),
        "vector_root": p.statement_vector_root, "target_spec_sha256": p.terminal_spec_root,
        "exclusions_root": p.excluded_root, "runtime_source_root": H,
        "starting_ledger_root": executor.canonical_sha256(tuple((v, n) for v, n, _ in predecessor_rows)),
        "target_ledger_root": executor.canonical_sha256(tuple((v, n) for v, n, _ in target_rows)),
        "starting_catalog_root": CATALOG_ROOT, "starting_acl_root": ACL_ROOT,
        "starting_data_root": executor._TERMINAL_DATA_SHA256,
        "target_catalog_root": CATALOG_ROOT, "target_acl_root": ACL_ROOT,
        "target_data_root": executor._TERMINAL_DATA_SHA256,
        "expires_at": int(time.time()) + 60, "authorization_id": "authorization",
        "attempt_id": "attempt", "authorization_sha256": H, "signature_sha256": H,
        "bindings_sha256": H,
    }
    for field, item in fields.items():
        object.__setattr__(value, field, item)
    p.manifest.predecessor_report_sha256 = fields["predecessor_report_sha256"]
    p.manifest.target_fingerprint = fields["target_fingerprint"]
    return value


def _own_transaction(cursor, authorization):
    cursor.transaction = (
        "off", executor._transaction_attempt_binding(authorization, _attempt(authorization)), True,
    )


def _attempt(authorization):
    value = object.__new__(executor.AttemptStarted)
    for field in ("authorization_id", "attempt_id", "target_fingerprint", "runtime_source_root",
                  "authorization_sha256", "signature_sha256", "bindings_sha256"):
        object.__setattr__(value, field, getattr(authorization, field, None))
    object.__setattr__(value, "receipt_sha256", H)
    return value

if __name__ == "__main__":
    unittest.main()
