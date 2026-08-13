#!/usr/bin/env python3
"""Build and verify the provider-owned ledger-50 Supabase CLI workspace.

The canonical local migration directory is intentionally not a valid input for
this hosted recovery.  The hosted ledger has an older, collided history.  This
tool creates an owner-only workspace containing fail-closed sentinels for the
50 already-applied versions and exact copies of the four forward migrations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import types
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
EXPECTED_CLI_VERSION = "2.109.1"
EXPECTED_CLI_SHA256 = (
    "b7be23f4e211b75c00a3df5fcd1f96f3905983c74ff3189bfc69ad5b0f7132c4"
)
EXPECTED_CLI_SIZE = 66_477_392
EXPECTED_HOSTED_CA_SHA256 = (
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
)
EXPECTED_HOSTED_CA_SIZE = 1_367
EXPECTED_PROJECT_REF = "aqlcofblfxdrjhhdmarw"
EXPECTED_PREDECESSOR_COUNT = 50
EXPECTED_PREDECESSOR_PAIR_SHA256 = (
    "14af921f7aa9e7714ba5e4b88ecdde4fc78f6f7ca40051fe1bc7e860d85a8db1"
)
EXPECTED_PREDECESSOR_STATEMENT_ROOT = (
    "ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4"
)
EXPECTED_G035_MANIFEST_SHA256 = (
    "bba79f264f26158d2fd93f62a0632f44ff8a0575619b50928e23ecefccf8ab95"
)
DUAL_RESTORE_VALIDATOR = (
    ROOT / "backend/supabase/scripts/run_g035_dual_restore_rehearsal.py"
)
DUAL_RESTORE_VALIDATOR_SHA256 = (
    "ab4b0c8c05a82a574ad662fc530899af721ec1506deb8b8aa0fd3aa3627891a2"
)
EXPECTED_RUNTIME_CONFIGURATION_SHA256 = (
    "86684fb40d84711e2739fcd47a67776de63066776780d5c32b6446994a1e73d8"
)
EXPECTED_POSTGRES_CUSTOM_TREE_ROOT = (
    "c564451c6c9bd5b645dcf2dc6ea5e8dc6912bf5ed4e6f51307662bfb129ac9b9"
)
FORWARD_SOURCE_SHA256 = {
    "20260814010000_hosted_g016_g041_catalog_reconciliation.sql":
        "0ade5034224e191dfc15f3a238134606bc29a1bfb9b5cbbbe8c82fa141d318ff",
    "20260814010100_hosted_runtime_boundary_convergence.sql":
        "b10708dc52f001676d6d6148dc4ed429d0e84ed4232df33031a312c96a75fec7",
    "20260814010200_hosted_public_profile_read_convergence.sql":
        "93738ef218cae9510f5e3989219edf73ca5e837bfba29e3fca1b2df7df26767c",
    "20260814010300_hosted_current_profile_mutation.sql":
        "dbcba23cf6d860b668b2bb160ebd6b753fdc77a3c7136d1490fdcd4e18587a67",
}
FORWARD_VERSIONS = tuple(name.split("_", 1)[0] for name in FORWARD_SOURCE_SHA256)
FIRST = MIGRATIONS / next(iter(FORWARD_SOURCE_SHA256))
PAIR = re.compile(r"\('([0-9]+)', '([A-Za-z0-9_-]+)'\)")
FILENAME = re.compile(r"^[0-9]+_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
SENTINEL = (
    b"DO $hosted_ledger50_predecessor_replay_forbidden$\n"
    b"BEGIN\n"
    b"  RAISE EXCEPTION 'hosted_ledger50_predecessor_replay_forbidden';\n"
    b"END\n"
    b"$hosted_ledger50_predecessor_replay_forbidden$;\n"
)
CONFIG = (
    'project_id = "hosted-ledger50-forward"\n\n'
    "[db]\nmajor_version = 17\n\n"
    "[db.migrations]\nenabled = true\nschema_paths = []\n\n"
    "[db.seed]\nenabled = false\nsql_paths = []\n"
).encode("ascii")
FORWARD_READBACK = ROOT / "backend/supabase/tests/hosted_forward_convergence_readback.sql"
PROFILE_READBACK = ROOT / "backend/supabase/tests/hosted_profile_convergence.sql"
READBACK_SOURCE_SHA256 = {
    FORWARD_READBACK.name:
        "dc39984d6f58d984ccbfad05a8be5e4d50d131c2bf5cf36d3839cc771a15ef9d",
    PROFILE_READBACK.name:
        "e3cbc02455028093e3b679764a00ff693ffa8ca633545618d7e3a21b0e851832",
}
MAX_CLI_OUTPUT = 65_536
DATABASE_STATEMENT_TIMEOUT_MS = 120_000
DATABASE_LOCK_TIMEOUT_MS = 5_000
DATABASE_IDLE_TRANSACTION_TIMEOUT_MS = 60_000
SERVICE_KEYS = {
    "host", "port", "dbname", "user", "password", "sslmode", "sslrootcert",
    "application_name", "connect_timeout",
}


class WorkspaceError(RuntimeError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _custodied_regular(path: Path, modes: tuple[int, ...], code: str) -> bytes:
    fd: int | None = None
    try:
        before = path.lstat()
        if (
            stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.getuid()
            or stat.S_IMODE(before.st_mode) not in modes
            or before.st_nlink != 1
        ):
            raise WorkspaceError(code)
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd)
        chunks: list[bytes] = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after_fd = os.fstat(fd)
        after_path = path.lstat()
    except OSError as error:
        raise WorkspaceError(code) from error
    finally:
        if fd is not None:
            os.close(fd)
    identity = (before.st_dev, before.st_ino, before.st_size)
    if (
        (opened.st_dev, opened.st_ino, opened.st_size) != identity
        or (after_fd.st_dev, after_fd.st_ino, after_fd.st_size) != identity
        or (after_path.st_dev, after_path.st_ino, after_path.st_size) != identity
        or stat.S_IMODE(after_fd.st_mode) not in modes
        or stat.S_IMODE(after_path.st_mode) not in modes
        or after_fd.st_uid != os.getuid()
        or after_path.st_uid != os.getuid()
        or after_fd.st_nlink != 1
        or after_path.st_nlink != 1
    ):
        raise WorkspaceError(code)
    return b"".join(chunks)


def _owned_regular(path: Path, mode: int = 0o600) -> bytes:
    return _custodied_regular(path, (mode,), "workspace_file_invalid")


def _owned_directory(path: Path) -> None:
    try:
        info = path.lstat()
    except OSError as error:
        raise WorkspaceError("workspace_directory_invalid") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise WorkspaceError("workspace_directory_invalid")


def _source_bytes(path: Path, digest: str) -> bytes:
    if not SHA256.fullmatch(digest):
        raise WorkspaceError("forward_source_contract_invalid")
    data = _custodied_regular(
        path, (0o600, 0o644), "forward_source_contract_invalid"
    )
    if _sha256(data) != digest:
        raise WorkspaceError("forward_source_contract_invalid")
    return data


def _readback_bytes(path: Path) -> bytes:
    digest = READBACK_SOURCE_SHA256.get(path.name)
    if digest is None:
        raise WorkspaceError("terminal_fixture_contract_invalid")
    try:
        data = _source_bytes(path, digest)
    except WorkspaceError as error:
        raise WorkspaceError("terminal_fixture_contract_invalid") from error
    return data


def predecessor_pairs() -> tuple[tuple[str, str], ...]:
    first = _source_bytes(FIRST, FORWARD_SOURCE_SHA256[FIRST.name])
    try:
        source = first.decode("utf-8")
        region = source[
            source.index("WITH expected(version, name) AS (") :
            source.index("), actual AS (")
        ]
    except (UnicodeDecodeError, ValueError) as error:
        raise WorkspaceError("predecessor_contract_invalid") from error
    pairs = tuple(PAIR.findall(region))
    canonical = json.dumps(
        pairs, ensure_ascii=True, separators=(",", ":")
    ).encode("ascii")
    if (
        len(pairs) != EXPECTED_PREDECESSOR_COUNT
        or len({version for version, _ in pairs}) != len(pairs)
        or pairs != tuple(sorted(pairs))
        or _sha256(canonical) != EXPECTED_PREDECESSOR_PAIR_SHA256
        or EXPECTED_PREDECESSOR_STATEMENT_ROOT not in source
    ):
        raise WorkspaceError("predecessor_contract_invalid")
    return pairs


def expected_files() -> dict[str, bytes]:
    result = {
        f"{version}_{name}.sql": SENTINEL
        for version, name in predecessor_pairs()
    }
    for name, digest in FORWARD_SOURCE_SHA256.items():
        if name in result or FILENAME.fullmatch(name) is None:
            raise WorkspaceError("forward_source_contract_invalid")
        result[name] = _source_bytes(MIGRATIONS / name, digest)
    if len(result) != EXPECTED_PREDECESSOR_COUNT + len(FORWARD_SOURCE_SHA256):
        raise WorkspaceError("workspace_file_set_invalid")
    return result


def _write_owned(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        raise WorkspaceError("workspace_write_failed") from error
    if _owned_regular(path) != data:
        raise WorkspaceError("workspace_write_failed")


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def prepare(output: Path) -> dict[str, object]:
    if not output.is_absolute() or output.exists() or output.is_symlink():
        raise WorkspaceError("workspace_output_invalid")
    parent = output.parent
    try:
        resolved_parent = parent.resolve(strict=True)
        parent_info = parent.lstat()
    except OSError as error:
        raise WorkspaceError("workspace_parent_invalid") from error
    if (
        resolved_parent != parent
        or stat.S_ISLNK(parent_info.st_mode)
        or not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.getuid()
        or stat.S_IMODE(parent_info.st_mode) & 0o022
    ):
        raise WorkspaceError("workspace_parent_invalid")
    files = expected_files()
    try:
        output.mkdir(mode=0o700)
        supabase = output / "supabase"
        migrations = supabase / "migrations"
        supabase.mkdir(mode=0o700)
        migrations.mkdir(mode=0o700)
        _write_owned(supabase / "config.toml", CONFIG)
        for name, data in sorted(files.items()):
            _write_owned(migrations / name, data)
        _fsync_directory(migrations)
        _fsync_directory(supabase)
        _fsync_directory(output)
        _fsync_directory(parent)
        return verify(output)
    except Exception:
        # Never claim a partial workspace. The caller owns cleanup of the exact
        # output path after inspecting the fixed error code.
        raise


def verify(workspace: Path) -> dict[str, object]:
    if not workspace.is_absolute() or workspace.resolve(strict=True) != workspace:
        raise WorkspaceError("workspace_directory_invalid")
    supabase = workspace / "supabase"
    migrations = supabase / "migrations"
    for directory in (workspace, supabase, migrations):
        _owned_directory(directory)
    try:
        workspace_entries = tuple(workspace.iterdir())
        supabase_entries = tuple(supabase.iterdir())
    except OSError as error:
        raise WorkspaceError("workspace_file_set_invalid") from error
    if {path.name for path in workspace_entries} != {"supabase"}:
        raise WorkspaceError("workspace_file_set_invalid")
    if {path.name for path in supabase_entries} != {"config.toml", "migrations"}:
        raise WorkspaceError("workspace_file_set_invalid")
    if _owned_regular(supabase / "config.toml") != CONFIG:
        raise WorkspaceError("workspace_config_invalid")
    expected = expected_files()
    try:
        entries = tuple(migrations.iterdir())
    except OSError as error:
        raise WorkspaceError("workspace_file_set_invalid") from error
    if {path.name for path in entries} != set(expected):
        raise WorkspaceError("workspace_file_set_invalid")
    for path in entries:
        if _owned_regular(path) != expected[path.name]:
            raise WorkspaceError("workspace_file_invalid")
    return {
        "schema": "hosted-ledger50-workspace-v1",
        "predecessorCount": EXPECTED_PREDECESSOR_COUNT,
        "forwardCount": len(FORWARD_SOURCE_SHA256),
        "terminalVersion": FORWARD_VERSIONS[-1],
        "sourceSha256": dict(FORWARD_SOURCE_SHA256),
    }


def validate_cli(cli: Path) -> None:
    try:
        data = _custodied_regular(cli, (0o755,), "supabase_cli_invalid")
        info = cli.lstat()
    except (OSError, WorkspaceError) as error:
        raise WorkspaceError("supabase_cli_invalid") from error
    if (
        not cli.is_absolute()
        or stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_nlink != 1
        or info.st_size != EXPECTED_CLI_SIZE
        or _sha256(data) != EXPECTED_CLI_SHA256
    ):
        raise WorkspaceError("supabase_cli_invalid")
    try:
        result = subprocess.run(
            [str(cli), "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise WorkspaceError("supabase_cli_invalid") from error
    if result.stdout.strip() != EXPECTED_CLI_VERSION or result.stderr:
        raise WorkspaceError("supabase_cli_invalid")


def _validate_plan(data: bytes, expected: tuple[str, ...]) -> tuple[str, ...]:
    if len(data) > MAX_CLI_OUTPUT:
        raise WorkspaceError("dry_run_plan_invalid")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise WorkspaceError("dry_run_plan_invalid") from error
    clean = re.sub(r"\x1b\[[0-9;]*m", "", text)
    planned = tuple(re.findall(r"(?m)^\s*[•*]\s+([^\s]+\.sql)\s*$", clean))
    if (
        "DRY RUN: migrations will *not* be pushed to the database." not in clean
        or planned != expected
        or any(flag in clean for flag in ("--include-all", "migration repair"))
    ):
        raise WorkspaceError("dry_run_plan_invalid")
    return planned


def _service_entries(path: Path, section: str) -> dict[str, str]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,63}", section):
        raise WorkspaceError("service_contract_invalid")
    data = _owned_regular(path)
    if not 0 < len(data) <= 16_384:
        raise WorkspaceError("service_contract_invalid")
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise WorkspaceError("service_contract_invalid") from error
    entries: dict[str, str] = {}
    headers = 0
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            headers += 1
            if line[1:-1] != section:
                raise WorkspaceError("service_contract_invalid")
            continue
        if headers != 1 or "=" not in line:
            raise WorkspaceError("service_contract_invalid")
        key, value = (part.strip() for part in line.split("=", 1))
        if (
            key in entries
            or key not in SERVICE_KEYS
            or not value
            or "://" in value
            or any(character in value for character in ("\x00", "\r", "\n"))
        ):
            raise WorkspaceError("service_contract_invalid")
        entries[key] = value
    required = {"host", "port", "dbname", "user", "password", "sslmode", "sslrootcert"}
    direct = f"db.{EXPECTED_PROJECT_REF}.supabase.co"
    pooler = re.fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com", entries.get("host", ""))
    expected_user = "postgres" if entries.get("host") == direct else f"postgres.{EXPECTED_PROJECT_REF}"
    if (
        headers != 1
        or not required <= entries.keys()
        or entries["host"] != direct and pooler is None
        or entries["user"] != expected_user
        or entries["dbname"] != "postgres"
        or entries["sslmode"] != "verify-full"
        or not entries["port"].isdigit()
        or not 1 <= int(entries["port"]) <= 65_535
        or (
            "connect_timeout" in entries
            and (
                not entries["connect_timeout"].isdigit()
                or not 1 <= int(entries["connect_timeout"]) <= 30
            )
        )
        or not entries["password"]
    ):
        raise WorkspaceError("service_contract_invalid")
    trust_root = Path(entries["sslrootcert"])
    try:
        resolved_trust_root = trust_root.resolve(strict=True)
    except OSError as error:
        raise WorkspaceError("service_contract_invalid") from error
    if not trust_root.is_absolute() or resolved_trust_root != trust_root:
        raise WorkspaceError("service_contract_invalid")
    trust_data = _owned_regular(trust_root)
    if (
        len(trust_data) != EXPECTED_HOSTED_CA_SIZE
        or _sha256(trust_data) != EXPECTED_HOSTED_CA_SHA256
        or trust_root == ROOT
        or ROOT in trust_root.parents
    ):
        raise WorkspaceError("service_contract_invalid")
    return entries


def _database_url(entries: dict[str, str]) -> str:
    query = urllib.parse.urlencode({
        "sslmode": entries["sslmode"],
        "sslrootcert": entries["sslrootcert"],
        "connect_timeout": entries.get("connect_timeout", "20"),
        "options": (
            f"-c statement_timeout={DATABASE_STATEMENT_TIMEOUT_MS} "
            f"-c lock_timeout={DATABASE_LOCK_TIMEOUT_MS} "
            "-c idle_in_transaction_session_timeout="
            f"{DATABASE_IDLE_TRANSACTION_TIMEOUT_MS}"
        ),
    })
    return (
        "postgresql://"
        f"{urllib.parse.quote(entries['user'], safe='')}@{entries['host']}:"
        f"{entries['port']}/{urllib.parse.quote(entries['dbname'], safe='')}?{query}"
    )


def _private_output_directory(path: Path) -> None:
    if not path.is_absolute() or path.exists() or path.is_symlink():
        raise WorkspaceError("execution_output_invalid")
    parent = path.parent
    _owned_directory(parent)
    path.mkdir(mode=0o700)
    _owned_directory(path)
    _fsync_directory(parent)


def _write_receipt(path: Path, value: dict[str, object]) -> None:
    data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n"
    _write_owned(path, data)
    _fsync_directory(path.parent)


def _write_secret(path: Path, data: bytes) -> None:
    """Write a short-lived credential file for later exact custody checks."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    created = False
    try:
        fd = os.open(path, flags, 0o600)
        created = True
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        info = path.lstat()
    except OSError as error:
        if created:
            try:
                path.unlink()
            except OSError:
                pass
        raise WorkspaceError("credential_custody_failed") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
        or info.st_nlink != 1
        or info.st_size != len(data)
    ):
        try:
            path.unlink()
        except OSError:
            pass
        raise WorkspaceError("credential_custody_failed")


