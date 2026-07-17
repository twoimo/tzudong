#!/usr/bin/env python3
"""Local-only G037 controller; the freeze owns the only mutation transaction."""
from __future__ import annotations
import argparse, base64, os, re, tempfile, time
from types import SimpleNamespace
from pathlib import Path

import g037_hosted_closure_executor as closure
import g037_managed_recovery as recovery
import g037_write_freeze as freeze
from g037_hosted_closure_contract import AUTHORIZATION_PUBLIC_KEY_PEM, canonical_bytes, digest, repository_root, validate_operator_assertion, validate_sources

SCHEMA="g037-production-controller-v1"
RESIDUAL_CHANNELS=("no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write","producer_stop")
class ControllerError(RuntimeError): pass
FINAL_RECEIPT_FIELDS=frozenset(("schema","status","commit","manifest_sha256","source_root","terminal_spec","freeze_id","origin","controller_public_key_sha256","prepared_receipt_sha256","recovery_receipt_sha256","recipient_fingerprint","logical_ciphertext_sha256","blob_ciphertext_sha256","auth_storage_catalog_root","auth_storage_metadata_root","storage_blob_root","object_count","total_bytes","observed_catalog_root","observed_acl_root","observed_ledger_root"))
OUTCOME_RECEIPT_FIELDS=frozenset(("schema","status","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","prepared_receipt_sha256","recovery_receipt_sha256","final_receipt_sha256"))
DIAGNOSTIC_FINAL_FIELDS=frozenset(("schema","status","outcome","freeze_receipt_sha256","prepared_receipt_sha256","recovery_receipt_sha256","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec"))
def _final_receipt(status, prepared, observed):
 capture=_prepared_binding(prepared,SimpleNamespace(freeze_id=prepared["freeze_id"]),prepared["origin"],Path("."),None)
 if not isinstance(observed,dict) or set(observed)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or observed["terminal_spec"]!=prepared["terminal_spec"]: raise ControllerError("observed terminal roots invalid")
 value={"schema":SCHEMA,"status":status,"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"],"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256,"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":capture["recovery_receipt_sha256"],"recipient_fingerprint":capture["recipient_fingerprint"],"logical_ciphertext_sha256":capture["logical_ciphertext_sha256"],"blob_ciphertext_sha256":capture["blob_ciphertext_sha256"],"auth_storage_catalog_root":capture["auth_storage_catalog_root"],"auth_storage_metadata_root":capture["auth_storage_metadata_root"],"storage_blob_root":capture["storage_blob_root"],"object_count":capture["object_count"],"total_bytes":capture["total_bytes"],"observed_catalog_root":observed["catalog_root"],"observed_acl_root":observed["acl_root"],"observed_ledger_root":observed["ledger_root"]}
 if set(value)!=FINAL_RECEIPT_FIELDS: raise ControllerError("final receipt fields invalid")
 return value
def _outcome_receipt(status, prepared, final_receipt_sha256):
 capture=_prepared_binding(prepared,SimpleNamespace(freeze_id=prepared["freeze_id"]),prepared["origin"],Path("."),None)
 value={"schema":SCHEMA,"status":status,"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"],"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":capture["recovery_receipt_sha256"],"final_receipt_sha256":final_receipt_sha256}
 if set(value)!=OUTCOME_RECEIPT_FIELDS: raise ControllerError("outcome receipt fields invalid")
 return value
def _safe_status(exc):
 return str(exc) if isinstance(exc,(ControllerError,freeze.FreezeError)) and str(exc) in {"failed-rolled-back","rollback-failed","commit-ambiguous","committed-unfinalized"} else "failed-rolled-back"

def _signed(path, public, label): return recovery.signed_json(path, public.encode() if isinstance(public,str) else public, label)
def _private(path,label): recovery.require_file(path,label)
def _assert_key(path, public, label):
 _private(path,label)
 try: actual=recovery.subprocess.run([recovery.command("openssl"),"pkey","-in",str(path),"-pubout"],stdin=recovery.subprocess.DEVNULL,stdout=recovery.subprocess.PIPE,stderr=recovery.subprocess.PIPE,check=True,timeout=recovery.TIMEOUT).stdout
 except Exception as exc: raise ControllerError(label+" unreadable") from exc
 if actual != public: raise ControllerError(label+" does not match pinned key")
