#!/usr/bin/env python3
"""Execute the home KPI RPC on the exact hosted PostgreSQL image, locally only.

Requires an existing local Docker engine. No installation, remote Docker context,
host port, hosted database, provider, browser or performance runner is used.
Every container has a random ownership label; cleanup verifies that label/ID.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.supabase.tests import home_youtube_kpi_fixture as fixture  # noqa: E402

IMAGE = "supabase/postgres:17.6.1.038@sha256:632b4da70fe03077f659e26ae5c2a2a177ab1348e487977afe822caef32f2676"
IMAGE_MANIFEST = IMAGE.split("@", 1)[1]
IMAGE_CONFIG = "sha256:e3d2cbf31805d05a5faa24969ff1126617e506d21f71993364aff5953e089263"
EXPECTED_SERVER = "170006"
PASSWORD = "home-kpi-isolated-fixture"
SOCKET = "/tmp/home-kpi-socket"
LABEL = "org.tzudong.home-kpi-fixture"
SOURCE_FILES = [Path(__file__), Path(fixture.__file__), fixture.MIGRATION, fixture.PREIMAGES,
                fixture.BEHAVIOR, Path(fixture.previous.__file__)] + [fixture.MIGRATIONS / name for name in fixture.CANONICAL_INPUTS]


class FixtureFailure(RuntimeError):
    pass


def checked(condition: bool, code: str) -> None:
    if not condition:
        raise FixtureFailure(code)


def source_hashes() -> dict[str, str]:
    return {str(path.relative_to(ROOT)): fixture.digest(path.read_bytes()) for path in SOURCE_FILES}


def safe_failure(stderr: str) -> str:
    match = re.search(r"\bHOME_KPI_(?:FIXTURE_)?[A-Z0-9_]+\b", stderr)
    if match:
        return match.group(0)[:100]
    match = re.search(r"ERROR:\s+([0-9A-Z]{5}):", stderr)
    return "HOME_KPI_SQL_" + match.group(1) if match else "HOME_KPI_COMMAND_FAILED"


def image_readback(image: dict, daemon_version: str) -> dict:
    """Retain only bounded image identity, never raw Docker inspect/config."""
    image_id = image.get("Id", "")
    digests = image.get("RepoDigests") or []
    return {
        "id": image_id if isinstance(image_id, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) else "invalid",
        "repoDigests": sorted(value for value in digests if isinstance(value, str)
                              and re.fullmatch(r"(?:docker\.io/)?supabase/postgres@sha256:[0-9a-f]{64}", value))[:8],
        "architecture": image.get("Architecture") if image.get("Architecture") in {"amd64", "arm64"} else "unsupported",
        "os": image.get("Os") if image.get("Os") in {"linux", "windows"} else "unsupported",
        "daemonVersion": daemon_version if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9_.-]+)?", daemon_version)
        and len(daemon_version) <= 64 else "unavailable",
    }


def admit_image(readback: dict) -> None:
    # Moby's classic store reports the config digest; its containerd store
    # reports the stored target descriptor digest. Both are exact known bytes
    # of this platform-specific pin, and the RepoDigest must independently bind
    # the pulled manifest. No index, arbitrary ID or alternate platform is admitted.
    checked(readback["id"] in {IMAGE_CONFIG, IMAGE_MANIFEST}
            and any(value in {"supabase/postgres@" + IMAGE_MANIFEST, "docker.io/supabase/postgres@" + IMAGE_MANIFEST}
                    for value in readback["repoDigests"])
            and readback["architecture"] == "amd64" and readback["os"] == "linux", "HOME_KPI_IMAGE_MISMATCH")


class OwnedDatabase:
    def __init__(self) -> None:
        self.token = uuid.uuid4().hex
        self.name = "home-kpi-" + self.token
        self.container_id: str | None = None
        self.image_id: str | None = None
        self.image_readback: dict | None = None
        self.launch_attempted = False

    @staticmethod
    def command(arguments: list[str], *, sql: str | None = None, timeout: int = 45,
                allow_failure: bool = False) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(arguments, input=sql, text=True, capture_output=True,
                                    timeout=timeout, check=False)
        except (subprocess.TimeoutExpired, OSError) as error:
            raise FixtureFailure("HOME_KPI_COMMAND_TIMEOUT" if isinstance(error, subprocess.TimeoutExpired)
                                 else "HOME_KPI_COMMAND_UNAVAILABLE") from None
        if result.returncode and not allow_failure:
            raise FixtureFailure(safe_failure(result.stderr))
        return result

    def owned(self) -> dict:
        result = self.command(["docker", "inspect", self.name])
        records = json.loads(result.stdout)
        checked(len(records) == 1, "HOME_KPI_CONTAINER_IDENTITY")
        value = records[0]
        checked(value["Id"] == self.container_id and value["Config"]["Labels"].get(LABEL) == self.token
                and value["HostConfig"]["NetworkMode"] == "none" and not value["HostConfig"].get("PortBindings")
                and value["Image"] == self.image_id, "HOME_KPI_CONTAINER_IDENTITY")
        return value

    def start(self) -> None:
        checked(shutil.which("docker") is not None, "HOME_KPI_LOCAL_DOCKER_REQUIRED")
        checked(not os.environ.get("DOCKER_HOST") or os.environ["DOCKER_HOST"].startswith("unix://"),
                "HOME_KPI_REMOTE_DOCKER_DENIED")
        context = self.command(["docker", "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])
        checked(json.loads(context.stdout).startswith("unix://"), "HOME_KPI_REMOTE_DOCKER_DENIED")
        # One bounded pull, no automatic retry, and no changes to daemon settings.
        self.command(["docker", "pull", "--platform", "linux/amd64", IMAGE], timeout=300)
        image = json.loads(self.command(["docker", "image", "inspect", IMAGE]).stdout)[0]
        daemon_version = self.command(["docker", "version", "--format", "{{.Server.Version}}"]).stdout.strip()
        self.image_readback = image_readback(image, daemon_version)
        admit_image(self.image_readback)
        self.image_id = self.image_readback["id"]
        startup = """
