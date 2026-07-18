#!/usr/bin/env python3
"""Protected, fail-closed G037 hosted migration executor.

Credentials are obtained only by environment *name*.  Receipts contain only
hashes/counts/booleans; SQL, DSNs and operator identity never leave process memory.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, tempfile, time
from pathlib import Path
from g037_hosted_closure_contract import BASELINE_PAIRS, BASELINE_RPC_MATRIX, DOCUMENTS_POLICY_COMPATIBILITY_PRESTATE, DOCUMENTS_POLICY_COMPATIBILITY_VERSION, G014_RPC_ALLOWLIST_FRAGMENTS, G014_RPC_ALLOWLIST_SOURCES, G014_RPC_ALLOWLIST_VERSION, MANAGED_ROLES, MANIFEST_SHA256, MODES, ROLE_FLAGS, ROLE_PROTOCOL_EPILOGUE, ROLE_PROTOCOL_EPILOGUE_SHA256, ROLE_PROTOCOL_EPILOGUE_VECTOR_SHA256, ROLE_SPLICES, ROLE_SPLICE_GROUPS, SELF_WRAPPING, STATIC_RPC_MATRIX, STATIC_RPC_MATRIX_SHA256, TERMINAL_MANAGED_ROWS, TRANSIENT_MANAGED_ROWS, ContractError, canonical_bytes, digest, no_duplicate_object, repository_root, terminal_spec, validate_sources
from g035_hosted_recovery_contract import SHORT_URL_SELECTION_SPEC, SHORT_URLS_CATALOG, canonical_sha256
from g037_write_freeze import CONTROLLER_PUBLIC_KEY_SHA256, Relation, VerifiedControllerCapability, VerifiedRecoveryCapture, validate_table_acl_rows
from g037_remediation_authorization import ExecutionAuthorizationEnvelope, authorize_exact_baseline, POLICY
from preflight_g034_hosted_migration_closure import approval_body_contract, approval_catalog_contract

SCHEMA="g037-hosted-closure-receipt-v3"; ENV=re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$"); COMMIT=re.compile(r"^[a-f0-9]{40}$")
class ClosureError(RuntimeError): pass
_DOCUMENTS_POLICY_COMPATIBILITY_VERSION = DOCUMENTS_POLICY_COMPATIBILITY_VERSION
_DOCUMENTS_POLICY_CONTRACT = DOCUMENTS_POLICY_COMPATIBILITY_PRESTATE
def _prepare_documents_policy_compatibility(cur,item,*,deadline):
    """Accept only absent or source-pinned prestate and record the exact outcome."""
    if item.version != _DOCUMENTS_POLICY_COMPATIBILITY_VERSION:
        return {"status":"not-applicable"}
    rows=tuple(
        (str(name),str(command),tuple(map(str,roles)),bool(permissive),qual,with_check)
        for name,command,roles,permissive,qual,with_check in q(cur,"""
            SELECT p.polname,
                   CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                                 WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END,
                   ARRAY(SELECT COALESCE(role.rolname,'PUBLIC')
                         FROM pg_catalog.unnest(p.polroles) AS policy_role(oid)
                         LEFT JOIN pg_catalog.pg_roles AS role ON role.oid=policy_role.oid
                         ORDER BY 1),
                   p.polpermissive,
                   pg_catalog.pg_get_expr(p.polqual,p.polrelid),
                   pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)
            FROM pg_catalog.pg_policy AS p
            WHERE p.polrelid='public.documents'::pg_catalog.regclass
              AND p.polname=ANY(%s)
            ORDER BY p.polname
        """,(list(name for name,*_ in _DOCUMENTS_POLICY_CONTRACT),))
    )
    if not rows:
        return {"status":"absent"}
    if rows != _DOCUMENTS_POLICY_CONTRACT:
        raise ClosureError("documents policy compatibility contract drift")
    for name,*_ in _DOCUMENTS_POLICY_CONTRACT:
        _execute_before_deadline(cur,f'DROP POLICY "{name}" ON public.documents',deadline=deadline)
    return {"status":"exact-repaired","prestate_sha256":digest(rows)}
def emit(x): print(canonical_bytes(x).decode("ascii"))
def receipt(mode,status,evidence):
    # Deliberately whitelist receipt fields instead of attempting to redact arbitrary data.
    safe={k:v for k,v in evidence.items() if k in {"commit_sha256","source_sha256","ledger_sha256","catalog_sha256","acl_sha256","migration_count","ledger_count","retirement_gate","rehearsal","runtime_authorization_denied","ambiguous_commit","managed_role_sha256","terminal_spec_sha256","checkpoint_sha256","documents_policy_compatibility"}}
    item={"schema":SCHEMA,"mode":mode,"status":status,"manifest_sha256":MANIFEST_SHA256,"evidence":safe}; item["receipt_sha256"]=digest(item); return item
def root_commit(root):
    try: value=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],capture_output=True,text=True,check=True).stdout.strip()
    except Exception as exc: raise ClosureError("commit unavailable") from exc
    if not COMMIT.fullmatch(value): raise ClosureError("commit unavailable")
    return value
def connection(env_name):
    if not ENV.fullmatch(env_name) or not os.environ.get(env_name): raise ClosureError("database credential environment unavailable")
    try:
        import psycopg
        return psycopg.connect(
            os.environ[env_name],
            autocommit=False,
            connect_timeout=10,
            options="-c statement_timeout=30000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000",
        )
    except Exception as exc: raise ClosureError("database connection unavailable") from exc
def q(cur,sql,params=()): cur.execute(sql,params); return cur.fetchall() if cur.description else []
def ledger(cur): return tuple((str(a),str(b),tuple(c)) for a,b,c in q(cur,"SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version,name"))
def retirement_gate(cur):
    # Source-bound gate: table is retired AND no executable/catalog definition references it.
    table=bool(q(cur,"SELECT pg_catalog.to_regclass('public.restaurants_backup') IS NULL")[0][0])
    scans=("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)' ELSE false END)","SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_views v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')","SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_matviews v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')","SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND pg_catalog.pg_get_triggerdef(t.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')","SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.rulename <> '_RETURN' AND pg_catalog.pg_get_ruledef(r.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')","SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE pg_catalog.pg_get_constraintdef(c.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')")
    if not table or any(bool(q(cur,s)[0][0]) for s in scans): raise ClosureError("source-bound retirement gate failed")
    contract=approval_body_contract()
    results=approval_catalog_contract(cur,contract)
    if set(results)!=set(contract) or not all(results.values()): raise ClosureError("source-bound retirement approval contract drift")
def catalog(cur, manifest, *, terminal=False):
    cur.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    rows=ledger(cur)
    expected_pairs=BASELINE_PAIRS+tuple((x.version,x.name) for x in manifest.migrations)
    pairs=tuple((version,name) for version,name,_ in rows)
    if pairs != (expected_pairs if terminal else BASELINE_PAIRS): raise ClosureError("ledger state does not match requested mode")
    retirement_gate(cur)
    locks=q(cur,"SELECT pg_catalog.count(*) FROM pg_catalog.pg_locks WHERE NOT granted")[0][0]
    if int(locks): raise ClosureError("waiting locks present")
    return rows,digest({"ledger":rows,"retirement":"passed"})
def runtime_probe(cur):
    cur.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    signature="public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)"
    rows=q(cur,"SELECT pg_catalog.to_regprocedure(%s)",(signature,))
    if len(rows)!=1 or rows[0][0] is None: raise ClosureError("terminal mutator unavailable")
    denied=bool(q(cur,"SELECT NOT pg_catalog.has_function_privilege(current_user, pg_catalog.to_regprocedure(%s), 'EXECUTE')",(signature,))[0][0])
    if not denied: raise ClosureError("runtime probe authorization unexpectedly granted")
    return denied
_WRAPPER_PREAMBLE=rb"(?:\s|--[^\r\n]*(?:\r\n|\n|\r|$)|/\*.*?\*/)*"
def source_sql(root,item):
    raw=(root/item.path).read_bytes() # validate_sources has already raw-hash checked it.
    if item.version not in SELF_WRAPPING:
        if re.search(rb"(?im)^\s*(begin|commit|rollback)\s*;",raw): raise ClosureError("transaction-control drift")
        return raw
    m=re.fullmatch(_WRAPPER_PREAMBLE+rb"BEGIN\s*;(.*?)COMMIT\s*;\s*",raw,re.S|re.I)
    if not m or re.search(rb"(?im)^\s*(begin|commit|rollback)\s*;",m.group(1)): raise ClosureError("self-wrapper drift")
    return m.group(1)
def vectors(root,item, *, raw=None, source_sha256=None):
    tool=root/"backend/supabase/scripts/g037_supabase_statement_vector.mjs"
    temporary = None
    if raw is None:
        source=root/item.path
        source_sha256=item.sha256
    else:
        temporary=tempfile.NamedTemporaryFile(prefix=f"{item.version}_managed_role_", suffix=".sql", delete=False)
        temporary.write(raw); temporary.close()
        source=Path(temporary.name)
    try:
        result=subprocess.run(["node",str(tool),"--source",str(source),"--version",item.version,"--sha256",source_sha256,"--size",str(source.stat().st_size)],capture_output=True,text=True,timeout=60)
        source_size=source.stat().st_size
    finally:
        if temporary is not None: Path(temporary.name).unlink(missing_ok=True)
    if result.returncode: raise ClosureError("official parser unavailable")
    try: data=json.loads(result.stdout,object_pairs_hook=no_duplicate_object)
    except Exception as exc: raise ClosureError("parser vector invalid") from exc
    upstream={"commit":"6d4c19870ed213ba7f682f117d0345c8a40bfa94","version":"v2.109.1","token":{"path":"apps/cli-go/pkg/parser/token.go","blob":"db008434246be335b9f7abaf0cb66a99a2b40378"},"state":{"path":"apps/cli-go/pkg/parser/state.go","blob":"47775390d1731c0ad29e10b20fb2fe16c8cfcadb"}}
    if set(data)!={"schema","upstream","version","source_sha256","source_size","statements"} or data["schema"]!="g037-supabase-statement-vector-v1" or data["upstream"]!=upstream or data["version"]!=item.version or data["source_sha256"]!=source_sha256 or data["source_size"]!=source_size or not isinstance(data["statements"],list) or not data["statements"] or any(not isinstance(x,str) or not x.strip() for x in data["statements"]): raise ClosureError("parser vector mismatch")
    full=tuple(data["statements"])
    controls=lambda statement: bool(re.match(r"(?is)^\s*(begin|commit|rollback)\b",statement))
    if item.version not in SELF_WRAPPING:
        if any(controls(statement) for statement in full): raise ClosureError("ordinary migration transaction-control drift")
        return full,full
    if len(full)<3 or not re.fullmatch(_WRAPPER_PREAMBLE.decode("ascii")+r"begin\s*",full[0],re.S|re.I) or not re.fullmatch(r"(?is)\s*commit\s*",full[-1]) or any(controls(statement) for statement in full[1:-1]): raise ClosureError("self-wrapper vector drift")
    return full,full[1:-1]
_ROLE_SPLICE_LABELS = (
    "00450-role", "00450-schema", "02000-role", "02000-schema-pair",
    "02000-full-assertion-definition", "02000-in-flight-invocation", "02400-role-block",
)
_ROLE_SPLICE_VERSIONS = ("20260713000450", "20260713002000", "20260713002400")
_SPLICE_FIELDS = frozenset(("label", "version", "old", "new", "start", "end", "old_sha256", "new_sha256"))
_GROUP_FIELDS = frozenset(("version", "source_sha256", "transformed_source_sha256", "original_vector_sha256", "transformed_vector_sha256"))
_HEX64 = re.compile(r"^[a-f0-9]{64}$")
def _splice_specs(root, manifest):
    """Validate the complete immutable splice table and transform each source once."""
    if not isinstance(ROLE_SPLICES, tuple) or len(ROLE_SPLICES) != 7:
        raise ClosureError("managed role splice count drift")
    if tuple(record.get("label") if isinstance(record, dict) else None for record in ROLE_SPLICES) != _ROLE_SPLICE_LABELS:
        raise ClosureError("managed role splice order drift")
    if not isinstance(ROLE_SPLICE_GROUPS, tuple) or len(ROLE_SPLICE_GROUPS) != 3:
        raise ClosureError("managed role splice group count drift")
    groups = {}
    for group in ROLE_SPLICE_GROUPS:
        if not isinstance(group, dict) or frozenset(group) != _GROUP_FIELDS or group.get("version") in groups:
            raise ClosureError("managed role splice group schema drift")
        if not all(isinstance(group[key], str) and _HEX64.fullmatch(group[key]) for key in _GROUP_FIELDS - {"version"}):
            raise ClosureError("managed role splice group hash drift")
        groups[group["version"]] = group
    if tuple(groups) != _ROLE_SPLICE_VERSIONS:
        raise ClosureError("managed role splice group order drift")
    records_by_version = {version: [] for version in _ROLE_SPLICE_VERSIONS}
    for record in ROLE_SPLICES:
        if not isinstance(record, dict) or frozenset(record) != _SPLICE_FIELDS:
            raise ClosureError("managed role splice schema drift")
        version = record["version"]
        if version not in records_by_version or not isinstance(record["old"], bytes) or not isinstance(record["new"], bytes) or not record["old"] or not record["new"]:
            raise ClosureError("managed role splice literal drift")
        if (not isinstance(record["start"], int) or not isinstance(record["end"], int)
                or record["start"] < 0 or record["end"] <= record["start"]
                or hashlib.sha256(record["old"]).hexdigest() != record["old_sha256"]
                or hashlib.sha256(record["new"]).hexdigest() != record["new_sha256"]
                or not _HEX64.fullmatch(record["old_sha256"]) or not _HEX64.fullmatch(record["new_sha256"])):
            raise ClosureError("managed role splice literal hash drift")
        records_by_version[version].append(record)
    items = {item.version: item for item in manifest.migrations}
    compiled = []
    for version in _ROLE_SPLICE_VERSIONS:
        item = items.get(version); group = groups[version]; records = records_by_version[version]
        if item is None or not records:
            raise ClosureError("managed role splice coverage drift")
        raw = (root / item.path).read_bytes().replace(b"\r\n", b"\n")
        if b"\r" in raw or hashlib.sha256(raw).hexdigest() != item.sha256 or group["source_sha256"] != item.sha256:
            raise ClosureError("managed role splice source drift")
        previous = 0; chunks = []
        for record in records:
            start, end = record["start"], record["end"]
            if start < previous or end > len(raw) or raw[start:end] != record["old"]:
                raise ClosureError("managed role splice offset drift")
            chunks.extend((raw[previous:start], record["new"])); previous = end
        chunks.append(raw[previous:]); transformed = b"".join(chunks)
        if hashlib.sha256(transformed).hexdigest() != group["transformed_source_sha256"]:
            raise ClosureError("managed role transformed source drift")
        compiled.append({"version": version, "group": group, "records": tuple(records), "raw": raw, "transformed": transformed})
    return tuple(compiled)
def _rpc_row_name(row):
    return row[0].split("(", 1)[0].rsplit(".", 1)[1]
def _fragment_rpc_rows(operation, raw):
    """Parse only the literal expected ACL values in one bounded source fragment."""
    if operation in {"base", "add", "replace-account"}:
        rows = re.findall(rb"\(\s*'([^']+)'(?:::[^,\s]+)?\s*,\s*'(anon|authenticated|service_role)'::name\s*\)", raw)
        return tuple((signature.decode("ascii"), role.decode("ascii")) for signature, role in rows)
    if operation in {"replace-external", "replace-retention"}:
        match = re.search(rb"FROM\s*\(\s*VALUES\s*(.*?)\)\s+AS\s+expected", raw, re.S)
        if not match:
            raise ClosureError("G014 RPC fragment grammar drift")
        role = re.search(rb"'(anon|authenticated|service_role)'::name", raw)
        signatures = re.findall(rb"\(\s*'([^']+)'\s*\)", match.group(1))
        if role is None:
            raise ClosureError("G014 RPC fragment grammar drift")
        return tuple((signature.decode("ascii"), role.group(1).decode("ascii")) for signature in signatures)
    if operation in {"add-claim", "add-status"}:
        role = re.search(rb"'(anon|authenticated|service_role)'::name", raw)
        signatures = re.findall(rb"'(public\.[^']+)'", raw)
        if role is None or len(signatures) != 2 or signatures[0] != signatures[1]:
            raise ClosureError("G014 RPC fragment grammar drift")
        return ((signatures[0].decode("ascii"), role.group(1).decode("ascii")),)
    raise ClosureError("G014 RPC fragment operation drift")
def _fragment_removed_names(operation, raw):
    if operation not in {"replace-account", "replace-external", "replace-retention"}:
        return ()
    field = b"function_name" if operation != "replace-retention" else b"source_signature"
    match = re.search(rb"DELETE\s+FROM.*?" + field + rb"\s+IN\s*\((.*?)\)\s*;", raw, re.S)
    if not match:
        raise ClosureError("G014 RPC fragment delete grammar drift")
    values = tuple(value.decode("ascii") for value in re.findall(rb"'([^']+)'", match.group(1)))
    if not values or len(values) != len(set(values)):
        raise ClosureError("G014 RPC fragment delete drift")
    return tuple(value.split("(", 1)[0].rsplit(".", 1)[-1] for value in values)
def _compose_source_bound_rpc_matrix(fragments):
    expected_counts = (80, 7, 5, 11, 8, 1, 1, 9)
    expected_removed = {"replace-account": 7, "replace-external": 5, "replace-retention": 6}
    matrix = []
    for index, (operation, raw) in enumerate(fragments):
        additions = _fragment_rpc_rows(operation, raw)
        if len(additions) != expected_counts[index] or len(additions) != len(set(additions)):
            raise ClosureError("G014 RPC fragment row drift")
        if operation == "base":
            if additions != BASELINE_RPC_MATRIX:
                raise ClosureError("G014 RPC baseline matrix drift")
            matrix.extend(additions)
            continue
        names = _fragment_removed_names(operation, raw)
        if names:
            before = len(matrix)
            matrix = [row for row in matrix if _rpc_row_name(row) not in set(names)]
            if before - len(matrix) != expected_removed[operation]:
                raise ClosureError("G014 RPC fragment removal drift")
        if any(row in matrix for row in additions):
            raise ClosureError("G014 RPC duplicate mutation")
        matrix.extend(additions)
    if len(matrix) != 104 or len(set(matrix)) != 104:
        raise ClosureError("G014 RPC composed matrix drift")
    return tuple(matrix)
def _source_bound_rpc_matrix(root, manifest):
    """Verify every immutable ACL mutation fragment before accepting the composed terminal matrix."""
    expected_versions = (
        "20260713002000", "20260713002100", "20260713002200",
        "20260713002300", "20260713002400",
    )
    if (G014_RPC_ALLOWLIST_VERSION != expected_versions[-1]
            or not isinstance(G014_RPC_ALLOWLIST_FRAGMENTS, tuple)
            or len(G014_RPC_ALLOWLIST_FRAGMENTS) != 8
            or not isinstance(G014_RPC_ALLOWLIST_SOURCES, tuple)
            or tuple(version for version, _, _ in G014_RPC_ALLOWLIST_SOURCES) != expected_versions):
        raise ClosureError("G014 RPC allowlist binding drift")
    sources = {item.version: item for item in manifest.migrations}
    for version, path, source_sha256 in G014_RPC_ALLOWLIST_SOURCES:
        item = sources.get(version)
        if item is None or item.path != path or item.sha256 != source_sha256:
            raise ClosureError("G014 RPC allowlist source binding drift")
    if tuple(version for version, *_ in G014_RPC_ALLOWLIST_FRAGMENTS) != (
            "20260713002000", "20260713002100", "20260713002200",
            "20260713002300", "20260713002300", "20260713002300",
            "20260713002300", "20260713002400"):
        raise ClosureError("G014 RPC allowlist fragment order drift")
    fragments = []
    for version, operation, start, end, bounded_sha256 in G014_RPC_ALLOWLIST_FRAGMENTS:
        item = sources.get(version)
        if (item is None or operation not in {"base", "add", "replace-account",
                "replace-external", "add-claim", "add-status", "replace-retention"}
                or not isinstance(start, int) or not isinstance(end, int)
                or start < 0 or end <= start or not re.fullmatch(r"[a-f0-9]{64}", bounded_sha256)):
            raise ClosureError("G014 RPC allowlist fragment schema drift")
        raw = (root / item.path).read_bytes()
        if hashlib.sha256(raw).hexdigest() != item.sha256 or end > len(raw):
            raise ClosureError("G014 RPC allowlist source drift")
        fragment = raw[start:end]
        if hashlib.sha256(fragment).hexdigest() != bounded_sha256:
            raise ClosureError("G014 RPC allowlist fragment drift")
        fragments.append((operation, fragment))
    matrix = _compose_source_bound_rpc_matrix(tuple(fragments))
    if matrix != STATIC_RPC_MATRIX:
        raise ClosureError("G014 RPC static composition drift")
    allowed_grantees = {"anon", "authenticated", "service_role"}
    if (len(matrix) != 104 or len({signature for signature, _ in matrix}) != 97
            or len(set(matrix)) != 104
            or {grantee for _, grantee in matrix} != allowed_grantees
            or tuple(sum(grantee == role for _, grantee in matrix)
                     for role in ("anon", "authenticated", "service_role")) != (1, 18, 85)
            or ("public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)", "service_role") in matrix
            or ("public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)", "service_role") not in matrix):
        raise ClosureError("G014 RPC allowlist matrix drift")
    if digest(matrix) != STATIC_RPC_MATRIX_SHA256:
        raise ClosureError("G014 RPC matrix digest drift")
    return matrix

_MANAGED_ROLE_IDENTIFIER = re.compile(r'U&"(?:""|[^"])*"|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*', re.I)
def _managed_role_tokens(statement):
    """Return top-level identifier tokens, retaining Unicode escape ambiguity."""
    tokens = []
    offset = 0
    while offset < len(statement):
        if statement.startswith("--", offset):
            newline = statement.find("\n", offset + 2)
            offset = len(statement) if newline < 0 else newline + 1
        elif statement.startswith("/*", offset):
            end = statement.find("*/", offset + 2)
            if end < 0:
                return ()
            offset = end + 2
        elif statement[offset] == "'":
            offset += 1
            while offset < len(statement):
                if statement[offset] == "'" and (offset + 1 == len(statement) or statement[offset + 1] != "'"):
                    offset += 1
                    break
                offset += 2 if statement[offset] == "'" else 1
        else:
            match = _MANAGED_ROLE_IDENTIFIER.match(statement, offset)
            if match is None:
                offset += 1
                continue
            token = match.group()
            if token[:2].lower() == 'u&':
                tokens.append(("unicode", token))
            else:
                tokens.append(("quoted", token[1:-1].replace('""', '"')) if token.startswith('"') else ("bare", token.lower()))
            offset = match.end()
    return tuple(tokens)

def _is_bare(token, value):
    return token == ("bare", value)

def _is_managed_role(token):
    return token[1] in MANAGED_ROLES

def _is_unpinned_managed_role_ddl(statement):
    """Fail closed on every top-level role/user/group DDL or SET ROLE form."""
    tokens = _managed_role_tokens(statement)
    if len(tokens) >= 2 and _is_bare(tokens[0], "set"):
        index = 1
        if len(tokens) > index and tokens[index] in {("bare", "local"), ("bare", "session")}:
            index += 1
        return len(tokens) > index and _is_bare(tokens[index], "role")
    return (len(tokens) >= 2 and tokens[0][0] == "bare"
            and tokens[0][1] in {"create", "alter", "drop"}
            and tokens[1][0] == "bare"
            and tokens[1][1] in {"role", "user", "group"})

def _is_unpinned_managed_role_membership(statement):
    """Reject unspliced managed membership grammar, not object privileges."""
    tokens = _managed_role_tokens(statement)
    if not tokens or tokens[0] not in {("bare", "grant"), ("bare", "revoke")}:
        return False
    if any(token[0] == "unicode" for token in tokens):
        return True
    direction = ("bare", "to") if _is_bare(tokens[0], "grant") else ("bare", "from")
    try:
        direction_index = tokens.index(direction, 1)
    except ValueError:
        return True
    if any(_is_bare(token, "on") for token in tokens[1:direction_index]):
        return False
    member_tokens = tokens[direction_index + 1:]
    granted_by = False
    for index, token in enumerate(member_tokens):
        if _is_bare(token, "granted") and index + 1 < len(member_tokens) and _is_bare(member_tokens[index + 1], "by"):
            member_tokens = member_tokens[:index]
            granted_by = True
            break
    return any(_is_managed_role(token) for token in (*tokens[1:direction_index], *member_tokens)) or not granted_by
def transformed_vectors(root, item, *, splices, original_full):
    entry = next((entry for entry in splices if entry["version"] == item.version), None)
    if entry is None:
        return original_full, original_full
    group = entry["group"]
    if digest(original_full) != group["original_vector_sha256"]:
        raise ClosureError("managed role original vector drift")
    transformed_full, transformed_inner = vectors(root, item, raw=entry["transformed"], source_sha256=group["transformed_source_sha256"])
    if digest(transformed_full) != group["transformed_vector_sha256"]:
        raise ClosureError("managed role transformed vector drift")
    return transformed_full, transformed_inner
def validate_managed_role_coverage(manifest):
    selected = tuple(item.version for item in manifest.migrations if item.version in _ROLE_SPLICE_VERSIONS)
    if selected != _ROLE_SPLICE_VERSIONS:
        raise ClosureError("managed role splice coverage drift")
    return {item.version: item for item in manifest.migrations if item.version in selected}
def _managed_rows(cur):
    rows=q(cur,"""
        SELECT role_row.rolname, member_row.rolname, grantor_row.rolname,
               membership.admin_option, membership.inherit_option, membership.set_option
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid=membership.roleid
          JOIN pg_catalog.pg_roles AS member_row ON member_row.oid=membership.member
          JOIN pg_catalog.pg_roles AS grantor_row ON grantor_row.oid=membership.grantor
         WHERE role_row.rolname=ANY(%s) OR member_row.rolname=ANY(%s)
         ORDER BY 1,2,3,4,5,6
    """,(list(MANAGED_ROLES),list(MANAGED_ROLES)))
    return tuple(tuple(row) for row in rows)


def _admission_assert(cur):
    """Read-only, bounded PG17.6 hosted-controller admission before every mutation."""
    rows=q(cur,"""
      SELECT pg_catalog.current_setting('server_version_num') = '170006',
             session_user = 'postgres',
             current_user = 'postgres',
             (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) <> 10,
             (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
             (SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname=current_user),
             pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CREATE'),
             (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolsuper),
             (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin'),
             COALESCE(pg_catalog.current_setting('createrole_self_grant', true),'') = '',
             (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname=ANY(%s)),
             pg_catalog.to_regnamespace('privacy_retention') IS NULL
    """,(list(MANAGED_ROLES),))
    if rows != [(True,True,True,True,False,True,True,1,10,True,0,True)]:
        raise ClosureError("hosted PostgreSQL 17.6 admission drift")
    if tuple((a,b) for a,b,_ in ledger(cur)) != BASELINE_PAIRS:
        raise ClosureError("hosted baseline ledger drift")

def _assert_memberships(cur, expected):
    if _managed_rows(cur) != tuple(sorted(expected)):
        raise ClosureError("managed role membership contract drift")

def _assert_role_flags(cur):
    rows=q(cur,"""
        SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,
               rolbypassrls,rolcanlogin
          FROM pg_catalog.pg_roles WHERE rolname=ANY(%s) ORDER BY rolname
    """,(list(MANAGED_ROLES),))
    expected=tuple((name,*ROLE_FLAGS) for name in sorted(MANAGED_ROLES))
    if tuple(tuple(row) for row in rows) != expected:
        raise ClosureError("managed role flag contract drift")
def _managed_role_catalog_assert(cur):
    """Terminal assertion: pg_catalog only; no private relation/function access."""
    _assert_role_flags(cur)
    _assert_memberships(cur, TERMINAL_MANAGED_ROWS)
    objects=q(cur,"""
        SELECT n.nspname,pg_catalog.pg_get_userbyid(n.nspowner),
               c.relname,pg_catalog.pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,
               n.nspname || '.' || p.proname || '(' ||
                 pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
               pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,
               COALESCE(pg_catalog.array_to_string(p.proconfig,','),'')
          FROM pg_catalog.pg_namespace n
          LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
            AND c.relname='tzuyang_address_evidence_admin_approval_receipts'
          LEFT JOIN pg_catalog.pg_proc p ON p.oid IN (
            'privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()'::regprocedure,
            'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)'::regprocedure)
         WHERE n.nspname='privacy_retention'
         ORDER BY n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)
    """)
    expected=(
        ("privacy_retention","privacy_workflow_owner","tzuyang_address_evidence_admin_approval_receipts","privacy_workflow_owner",True,True,"privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()","privacy_workflow_owner",False,"search_path="),
        ("privacy_retention","privacy_workflow_owner","tzuyang_address_evidence_admin_approval_receipts","privacy_workflow_owner",True,True,"public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)","privacy_workflow_owner",True,"search_path="),
    )
    if tuple(tuple(row) for row in objects) != expected:
        raise ClosureError("managed ownership catalog contract drift")
def _g014_public_rpc_acl_assert(cur):
    """Catalog-only G014 ACL check against the source-pinned static matrix."""
    expected_values = "VALUES\n" + ",\n".join(
        "(" + repr(signature) + "," + repr(grantee) + ")"
        for signature, grantee in STATIC_RPC_MATRIX
    )
    expected_matrix = tuple(sorted(STATIC_RPC_MATRIX))
    missing = q(cur, """
        WITH expected(source_signature,grantee) AS (""" + expected_values + """),
        resolved AS (
          SELECT DISTINCT source_signature,pg_catalog.to_regprocedure(source_signature) AS procedure_oid
            FROM expected
        )
        SELECT source_signature FROM resolved WHERE procedure_oid IS NULL ORDER BY source_signature
    """)
    if missing:
        raise ClosureError("G014 public RPC missing source signature: " + ", ".join(row[0] for row in missing))
    actual = q(cur, """
        WITH expected(source_signature,grantee) AS (""" + expected_values + """),
        resolved AS (
          SELECT source_signature,grantee,pg_catalog.to_regprocedure(source_signature) AS procedure_oid
            FROM expected
        )
        SELECT resolved.source_signature,resolved.grantee
          FROM resolved
         WHERE pg_catalog.has_function_privilege(resolved.grantee,resolved.procedure_oid,'EXECUTE')
         ORDER BY 1,2
    """)
    if tuple(tuple(row) for row in actual) != expected_matrix:
        raise ClosureError("G014 public RPC ACL contract drift")
    public_acl = q(cur, """
        SELECT namespace.nspname || '.' || procedure.proname || '(' ||
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')'
          FROM pg_catalog.pg_proc procedure
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))
          ) acl
         WHERE namespace.nspname='public' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
         ORDER BY 1
    """)
    if public_acl:
        raise ClosureError("G014 public RPC PUBLIC ACL drift")
    unlisted = q(cur, """
        WITH expected(source_signature,grantee) AS (""" + expected_values + """),
        resolved AS (
          SELECT source_signature,grantee,pg_catalog.to_regprocedure(source_signature) AS procedure_oid
            FROM expected
        ), api_roles(grantee) AS (VALUES ('anon'::name),('authenticated'::name),('service_role'::name))
        SELECT namespace.nspname || '.' || procedure.proname || '(' ||
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',api_roles.grantee::text
          FROM pg_catalog.pg_proc procedure
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
          CROSS JOIN api_roles
          LEFT JOIN resolved ON resolved.procedure_oid=procedure.oid AND resolved.grantee=api_roles.grantee
         WHERE namespace.nspname='public'
           AND pg_catalog.has_function_privilege(api_roles.grantee,procedure.oid,'EXECUTE')
           AND resolved.procedure_oid IS NULL
         ORDER BY 1,2
    """)
    if unlisted:
        raise ClosureError("G014 public RPC unlisted API ACL drift")
    overloads = q(cur, """
        WITH expected(source_signature,grantee) AS (""" + expected_values + """),
        expected_names(name) AS (
          SELECT DISTINCT pg_catalog.split_part(pg_catalog.split_part(source_signature,'.',2),'(',1)
            FROM expected
        ), resolved(procedure_oid) AS (
          SELECT DISTINCT pg_catalog.to_regprocedure(source_signature) FROM expected
        )
        SELECT namespace.nspname || '.' || procedure.proname || '(' ||
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')'
          FROM pg_catalog.pg_proc procedure
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
          JOIN expected_names ON expected_names.name=procedure.proname
          LEFT JOIN resolved ON resolved.procedure_oid=procedure.oid
         WHERE namespace.nspname='public' AND resolved.procedure_oid IS NULL
         ORDER BY 1
    """)
    if overloads:
        raise ClosureError("G014 public RPC unexpected overload drift")

def _source_binding(root, manifest):
    return (
        root_commit(root),
        digest([(item.path, item.sha256) for item in manifest.migrations]),
        terminal_spec(manifest),
    )
def validate_controller_capability(capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline):
    """Bind the controller-verified capability to this immutable source tree."""
    head, source_root, terminal_spec = _source_binding(root, manifest)
    required={"schema","state","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","scope","relation_root","acl_root","held_lock_root","not_before_unix","not_after_unix","controller_public_key_sha256","signature"}
    if (not (type(capability) is VerifiedControllerCapability) or set(capability) != required
        or capability["schema"] != "g037-write-freeze-v3" or capability["state"] != "active-provisional"
        or capability["freeze_id"] != freeze_id or capability["commit"] != head
        or capability["manifest_sha256"] != MANIFEST_SHA256 or capability["source_root"] != source_root
        or capability["terminal_spec"] != terminal_spec or capability["relation_root"] != relation_root
        or capability["acl_root"] != acl_root or capability["not_after_unix"] != deadline
        or not isinstance(capability["origin"],str) or not capability["origin"]
        or capability["scope"] != {"schemas":["public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention"],"ordinary_relations":"all"}
        or not isinstance(capability["held_lock_root"],str) or not _HEX64.fullmatch(capability["held_lock_root"])
        or capability["controller_public_key_sha256"] != CONTROLLER_PUBLIC_KEY_SHA256
        or not isinstance(capability["signature"], str) or not capability["signature"]):
        raise ClosureError("controller capability binding mismatch")
    if (not isinstance(capability["not_before_unix"], int) or isinstance(capability["not_before_unix"],bool)
        or capability["not_before_unix"]>deadline or deadline <= int(time.time())):
        raise ClosureError("controller capability expired")
    return terminal_spec
def _deadline_state(deadline):
    return (deadline, time.monotonic() + (deadline - time.time()))
def _remaining_deadline_ms(deadline):
    utc_deadline, monotonic_deadline = deadline if isinstance(deadline, tuple) else _deadline_state(deadline)
    remaining = min(utc_deadline - time.time(), monotonic_deadline - time.monotonic())
    if remaining <= 0:
        raise ClosureError("controller capability expired")
    return max(1, int(remaining * 1000))
def _assert_capability_not_expired(deadline):
    _remaining_deadline_ms(deadline)
def _execute_before_deadline(cur, sql, params=(), *, deadline):
    remaining_ms = _remaining_deadline_ms(deadline)
    cur.execute("SELECT pg_catalog.set_config('statement_timeout', %s, true)", (f"{min(remaining_ms, 60000)}ms",))
    _remaining_deadline_ms(deadline)
    cur.execute(sql) if not params else cur.execute(sql, params)
def _q_before_deadline(cur, sql, params=(), *, deadline):
    _execute_before_deadline(cur, sql, params, deadline=deadline)
    return cur.fetchall() if cur.description else []
def _lock_under_controller(cur, *, deadline):
    remaining_ms = _remaining_deadline_ms(deadline)
    _execute_before_deadline(cur, "SELECT pg_catalog.set_config('lock_timeout', %s, true)", (f"{min(remaining_ms, 10000)}ms",), deadline=deadline)
    _execute_before_deadline(cur, "SELECT pg_catalog.set_config('idle_in_transaction_session_timeout', %s, true)", (f"{remaining_ms}ms",), deadline=deadline)
    _execute_before_deadline(cur, "SELECT pg_catalog.pg_advisory_xact_lock(37037)", deadline=deadline)
def _terminal_assert(cur, manifest, expected_vectors, *, deadline=None):
    if deadline is not None:
        _assert_capability_not_expired(deadline)
    rows=ledger(cur)
    expected=BASELINE_PAIRS+tuple((item.version,item.name) for item in manifest.migrations)
    pairs=tuple((version,name) for version,name,_ in rows)
    if len(rows)!=40 or pairs!=expected or len(set(pairs))!=len(pairs):
        raise ClosureError("terminal ledger mismatch")
    if any(not isinstance(statements,tuple) or not statements for _,_,statements in rows):
        raise ClosureError("terminal ledger noncanonical")
    actual={version:statements for version,_,statements in rows}
    if set(actual)!=set(version for version,_ in expected) or any(actual.get(version)!=statements for version,statements in expected_vectors.items()):
        raise ClosureError("terminal vector mismatch")
    retirement_gate(cur)
    _managed_role_catalog_assert(cur)
    _g014_public_rpc_acl_assert(cur)
    if deadline is not None:
        _assert_capability_not_expired(deadline)
    return rows
def _stable_projection_roots(cur):
    schemas=("public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention")
    catalog_rows=tuple(tuple(map(str,row)) for row in q(cur,"SELECT n.nspname,c.relname,c.relkind,pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4",(list(schemas),)))
    raw_acl_rows=tuple(q(cur,"SELECT n.nspname,c.relname,COALESCE(grantor.rolname,'PUBLIC'),COALESCE(grantee.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=x.grantor LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=x.grantee WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4,5,6",(list(schemas),)))
    if not catalog_rows or catalog_rows!=tuple(sorted(catalog_rows)) or len(catalog_rows)!=len(set(catalog_rows)):
        raise ClosureError("terminal catalog projection noncanonical")
    relations=tuple(Relation(schema,name,index,"",owner) for index,(schema,name,_,owner) in enumerate(catalog_rows))
    try:
        validate_table_acl_rows(raw_acl_rows,relations,terminal=True)
    except Exception as exc:
        raise ClosureError("terminal relation ACL safety policy failed") from exc
    acl_rows=tuple(tuple(map(str,row)) for row in raw_acl_rows)
    if acl_rows!=tuple(sorted(acl_rows)) or len(acl_rows)!=len(set(acl_rows)):
        raise ClosureError("terminal acl projection noncanonical")
    return digest(catalog_rows),digest(acl_rows)
def observed_terminal_roots(cur, root, manifest, *, deadline=None):
    """Read only terminal/reconciliation observation; never owns a transaction."""
    if deadline is not None:
        _assert_capability_not_expired(deadline)
    expected={}
    for item in manifest.migrations:
        full,_=vectors(root,item); expected[item.version]=full
    rows=_terminal_assert(cur,manifest,expected,deadline=deadline)
    catalog_root,acl_root=_stable_projection_roots(cur)
    if deadline is not None:
        _assert_capability_not_expired(deadline)
    return {"catalog_root":catalog_root,"acl_root":acl_root,"ledger_root":digest(rows),"terminal_spec":_source_binding(root,manifest)[2]}
def terminal_readback_assert(cur, root, manifest, *, deadline=None):
    return observed_terminal_roots(cur,root,manifest,deadline=deadline)
_SHORT_URL_REMEDIATION_EVIDENCE_SCHEMA="g037-short-url-remediation-evidence-v1"
_SHORT_URL_BINDING_FIELDS=frozenset(("envelope","expected_bindings","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","recovery_receipt_sha256","capture_evidence"))
_SHORT_URL_CAPTURE_FIELDS=frozenset(("selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count","duplicate_victims_sha256","victim_descriptors_sha256"))

def _short_url_json(value):
    if isinstance(value,str):
        try: return json.loads(value)
        except json.JSONDecodeError as exc: raise ClosureError("short_urls query JSON invalid") from exc
    return value

def _short_url_snapshot(cur):
    catalog=_short_url_json(q(cur,"SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'position',ordinal_position,'character_maximum_length',character_maximum_length,'column_default',column_default,'is_generated',is_generated,'is_identity',is_identity,'identity_generation',identity_generation) ORDER BY ordinal_position),'[]') FROM information_schema.columns WHERE table_schema='public' AND table_name='short_urls'")[0][0])
    rows=_short_url_json(q(cur,"SELECT COALESCE(pg_catalog.json_agg(pg_catalog.to_jsonb(s) ORDER BY s.id),'[]') FROM public.short_urls s")[0][0])
    descriptors=_short_url_json(q(cur,"WITH ranked AS (SELECT id,target_url,pg_catalog.first_value(id) OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) keeper_id,pg_catalog.row_number() OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) rank,pg_catalog.to_jsonb(short_urls) row_json FROM public.short_urls) SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object('source_id',id::text,'keeper_id',keeper_id::text,'target_url_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_url,'UTF8'),'sha256'),'hex'),'rank',rank,'source_row_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(row_json::text,'UTF8'),'sha256'),'hex')) ORDER BY id),'[]') FROM ranked WHERE rank>1")[0][0])
    invalid=q(cur,"SELECT EXISTS (SELECT 1 FROM public.short_urls WHERE code IS NULL OR target_url IS NULL) OR EXISTS (SELECT 1 FROM public.short_urls GROUP BY code HAVING pg_catalog.count(*)>1)")[0][0]
    if invalid or catalog != list(SHORT_URLS_CATALOG) or not isinstance(rows,list) or not isinstance(descriptors,list):
        raise ClosureError("short_urls current capture invalid")
    return {"selection_spec_sha256":canonical_sha256(SHORT_URL_SELECTION_SPEC),"short_urls_catalog_sha256":canonical_sha256(catalog),"short_urls_rowset_sha256":canonical_sha256(rows),"short_urls_row_count":len(rows),"duplicate_group_count":len({item.get("keeper_id") for item in descriptors}),"duplicate_victim_count":len(descriptors),"victim_descriptor_count":len(descriptors),"duplicate_victims_sha256":canonical_sha256(descriptors),"victim_descriptors_sha256":canonical_sha256(descriptors),"_rows":rows,"_victims":descriptors}

def _short_url_binding(binding, *, baseline_is_exact):
    if not isinstance(binding,dict) or set(binding)!=_SHORT_URL_BINDING_FIELDS:
        raise ClosureError("short_urls remediation binding invalid")
    envelope=binding["envelope"]; capture=binding["capture_evidence"]
    if not isinstance(envelope,ExecutionAuthorizationEnvelope) or not isinstance(binding["expected_bindings"],dict):
        raise ClosureError("execution authorization envelope invalid")
    try:
        authorization=authorize_exact_baseline(envelope,expected_bindings=binding["expected_bindings"],now=int(time.time()),baseline_is_exact=baseline_is_exact)
    except ContractError as exc:
        raise ClosureError("execution authorization invalid") from exc
    for key in _SHORT_URL_BINDING_FIELDS-{"envelope","expected_bindings","capture_evidence","legacy_repository_commit"}:
        if not isinstance(binding[key],str) or not _HEX64.fullmatch(binding[key]):
            raise ClosureError("short_urls authorization provenance invalid")
    if not isinstance(binding["legacy_repository_commit"],str) or not COMMIT.fullmatch(binding["legacy_repository_commit"]):
        raise ClosureError("short_urls authorization provenance invalid")
    if authorization["policy"] != POLICY or authorization["legacy_repository_commit"] != binding["legacy_repository_commit"] or any(binding[key]!=authorization[key] for key in ("legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256")):
        raise ClosureError("execution authorization provenance drift")
    if not (type(capture) is VerifiedRecoveryCapture) or set(capture)!=_SHORT_URL_CAPTURE_FIELDS:
        raise ClosureError("short_urls capture binding invalid")
    if any(not isinstance(capture[key],str) or not _HEX64.fullmatch(capture[key]) for key in ("selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256")):
        raise ClosureError("short_urls capture hashes invalid")
    if any(not isinstance(capture[key],int) or isinstance(capture[key],bool) or capture[key]<0 for key in ("short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count")):
        raise ClosureError("short_urls capture counts invalid")
    vector=authorization["legacy_vector"]
    if any(vector[key] != capture["short_urls_rowset_sha256" if key=="pre_short_urls_rowset_sha256" else key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")):
        raise ClosureError("execution authorization capture drift")
    if capture["duplicate_victim_count"] != capture["victim_descriptor_count"] or capture["duplicate_victims_sha256"] != capture["victim_descriptors_sha256"]:
        raise ClosureError("short_urls capture invalid")
    return authorization,capture

def remediate_short_url_duplicates(cur, binding, *, deadline):
    """Fail closed before mutation; return only bounded, receipt-safe remediation evidence."""
    authorization,capture=_short_url_binding(binding,baseline_is_exact=lambda: tuple((version,name) for version,name,_ in ledger(cur))==BASELINE_PAIRS)
    before=_short_url_snapshot(cur)
    expected={key:capture[key] for key in _SHORT_URL_CAPTURE_FIELDS}
    if any(before[key] != expected[key] for key in expected):
        raise ClosureError("short_urls current capture drift")
    if any(authorization["legacy_vector"][key] != before["short_urls_rowset_sha256" if key=="pre_short_urls_rowset_sha256" else key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")):
        raise ClosureError("short_urls authorization current drift")
    victims=before["_victims"]; victim_ids=[item.get("source_id") for item in victims]
    if len(victim_ids)!=len(set(victim_ids)) or any(not isinstance(value,str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",value) for value in victim_ids):
        raise ClosureError("short_urls victim selection invalid")
    if victim_ids:
        deleted=[str(row[0]) for row in _q_before_deadline(cur,"DELETE FROM public.short_urls WHERE id = ANY(%s::uuid[]) RETURNING id::text",(victim_ids,),deadline=deadline)]
        if set(deleted)!=set(victim_ids) or len(deleted)!=len(victim_ids):
            raise ClosureError("short_urls delete returning mismatch")
    after=_short_url_snapshot(cur)
    survivor=[row for row in before["_rows"] if row.get("id") not in set(victim_ids)]
    if after["_rows"] != survivor or after["duplicate_group_count"] or after["duplicate_victim_count"]:
        raise ClosureError("short_urls remediation postcondition failed")
    evidence={"schema":_SHORT_URL_REMEDIATION_EVIDENCE_SCHEMA,"authorization_id":authorization["authorization_id"],"policy":authorization["policy"],"execution_authorization_sha256":binding["execution_authorization_sha256"],"execution_authorization_signature_sha256":binding["execution_authorization_signature_sha256"],"legacy_repository_commit":binding["legacy_repository_commit"],"legacy_authorization_sha256":binding["legacy_authorization_sha256"],"legacy_authorization_signature_sha256":binding["legacy_authorization_signature_sha256"],"legacy_capture_receipt_sha256":binding["legacy_capture_receipt_sha256"],"legacy_restore_receipt_sha256":binding["legacy_restore_receipt_sha256"],"legacy_inspection_receipt_sha256":binding["legacy_inspection_receipt_sha256"],"recovery_receipt_sha256":binding["recovery_receipt_sha256"],"capture_short_urls_rowset_sha256":capture["short_urls_rowset_sha256"],"pre_short_urls_rowset_sha256":before["short_urls_rowset_sha256"],"survivor_short_urls_rowset_sha256":after["short_urls_rowset_sha256"],"deleted_count":len(victim_ids),"duplicate_group_count_before":before["duplicate_group_count"],"duplicate_group_count_after":after["duplicate_group_count"]}
    return {**evidence,"remediation_sha256":canonical_sha256(evidence)}

def _precompute_execution_plan(root, manifest):
    """Compile all pinned transformed vectors before any cursor admission or mutation."""
    _source_bound_rpc_matrix(root, manifest)
    splices = _splice_specs(root, manifest)
    if hashlib.sha256(ROLE_PROTOCOL_EPILOGUE).hexdigest() != ROLE_PROTOCOL_EPILOGUE_SHA256:
        raise ClosureError("role epilogue digest drift")
    epilogue_item = type("EpilogueItem", (), {
        "version": "20260718003700",
        "sha256": ROLE_PROTOCOL_EPILOGUE_SHA256,
    })()
    epilogue_full, epilogue_inner = vectors(
        root, epilogue_item, raw=ROLE_PROTOCOL_EPILOGUE,
        source_sha256=ROLE_PROTOCOL_EPILOGUE_SHA256,
    )
    if (epilogue_full != epilogue_inner
            or digest(epilogue_full) != ROLE_PROTOCOL_EPILOGUE_VECTOR_SHA256):
        raise ClosureError("role epilogue vector drift")
    plan = []; splice_versions = {entry["version"] for entry in splices}
    for item in manifest.migrations:
        source_sql(root, item)
        original_full, _ = vectors(root, item)
        transformed_full, transformed_inner = transformed_vectors(root, item, splices=splices, original_full=original_full)
        if item.version not in splice_versions:
            if transformed_full != original_full:
                raise ClosureError("unapproved transformed vector")
            if (any(_is_unpinned_managed_role_ddl(statement) for statement in transformed_inner)
                    or any(_is_unpinned_managed_role_membership(statement) for statement in transformed_inner)):
                raise ClosureError("unpinned role statement")
        plan.append((item, original_full, transformed_full, transformed_inner))
    return tuple(plan), splices
def _execute_closure(cur, root, manifest, remediation, *, plan, deadline):
    deadline = _deadline_state(deadline) if not isinstance(deadline, tuple) else deadline
    validate_managed_role_coverage(manifest)
    _admission_assert(cur)
    _assert_capability_not_expired(deadline)
    remediation_evidence=remediate_short_url_duplicates(cur,remediation,deadline=deadline)
    expected_vectors={}; policy_evidence=[]
    for item, original_full, _transformed_full, inner in plan:
        policy_evidence.append(_prepare_documents_policy_compatibility(cur,item,deadline=deadline))
        for ordinal, statement in enumerate(inner, start=1):
            try:
                _execute_before_deadline(cur,statement,deadline=deadline)
            except Exception:
                statement_sha256=hashlib.sha256(statement.encode("utf-8")).hexdigest()
                raise ClosureError(f"immutable migration statement failed: version={item.version}, ordinal={ordinal}, sha256={statement_sha256}") from None
        _execute_before_deadline(cur,"INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (%s,%s,%s)",(item.version,item.name,list(original_full)),deadline=deadline)
        expected_vectors[item.version]=original_full
    _assert_role_flags(cur)
    _assert_memberships(cur, TRANSIENT_MANAGED_ROWS)
    _execute_before_deadline(cur,ROLE_PROTOCOL_EPILOGUE.decode("ascii"),deadline=deadline)
    _assert_memberships(cur, TERMINAL_MANAGED_ROWS)
    _terminal_assert(cur,manifest,expected_vectors,deadline=deadline)
    return {**remediation_evidence,"documents_policy_compatibility":tuple(policy_evidence)}
def rehearse_cursor(cur, capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline, remediation):
    """Execute and roll back exact vectors using only the controller cursor."""
    validate_controller_capability(capability, root=root, manifest=manifest, freeze_id=freeze_id, relation_root=relation_root, acl_root=acl_root, deadline=deadline)
    plan, _splices = _precompute_execution_plan(root, manifest)
    deadline=_deadline_state(deadline)
    _execute_before_deadline(cur,"SAVEPOINT g037_rehearsal",deadline=deadline)
    remediation_evidence = None
    failure = None
    try:
        _lock_under_controller(cur, deadline=deadline)
        if tuple((version,name) for version,name,_ in ledger(cur)) != BASELINE_PAIRS: raise ClosureError("rehearsal baseline mismatch")
        _assert_capability_not_expired(deadline)
        remediation_evidence=_execute_closure(cur,root,manifest,remediation,plan=plan,deadline=deadline)
    except Exception as exc:
        failure = exc
    finally:
        try:
            cur.execute("ROLLBACK TO SAVEPOINT g037_rehearsal")
            cur.execute("RELEASE SAVEPOINT g037_rehearsal")
        except Exception as rollback_exc:
            raise ClosureError("rollback rehearsal failed") from rollback_exc
    if failure is not None:
        raise ClosureError("rehearsal failed") from failure
    _assert_capability_not_expired(deadline)
    return remediation_evidence
def apply_cursor(cur, capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline, remediation):
    """Apply exact vectors once using only the controller cursor; never retry."""
    validate_controller_capability(capability, root=root, manifest=manifest, freeze_id=freeze_id, relation_root=relation_root, acl_root=acl_root, deadline=deadline)
    plan, _splices = _precompute_execution_plan(root, manifest)
    deadline=_deadline_state(deadline)
    _assert_capability_not_expired(deadline)
    _lock_under_controller(cur, deadline=deadline)
    if tuple((version,name) for version,name,_ in ledger(cur)) != BASELINE_PAIRS:
        raise ClosureError("commit ambiguity: readback only; retry forbidden")
    _assert_capability_not_expired(deadline)
    try:
        evidence=_execute_closure(cur,root,manifest,remediation,plan=plan,deadline=deadline)
        _assert_capability_not_expired(deadline)
        return evidence
    except ClosureError:
        raise
    except Exception as exc:
        raise ClosureError("commit ambiguous: readback only; retry forbidden") from exc
def run(args):
    root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root); base={"commit_sha256":root_commit(root),"source_sha256":digest([x.sha256 for x in manifest.migrations]),"migration_count":28}
    if args.mode=="validate": return receipt(args.mode,"valid",base)
    conn=connection(args.db_env)
    try:
        cur=conn.cursor()
        if args.mode=="runtime-probe":
            probe=runtime_probe(cur)
            return receipt(args.mode,"authorization-denied",{**base,"runtime_authorization_denied":probe})
        rows,cat=catalog(cur,manifest,terminal=args.mode in {"readback","reconciliation-readback"}); base.update(catalog_sha256=cat,ledger_sha256=digest(rows),ledger_count=len(rows),retirement_gate="passed")
        if args.mode in {"readback","reconciliation-readback"}:
            terminal=terminal_readback_assert(cur,root,manifest)
            base.update(catalog_sha256=terminal["catalog_root"],acl_sha256=terminal["acl_root"],ledger_sha256=terminal["ledger_root"])
        if args.mode in {"preflight","readback","reconciliation-readback"}: return receipt(args.mode,"ready" if args.mode=="preflight" else "readback",base)
        raise ClosureError("unsupported non-controller mode")
    finally:
        conn.rollback()
        conn.close()
def main(argv=None):
    p=argparse.ArgumentParser(); p.add_argument("mode",choices=sorted(MODES)); p.add_argument("--db-env",default="SUPABASE_DB_URL")
    a=p.parse_args(argv)
    try: emit(run(a)); return 0
    except (ClosureError,ContractError) as exc: emit(receipt(a.mode,"denied",{"ambiguous_commit":"ambiguous" in str(exc).lower()})); return 2
if __name__=="__main__": raise SystemExit(main())