def _assert_controller_key(path): _assert_key(path,freeze.CONTROLLER_PUBLIC_KEY_PEM.encode(),"controller signing key")
def _outside(path,label,*,fresh):
 path=Path(path).resolve(); root=repository_root(Path(__file__).resolve())
 if root in path.parents or path.parent==root: raise ControllerError(label+" must be outside repository")
 recovery.require_dir(path.parent,label+" destination")
 if fresh and (path.exists() or path.is_symlink()): raise ControllerError(label+" must be fresh")
 return path
def _outside_fresh(path,label): return _outside(path,label,fresh=True)
def _write_signed(path,key,value,label,public_key=freeze.CONTROLLER_PUBLIC_KEY_PEM):
 path=_outside_fresh(path,label); unsigned=dict(value)
 data=dict(unsigned); data["signature"]=base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),key,canonical_bytes(unsigned))).decode("ascii")
 fd,tmp=tempfile.mkstemp(prefix=".g037-",dir=path.parent)
 temp=Path(tmp)
 try:
  if os.name!="nt": os.chmod(temp,0o600)
  with os.fdopen(fd,"w",encoding="ascii",closefd=True) as f:
   f.write(canonical_bytes(data).decode("ascii")+"\n"); f.flush(); os.fsync(f.fileno())
  try: os.link(temp,path)
  except FileExistsError as exc: raise ControllerError(label+" must be fresh") from exc
  if os.name!="nt":
   directory=os.open(path.parent,os.O_RDONLY)
   try: os.fsync(directory)
   finally: os.close(directory)
 finally: temp.unlink(missing_ok=True)
 # signed_json returns the unsigned payload; authenticate exactly what was persisted.
 if _signed(path,public_key,label)!=unsigned: raise ControllerError(label+" readback invalid")
 return digest(unsigned)
def _deadline(capability): return float(capability["not_after_unix"])
def _terminal_roots(conn, root, manifest):
 cur=conn.cursor()
 try:
  cur.execute("BEGIN TRANSACTION READ ONLY")
  value=closure.observed_terminal_roots(cur,root,manifest)
  conn.rollback(); return value
 except Exception:
  try: conn.rollback()
  except Exception: pass
  raise
 finally: cur.close()
def _residual_attestations(args, issued):
 root=repository_root(Path(__file__).resolve()); seen=set(); attestations={}
 for channel in RESIDUAL_CHANNELS:
  path=getattr(args,"evidence_"+channel,None)
  if not path: raise ControllerError("residual evidence missing")
  p=Path(path).resolve()
  if root in p.parents or p==root or p in seen: raise ControllerError("residual evidence must be distinct and outside repository")
  seen.add(p)
  if not recovery.restrictive(p): raise ControllerError("residual evidence must be a restrictive regular file")
  attestations[channel]={"status":True,"evidence_sha256":recovery.file_hash(p),"observed_at":issued}
 return attestations
def _validate_residual_evidence(args,assertion):
 attestations=assertion.get("attestations")
 if not isinstance(attestations,dict): raise ControllerError("operator assertion attestations missing")
 expected=_residual_attestations(args,int(time.time()))
 for channel, evidence in expected.items():
  if attestations.get(channel,{}).get("evidence_sha256")!=evidence["evidence_sha256"]: raise ControllerError("residual evidence hash mismatch")
def _validate_assertion(assertion,args,root):
 head=freeze._root_source()[1]; source_root=freeze._root_source()[2]; terminal=freeze._root_source()[3]
 relation=assertion.get("relation_root"); acl=assertion.get("acl_root")
 if not isinstance(relation,str) or not isinstance(acl,str): raise ControllerError("operator assertion inventory roots missing")
 validate_operator_assertion(assertion,freeze_id=args.freeze_id,origin=recovery.origin(args.origin),relation_root=relation,acl_root=acl,commit=head,source_root=source_root,terminal_spec=terminal)
 if assertion.get("expires_at",0)<=int(time.time()): raise ControllerError("operator assertion expired")
 if assertion.get("expires_at",0)-assertion.get("issued_at",0)>900: raise ControllerError("operator assertion expiry exceeds prepare maximum")
 _validate_residual_evidence(args,assertion)
 return assertion