umask 077
mkdir /tmp/home-kpi-socket
printf '%s\\n' 'home-kpi-isolated-fixture' > /tmp/home-kpi-password
initdb -D /tmp/home-kpi-data -U fixture_bootstrap --encoding=UTF8 --locale=C --auth-local=scram-sha-256 --auth-host=reject --pwfile=/tmp/home-kpi-password >/tmp/home-kpi-init.log 2>&1
exec postgres -D /tmp/home-kpi-data -c listen_addresses='' -c unix_socket_directories=/tmp/home-kpi-socket -c shared_preload_libraries='' -c max_connections=20
"""
        self.launch_attempted = True
        launched = self.command([
            "docker", "run", "--detach", "--name", self.name, "--label", LABEL + "=" + self.token,
            "--network", "none", "--user", "postgres", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--memory", "1g", "--cpus", "2", "--pids-limit", "128", "--tmpfs", "/tmp:rw,size=536870912,mode=1777",
            "--entrypoint", "/bin/bash", IMAGE, "-ceu", startup,
        ])
        self.container_id = launched.stdout.strip()
        checked(re.fullmatch(r"[0-9a-f]{64}", self.container_id) is not None, "HOME_KPI_CONTAINER_IDENTITY")
        self.owned()
        for _ in range(30):
            ready = self.command(["docker", "exec", self.name, "pg_isready", "-h", SOCKET,
                                  "-U", "fixture_bootstrap", "-d", "postgres"], allow_failure=True)
            if ready.returncode == 0:
                return
            checked(self.owned()["State"]["Running"], "HOME_KPI_CONTAINER_STOPPED")
            time.sleep(1)
        raise FixtureFailure("HOME_KPI_READINESS_TIMEOUT")

    def sql(self, text: str, database: str = "postgres", user: str = "fixture_bootstrap",
            *, allow_failure: bool = False, single_transaction: bool = False) -> subprocess.CompletedProcess[str]:
        self.owned()
        command = [
            "docker", "exec", "--interactive", "--env", "PGPASSWORD=" + PASSWORD, self.name,
            "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
            "--host", SOCKET, "--username", user, "--dbname", database, "--file=-",
        ]
        if single_transaction:
            command.append("--single-transaction")
        return self.command(command, sql="\\set VERBOSITY verbose\n" + text, allow_failure=allow_failure)

    def json(self, text: str, database: str = "postgres") -> dict:
        output = self.sql(text, database).stdout.strip().splitlines()
        checked(bool(output), "HOME_KPI_SQL_RESULT_MISSING")
        return json.loads(output[-1])

    def setup(self, name: str, definitions: dict[str, str]) -> None:
        checked(re.fullmatch(r"kpi_[a-z_]+", name) is not None, "HOME_KPI_DATABASE_NAME")
        self.sql("CREATE DATABASE " + name + " OWNER postgres TEMPLATE template0;")
        self.sql(fixture.setup_database_sql(definitions), name)

    def cleanup(self) -> bool:
        if self.container_id is None:
            if not self.launch_attempted:
                return True
            # A timed-out docker run may already have created the container.
            # Reconcile its unique label instead of treating missing stdout as
            # proof that nothing ran or dispatching another run.
            result = self.command(["docker", "ps", "--all", "--no-trunc", "--quiet", "--filter", "label=" + LABEL + "=" + self.token])
            identities = result.stdout.strip().splitlines()
            if not identities:
                return True
            checked(len(identities) == 1 and re.fullmatch(r"[0-9a-f]{64}", identities[0]) is not None,
                    "HOME_KPI_CONTAINER_IDENTITY")
            self.container_id = identities[0]
        self.owned()
        self.command(["docker", "rm", "--force", "--volumes", self.name])
        result = self.command(["docker", "ps", "--all", "--quiet", "--filter", "label=" + LABEL + "=" + self.token])
        checked(result.stdout.strip() == "", "HOME_KPI_CLEANUP_FAILED")
        return True


def state_digest(state: dict) -> str:
    return fixture.digest(json.dumps(state, sort_keys=True, separators=(",", ":")))


def verify_success(database: OwnedDatabase, variant: str, definitions: dict[str, str]) -> dict:
    name = "kpi_" + variant
    database.setup(name, definitions)
    before = database.json(fixture.STATE_SQL, name)
    database.sql(fixture.MIGRATION.read_text(), name, "postgres", single_transaction=True)
    after = database.json(fixture.STATE_SQL, name)
    checked(before["memberships"] == after["memberships"] and after["effectiveOwnerAccess"] == [False, False],
            "HOME_KPI_MEMBERSHIP_RESTORATION")
    checked(before["table"] == after["table"] and before["columns"] == after["columns"], "HOME_KPI_TABLE_CHANGED")
    for validator, metadata in before["validators"].items():
        next_metadata = after["validators"][validator]
        checked({k: v for k, v in metadata.items() if k != "prosrc"}
                == {k: v for k, v in next_metadata.items() if k != "prosrc"}, "HOME_KPI_VALIDATOR_METADATA_CHANGED")
        expected = (fixture.expected_patched_body(definitions[validator], validator)
                    if validator != "assert_g014_public_rpc_allowlist" else fixture.body(definitions[validator]))
        checked(next_metadata["prosrc"] == expected, "HOME_KPI_VALIDATOR_SOURCE_CHANGED")
    checked(before["registry"] == [] and after["registry"] == [{
        "function_schema": "public", "function_name": "get_home_youtube_kpi_metrics",
        "identity_arguments": "1009", "grantee": "service_role",
        "source_signature": "public.get_home_youtube_kpi_metrics(text[])",
    }], "HOME_KPI_REGISTRY_CHANGED")
    checked(after["rpc"]["prosrc"] == fixture.previous.tagged(fixture.MIGRATION.read_text(), "home_kpi_function"),
            "HOME_KPI_RPC_SOURCE_CHANGED")
    check_validators = "SET ROLE privacy_workflow_owner; SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); RESET ROLE;"
    database.sql(check_validators, name)
    catalog = definitions["assert_g014_catalog_contract"].replace(fixture.body(definitions["assert_g014_catalog_contract"]),
                                                                after["validators"]["assert_g014_catalog_contract"]["prosrc"])
    database.sql(fixture.catalog_loop_sql(catalog), name)
    behavior = database.json(fixture.BEHAVIOR.read_text(), name)
    checked(behavior["count"] == 10 and len(behavior["cases"]) == 10, "HOME_KPI_BEHAVIOR_INCOMPLETE")
    checked(database.json(fixture.STATE_SQL, name) == after, "HOME_KPI_BEHAVIOR_ROLLBACK")
    repeated = database.sql(fixture.MIGRATION.read_text(), name, "postgres", allow_failure=True, single_transaction=True)
    checked(repeated.returncode != 0 and safe_failure(repeated.stderr) == "HOME_KPI_IDENTITY_EXISTS"
            and database.json(fixture.STATE_SQL, name) == after, "HOME_KPI_REAPPLY_CHANGED_STATE")

    # The actual retained validators must still reject permission/mode drift.
    rejected = []
    for code, change in [
        ("definer", "ALTER FUNCTION public.get_home_youtube_kpi_metrics(text[]) SECURITY DEFINER;"),
        ("stable", "ALTER FUNCTION public.get_home_youtube_kpi_metrics(text[]) STABLE;"),
        ("path", "ALTER FUNCTION public.get_home_youtube_kpi_metrics(text[]) SET search_path=public;"),
        ("anon", "GRANT EXECUTE ON FUNCTION public.get_home_youtube_kpi_metrics(text[]) TO anon;"),
        ("grant_option", "GRANT EXECUTE ON FUNCTION public.get_home_youtube_kpi_metrics(text[]) TO service_role WITH GRANT OPTION;"),
        ("missing_service", "REVOKE EXECUTE ON FUNCTION public.get_home_youtube_kpi_metrics(text[]) FROM service_role;"),
    ]:
        result = database.sql("BEGIN; " + change + check_validators + fixture.catalog_loop_sql(catalog) + " ROLLBACK;", name, allow_failure=True)
        checked(result.returncode != 0 and database.json(fixture.STATE_SQL, name) == after,
                "HOME_KPI_VALIDATOR_DRIFT_UNDETECTED")
        rejected.append(code)
    return {"behaviorCases": behavior["cases"], "validatorDriftCases": rejected,
            "membershipsRestored": True, "validatorMetadataPreserved": True, "tableBoundaryPreserved": True,
            "strictReapplyRejectedWithoutChanges": True, "beforeSha256": state_digest(before), "afterSha256": state_digest(after)}


def verify_registration_rollback(database: OwnedDatabase, definitions: dict[str, str]) -> list[str]:
    passed = []
    for case in ["catalog_drift", "lease_failure", "outer_finalize_failure"]:
        name = "kpi_" + case
        database.setup(name, definitions)
        if case == "catalog_drift":
            definition = definitions["assert_g014_catalog_contract"]
            database.sql(definition.replace(fixture.body(definition), fixture.body(definition) + "\n"), name)
        elif case == "lease_failure":
            # Owner custody is acquired first, then temporary function creation
            # really fails on language USAGE. The postgres caller still has that
            # right, so the failure occurs after SET ROLE, not in an earlier DO.
            # Closing the failed transaction must undo the live role lease.
            database.sql("REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC,privacy_workflow_owner; GRANT USAGE ON LANGUAGE plpgsql TO postgres;", name)
        before = database.json(fixture.STATE_SQL, name)
        source = fixture.MIGRATION.read_text()
        if case == "outer_finalize_failure":
            # Exact migration bytes plus a failing executor-finalization
            # statement: no internal COMMIT may strand DDL outside the wrapper.
            source += "\nSELECT 1/0;\n"
        result = database.sql(source, name, "postgres", allow_failure=True, single_transaction=True)
        checked(result.returncode != 0, "HOME_KPI_REGISTRATION_FAILURE_NOT_REJECTED")
        if case == "catalog_drift":
            checked(safe_failure(result.stderr) == "HOME_KPI_SOURCE_DRIFT", "HOME_KPI_WRONG_DRIFT_FAILURE")
        elif case == "lease_failure":
            checked("42501" in result.stderr, "HOME_KPI_WRONG_LEASE_FAILURE")
        else:
            checked("22012" in result.stderr, "HOME_KPI_WRONG_FINALIZATION_FAILURE")
        checked(database.json(fixture.STATE_SQL, name) == before, "HOME_KPI_REGISTRATION_ROLLBACK_FAILED")
        passed.append(case)
    return passed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    def interrupted(_signal: int, _frame: object) -> None:
        raise FixtureFailure("HOME_KPI_INTERRUPTED")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    database = OwnedDatabase()
    before = source_hashes()
    receipt: dict = {"schemaVersion": 1, "status": "started", "image": IMAGE, "imageConfig": IMAGE_CONFIG,
                     "sourceSha256": before, "hostedWrites": 0, "providerCalls": 0, "networkMode": "none",
                     "limits": "Synthetic KPI data; actual allowlist/definer validators and exact catalog RPC loop. Full G014 relation graph, hosted deployment and performance are not proven."}
    for key, variable in [("runId", "GITHUB_RUN_ID"), ("runAttempt", "GITHUB_RUN_ATTEMPT")]:
        value = os.environ.get(variable)
        if value and value.isdigit():
            receipt[key] = value
    stage = "prerequisites"
    try:
        source = database.command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.strip()
        checked(re.fullmatch(r"[0-9a-f]{40}", source) is not None, "HOME_KPI_SOURCE_IDENTITY")
        receipt["sourceCommit"] = source
        hosted = fixture.hosted_definitions()
        canonical = fixture.canonical_definitions()
        stage = "database_start"
        database.start()
        version = database.json("SELECT jsonb_build_object('serverVersionNum',current_setting('server_version_num'),'serverVersion',current_setting('server_version'),'isolation',current_setting('transaction_isolation'));")
        checked(version["serverVersionNum"] == EXPECTED_SERVER and version["isolation"] == "read committed",
                "HOME_KPI_DATABASE_VERSION")
        receipt["database"] = version
        database.sql("""
CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD 'home-kpi-isolated-fixture';
CREATE ROLE privacy_workflow_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT NOBYPASSRLS;
CREATE ROLE privacy_auth_bridge NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB INHERIT NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
""")
        receipt["variants"] = {}
        for variant, definitions in [("hosted", hosted), ("canonical", canonical)]:
            stage = variant + "_contract"
            receipt["variants"][variant] = verify_success(database, variant, definitions)
        stage = "registration_rollback"
        receipt["registrationRollbackCases"] = verify_registration_rollback(database, hosted)
        checked(source_hashes() == before, "HOME_KPI_SOURCE_CHANGED_DURING_TEST")
        receipt["status"] = "passed"
    except (FixtureFailure, ValueError, KeyError, OSError) as error:
        receipt["status"] = "failed"
        receipt["failure"] = {"stage": stage, "code": str(error) if isinstance(error, FixtureFailure) else "HOME_KPI_FIXTURE_INPUT"}
    finally:
        if database.image_readback is not None:
            receipt["imageReadback"] = database.image_readback
        try:
            receipt["ownedContainerRemoved"] = database.cleanup()
        except (FixtureFailure, ValueError, KeyError, OSError):
            receipt["status"] = "failed"
            receipt["ownedContainerRemoved"] = False
            receipt["failure"] = {"stage": "cleanup", "code": "HOME_KPI_CLEANUP_FAILED"}
        receipt["sourceStable"] = source_hashes() == before
        if not receipt["sourceStable"]:
            receipt["status"] = "failed"
            receipt["failure"] = {"stage": "source_readback", "code": "HOME_KPI_SOURCE_CHANGED_DURING_TEST"}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        temporary.replace(args.output)
    print(json.dumps({"status": receipt["status"], "stage": receipt.get("failure", {}).get("stage"),
                      "code": receipt.get("failure", {}).get("code"), "ownedContainerRemoved": receipt["ownedContainerRemoved"]}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
