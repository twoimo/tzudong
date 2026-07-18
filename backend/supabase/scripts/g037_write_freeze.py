#!/usr/bin/env python3
"""G037 single-transaction ordinary-writer fence.

``preflight(conn)`` is read-only except for rolled-back lock probes. ``run``
owns the only transaction and passes its cursor plus a verified, signed active
capability to the callback; callback code must not commit, roll back, or open a
connection. Table locks do not fence sequences, owners, superusers, Dashboard,
provider, or credential holders: the signed producer-stop assertion attests
those residual channels.
"""
from __future__ import annotations
import base64, hashlib, subprocess, time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from g037_hosted_closure_contract import AUTHORIZATION_PUBLIC_KEY_PEM, MANIFEST_SHA256, canonical_bytes, digest, repository_root, validate_operator_assertion, validate_sources
SCHEMA="g037-write-freeze-v3"
REACHABLE_SCHEMAS=("public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention")
CREATED_BY_SELECTED=frozenset(REACHABLE_SCHEMAS[3:])
PROVIDER_MANAGED_LOCK_EXCLUSIONS=frozenset((
 ("auth","schema_migrations","supabase_auth_admin"),
 ("storage","buckets_vectors","supabase_storage_admin"),
 ("storage","migrations","supabase_storage_admin"),
 ("storage","vector_indexes","supabase_storage_admin"),
))
CONTROLLER_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAqaHsCrD74lzv7J3zcfsjchTndvHTWTj1dWeDjwXK+G8=\n-----END PUBLIC KEY-----\n"
CONTROLLER_PUBLIC_KEY_SHA256=hashlib.sha256(CONTROLLER_PUBLIC_KEY_PEM.encode()).hexdigest()
class FreezeError(RuntimeError): pass
_LOCK_TIMEOUT_SETTINGS=("statement_timeout","lock_timeout","idle_in_transaction_session_timeout")
_LOCK_TIMEOUT_MIN_SECONDS=1
_LOCK_TIMEOUT_MAX_SECONDS=900
class RehearsalRollbackError(FreezeError):
 def __init__(self, original_error, rollback_error):
  super().__init__("rollback-failed")
  self.original_error=original_error
  self.rollback_error=rollback_error
@dataclass(frozen=True)
class Relation:
 schema:str; name:str; oid:int; kind:str; owner:str
 @property
 def key(self): return (self.schema,self.name,self.oid,self.kind,self.owner)
@dataclass(frozen=True)
class Inventory:
 schemas:tuple[str,...]; relations:tuple[Relation,...]; relation_root:str; acl_root:str
def _rows(c,s,p=()): c.execute(s,p); return tuple(tuple(x) for x in c.fetchall())
def _ident(x):
 if not isinstance(x,str) or not x or "\0" in x: raise FreezeError("unsafe identifier")
 return '"'+x.replace('"','""')+'"'
def _unique(rows,what):
 if len(rows)!=len(set(rows)): raise FreezeError("duplicate %s inventory"%what)
 return tuple(sorted(rows))
def _lockable_relations(relations):
 excluded=tuple(r for r in relations if (r.schema,r.name,r.owner) in PROVIDER_MANAGED_LOCK_EXCLUSIONS)
 if len(excluded)!=len(PROVIDER_MANAGED_LOCK_EXCLUSIONS) or { (r.schema,r.name,r.owner) for r in excluded }!=PROVIDER_MANAGED_LOCK_EXCLUSIONS:
  raise FreezeError("provider-managed lock exclusion inventory drift")
 return tuple(r for r in relations if r not in excluded)
def _inv(conn):
 c=conn.cursor()
 try:
  schemas=tuple(x[0] for x in _unique(_rows(c,"SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1",(list(REACHABLE_SCHEMAS),)),"schema"))
  if set(REACHABLE_SCHEMAS)-set(schemas)-CREATED_BY_SELECTED: raise FreezeError("required reachable schema missing")
  rs=_unique(_rows(c,"SELECT n.nspname,c.relname,c.oid,c.relkind,pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3",(list(schemas),)),"relation")
  relations=tuple(Relation(str(a),str(b),int(o),str(k),str(owner)) for a,b,o,k,owner in rs)
  if not relations: raise FreezeError("empty reachable relation inventory")
  acl=_unique(_rows(c,"SELECT n.nspname,c.oid,COALESCE(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname=ANY(%s) ORDER BY 1,2,3,4,5",(list(schemas),)),"acl")
  return Inventory(schemas,relations,digest([r.key for r in relations]),digest(acl))
 finally: c.close()
def preflight(conn):
 """Probe locks inside an ordinary transaction and always roll it back."""
 answer=_inv(conn); lockable=_lockable_relations(answer.relations); c=conn.cursor()
 try:
  c.execute("BEGIN")
  for r in lockable: c.execute("LOCK TABLE %s.%s IN SHARE ROW EXCLUSIVE MODE NOWAIT"%(_ident(r.schema),_ident(r.name)))
  conn.rollback(); return answer
 except Exception as e:
  conn.rollback(); raise FreezeError("all non-provider-managed reachable relations must be lockable") from e
 finally: c.close()