def validate(args, *, require_fresh_outputs=False):
 base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); validate_sources(root)
 _private(args.operator_assertion,"operator assertion"); assertion=_signed(args.operator_assertion,AUTHORIZATION_PUBLIC_KEY_PEM,"operator assertion"); _validate_assertion(assertion,args,root)
 _assert_controller_key(args.controller_signing_key); _assert_key(args.recovery_signing_key,recovery.RECOVERY_PUBLIC_KEY,"recovery signing key")
 recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file); recovery.pgpass(args.pgpass_file,entries)
 recovery.safe_destination(args.destination)
 for path,label in ((args.recovery_receipt,"recovery receipt"),(args.prepared_receipt,"prepared receipt"),(args.final_receipt,"final receipt"),(args.outcome_receipt,"outcome receipt")): _outside(path,label,fresh=require_fresh_outputs)
 if getattr(args,"secret_file",None): recovery.require_file(args.secret_file,"secret file")
 if bool(getattr(args,"secret_env",None))==bool(getattr(args,"secret_file",None)): raise ControllerError("supply exactly one secret reference")
 return {"schema":SCHEMA,"mode":"validate","status":"valid","origin":base,"recipient_fingerprint":fp}
def _project_ref(origin):
 if not isinstance(origin,str):
  raise ControllerError("origin must be canonical https://<project-ref>.supabase.co")
 match=re.fullmatch(r"https://([a-z0-9]{20})\.supabase\.co",origin)
 if not match:
  raise ControllerError("origin must be canonical https://<project-ref>.supabase.co")
 return match.group(1)
def _bound_service(args, origin):
 entries=recovery.service(args.service_file,args.service_name)
 ref=_project_ref(origin)
 host=entries.get("host")
 user=entries.get("user")
 if entries.get("dbname")!="postgres":
  raise ControllerError("service database must be postgres")
 if host==f"db.{ref}.supabase.co":
  if user!="postgres":
   raise ControllerError("direct service user does not match project")
 elif re.fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com",host or ""):
  if user!=f"postgres.{ref}":
   raise ControllerError("pooler service user does not match project")
 else:
  raise ControllerError("service host does not match project")
 return entries
def _validated_binding(args):
 base=recovery.origin(args.origin)
 return base,_bound_service(args,base)
def _connect(entries,args,readonly=False):
 try:
  import psycopg
  options="-c default_transaction_read_only=on" if readonly else None
  return psycopg.connect(**dict(entries,passfile=str(Path(args.pgpass_file).resolve()),autocommit=False,connect_timeout=20,options=options))
 except Exception as exc: raise ControllerError("controller database connection unavailable") from exc