def _pgpass_bytes(entries: dict[str, str]) -> bytes:
    password = entries["password"].replace("\\", "\\\\").replace(":", "\\:")
    return (
        f"{entries['host']}:{entries['port']}:{entries['dbname']}:"
        f"{entries['user']}:{password}\n"
    ).encode("utf-8")


def _verify_secret(path: Path, expected: bytes) -> None:
    try:
        actual = _custodied_regular(path, (0o600,), "credential_custody_failed")
    except WorkspaceError as error:
        raise WorkspaceError("credential_custody_failed") from error
    if actual != expected:
        raise WorkspaceError("credential_custody_failed")


def _run_cli(cli: Path, workspace: Path, database_url: str, pgpass: Path, *, dry_run: bool) -> bytes:
    command = [
        str(cli), "--workdir", str(workspace), "db", "push",
        "--db-url", database_url, "--yes",
    ]
    if dry_run:
        command.append("--dry-run")
    environment = {
        key: os.environ[key]
        for key in ("HOME", "PATH", "SYSTEMROOT", "TMPDIR", "USERPROFILE", "WINDIR")
        if key in os.environ
    }
    environment.update({
        "PGPASSFILE": str(pgpass),
        "PGCONNECT_TIMEOUT": "20",
        "NO_COLOR": "1",
        "SUPABASE_NO_KEYRING": "1",
    })
    try:
        result = subprocess.run(
            command,
            cwd=workspace,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600 if not dry_run else 180,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise WorkspaceError("supabase_cli_execution_failed") from error
    output = result.stdout + b"\n" + result.stderr
    if result.returncode != 0 or len(output) > MAX_CLI_OUTPUT:
        raise WorkspaceError("supabase_cli_execution_failed")
    return output


def _connect(entries: dict[str, str], *, autocommit: bool):
    try:
        import psycopg
        return psycopg.connect(
            host=entries["host"],
            port=int(entries["port"]),
            dbname=entries["dbname"],
            user=entries["user"],
            password=entries["password"],
            sslmode=entries["sslmode"],
            sslrootcert=entries["sslrootcert"],
            connect_timeout=int(entries.get("connect_timeout", "20")),
            options=(
                "-c default_transaction_read_only=on "
                f"-c statement_timeout={DATABASE_STATEMENT_TIMEOUT_MS} "
                f"-c lock_timeout={DATABASE_LOCK_TIMEOUT_MS} "
                "-c idle_in_transaction_session_timeout="
                f"{DATABASE_IDLE_TRANSACTION_TIMEOUT_MS}"
            ),
            autocommit=autocommit,
        )
    except Exception as error:
        raise WorkspaceError("database_connection_failed") from error


def _expected_forward_rows() -> tuple[tuple[str, str, int, str], ...]:
    return tuple(
        (
            name.split("_", 1)[0],
            name.split("_", 1)[1][:-4],
            count,
            digest,
        )
        for name, count, digest in _forward_statement_contracts()
    )


def _validated_forward_prefix(
    forwards: tuple[tuple[object, object, object, object], ...],
) -> tuple[tuple[str, str, int, str], ...]:
    try:
        normalized = tuple(
            (str(version), str(name), int(count), str(digest))
            for version, name, count, digest in forwards
        )
    except (TypeError, ValueError) as error:
        raise WorkspaceError("remote_ledger_contract_invalid") from error
    expected = _expected_forward_rows()
    if normalized != expected[:len(normalized)]:
        raise WorkspaceError("remote_ledger_contract_invalid")
    return normalized


def _remote_ledger(entries: dict[str, str]) -> dict[str, object]:
    pairs = predecessor_pairs()
    with _connect(entries, autocommit=False) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT version::text,name::text FROM supabase_migrations.schema_migrations "
                "WHERE version::text < '20260814010000' ORDER BY version::text"
            )
            actual_pairs = tuple((str(version), str(name)) for version, name in cursor.fetchall())
            cursor.execute(
                "SELECT encode(sha256(convert_to(json_agg(json_build_array(version::text,name::text,statements) "
                "ORDER BY version::text)::text,'UTF8')),'hex'), "
                "count(*) FILTER (WHERE statements IS NULL), "
                "count(*) FILTER (WHERE cardinality(statements)=0) "
                "FROM supabase_migrations.schema_migrations WHERE version::text < '20260814010000'"
            )
            root, null_count, empty_count = cursor.fetchone()
            cursor.execute(
                "SELECT version::text,name::text,cardinality(statements),"
                "encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex') "
                "FROM supabase_migrations.schema_migrations WHERE version::text >= '20260814010000' "
                "ORDER BY version::text"
            )
            forwards = tuple(cursor.fetchall())
        connection.rollback()
    if (
        actual_pairs != pairs
        or root != EXPECTED_PREDECESSOR_STATEMENT_ROOT
        or null_count != 0
        or empty_count != 7
    ):
        raise WorkspaceError("remote_ledger_contract_invalid")
    # Supabase CLI 2.109.1 commits each migration and its history row in a
    # separate implicit transaction.  A bounded restart may therefore admit
    # only an exact prefix of the four frozen forward rows.  Any gap, reorder,
    # body drift, or extra row is terminally ambiguous and rejected.
    normalized = _validated_forward_prefix(forwards)
    return {
        "predecessorCount": len(actual_pairs),
        "predecessorStatementRoot": root,
        "forwardCount": len(forwards),
        "forwardVersions": [row[0] for row in normalized],
    }


