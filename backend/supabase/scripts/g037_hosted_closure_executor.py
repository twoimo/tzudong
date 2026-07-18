#!/usr/bin/env python3
"""Protected, fail-closed G037 hosted migration executor.

Credentials are obtained only by environment *name*.  Receipts contain only
hashes/counts/booleans; SQL, DSNs and operator identity never leave process memory.
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path
from g037_hosted_closure_contract import BASELINE_PAIRS, MANIFEST_SHA256, MODES, SELF_WRAPPING, ContractError, canonical_bytes, digest, no_duplicate_object, repository_root, validate_sources
from preflight_g034_hosted_migration_closure import approval_body_contract, approval_catalog_contract

SCHEMA="g037-hosted-closure-receipt-v3"; ENV=re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$"); COMMIT=re.compile(r"^[a-f0-9]{40}$")
class ClosureError(RuntimeError): pass
_DOCUMENTS_POLICY_COMPATIBILITY_VERSION="20260627080000"
_DOCUMENTS_POLICY_CONTRACT=(
    ("documents_delete_own","DELETE",("PUBLIC",),True,"(auth.uid() = user_id)",None),
    ("documents_insert_own","INSERT",("PUBLIC",),True,None,"(auth.uid() = user_id)"),
    ("documents_select_own","SELECT",("PUBLIC",),True,"(auth.uid() = user_id)",None),
    ("documents_update_own","UPDATE",("PUBLIC",),True,"(auth.uid() = user_id)","(auth.uid() = user_id)"),
)
def _prepare_documents_policy_compatibility(cur,item):
    """Remove only the exact unledgered policies that this immutable migration creates."""
    if item.version != _DOCUMENTS_POLICY_COMPATIBILITY_VERSION:
        return
    rows=tuple(
        (str(name),str(command),tuple(map(str,roles)),bool(permissive),qual,with_check)
        for name,command,roles,permissive,qual,with_check in q(cur,"""
            SELECT p.polname,
                   CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                                 WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END,
                   ARRAY(SELECT COALESCE(role.rolname,'PUBLIC')
                         FROM unnest(p.polroles) AS policy_role(oid)
                         LEFT JOIN pg_catalog.pg_roles AS role ON role.oid=policy_role.oid
                         ORDER BY 1),
                   p.polpermissive,
                   pg_catalog.pg_get_expr(p.polqual,p.polrelid),
                   pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)
            FROM pg_catalog.pg_policy AS p
            WHERE p.polrelid='public.documents'::regclass
              AND p.polname=ANY(%s)
            ORDER BY p.polname
        """,(list(name for name,*_ in _DOCUMENTS_POLICY_CONTRACT),))
    )
    if not rows:
        return
    if rows != _DOCUMENTS_POLICY_CONTRACT:
        raise ClosureError("documents policy compatibility contract drift")
    for name,*_ in _DOCUMENTS_POLICY_CONTRACT:
        cur.execute(f'DROP POLICY "{name}" ON public.documents')
def emit(x): print(canonical_bytes(x).decode("ascii"))
def receipt(mode,status,evidence):
    # Deliberately whitelist receipt fields instead of attempting to redact arbitrary data.
    safe={k:v for k,v in evidence.items() if k in {"commit_sha256","source_sha256","ledger_sha256","catalog_sha256","acl_sha256","migration_count","ledger_count","retirement_gate","rehearsal","runtime_authorization_denied","ambiguous_commit"}}
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
        return psycopg.connect(os.environ[env_name], autocommit=False)
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
    locks=q(cur,"SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")[0][0]
    if int(locks): raise ClosureError("waiting locks present")
    return rows,digest({"ledger":rows,"retirement":"passed"})
def runtime_probe(cur):
    cur.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    signature="public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)"
    rows=q(cur,"SELECT pg_catalog.to_regprocedure(%s)",(signature,))
    if len(rows)!=1 or rows[0][0] is None: raise ClosureError("terminal mutator unavailable")
    denied=bool(q(cur,"SELECT NOT has_function_privilege(current_user, pg_catalog.to_regprocedure(%s), 'EXECUTE')",(signature,))[0][0])
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
def vectors(root,item):
    tool=root/"backend/supabase/scripts/g037_supabase_statement_vector.mjs"; source=root/item.path
    result=subprocess.run(["node",str(tool),"--source",str(source),"--version",item.version,"--sha256",item.sha256,"--size",str(source.stat().st_size)],capture_output=True,text=True,timeout=60)
    if result.returncode: raise ClosureError("official parser unavailable")
    try: data=json.loads(result.stdout,object_pairs_hook=no_duplicate_object)
    except Exception as exc: raise ClosureError("parser vector invalid") from exc
    upstream={"commit":"6d4c19870ed213ba7f682f117d0345c8a40bfa94","version":"v2.109.1","token":{"path":"apps/cli-go/pkg/parser/token.go","blob":"db008434246be335b9f7abaf0cb66a99a2b40378"},"state":{"path":"apps/cli-go/pkg/parser/state.go","blob":"47775390d1731c0ad29e10b20fb2fe16c8cfcadb"}}
    if set(data)!={"schema","upstream","version","source_sha256","source_size","statements"} or data["schema"]!="g037-supabase-statement-vector-v1" or data["upstream"]!=upstream or data["version"]!=item.version or data["source_sha256"]!=item.sha256 or data["source_size"]!=source.stat().st_size or not isinstance(data["statements"],list) or not data["statements"] or any(not isinstance(x,str) or not x.strip() for x in data["statements"]): raise ClosureError("parser vector mismatch")
    full=tuple(data["statements"])
    controls=lambda statement: bool(re.match(r"(?is)^\s*(begin|commit|rollback)\b",statement))
    if item.version not in SELF_WRAPPING:
        if any(controls(statement) for statement in full): raise ClosureError("ordinary migration transaction-control drift")
        return full,full
    if len(full)<3 or not re.fullmatch(_WRAPPER_PREAMBLE.decode("ascii")+r"begin\s*",full[0],re.S|re.I) or not re.fullmatch(r"(?is)\s*commit\s*",full[-1]) or any(controls(statement) for statement in full[1:-1]): raise ClosureError("self-wrapper vector drift")
    return full,full[1:-1]
def _source_binding(root, manifest):
    return (
        root_commit(root),
        digest([(item.path, item.sha256) for item in manifest.migrations]),
        digest({"manifest": MANIFEST_SHA256, "migrations": [(item.version, item.sha256) for item in manifest.migrations], "g014_terminal": "20260713002400"}),
    )
def validate_controller_capability(capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline):
    """Bind the controller-verified capability to this immutable source tree."""
    head, source_root, terminal_spec = _source_binding(root, manifest)
    required={"schema","state","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","scope","relation_root","acl_root","held_lock_root","not_before_unix","not_after_unix","controller_public_key_sha256","signature"}
    if (not isinstance(capability, dict) or set(capability) != required
        or capability["schema"] != "g037-write-freeze-v3" or capability["state"] != "active-provisional"
        or capability["freeze_id"] != freeze_id or capability["commit"] != head
        or capability["manifest_sha256"] != MANIFEST_SHA256 or capability["source_root"] != source_root
        or capability["terminal_spec"] != terminal_spec or capability["relation_root"] != relation_root
        or capability["acl_root"] != acl_root or capability["not_after_unix"] != deadline
        or not isinstance(capability["signature"], str) or not capability["signature"]):
        raise ClosureError("controller capability binding mismatch")
    if not isinstance(capability["not_before_unix"], int) or deadline <= int(time.time()):
        raise ClosureError("controller capability expired")
    return terminal_spec
def _lock_under_controller(cur):
    cur.execute("SET LOCAL statement_timeout = '60s'")
    cur.execute("SET LOCAL lock_timeout = '10s'")
    cur.execute("SET LOCAL idle_in_transaction_session_timeout = '60s'")
    cur.execute("SELECT pg_advisory_xact_lock(37037)")
def _terminal_assert(cur, manifest, expected_vectors):
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
    return rows
def _stable_projection_roots(cur):
    schemas=("public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention")
    catalog_rows=tuple(tuple(map(str,row)) for row in q(cur,"SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4",(list(schemas),)))
    acl_rows=tuple(tuple(map(str,row)) for row in q(cur,"SELECT n.nspname,c.relname,COALESCE(grantor.rolname,'PUBLIC'),COALESCE(grantee.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=x.grantor LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=x.grantee WHERE n.nspname=ANY(%s) ORDER BY 1,2,3,4,5,6",(list(schemas),)))
    if not catalog_rows or catalog_rows!=tuple(sorted(catalog_rows)) or len(catalog_rows)!=len(set(catalog_rows)):
        raise ClosureError("terminal catalog projection noncanonical")
    if acl_rows!=tuple(sorted(acl_rows)) or len(acl_rows)!=len(set(acl_rows)):
        raise ClosureError("terminal acl projection noncanonical")
    return digest(catalog_rows),digest(acl_rows)
def observed_terminal_roots(cur, root, manifest):
    """Read only terminal/reconciliation observation; never owns a transaction."""
    expected={}
    for item in manifest.migrations:
        full,_=vectors(root,item); expected[item.version]=full
    rows=_terminal_assert(cur,manifest,expected)
    catalog_root,acl_root=_stable_projection_roots(cur)
    return {"catalog_root":catalog_root,"acl_root":acl_root,"ledger_root":digest(rows),"terminal_spec":_source_binding(root,manifest)[2]}
def terminal_readback_assert(cur, root, manifest):
    return observed_terminal_roots(cur,root,manifest)
def _execute_closure(cur, root, manifest):
    expected_vectors={}
    for item in manifest.migrations:
        source_sql(root,item)
        full,inner=vectors(root,item)
        _prepare_documents_policy_compatibility(cur,item)
        for statement in inner: cur.execute(statement)
        cur.execute("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (%s,%s,%s)",(item.version,item.name,list(full)))
        expected_vectors[item.version]=full
    _terminal_assert(cur,manifest,expected_vectors)
def rehearse_cursor(cur, capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline):
    """Execute and roll back exact vectors using only the controller cursor."""
    validate_controller_capability(capability, root=root, manifest=manifest, freeze_id=freeze_id, relation_root=relation_root, acl_root=acl_root, deadline=deadline)
    cur.execute("SAVEPOINT g037_rehearsal")
    try:
        _lock_under_controller(cur)
        if tuple((version,name) for version,name,_ in ledger(cur)) != BASELINE_PAIRS: raise ClosureError("rehearsal baseline mismatch")
        _execute_closure(cur,root,manifest)
    except Exception as exc:
        try:
            cur.execute("ROLLBACK TO SAVEPOINT g037_rehearsal")
        except Exception as rollback_exc:
            raise ClosureError("rollback rehearsal failed") from rollback_exc
        raise ClosureError("rehearsal failed") from exc
    cur.execute("ROLLBACK TO SAVEPOINT g037_rehearsal")
    cur.execute("RELEASE SAVEPOINT g037_rehearsal")
def apply_cursor(cur, capability, *, root, manifest, freeze_id, relation_root, acl_root, deadline):
    """Apply exact vectors once using only the controller cursor; never retry."""
    validate_controller_capability(capability, root=root, manifest=manifest, freeze_id=freeze_id, relation_root=relation_root, acl_root=acl_root, deadline=deadline)
    _lock_under_controller(cur)
    if tuple((version,name) for version,name,_ in ledger(cur)) != BASELINE_PAIRS:
        raise ClosureError("commit ambiguity: readback only; retry forbidden")
    try:
        _execute_closure(cur,root,manifest)
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