def prepare(args):
 base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 _assert_key(args.authorization_signing_key,AUTHORIZATION_PUBLIC_KEY_PEM.encode(),"authorization signing key")
 recovery.pgpass(args.pgpass_file,entries)
 seconds=args.expiry_seconds
 if not isinstance(seconds,int) or isinstance(seconds,bool) or not 0<seconds<=900: raise ControllerError("expiry seconds must be between 1 and 900")
 _outside_fresh(args.operator_assertion,"operator assertion")
 issued=int(time.time()); attestations=_residual_attestations(args,issued)
 conn=_connect(entries,args)
 try:
  inventory=freeze.preflight(conn)
  state=getattr(getattr(conn,"info",None),"transaction_status",0)
  if state not in (0,"IDLE"): raise ControllerError("preflight connection not clean")
 finally: conn.close()
 _,head,source_root,terminal_spec=freeze._root_source()
 assertion={"schema":"g037-write-freeze-assertion-v1","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"relation_root":inventory.relation_root,"acl_root":inventory.acl_root,"source_root":source_root,"terminal_spec":terminal_spec,"issued_at":issued,"expires_at":issued+seconds,"attestations":attestations}
 assertion_hash=_write_signed(args.operator_assertion,args.authorization_signing_key,assertion,"operator assertion",AUTHORIZATION_PUBLIC_KEY_PEM)
 # Validate the authenticated persisted bytes against the exact inventory and source bindings.
 persisted=_signed(args.operator_assertion,AUTHORIZATION_PUBLIC_KEY_PEM,"operator assertion")
 validate_operator_assertion(persisted,freeze_id=args.freeze_id,origin=base,relation_root=inventory.relation_root,acl_root=inventory.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 return {"schema":SCHEMA,"mode":"prepare","status":"prepared","assertion_sha256":assertion_hash,"expires_at":assertion["expires_at"],"relation_root":inventory.relation_root,"acl_root":inventory.acl_root}
def execute(args):
 validate(args,require_fresh_outputs=True); base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 assertion=_signed(args.operator_assertion,AUTHORIZATION_PUBLIC_KEY_PEM,"operator assertion"); recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file); secret=recovery.read_secret_reference(args.secret_env,args.secret_file)
 conn=_connect(entries,args); expected=freeze._inv(conn)
 try:
  final_status={"value":None}; prepared_value={"value":None}; final_hash={"value":None}; freeze_receipt={"value":None}
  def provisional(payload):
   return {**payload,"signature":base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),args.controller_signing_key,canonical_bytes(payload))).decode("ascii")}
  def callback(cur,capability):
   root_source,head,source_root,terminal_spec=freeze._root_source()
   expected_binding={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":recovery.EXPECTED_FREEZE_SCOPE,"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":capability.get("held_lock_root"),"not_before_unix":capability.get("not_before_unix"),"not_after_unix":capability.get("not_after_unix"),"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256}
   captured=recovery.capture_cursor(cur,base=base,secret=secret,recipient=recipient,recipient_fingerprint=fp,service_file=args.service_file,pgpass_file=args.pgpass_file,service_name=args.service_name,destination=args.destination,age_command=args.age_command,pg_dump_command=args.pg_dump,deadline=_deadline(capability),freeze_capability=capability,expected_binding=expected_binding,recovery_signing_key=args.recovery_signing_key,recovery_receipt=args.recovery_receipt)
   closure.rehearse_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"])
   closure.apply_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"])
   return captured
  def terminal(cur,spec):
   observed=closure.observed_terminal_roots(cur,root,manifest)
   if observed.get("terminal_spec")!=spec: raise ControllerError("terminal specification drift")
   return observed
  def prepared(intent):
   prepared_value["value"]=intent
   _write_signed(args.prepared_receipt,args.controller_signing_key,intent,"prepared receipt")
   return intent["receipt_sha256"]
  def diagnostic(receipt,status):
   prepared=prepared_value["value"]
   if prepared is None: return None
   value={"schema":SCHEMA,"status":"diagnostic","outcome":status,"freeze_receipt_sha256":receipt["receipt_sha256"],"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":prepared["capture_roots"]["recovery_receipt_sha256"],"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"]}
   if set(value)!=DIAGNOSTIC_FINAL_FIELDS: raise ControllerError("diagnostic receipt fields invalid")
   return _write_signed(args.final_receipt,args.controller_signing_key,value,"diagnostic outcome receipt")
  def final(receipt):
   freeze_receipt["value"]=receipt
   status=receipt["status"]; final_status["value"]=status
   if status!="committed":
    final_hash["value"]=diagnostic(receipt,status)
    return
   observed=_terminal_roots(conn,root,manifest)
   if observed != receipt["terminal"]: raise ControllerError("committed-unfinalized")
   value=_final_receipt("committed",prepared_value["value"],observed)
   final_hash["value"]=_write_signed(args.final_receipt,args.controller_signing_key,value,"final receipt")
  try:
   result=freeze.run(conn,origin=base,freeze_id=args.freeze_id,expected=expected,assertion=assertion,callback=callback,provisional_writer=provisional,precommit_receipt_writer=prepared,final_receipt_writer=final,terminal_assert=terminal)
  except Exception as exc:
   status=_safe_status(exc); prepared=prepared_value["value"]
   if prepared is not None and freeze_receipt["value"] is not None:
    if final_hash["value"] is None: final_hash["value"]=diagnostic(freeze_receipt["value"],status)
    _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt(status,prepared,final_hash["value"]),"outcome receipt")
   raise
  prepared=prepared_value["value"]
  if prepared is None or final_hash["value"] is None: raise ControllerError("final receipt persistence missing")
  _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt(final_status["value"],prepared,final_hash["value"]),"outcome receipt")
  return result
 finally: conn.close()
def _prepared_binding(prepared,args,base,root,manifest):
 root_source,head,source_root,terminal_spec=freeze._root_source()
 unsigned=dict(prepared); claimed=unsigned.pop("receipt_sha256",None)
 required={"schema","status","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","before_relation_root","before_acl_root","held_lock_root","capture_roots","terminal","receipt_sha256"}
 if set(prepared)!=required or claimed!=digest(unsigned) or prepared["schema"]!=freeze.SCHEMA or prepared["status"]!="prepared-not-committed" or prepared["freeze_id"]!=args.freeze_id or prepared["origin"]!=base or prepared["commit"]!=head or prepared["source_root"]!=source_root or prepared["terminal_spec"]!=terminal_spec or prepared["manifest_sha256"]!=freeze.MANIFEST_SHA256: raise ControllerError("prepared receipt binding invalid")
 terminal=prepared["terminal"]
 if not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root")): raise ControllerError("prepared terminal roots invalid")
 capture=prepared["capture_roots"]
 expected={"auth_storage_catalog_root","auth_storage_metadata_root","storage_blob_root","recipient_fingerprint","logical_ciphertext_sha256","blob_ciphertext_sha256","object_count","total_bytes","recovery_receipt_sha256"}
 if not isinstance(capture,dict) or set(capture)!=expected: raise ControllerError("prepared capture roots invalid")
 if any(not isinstance(capture[k],str) or len(capture[k])!=64 or any(c not in "0123456789abcdef" for c in capture[k]) for k in expected-{"object_count","total_bytes"}) or any(not isinstance(capture[k],int) or isinstance(capture[k],bool) or capture[k]<0 for k in ("object_count","total_bytes")): raise ControllerError("prepared capture values invalid")
 return capture