def _root_source():
 root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 try: commit=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],capture_output=True,text=True,check=True).stdout.strip()
 except Exception as e: raise FreezeError("checked-out HEAD unavailable") from e
 if len(commit)!=40 or any(c not in "0123456789abcdef" for c in commit): raise FreezeError("checked-out HEAD invalid")
 source_root=digest([(m.path,m.sha256) for m in manifest.migrations])
 # Immutable source declaration: the selected G014 terminal migration vectors and manifest hashes.
 terminal_spec=digest({"manifest":MANIFEST_SHA256,"migrations":[(m.version,m.sha256) for m in manifest.migrations],"g014_terminal":"20260713002400"})
 return root,commit,source_root,terminal_spec
def _locks(c,rs,seconds):
 if (not isinstance(seconds,int) or isinstance(seconds,bool)
     or not _LOCK_TIMEOUT_MIN_SECONDS<=seconds<=_LOCK_TIMEOUT_MAX_SECONDS):
  raise FreezeError("lock timeout seconds must be between 1 and 900")
 for key in _LOCK_TIMEOUT_SETTINGS: c.execute("SET LOCAL %s = '%ds'"%(key,seconds))
 lockable=_lockable_relations(rs)
 for r in lockable: c.execute("LOCK TABLE %s.%s IN SHARE ROW EXCLUSIVE MODE"%(_ident(r.schema),_ident(r.name)))
 held=_rows(c,"SELECT n.nspname,c.relname,c.oid FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted AND l.mode='ShareRowExclusiveLock' ORDER BY 1,2,3")
 expected=tuple((r.schema,r.name,r.oid) for r in lockable)
 if held!=expected or _rows(c,"SELECT count(*) FROM pg_locks WHERE NOT granted")[0][0]!=0: raise FreezeError("held lock set drift")
 return digest(held)
def _verify_active(value, expected):
 if not isinstance(value,dict) or set(value)!={*expected,"signature"} or value.get("controller_public_key_sha256")!=CONTROLLER_PUBLIC_KEY_SHA256: raise FreezeError("active capability fields mismatch")
 signature=value["signature"]; payload={k:v for k,v in value.items() if k!="signature"}
 if not isinstance(signature,str): raise FreezeError("active capability signature missing")
 try:
  from cryptography.hazmat.primitives.serialization import load_pem_public_key
  load_pem_public_key(CONTROLLER_PUBLIC_KEY_PEM.encode()).verify(base64.b64decode(signature,validate=True),canonical_bytes(payload))
 except Exception as e: raise FreezeError("active capability signature invalid") from e
 return value
CAPTURE_ROOT_KEYS=frozenset(("auth_storage_catalog_root","auth_storage_metadata_root","storage_blob_root","recipient_fingerprint","logical_ciphertext_sha256","blob_ciphertext_sha256","recovery_receipt_sha256","object_count","total_bytes"))
def validate_capture_roots(value):
 if not isinstance(value,dict) or set(value)!=CAPTURE_ROOT_KEYS: raise FreezeError("capture roots fields invalid")
 if any(not isinstance(value[k],str) or len(value[k])!=64 or any(c not in "0123456789abcdef" for c in value[k]) for k in CAPTURE_ROOT_KEYS-{"object_count","total_bytes"}): raise FreezeError("capture roots hash invalid")
 if any(not isinstance(value[k],int) or isinstance(value[k],bool) or value[k]<0 or value[k]>(2**34) for k in ("object_count","total_bytes")): raise FreezeError("capture roots size invalid")
 return value