def _forward_statement_contracts() -> tuple[tuple[str, int, str], ...]:
    contracts = []
    for fixture in (FORWARD_READBACK, PROFILE_READBACK):
        try:
            source = _readback_bytes(fixture).decode("utf-8")
        except UnicodeDecodeError as error:
            raise WorkspaceError("terminal_fixture_contract_invalid") from error
        matches = re.findall(
            r"'([0-9]+)'::text,\s*'([A-Za-z0-9_]+)'::text,\s*"
            r"([0-9]+),\s*'([a-f0-9]{64})'::text",
            source,
        )
        if matches:
            current = tuple(
                (f"{version}_{name}.sql", int(count), digest)
                for version, name, count, digest in matches
            )
            if contracts and tuple(contracts) != current:
                raise WorkspaceError("terminal_fixture_contract_invalid")
            contracts = list(current)
    if tuple(name for name, _, _ in contracts) != tuple(FORWARD_SOURCE_SHA256):
        raise WorkspaceError("terminal_fixture_contract_invalid")
    return tuple(contracts)


def _execute_readbacks(entries: dict[str, str]) -> dict[str, str]:
    fixtures = (FORWARD_READBACK, PROFILE_READBACK)
    hashes: dict[str, str] = {}
    try:
        with _connect(entries, autocommit=True) as connection:
            for fixture in fixtures:
                data = _readback_bytes(fixture)
                hashes[fixture.name] = _sha256(data)
                connection.execute(data.decode("utf-8"))
    except WorkspaceError:
        raise
    except Exception as error:
        raise WorkspaceError("terminal_readback_failed") from error
    return hashes