def _baseline_roots(conn):
 cur=conn.cursor()
 try:
  cur.execute("BEGIN TRANSACTION READ ONLY")
  inventory=freeze._inv(conn)
  conn.rollback()
  return {"relation_root":inventory.relation_root,"acl_root":inventory.acl_root}
 except Exception:
  try: conn.rollback()
  except Exception: pass
  raise
 finally: cur.close()
def rehearse(args):
 """Full local cursor rehearsal. freeze.rehearse has no commit path."""
 validate(args,require_fresh_outputs=True); base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 _outside_fresh(args.rehearsal_receipt,"rehearsal receipt"); _outside_fresh(args.rehearsal_outcome_receipt,"rehearsal outcome receipt")
 assertion=_signed(args.operator_assertion,AUTHORIZATION_PUBLIC_KEY_PEM,"operator assertion"); recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file); secret=recovery.read_secret_reference(args.secret_env,args.secret_file)
 conn=_connect(entries,args); expected=freeze._inv(conn)
 try:
  def provisional(payload):
   return {**payload,"signature":base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),args.controller_signing_key,canonical_bytes(payload))).decode("ascii")}
  def callback(cur,capability):
   root_source,head,source_root,terminal_spec=freeze._root_source()
   binding={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":recovery.EXPECTED_FREEZE_SCOPE,"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":capability.get("held_lock_root"),"not_before_unix":capability.get("not_before_unix"),"not_after_unix":capability.get("not_after_unix"),"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256}
   captured=recovery.capture_cursor(cur,base=base,secret=secret,recipient=recipient,recipient_fingerprint=fp,service_file=args.service_file,pgpass_file=args.pgpass_file,service_name=args.service_name,destination=args.destination,age_command=args.age_command,pg_dump_command=args.pg_dump,deadline=_deadline(capability),freeze_capability=capability,expected_binding=binding,recovery_signing_key=args.recovery_signing_key,recovery_receipt=args.recovery_receipt)
   closure.rehearse_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"])
   closure.apply_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"])
   return captured
  def terminal(cur,spec):
   observed=closure.observed_terminal_roots(cur,root,manifest)
   if observed.get("terminal_spec")!=spec: raise ControllerError("terminal specification drift")
   return observed
  def receipt(value): return _write_signed(args.rehearsal_receipt,args.controller_signing_key,value,"rehearsal receipt")
  def outcome(value): return _write_signed(args.rehearsal_outcome_receipt,args.controller_signing_key,value,"rehearsal outcome receipt")
  return freeze.rehearse(conn,origin=base,freeze_id=args.freeze_id,expected=expected,assertion=assertion,callback=callback,provisional_writer=provisional,rehearsal_receipt_writer=receipt,outcome_receipt_writer=outcome,terminal_assert=terminal,baseline_assert=lambda:_baseline_roots(conn))
 finally: conn.close()