def run(conn, *, origin, freeze_id, expected, assertion, callback, provisional_writer,
        precommit_receipt_writer, final_receipt_writer, terminal_assert):
 root,head,source_root,terminal_spec=_root_source()
 validate_operator_assertion(assertion,freeze_id=freeze_id,origin=origin,relation_root=expected.relation_root,acl_root=expected.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 now=int(time.time()); expires=assertion["expires_at"]; seconds=expires-now
 if seconds<=0: raise FreezeError("assertion window expired")
 c=conn.cursor(); status="failed-rolled-back"; lock_root=""; captures={}; terminal={}; commit_started=False; precommit_hash=""
 try:
  c.execute("BEGIN"); current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations
      or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root):
   raise FreezeError("inventory drift")
  lock_root=_locks(c,expected.relations,seconds)
  current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations
      or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root):
   raise FreezeError("post-lock inventory drift")
  payload={"schema":SCHEMA,"state":"active-provisional","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":{"schemas":list(REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":lock_root,"not_before_unix":now,"not_after_unix":expires,"controller_public_key_sha256":CONTROLLER_PUBLIC_KEY_SHA256}
  signed=_verify_active(provisional_writer(payload),set(payload))
  c.execute("SAVEPOINT g037_closure")
  try:
   output=callback(c,signed); captures=output if isinstance(output,dict) else {}
   validate_capture_roots(captures)
   terminal=terminal_assert(c,terminal_spec)
   if (not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"}
       or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root"))):
    raise FreezeError("immutable terminal assertion missing")
   intent={"schema":SCHEMA,"status":"prepared-not-committed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"terminal":terminal}
   intent["receipt_sha256"]=digest(intent)
   precommit_hash=precommit_receipt_writer(intent)
   if precommit_hash != intent["receipt_sha256"]: raise FreezeError("precommit receipt persistence failed")
   c.execute("RELEASE SAVEPOINT g037_closure"); commit_started=True; conn.commit(); status="committed"; result=output
  except Exception:
   if commit_started: status="commit-ambiguous"
   else:
    try: conn.rollback()
    except Exception: status="rollback-failed"
 except Exception:
  if not commit_started and status!="rollback-failed":
   try: conn.rollback()
   except Exception: status="rollback-failed"
 finally: c.close()
 receipt={"schema":SCHEMA,"status":status,"freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"terminal":terminal,"precommit_receipt_sha256":precommit_hash,"residual_channels":"sequence-owner-superuser-dashboard-provider-credential-holder-attested-not-fenced"}; receipt["receipt_sha256"]=digest(receipt)
 try: final_receipt_writer(receipt)
 except Exception as e:
  if status=="committed": raise FreezeError("committed-unfinalized") from e
  raise FreezeError("final receipt persistence failed") from e
 if status!="committed": raise FreezeError(status)
 return result
def rehearse(conn, *, origin, freeze_id, expected, assertion, callback, provisional_writer,
             rehearsal_receipt_writer, outcome_receipt_writer, terminal_assert, baseline_assert):
 """Run the complete closure cursor path, then unconditionally roll it back."""
 root,head,source_root,terminal_spec=_root_source()
 validate_operator_assertion(assertion,freeze_id=freeze_id,origin=origin,relation_root=expected.relation_root,acl_root=expected.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 now=int(time.time()); expires=assertion["expires_at"]; seconds=expires-now
 if seconds<=0: raise FreezeError("assertion window expired")
 c=conn.cursor(); lock_root=""; captures={}; terminal={}; receipt=None; stage="begin"
 try:
  c.execute("BEGIN"); current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root): raise FreezeError("inventory drift")
  lock_root=_locks(c,expected.relations,seconds)
  current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root): raise FreezeError("post-lock inventory drift")
  payload={"schema":SCHEMA,"state":"active-provisional","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":{"schemas":list(REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":lock_root,"not_before_unix":now,"not_after_unix":expires,"controller_public_key_sha256":CONTROLLER_PUBLIC_KEY_SHA256}
  signed=_verify_active(provisional_writer(payload),set(payload))
  captures=callback(c,signed); validate_capture_roots(captures); stage="capture-validated"
  terminal=terminal_assert(c,terminal_spec)
  if (not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root"))): raise FreezeError("immutable terminal assertion missing")
  stage="terminal-observed"
  receipt={"schema":"g037-rehearsal-v1","status":"terminal-observed-before-rollback","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"terminal":terminal}
  receipt["receipt_sha256"]=digest(receipt)
  if rehearsal_receipt_writer(receipt)!=receipt["receipt_sha256"]: raise FreezeError("rehearsal receipt persistence failed")
  stage="rehearsal-receipt-persisted"
  try: conn.rollback()
  except Exception as rollback_error:
   outcome={"schema":"g037-rehearsal-v1","status":"rollback-failed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"],"failure_stage":stage,"rollback_state":"ambiguous"}
   outcome["receipt_sha256"]=digest(outcome)
   try: outcome_receipt_writer(outcome)
   except Exception: pass
   raise RehearsalRollbackError(FreezeError("rollback required"),rollback_error) from None
  stage="rolled-back"
  baseline=baseline_assert()
  if baseline != {"relation_root":expected.relation_root,"acl_root":expected.acl_root}: raise FreezeError("baseline readback drift")
  outcome={"schema":"g037-rehearsal-v1","status":"rehearsed-rolled-back","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"],"baseline":baseline}
  outcome["receipt_sha256"]=digest(outcome)
  if outcome_receipt_writer(outcome)!=outcome["receipt_sha256"]: raise FreezeError("rehearsal outcome persistence failed")
  return outcome
 except RehearsalRollbackError:
  raise
 except Exception as original_error:
  try: conn.rollback()
  except Exception as rollback_error:
   outcome={"schema":"g037-rehearsal-v1","status":"rollback-failed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"] if receipt else "","failure_stage":stage,"rollback_state":"ambiguous"}
   outcome["receipt_sha256"]=digest(outcome)
   try: outcome_receipt_writer(outcome)
   except Exception: pass
   raise RehearsalRollbackError(original_error,rollback_error) from None
  raise
 finally: c.close()