def _bounded_failure_ledger(entries: dict[str, str]) -> dict[str, object]:
    """Return only an exact bounded prefix diagnostic after a failed push.

    A diagnostic read failure or a non-prefix ledger is intentionally folded
    into one fixed state.  It is never used to continue within this invocation.
    """
    try:
        state = _remote_ledger(entries)
        count = state["forwardCount"]
        versions = state["forwardVersions"]
        if (
            not isinstance(count, int)
            or not isinstance(versions, list)
            or len(versions) != count
            or any(not isinstance(item, str) for item in versions)
        ):
            raise WorkspaceError("remote_ledger_contract_invalid")
        return {
            "status": "exact-prefix-read-back",
            "forwardCount": count,
            "forwardVersions": versions,
        }
    except Exception:
        return {
            "status": "unavailable-or-invalid",
            "forwardCount": None,
            "forwardVersions": [],
        }


def _remove_secret(path: Path) -> None:
    try:
        path.unlink()
        _fsync_directory(path.parent)
        path.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise WorkspaceError("credential_custody_failed") from error
    raise WorkspaceError("credential_custody_failed")


def _git_binding(expected_commit: str, expected_tree: str) -> dict[str, str]:
    if not re.fullmatch(r"[a-f0-9]{40}", expected_commit) or not re.fullmatch(r"[a-f0-9]{40}", expected_tree):
        raise WorkspaceError("source_binding_invalid")
    git_environment = {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
    }
    def git(*args: str) -> str:
        try:
            result = subprocess.run(
                ["/usr/bin/git", "-C", os.fspath(ROOT), *args],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
                env=git_environment,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise WorkspaceError("source_binding_invalid") from error
        return result.stdout.strip()
    if (
        git("rev-parse", "HEAD") != expected_commit
        or git("show", "-s", "--format=%T", "HEAD") != expected_tree
        or git("status", "--porcelain=v1", "--untracked-files=all")
        or git("remote", "get-url", "origin") != "https://github.com/twoimo/tzudong.git"
    ):
        raise WorkspaceError("source_binding_invalid")
    try:
        remote = subprocess.run(
            [
                "/usr/bin/git", "-C", os.fspath(ROOT), "ls-remote",
                "--exit-code", "origin", "refs/heads/main",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
            env=git_environment,
        ).stdout.strip().split()
    except (OSError, subprocess.SubprocessError) as error:
        raise WorkspaceError("source_binding_invalid") from error
    if remote != [expected_commit, "refs/heads/main"]:
        raise WorkspaceError("source_binding_invalid")
    return {"commit": expected_commit, "tree": expected_tree}


def _require_external_path(path: Path, *, existing: bool) -> Path:
    try:
        resolved = path.resolve(strict=existing)
    except OSError as error:
        raise WorkspaceError("external_path_invalid") from error
    if not path.is_absolute() or resolved == ROOT or ROOT in resolved.parents:
        raise WorkspaceError("external_path_invalid")
    return resolved


def _dual_restore_module():
    source = _source_bytes(DUAL_RESTORE_VALIDATOR, DUAL_RESTORE_VALIDATOR_SHA256)
    module = types.ModuleType("tzudong_g035_dual_restore_validator")
    module.__file__ = os.fspath(DUAL_RESTORE_VALIDATOR)
    module.__package__ = ""
    try:
        code = compile(
            source,
            os.fspath(DUAL_RESTORE_VALIDATOR),
            "exec",
            dont_inherit=True,
            optimize=0,
        )
        exec(code, module.__dict__)
    except (SyntaxError, UnicodeError, ValueError, TypeError, RuntimeError) as error:
        raise WorkspaceError("recovery_evidence_invalid") from error
    return module


def _validate_recovery_evidence(
    capture_path: Path,
    dual_path: Path,
    archive_path: Path,
    expected_commit: str,
    docker: Path,
) -> dict[str, object]:
    module = _dual_restore_module()
    try:
        summary = module.validate_dual_restore_receipt(
            dual_path,
            capture_path,
            archive_path,
            ROOT,
            expected_commit,
            docker_binary=os.fspath(docker),
        )
    except Exception as error:
        raise WorkspaceError("recovery_evidence_invalid") from error
    required = {
        "schema", "status", "receiptSha256", "sourceCommit",
        "runtimeSourceRoot", "captureReceiptSha256", "archiveSha256",
        "captureReceiptMtimeNs", "archiveMtimeNs", "ledgerCount",
        "ledgerSha256", "restorableCatalogSha256", "managedCatalogSha256",
        "restoreRunReceiptIds", "g035RestoreReceiptSha256",
        "restoreReceiptBytesSha256", "restoreReceiptMtimeNs",
        "runtimeConfigurationSha256", "postgresCustomTreeRoot",
        "cleanupReceiptSha256",
        "cleanupLiveReadback", "observedAtUnixSeconds", "hostedMutations",
    }
    if (
        not isinstance(summary, dict)
        or set(summary) != required
        or summary.get("schema") != "local-dual-restore-rehearsal-v2"
        or summary.get("status") != "restored_compared_and_cleaned"
        or summary.get("sourceCommit") != expected_commit
        or summary.get("ledgerCount") != EXPECTED_PREDECESSOR_COUNT
        or summary.get("ledgerSha256") != EXPECTED_PREDECESSOR_PAIR_SHA256
        or summary.get("postgresCustomTreeRoot") != EXPECTED_POSTGRES_CUSTOM_TREE_ROOT
        or summary.get("cleanupLiveReadback") is not True
        or summary.get("hostedMutations") != 0
        or any(
            not isinstance(summary.get(key), str)
            or SHA256.fullmatch(summary[key]) is None
            for key in (
                "receiptSha256", "runtimeSourceRoot", "captureReceiptSha256",
                "archiveSha256", "ledgerSha256", "restorableCatalogSha256",
                "managedCatalogSha256", "cleanupReceiptSha256",
            )
        )
        or not isinstance(summary.get("restoreRunReceiptIds"), list)
        or len(summary["restoreRunReceiptIds"]) != 2
        or len(set(summary["restoreRunReceiptIds"])) != 2
        or any(
            not isinstance(item, str) or SHA256.fullmatch(item) is None
            for item in summary["restoreRunReceiptIds"]
        )
        or any(
            not isinstance(summary.get(key), list)
            or len(summary[key]) != 2
            or any(
                not isinstance(item, str) or SHA256.fullmatch(item) is None
                for item in summary[key]
            )
            for key in (
                "g035RestoreReceiptSha256", "restoreReceiptBytesSha256",
            )
        )
        or summary.get("runtimeConfigurationSha256")
        != [
            EXPECTED_RUNTIME_CONFIGURATION_SHA256,
            EXPECTED_RUNTIME_CONFIGURATION_SHA256,
        ]
        or not isinstance(summary.get("restoreReceiptMtimeNs"), list)
        or len(summary["restoreReceiptMtimeNs"]) != 2
        or any(
            type(item) is not int or item <= 0
            for item in summary["restoreReceiptMtimeNs"]
        )
    ):
        raise WorkspaceError("recovery_evidence_invalid")
    summary_sha256 = _sha256(
        json.dumps(
            summary, ensure_ascii=True, sort_keys=True, separators=(",", ":")
        ).encode("ascii")
    )
    return {
        "captureReceiptSha256": summary["captureReceiptSha256"],
        "dualRestoreReceiptSha256": summary["receiptSha256"],
        "archiveSha256": summary["archiveSha256"],
        "observedAtUnixSeconds": summary["observedAtUnixSeconds"],
        "validationSummarySha256": summary_sha256,
        "runtimeConfigurationSha256": EXPECTED_RUNTIME_CONFIGURATION_SHA256,
        "postgresCustomTreeRoot": EXPECTED_POSTGRES_CUSTOM_TREE_ROOT,
        "managedPitrAvailable": False,
        "recoveryMode": "local-encrypted-capture-and-dual-restore-v2",
    }


def _freeze_execution_inputs(
    *,
    workspace: Path,
    cli: Path,
    service_file: Path,
    service_name: str,
    entries: dict[str, str],
    pgpass: Path,
    pgpass_data: bytes,
    capture_receipt: Path,
    dual_restore_receipt: Path,
    encrypted_archive: Path,
    docker: Path,
    expected_commit: str,
    expected_tree: str,
    recovery: dict[str, object],
) -> None:
    _git_binding(expected_commit, expected_tree)
    validate_cli(cli)
    verify(workspace)
    _forward_statement_contracts()
    if _service_entries(service_file, service_name) != entries:
        raise WorkspaceError("service_contract_invalid")
    _verify_secret(pgpass, pgpass_data)
    refreshed_recovery = _validate_recovery_evidence(
        capture_receipt,
        dual_restore_receipt,
        encrypted_archive,
        expected_commit,
        docker,
    )
    if refreshed_recovery != recovery:
        raise WorkspaceError("recovery_evidence_invalid")


def execute(
    workspace: Path,
    output: Path,
    cli: Path,
    service_file: Path,
    service_name: str,
    capture_receipt: Path,
    dual_restore_receipt: Path,
    encrypted_archive: Path,
    docker: Path,
    expected_commit: str,
    expected_tree: str,
    confirm_project_ref: str,
) -> dict[str, object]:
    if confirm_project_ref != EXPECTED_PROJECT_REF:
        raise WorkspaceError("project_confirmation_invalid")
    workspace = _require_external_path(workspace, existing=True)
    output = _require_external_path(output, existing=False)
    service_file = _require_external_path(service_file, existing=True)
    capture_receipt = _require_external_path(capture_receipt, existing=True)
    dual_restore_receipt = _require_external_path(dual_restore_receipt, existing=True)
    encrypted_archive = _require_external_path(encrypted_archive, existing=True)
    if output == workspace or workspace in output.parents or output in workspace.parents:
        raise WorkspaceError("external_path_invalid")
    binding = _git_binding(expected_commit, expected_tree)
    recovery = _validate_recovery_evidence(
        capture_receipt,
        dual_restore_receipt,
        encrypted_archive,
        expected_commit,
        docker,
    )
    verify(workspace)
    validate_cli(cli)
    entries = _service_entries(service_file, service_name)
    _private_output_directory(output)
    pgpass = output / ".pgpass"
    pgpass_data = _pgpass_bytes(entries)
    _write_secret(pgpass, pgpass_data)
    stage = "preflight"
    caught: Exception | None = None
    receipt: dict[str, object] | None = None
    failure_remote: dict[str, object] | None = None
    try:
        before = _remote_ledger(entries)
        prefix = int(before["forwardCount"])
        remaining = tuple(FORWARD_SOURCE_SHA256)[prefix:]
        if remaining:
            stage = "dry_run"
            output_bytes = _run_cli(
                cli, workspace, _database_url(entries), pgpass, dry_run=True
            )
            planned = _validate_plan(output_bytes, remaining)
            verify(workspace)
            if _remote_ledger(entries) != before:
                raise WorkspaceError("remote_ledger_contract_invalid")
            dry_receipt = {
                "schema": "hosted-ledger50-dry-run-v3",
                "status": "passed",
                "projectRef": EXPECTED_PROJECT_REF,
                "cliVersion": EXPECTED_CLI_VERSION,
                "cliSha256": EXPECTED_CLI_SHA256,
                "admittedPrefixCount": prefix,
                "plannedMigrations": list(planned),
                "source": binding,
                "remote": before,
                "recovery": recovery,
            }
            _write_receipt(output / "dry-run-receipt.json", dry_receipt)
            # Freeze all local execution inputs again immediately before the
            # one authorized mutating subprocess.  The prior remote readback
            # and receipt write are deliberately before this final sequence.
            _freeze_execution_inputs(
                workspace=workspace, cli=cli, service_file=service_file,
                service_name=service_name, entries=entries, pgpass=pgpass,
                pgpass_data=pgpass_data, capture_receipt=capture_receipt,
                dual_restore_receipt=dual_restore_receipt,
                encrypted_archive=encrypted_archive, docker=docker,
                expected_commit=expected_commit, expected_tree=expected_tree,
                recovery=recovery,
            )
            stage = "push"
            # Exactly one push attempt is permitted per invocation.  A partial
            # commit is recovered only by a fresh invocation after readback.
            _run_cli(cli, workspace, _database_url(entries), pgpass, dry_run=False)
        stage = "readback"
        if not remaining:
            _freeze_execution_inputs(
                workspace=workspace, cli=cli, service_file=service_file,
                service_name=service_name, entries=entries, pgpass=pgpass,
                pgpass_data=pgpass_data, capture_receipt=capture_receipt,
                dual_restore_receipt=dual_restore_receipt,
                encrypted_archive=encrypted_archive, docker=docker,
                expected_commit=expected_commit, expected_tree=expected_tree,
                recovery=recovery,
            )
        after = _remote_ledger(entries)
        if after["forwardCount"] != len(FORWARD_SOURCE_SHA256):
            raise WorkspaceError("remote_ledger_contract_invalid")
        fixture_hashes = _execute_readbacks(entries)
        _freeze_execution_inputs(
            workspace=workspace, cli=cli, service_file=service_file,
            service_name=service_name, entries=entries, pgpass=pgpass,
            pgpass_data=pgpass_data, capture_receipt=capture_receipt,
            dual_restore_receipt=dual_restore_receipt,
            encrypted_archive=encrypted_archive, docker=docker,
            expected_commit=expected_commit, expected_tree=expected_tree,
            recovery=recovery,
        )
        receipt = {
            "schema": "hosted-ledger50-apply-v2",
            "status": (
                "already-applied-and-read-back" if not remaining
                else "applied-and-read-back"
            ),
            "projectRef": EXPECTED_PROJECT_REF,
            "cliVersion": EXPECTED_CLI_VERSION,
            "cliSha256": EXPECTED_CLI_SHA256,
            "source": binding,
            "before": before,
            "after": after,
            "terminalFixtureSha256": fixture_hashes,
            "recovery": recovery,
        }
    except Exception as error:
        caught = error
        failure_remote = _bounded_failure_ledger(entries)

    original_stage = stage
    if caught is None:
        stage = "credential_cleanup"
    try:
        _remove_secret(pgpass)
    except WorkspaceError as error:
        caught = error
        stage = "credential_cleanup"
        failure_remote = _bounded_failure_ledger(entries)

    if caught is not None:
        _write_receipt(output / "failure-receipt.json", {
            "schema": "hosted-ledger50-apply-failure-v2",
            "status": "failed",
            "stage": stage,
            "originalStage": original_stage,
            "projectRef": EXPECTED_PROJECT_REF,
            "source": binding,
            "postFailureRemote": failure_remote,
            "retryAttempted": False,
        })
        raise caught

    if receipt is None:
        raise WorkspaceError("apply_receipt_invalid")
    _write_receipt(output / "apply-receipt.json", receipt)
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("prepare")
    create.add_argument("--output-dir", type=Path, required=True)
    check = commands.add_parser("verify")
    check.add_argument("--workspace", type=Path, required=True)
    run = commands.add_parser("execute")
    run.add_argument("--workspace", type=Path, required=True)
    run.add_argument("--output-dir", type=Path, required=True)
    run.add_argument("--supabase-cli", type=Path, required=True)
    run.add_argument("--service-file", type=Path, required=True)
    run.add_argument("--service-name", required=True)
    run.add_argument("--capture-receipt", type=Path, required=True)
    run.add_argument("--dual-restore-receipt", type=Path, required=True)
    run.add_argument("--encrypted-archive", type=Path, required=True)
    run.add_argument("--docker", type=Path, required=True)
    run.add_argument("--expected-commit", required=True)
    run.add_argument("--expected-tree", required=True)
    run.add_argument("--confirm-project-ref", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            result = prepare(args.output_dir)
        elif args.command == "verify":
            result = verify(args.workspace)
        else:
            result = execute(
                args.workspace,
                args.output_dir,
                args.supabase_cli,
                args.service_file,
                args.service_name,
                args.capture_receipt,
                args.dual_restore_receipt,
                args.encrypted_archive,
                args.docker,
                args.expected_commit,
                args.expected_tree,
                args.confirm_project_ref,
            )
    except WorkspaceError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