def reconcile(args):
 # No migration/executor path is reachable here: this is a new read-only observation only.
 base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root); _assert_controller_key(args.controller_signing_key)
 _outside_fresh(args.final_receipt,"final receipt"); _outside_fresh(args.outcome_receipt,"outcome receipt")
 prepared=_signed(args.prepared_receipt,freeze.CONTROLLER_PUBLIC_KEY_PEM,"prepared receipt"); capture=_prepared_binding(prepared,args,base,root,manifest)
 recovery_receipt=recovery.load_receipt(args.recovery_receipt)
 if capture["recovery_receipt_sha256"]!=digest(recovery_receipt): raise ControllerError("recovery receipt binding invalid")
 evidence=recovery_receipt.get("evidence")
 if not isinstance(evidence,dict) or capture["logical_ciphertext_sha256"]!=evidence.get("logical_ciphertext_sha256") or capture["blob_ciphertext_sha256"]!=evidence.get("blob_ciphertext_sha256") or capture["recipient_fingerprint"]!=evidence.get("recipient_fingerprint") or capture["auth_storage_catalog_root"]!=evidence.get("catalog_sha256") or capture["auth_storage_metadata_root"]!=evidence.get("metadata_sha256") or capture["storage_blob_root"]!=digest(evidence.get("members")) or capture["object_count"]!=evidence.get("object_count") or capture["total_bytes"]!=evidence.get("total_bytes"): raise ControllerError("recovery capture binding invalid")
 recovery.verify(type("RecoveryVerifyArgs",(),{"destination":args.destination,"recipient_file":args.recipient_file,"recipient_allowlist_file":args.recipient_allowlist_file,"identity_file":args.identity_file,"receipt":args.recovery_receipt,"logical_archive":args.logical_archive,"blob_archive":args.blob_archive,"age_command":args.age_command,"pg_restore":args.pg_restore})())
 recovery.pgpass(args.pgpass_file,entries); conn=_connect(entries,args,readonly=True)
 try: observed=_terminal_roots(conn,root,manifest)
 finally: conn.close()
 if observed!=prepared["terminal"]: raise ControllerError("terminal readback drift")
 value=_final_receipt("reconciled",prepared,observed)
 final_hash=_write_signed(args.final_receipt,args.controller_signing_key,value,"reconciled final receipt")
 _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt("reconciled",prepared,final_hash),"outcome receipt")
 return value
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True)
 def common(x):
  x.add_argument("--origin",required=True); x.add_argument("--freeze-id",required=True); x.add_argument("--controller-signing-key",required=True); x.add_argument("--service-file",required=True); x.add_argument("--service-name",default="g037"); x.add_argument("--pgpass-file",required=True); x.add_argument("--destination",required=True); x.add_argument("--recovery-receipt",required=True); x.add_argument("--prepared-receipt",required=True); x.add_argument("--final-receipt",required=True); x.add_argument("--outcome-receipt",required=True); x.add_argument("--recipient-file",required=True); x.add_argument("--recipient-allowlist-file",required=True)
 def assertion_inputs(x):
  x.add_argument("--operator-assertion",required=True); x.add_argument("--recovery-signing-key",required=True)
  for channel in RESIDUAL_CHANNELS: x.add_argument("--evidence-"+channel.replace("_","-"),dest="evidence_"+channel,required=True)
 for name in ("validate","execute","rehearse","reconcile"):
  x=sub.add_parser(name); common(x)
  if name in ("validate","execute","rehearse"): assertion_inputs(x)
  if name in ("execute","rehearse"): x.add_argument("--secret-env"); x.add_argument("--secret-file"); x.add_argument("--age-command",default="age"); x.add_argument("--pg-dump",default="pg_dump")
  if name=="rehearse": x.add_argument("--rehearsal-receipt",required=True); x.add_argument("--rehearsal-outcome-receipt",required=True)
  if name=="reconcile": x.add_argument("--logical-archive",required=True); x.add_argument("--blob-archive",required=True); x.add_argument("--identity-file",required=True); x.add_argument("--age-command",default="age"); x.add_argument("--pg-restore",default="pg_restore")
 x=sub.add_parser("prepare")
 x.add_argument("--origin",required=True); x.add_argument("--freeze-id",required=True); x.add_argument("--authorization-signing-key",required=True); x.add_argument("--operator-assertion",required=True); x.add_argument("--service-file",required=True); x.add_argument("--service-name",default="g037"); x.add_argument("--pgpass-file",required=True); x.add_argument("--expiry-seconds",type=int,default=600)
 for channel in RESIDUAL_CHANNELS: x.add_argument("--evidence-"+channel.replace("_","-"),dest="evidence_"+channel,required=True)
 return p
def main(argv=None):
 try:
  args=parser().parse_args(argv); result={"prepare":prepare,"validate":validate,"execute":execute,"rehearse":rehearse,"reconcile":reconcile}[args.mode](args); print(canonical_bytes({k:result[k] for k in ("schema","mode","status","assertion_sha256","expires_at","relation_root","acl_root") if k in result}).decode()); return 0
 except Exception: print(canonical_bytes({"schema":SCHEMA,"status":"rejected"}).decode()); return 2
if __name__=="__main__": raise SystemExit(main())
