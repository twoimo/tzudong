#!/usr/bin/env python3
"""Local-only G037 controller; the freeze owns the only mutation transaction."""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, time
from types import SimpleNamespace
from pathlib import Path

import g037_hosted_closure_executor as closure
import g037_managed_recovery as recovery
import g037_write_freeze as freeze
from g035_hosted_recovery_contract import ContractError
from g037_hosted_closure_contract import AUTHORIZATION_PUBLIC_KEY_PEM, canonical_bytes, digest, no_duplicate_object, repository_root, terminal_spec as build_terminal_spec, validate_operator_assertion, validate_operator_assertion_request, validate_sources
import g037_remediation_authorization as remediation_authorization

SCHEMA="g037-production-controller-v1"
RESIDUAL_CHANNELS=("no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write","producer_stop")
PRODUCER_STOP_JOBS=(
 {"workflow":"account-deletion-worker.yml","job":"dispatch","freeze_guard":"vars.G037_WRITE_FREEZE != 'active'","guard_active":True,"no_in_flight":True},
 {"workflow":"privacy-retention.yml","job":"retain","freeze_guard":"vars.G037_WRITE_FREEZE != 'active'","guard_active":True,"no_in_flight":True},
)
class ControllerError(RuntimeError): pass
FINAL_RECEIPT_FIELDS=frozenset(("schema","status","commit","manifest_sha256","source_root","terminal_spec","freeze_id","origin","controller_public_key_sha256","prepared_receipt_sha256","recovery_receipt_sha256","recipient_fingerprint","logical_ciphertext_sha256","blob_ciphertext_sha256","auth_storage_catalog_root","auth_storage_metadata_root","storage_blob_root","object_count","total_bytes","short_urls_catalog_root","short_urls_rowset_root","short_urls_victim_descriptors_root","short_urls_row_count","duplicate_group_count","duplicate_victim_count","authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256","observed_catalog_root","observed_acl_root","observed_ledger_root"))
OUTCOME_RECEIPT_FIELDS=frozenset(("schema","status","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","prepared_receipt_sha256","recovery_receipt_sha256","authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256","final_receipt_sha256","attempt_marker_sha256"))
DIAGNOSTIC_FINAL_FIELDS=frozenset(("schema","status","outcome","freeze_receipt_sha256","prepared_receipt_sha256","recovery_receipt_sha256","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256","attempt_marker_sha256"))
def _final_receipt(status, prepared, observed):
 capture=_prepared_binding(prepared,SimpleNamespace(freeze_id=prepared["freeze_id"]),prepared["origin"],Path("."),None)
 if not isinstance(observed,dict) or set(observed)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or observed["terminal_spec"]!=prepared["terminal_spec"]: raise ControllerError("observed terminal roots invalid")
 value={"schema":SCHEMA,"status":status,"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"],"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256,"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":capture["recovery_receipt_sha256"],"recipient_fingerprint":capture["recipient_fingerprint"],"logical_ciphertext_sha256":capture["logical_ciphertext_sha256"],"blob_ciphertext_sha256":capture["blob_ciphertext_sha256"],"auth_storage_catalog_root":capture["auth_storage_catalog_root"],"auth_storage_metadata_root":capture["auth_storage_metadata_root"],"storage_blob_root":capture["storage_blob_root"],"object_count":capture["object_count"],"total_bytes":capture["total_bytes"],"short_urls_catalog_root":capture["short_urls_catalog_root"],"short_urls_rowset_root":capture["short_urls_rowset_root"],"short_urls_victim_descriptors_root":capture["short_urls_victim_descriptors_root"],"short_urls_row_count":capture["short_urls_row_count"],"duplicate_group_count":capture["duplicate_group_count"],"duplicate_victim_count":capture["duplicate_victim_count"],**{key:prepared["remediation_evidence"][key] for key in ("authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256")},"observed_catalog_root":observed["catalog_root"],"observed_acl_root":observed["acl_root"],"observed_ledger_root":observed["ledger_root"]}
 if set(value)!=FINAL_RECEIPT_FIELDS: raise ControllerError("final receipt fields invalid")
 return value
def _outcome_receipt(status, prepared, final_receipt_sha256, attempt_marker_sha256="0"*64):
 capture=_prepared_binding(prepared,SimpleNamespace(freeze_id=prepared["freeze_id"]),prepared["origin"],Path("."),None)
 value={"schema":SCHEMA,"status":status,"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"],"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":capture["recovery_receipt_sha256"],**{key:prepared["remediation_evidence"][key] for key in ("authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256")},"final_receipt_sha256":final_receipt_sha256,"attempt_marker_sha256":attempt_marker_sha256}
 if set(value)!=OUTCOME_RECEIPT_FIELDS: raise ControllerError("outcome receipt fields invalid")
 return value
def _safe_status(exc):
 return str(exc) if isinstance(exc,(ControllerError,freeze.FreezeError)) and str(exc) in {"failed-rolled-back","rollback-failed","commit-ambiguous","committed-unfinalized"} else "failed-rolled-back"

def _signed(path, public, label): return recovery.signed_json(path, public.encode() if isinstance(public,str) else public, label)
def _signed_assertion(path, label):
 raw_path=Path(path)
 try:
  persisted=raw_path.read_bytes()
  envelope=json.loads(persisted.decode("ascii"),object_pairs_hook=no_duplicate_object)
 except Exception as exc: raise ControllerError(label+" unreadable") from exc
 if not isinstance(envelope,dict) or "signature" not in envelope: raise ControllerError(label+" signature absent")
 authenticated=_signed(path,AUTHORIZATION_PUBLIC_KEY_PEM,label)
 try:
  if raw_path.read_bytes()!=persisted: raise ControllerError(label+" changed during authentication")
 except ControllerError: raise
 except Exception as exc: raise ControllerError(label+" unreadable") from exc
 unsigned=dict(envelope); unsigned.pop("signature")
 if unsigned!=authenticated: raise ControllerError(label+" authenticated projection mismatch")
 return envelope,unsigned
def _private(path,label): recovery.require_file(path,label)
def _assert_key(path, public, label):
 try: actual=recovery.private_key_public(path)
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
def _remediation_custody(path,label):
 raw=Path(path)
 if raw.is_symlink(): raise ControllerError(label+" must be a restrictive regular file outside repository")
 path=raw.resolve(); root=repository_root(Path(__file__).resolve())
 if root in path.parents or path==root or not recovery.restrictive(path): raise ControllerError(label+" must be a restrictive regular file outside repository")
 recovery.require_file(path,label)
 return path
def _held_custody(path,label):
 path=_remediation_custody(path,label)
 flags=os.O_RDONLY | getattr(os,"O_BINARY",0)
 if hasattr(os,"O_NOFOLLOW"): flags|=os.O_NOFOLLOW
 try:
  descriptor=os.open(path,flags)
  initial=os.fstat(descriptor)
  if not __import__("stat").S_ISREG(initial.st_mode): raise ControllerError(label+" must be a restrictive regular file outside repository")
  # Do not authenticate a path whose identity changed while it was being admitted.
  current=path.stat()
  if (initial.st_dev,initial.st_ino)!=(current.st_dev,current.st_ino): raise ControllerError(label+" changed during custody admission")
  chunks=[]
  while True:
   part=os.read(descriptor,65536)
   if not part: break
   chunks.append(part)
  return path,(initial.st_dev,initial.st_ino),b"".join(chunks)
 except ControllerError: raise
 except Exception as exc: raise ControllerError(label+" unreadable") from exc
 finally:
  try: os.close(descriptor)
  except Exception: pass
def _attempt_journal_directory():
 directory=Path("C:/ProgramData/TzudongRecovery/g037-attempts") if os.name=="nt" else Path("/var/lib/tzudong-recovery/g037-attempts")
 recovery.require_dir(directory,"attempt journal")
 return directory
def _attempt_identity(envelope):
 if type(envelope) is not remediation_authorization.ExecutionAuthorizationEnvelope: raise ControllerError("execution envelope invalid")
 try: authorization=json.loads(envelope.raw.decode("utf8"),object_pairs_hook=no_duplicate_object)
 except Exception as exc: raise ControllerError("execution envelope invalid") from exc
 authorization_id=authorization.get("authorization_id") if isinstance(authorization,dict) else None
 if not isinstance(authorization_id,str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",authorization_id): raise ControllerError("execution envelope invalid")
 return authorization_id,hashlib.sha256(envelope.raw).hexdigest(),hashlib.sha256(envelope.signature).hexdigest()
def _attempt_path(authorization_id,authorization_sha256):
 return _attempt_journal_directory()/(authorization_id+"-"+authorization_sha256+".json")
def _attempt_marker(args, origin, envelope):
 authorization_id,authorization_sha256,signature_sha256=_attempt_identity(envelope)
 value={"schema":"g037-execution-attempt-v1","authorization_id":authorization_id,"execution_authorization_sha256":authorization_sha256,"execution_authorization_signature_sha256":signature_sha256,"freeze_id":args.freeze_id,"origin":origin,"issued_at":int(time.time())}
 return _write_unsigned(_attempt_path(authorization_id,authorization_sha256),value,"attempt marker")
def _read_attempt_marker(args, prepared):
 evidence=prepared.get("remediation_evidence")
 if not isinstance(evidence,dict): raise ControllerError("attempt marker binding invalid")
 authorization_id=evidence.get("authorization_id"); authorization_sha256=evidence.get("execution_authorization_sha256")
 if not isinstance(authorization_id,str) or not isinstance(authorization_sha256,str): raise ControllerError("attempt marker binding invalid")
 path=_outside(_attempt_path(authorization_id,authorization_sha256),"attempt marker",fresh=False)
 _,_,raw=_held_custody(path,"attempt marker")
 try: value=json.loads(raw.decode("ascii"),object_pairs_hook=no_duplicate_object)
 except Exception as exc: raise ControllerError("attempt marker unreadable") from exc
 if canonical_bytes(value)!=raw: raise ControllerError("attempt marker binding invalid")
 required={"schema","authorization_id","execution_authorization_sha256","execution_authorization_signature_sha256","freeze_id","origin","issued_at"}
 issued_at=value.get("issued_at") if isinstance(value,dict) else None
 if not isinstance(value,dict) or set(value)!=required or value["schema"]!="g037-execution-attempt-v1" or value["authorization_id"]!=authorization_id or value["execution_authorization_sha256"]!=authorization_sha256 or value["execution_authorization_signature_sha256"]!=evidence.get("execution_authorization_signature_sha256") or value["freeze_id"]!=prepared["freeze_id"] or value["origin"]!=prepared["origin"] or not isinstance(issued_at,int) or isinstance(issued_at,bool) or issued_at<=0 or issued_at>int(time.time())+30: raise ControllerError("attempt marker binding invalid")
 return digest(value)

def _execution_bindings(args, assertion, recipient_fingerprint, assertion_sha256):
 _,head,source_root,_=freeze._root_source()
 terminal_spec=build_terminal_spec(validate_sources(repository_root(Path(__file__).resolve())))
 return {
  "purpose":remediation_authorization.PURPOSE,"policy":remediation_authorization.POLICY,
  "origin":recovery.origin(args.origin),"project":_project_ref(recovery.origin(args.origin)),
  "current_commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":source_root,
  "terminal_spec":terminal_spec,"freeze_id":args.freeze_id,
  "operator_assertion_sha256":assertion_sha256,
  "operator_assertion_expires_at":assertion["expires_at"],
  "recipient_fingerprint":recipient_fingerprint,
  "recovery_public_key_fingerprint":recovery.RECOVERY_PUBLIC_KEY_SHA256,
  "capture_scope_sha256":digest({"schemas":["auth","storage","public.short_urls"],"selection_spec":recovery.SHORT_URL_SELECTION_SPEC}),
  "baseline_ledger_state":"exact-g037-baseline",
  "legacy_capture_receipt_sha256":None,"legacy_restore_receipt_sha256":None,
  "legacy_inspection_receipt_sha256":None,"legacy_repository_commit":None,"legacy_authorization_sha256":None,
  "legacy_authorization_signature_sha256":None,"legacy_vector":None,
 }

def _verify_remediation(args, assertion, recipient_fingerprint, assertion_sha256):
 try:
  chain=remediation_authorization.verify_legacy_remediation_chain(
   args.legacy_capture_receipt,args.legacy_restore_receipt,args.legacy_inspection_receipt,
   args.legacy_authorization,args.legacy_authorization_signature,
   require_custody=_remediation_custody)
  expected=_execution_bindings(args,assertion,recipient_fingerprint,assertion_sha256)
  expected.update({"legacy_capture_receipt_sha256":chain.capture_receipt_sha256,"legacy_restore_receipt_sha256":chain.restore_receipt_sha256,"legacy_inspection_receipt_sha256":chain.inspection_receipt_sha256,"legacy_repository_commit":chain.legacy_repository_commit,"legacy_authorization_sha256":chain.legacy_authorization_sha256,"legacy_authorization_signature_sha256":chain.legacy_authorization_signature_sha256,"legacy_vector":dict(chain.legacy_vector)})
  envelope=remediation_authorization.authenticate_execution_authorization_document(
   args.execution_authorization,args.execution_authorization_signature,
   require_custody=_remediation_custody,expected_bindings=expected)
 except ContractError as exc: raise ControllerError(str(exc)) from exc
 return envelope,expected

def _remediation_binding(envelope,expected_bindings,capture,args,attempt_marker_sha256):
 receipt=recovery.load_receipt(args.recovery_receipt)
 if capture.get("recovery_receipt_sha256")!=digest(receipt): raise ControllerError("fresh recovery receipt binding invalid")
 source=receipt.get("evidence")
 required={"short_urls_catalog_sha256","short_urls_rowset_sha256","victim_descriptors_sha256","short_urls_row_count","duplicate_group_count","duplicate_victim_count","selection_spec_sha256","duplicate_victims_sha256"}
 if not isinstance(source,dict) or not required <= set(source): raise ControllerError("fresh recovery evidence missing")
 evidence={"selection_spec_sha256":source["selection_spec_sha256"],"short_urls_catalog_sha256":source["short_urls_catalog_sha256"],"short_urls_rowset_sha256":source["short_urls_rowset_sha256"],"short_urls_row_count":source["short_urls_row_count"],"duplicate_group_count":source["duplicate_group_count"],"duplicate_victim_count":source["duplicate_victim_count"],"victim_descriptor_count":source["duplicate_victim_count"],"duplicate_victims_sha256":source["duplicate_victims_sha256"],"victim_descriptors_sha256":source["victim_descriptors_sha256"]}
 return {"envelope":envelope,"expected_bindings":expected_bindings,"execution_authorization_sha256":hashlib.sha256(envelope.raw).hexdigest(),"execution_authorization_signature_sha256":hashlib.sha256(envelope.signature).hexdigest(),"attempt_marker_sha256":attempt_marker_sha256,"legacy_repository_commit":expected_bindings["legacy_repository_commit"],"legacy_authorization_sha256":expected_bindings["legacy_authorization_sha256"],"legacy_authorization_signature_sha256":expected_bindings["legacy_authorization_signature_sha256"],"legacy_capture_receipt_sha256":expected_bindings["legacy_capture_receipt_sha256"],"legacy_restore_receipt_sha256":expected_bindings["legacy_restore_receipt_sha256"],"legacy_inspection_receipt_sha256":expected_bindings["legacy_inspection_receipt_sha256"],"recovery_receipt_sha256":capture["recovery_receipt_sha256"],"capture_evidence":freeze.verified_recovery_capture(evidence)}
def _fsync_directory(path):
 try:
  from g040_recovery_authorization import _fsync_directory as sync
  sync(Path(path))
 except Exception as exc: raise ControllerError("directory durability failed") from exc
def _write_unsigned(path,value,label):
 path=_outside_fresh(path,label); data=canonical_bytes(value)
 temp=Path(recovery._temporary_bytes(data,".g037-",directory=path.parent))
 try:
  try: os.link(temp,path)
  except FileExistsError as exc: raise ControllerError(label+" must be fresh") from exc
  _fsync_directory(path.parent)
  recovery.require_file(path,label)
  if path.read_bytes()!=data: raise ControllerError(label+" readback invalid")
  return digest(value)
 finally:
  recovery._cleanup_temporary_files(temp)
def _write_finalized_assertion(path,request,signature):
 path=_outside_fresh(path,"operator assertion")
 value={**request,"signature":base64.b64encode(signature).decode("ascii")}
 data=canonical_bytes(value)
 temp=Path(recovery._temporary_bytes(data,".g037-",directory=path.parent))
 try:
  try: os.link(temp,path)
  except FileExistsError as exc: raise ControllerError("operator assertion must be fresh") from exc
  _fsync_directory(path.parent)
  if _signed(path,AUTHORIZATION_PUBLIC_KEY_PEM,"operator assertion")!=request: raise ControllerError("operator assertion readback invalid")
  return digest(value)
 finally:
  recovery._cleanup_temporary_files(temp)
def _write_signed(path,key,value,label,public_key=freeze.CONTROLLER_PUBLIC_KEY_PEM):
 path=_outside_fresh(path,label); unsigned=dict(value)
 data=dict(unsigned); data["signature"]=base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),key,canonical_bytes(unsigned))).decode("ascii")
 temp=Path(recovery._temporary_bytes(canonical_bytes(data)+b"\n",".g037-",directory=path.parent))
 try:
  try: os.link(temp,path)
  except FileExistsError as exc: raise ControllerError(label+" must be fresh") from exc
  if os.name!="nt":
   directory=os.open(path.parent,os.O_RDONLY)
   try: os.fsync(directory)
   finally: os.close(directory)
  recovery.require_file(path,label)
  if _signed(path,public_key,label)!=unsigned: raise ControllerError(label+" readback invalid")
  return digest(unsigned)
 finally:
  recovery._cleanup_temporary_files(temp)
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
 root=repository_root(Path(__file__).resolve()); identities=set(); hashes=set(); attestations={}
 for channel in RESIDUAL_CHANNELS:
  path=getattr(args,"evidence_"+channel,None)
  if not path: raise ControllerError("residual evidence missing")
  raw=Path(path)
  if raw.is_symlink(): raise ControllerError("residual evidence must be a restrictive regular file")
  p=raw.resolve()
  if root in p.parents or p==root or not recovery.restrictive(p): raise ControllerError("residual evidence must be distinct and outside repository")
  try:
   identity=(p.stat().st_dev,p.stat().st_ino); content=p.read_bytes()
   evidence=json.loads(content.decode("utf-8"),object_pairs_hook=no_duplicate_object)
  except Exception as exc: raise ControllerError("residual evidence unreadable") from exc
  content_sha256=__import__("hashlib").sha256(content).hexdigest()
  if identity in identities or content_sha256 in hashes: raise ControllerError("residual evidence identities must be unique")
  identities.add(identity); hashes.add(content_sha256)
  observed_at=evidence.get("observed_at") if isinstance(evidence,dict) else None
  required={"schema","channel","freeze_id","status","observed_at"}
  producer_fields={"producers"} if channel=="producer_stop" else set()
  if not isinstance(evidence,dict) or set(evidence) != required | producer_fields or evidence.get("schema")!="g037-residual-freeze-evidence-v1" or evidence.get("channel")!=channel or evidence.get("freeze_id")!=args.freeze_id or evidence.get("status") is not True or not isinstance(observed_at,int) or isinstance(observed_at,bool) or observed_at>issued or issued-observed_at>900 or (channel=="producer_stop" and evidence.get("producers")!=list(PRODUCER_STOP_JOBS)): raise ControllerError("residual evidence binding, status, or freshness invalid")
  attestations[channel]={"status":True,"evidence_sha256":content_sha256,"observed_at":observed_at}
 return attestations
def _validate_residual_evidence(args,assertion):
 attestations=assertion.get("attestations")
 if not isinstance(attestations,dict): raise ControllerError("operator assertion attestations missing")
 expected=_residual_attestations(args,int(time.time()))
 for channel, evidence in expected.items():
  actual=attestations.get(channel,{})
  if actual.get("status") is not True or actual.get("evidence_sha256")!=evidence["evidence_sha256"] or actual.get("observed_at")!=evidence["observed_at"]: raise ControllerError("residual evidence binding mismatch")
def _validate_assertion_with(assertion,args,validator):
 head=freeze._root_source()[1]; source_root=freeze._root_source()[2]; terminal=freeze._root_source()[3]
 relation=assertion.get("relation_root"); acl=assertion.get("acl_root")
 if not isinstance(relation,str) or not isinstance(acl,str): raise ControllerError("operator assertion inventory roots missing")
 validator(assertion,freeze_id=args.freeze_id,origin=recovery.origin(args.origin),relation_root=relation,acl_root=acl,commit=head,source_root=source_root,terminal_spec=terminal)
 if assertion.get("expires_at",0)<=int(time.time()): raise ControllerError("operator assertion expired")
 if assertion.get("expires_at",0)-assertion.get("issued_at",0)>900: raise ControllerError("operator assertion expiry exceeds prepare maximum")
 _validate_residual_evidence(args,assertion)
 return assertion
def _validate_assertion_request(assertion,args,root):
 del root
 return _validate_assertion_with(assertion,args,validate_operator_assertion_request)
def _validate_assertion(assertion,args,root):
 del root
 return _validate_assertion_with(assertion,args,validate_operator_assertion)
def _read_validated_assertion(args,root):
 _private(args.operator_assertion,"operator assertion")
 assertion,_=_signed_assertion(args.operator_assertion,"operator assertion")
 _validate_assertion(assertion,args,root)
 return assertion,digest(assertion)
def validate(args, *, require_fresh_outputs=False):
 base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); validate_sources(root)
 assertion,assertion_sha256=_read_validated_assertion(args,root)
 _assert_controller_key(args.controller_signing_key); _assert_key(args.recovery_signing_key,recovery.RECOVERY_PUBLIC_KEY,"recovery signing key")
 recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file)
 _verify_remediation(args,assertion,fp,assertion_sha256)
 recovery.pgpass(args.pgpass_file,entries)
 recovery.safe_destination(args.destination)
 for path,label in ((args.recovery_receipt,"recovery receipt"),(args.prepared_receipt,"prepared receipt"),(args.final_receipt,"final receipt"),(args.outcome_receipt,"outcome receipt")): _outside(path,label,fresh=require_fresh_outputs)
 if hasattr(args,"secret_env") or hasattr(args,"secret_file"):
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
 base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); validate_sources(root)
 recovery.pgpass(args.pgpass_file,entries)
 seconds=args.expiry_seconds
 if not isinstance(seconds,int) or isinstance(seconds,bool) or not 0<seconds<=900: raise ControllerError("expiry seconds must be between 1 and 900")
 _outside_fresh(args.operator_assertion_request,"operator assertion request")
 issued=int(time.time()); attestations=_residual_attestations(args,issued)
 conn=_connect(entries,args)
 try:
  inventory=freeze.preflight(conn)
  state=getattr(getattr(conn,"info",None),"transaction_status",0)
  if state not in (0,"IDLE"): raise ControllerError("preflight connection not clean")
 finally: conn.close()
 _,head,source_root,terminal_spec=freeze._root_source()
 assertion={"schema":"g037-write-freeze-assertion-v1","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"relation_root":inventory.relation_root,"acl_root":inventory.acl_root,"source_root":source_root,"terminal_spec":terminal_spec,"issued_at":issued,"expires_at":issued+seconds,"attestations":attestations}
 assertion_hash=_write_unsigned(args.operator_assertion_request,assertion,"operator assertion request")
 validate_operator_assertion_request(assertion,freeze_id=args.freeze_id,origin=base,relation_root=inventory.relation_root,acl_root=inventory.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 return {"schema":SCHEMA,"mode":"prepare","status":"prepared","assertion_request_sha256":assertion_hash,"expires_at":assertion["expires_at"],"relation_root":inventory.relation_root,"acl_root":inventory.acl_root}
def finalize(args):
 root=repository_root(Path(__file__).resolve())
 request_path,request_identity,request_bytes=_held_custody(args.operator_assertion_request,"operator assertion request")
 signature_path,signature_identity,signature=_held_custody(args.operator_assertion_signature,"operator assertion signature")
 try: request=json.loads(request_bytes.decode("ascii"),object_pairs_hook=no_duplicate_object)
 except Exception as exc: raise ControllerError("operator assertion request unreadable") from exc
 if request_path==signature_path or request_identity==signature_identity or not isinstance(request,dict) or "signature" in request or canonical_bytes(request)!=request_bytes: raise ControllerError("operator assertion request is not canonical")
 with recovery._source_public_key(AUTHORIZATION_PUBLIC_KEY_PEM.encode("ascii")) as public_key:
  if not recovery.openssl_verify(recovery.command("openssl"),public_key,request_bytes,signature): raise ControllerError("operator assertion signature invalid")
 _validate_assertion_request(request,args,root)
 assertion_hash=_write_finalized_assertion(args.operator_assertion,request,signature)
 return {"schema":SCHEMA,"mode":"finalize","status":"finalized","assertion_sha256":assertion_hash,"expires_at":request["expires_at"],"relation_root":request["relation_root"],"acl_root":request["acl_root"]}
def execute(args):
 validate(args,require_fresh_outputs=True); base,entries=_validated_binding(args); root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 assertion,assertion_sha256=_read_validated_assertion(args,root); recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file); envelope,execution_bindings=_verify_remediation(args,assertion,fp,assertion_sha256); attempt_marker_sha256=_attempt_marker(args,base,envelope); secret=recovery.read_secret_reference(args.secret_env,args.secret_file)
 conn=_connect(entries,args); expected=freeze._inv(conn)
 try:
  final_status={"value":None}; prepared_value={"value":None}; final_hash={"value":None}; freeze_receipt={"value":None}
  def provisional(payload):
   return {**payload,"signature":base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),args.controller_signing_key,canonical_bytes(payload))).decode("ascii")}
  def callback(cur,capability):
   root_source,head,source_root,terminal_spec=freeze._root_source()
   expected_binding={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":recovery.EXPECTED_FREEZE_SCOPE,"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":capability.get("held_lock_root"),"not_before_unix":capability.get("not_before_unix"),"not_after_unix":capability.get("not_after_unix"),"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256}
   captured=recovery.capture_cursor(cur,base=base,secret=secret,recipient=recipient,recipient_fingerprint=fp,service_file=args.service_file,pgpass_file=args.pgpass_file,service_name=args.service_name,destination=args.destination,age_command=args.age_command,pg_dump_command=args.pg_dump,deadline=_deadline(capability),freeze_capability=capability,expected_binding=expected_binding,recovery_signing_key=args.recovery_signing_key,recovery_receipt=args.recovery_receipt)
   remediation=_remediation_binding(envelope,execution_bindings,captured,args,attempt_marker_sha256)
   rehearsed=closure.rehearse_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"],remediation=remediation)
   applied=closure.apply_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"],remediation=remediation)
   if rehearsed!=applied: raise ControllerError("short_urls remediation rehearsal/apply drift")
   return {"capture_roots":captured,"remediation_evidence":applied}
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
   value={"schema":SCHEMA,"status":"diagnostic","outcome":status,"freeze_receipt_sha256":receipt["receipt_sha256"],"prepared_receipt_sha256":prepared["receipt_sha256"],"recovery_receipt_sha256":prepared["capture_roots"]["recovery_receipt_sha256"],"freeze_id":prepared["freeze_id"],"origin":prepared["origin"],"commit":prepared["commit"],"manifest_sha256":prepared["manifest_sha256"],"source_root":prepared["source_root"],"terminal_spec":prepared["terminal_spec"],**{key:prepared["remediation_evidence"][key] for key in ("authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","remediation_sha256")},"attempt_marker_sha256":attempt_marker_sha256}
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
    _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt(status,prepared,final_hash["value"],attempt_marker_sha256),"outcome receipt")
   raise
  prepared=prepared_value["value"]
  if prepared is None or final_hash["value"] is None: raise ControllerError("final receipt persistence missing")
  _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt(final_status["value"],prepared,final_hash["value"],attempt_marker_sha256),"outcome receipt")
  return result
 finally: conn.close()
def _prepared_binding(prepared,args,base,root,manifest):
 root_source,head,source_root,terminal_spec=freeze._root_source()
 unsigned=dict(prepared); claimed=unsigned.pop("receipt_sha256",None)
 required={"schema","status","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","before_relation_root","before_acl_root","held_lock_root","capture_roots","remediation_evidence","terminal","receipt_sha256"}
 if set(prepared)!=required or claimed!=digest(unsigned) or prepared["schema"]!=freeze.SCHEMA or prepared["status"]!="prepared-not-committed" or prepared["freeze_id"]!=args.freeze_id or prepared["origin"]!=base or prepared["commit"]!=head or prepared["source_root"]!=source_root or prepared["terminal_spec"]!=terminal_spec or prepared["manifest_sha256"]!=freeze.MANIFEST_SHA256: raise ControllerError("prepared receipt binding invalid")
 terminal=prepared["terminal"]
 if not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root")): raise ControllerError("prepared terminal roots invalid")
 capture=prepared["capture_roots"]
 if not isinstance(capture,dict): raise ControllerError("prepared capture roots invalid")
 try: freeze.validate_capture_roots(capture); freeze.validate_remediation_evidence(prepared["remediation_evidence"])
 except freeze.FreezeError as exc: raise ControllerError("prepared remediation binding invalid") from exc
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
 assertion,assertion_sha256=_read_validated_assertion(args,root); recipient,fp=recovery.recipient_from_files(args.recipient_file,args.recipient_allowlist_file); envelope,execution_bindings=_verify_remediation(args,assertion,fp,assertion_sha256); attempt_marker_sha256=_attempt_marker(args,base,envelope); secret=recovery.read_secret_reference(args.secret_env,args.secret_file)
 conn=_connect(entries,args); expected=freeze._inv(conn)
 try:
  def provisional(payload):
   return {**payload,"signature":base64.b64encode(recovery.openssl_sign(recovery.command("openssl"),args.controller_signing_key,canonical_bytes(payload))).decode("ascii")}
  def callback(cur,capability):
   root_source,head,source_root,terminal_spec=freeze._root_source()
   binding={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":args.freeze_id,"origin":base,"commit":head,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":recovery.EXPECTED_FREEZE_SCOPE,"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":capability.get("held_lock_root"),"not_before_unix":capability.get("not_before_unix"),"not_after_unix":capability.get("not_after_unix"),"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256}
   captured=recovery.capture_cursor(cur,base=base,secret=secret,recipient=recipient,recipient_fingerprint=fp,service_file=args.service_file,pgpass_file=args.pgpass_file,service_name=args.service_name,destination=args.destination,age_command=args.age_command,pg_dump_command=args.pg_dump,deadline=_deadline(capability),freeze_capability=capability,expected_binding=binding,recovery_signing_key=args.recovery_signing_key,recovery_receipt=args.recovery_receipt)
   remediation=_remediation_binding(envelope,execution_bindings,captured,args,attempt_marker_sha256)
   rehearsed=closure.rehearse_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"],remediation=remediation)
   applied=closure.apply_cursor(cur,capability,root=root,manifest=manifest,freeze_id=args.freeze_id,relation_root=expected.relation_root,acl_root=expected.acl_root,deadline=capability["not_after_unix"],remediation=remediation)
   if rehearsed!=applied: raise ControllerError("short_urls remediation rehearsal/apply drift")
   return {"capture_roots":captured,"remediation_evidence":applied}
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
 if not isinstance(evidence,dict) or capture["logical_ciphertext_sha256"]!=evidence.get("logical_ciphertext_sha256") or capture["blob_ciphertext_sha256"]!=evidence.get("blob_ciphertext_sha256") or capture["recipient_fingerprint"]!=evidence.get("recipient_fingerprint") or capture["auth_storage_catalog_root"]!=evidence.get("catalog_sha256") or capture["auth_storage_metadata_root"]!=evidence.get("metadata_sha256") or capture["storage_blob_root"]!=digest(evidence.get("members")) or capture["object_count"]!=evidence.get("object_count") or capture["total_bytes"]!=evidence.get("total_bytes") or capture["short_urls_catalog_root"]!=evidence.get("short_urls_catalog_sha256") or capture["short_urls_rowset_root"]!=evidence.get("short_urls_rowset_sha256") or capture["short_urls_victim_descriptors_root"]!=evidence.get("victim_descriptors_sha256") or capture["short_urls_row_count"]!=evidence.get("short_urls_row_count") or capture["duplicate_group_count"]!=evidence.get("duplicate_group_count") or capture["duplicate_victim_count"]!=evidence.get("duplicate_victim_count"): raise ControllerError("recovery capture binding invalid")
 recovery.verify(type("RecoveryVerifyArgs",(),{"destination":args.destination,"recipient_file":args.recipient_file,"recipient_allowlist_file":args.recipient_allowlist_file,"identity_file":args.identity_file,"receipt":args.recovery_receipt,"logical_archive":args.logical_archive,"blob_archive":args.blob_archive,"age_command":args.age_command,"pg_restore":args.pg_restore})())
 recovery.pgpass(args.pgpass_file,entries); conn=_connect(entries,args,readonly=True)
 try: observed=_terminal_roots(conn,root,manifest)
 finally: conn.close()
 if observed!=prepared["terminal"]: raise ControllerError("terminal readback drift")
 value=_final_receipt("reconciled",prepared,observed)
 marker_sha256=_read_attempt_marker(args,prepared)
 if marker_sha256!=prepared["remediation_evidence"]["attempt_marker_sha256"]: raise ControllerError("attempt marker digest drift")
 final_hash=_write_signed(args.final_receipt,args.controller_signing_key,value,"reconciled final receipt")
 _write_signed(args.outcome_receipt,args.controller_signing_key,_outcome_receipt("reconciled",prepared,final_hash,marker_sha256),"outcome receipt")
 return value
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True)
 def common(x):
  x.add_argument("--origin",required=True); x.add_argument("--freeze-id",required=True); x.add_argument("--service-file",required=True); x.add_argument("--service-name",default="g037"); x.add_argument("--pgpass-file",required=True); x.add_argument("--destination",required=True); x.add_argument("--recovery-receipt",required=True); x.add_argument("--prepared-receipt",required=True); x.add_argument("--final-receipt",required=True); x.add_argument("--outcome-receipt",required=True); x.add_argument("--recipient-file",required=True); x.add_argument("--recipient-allowlist-file",required=True)
 def assertion_inputs(x):
  x.add_argument("--operator-assertion",required=True)
  for channel in RESIDUAL_CHANNELS: x.add_argument("--evidence-"+channel.replace("_","-"),dest="evidence_"+channel,required=True)
 for name in ("validate","execute","rehearse","reconcile"):
  x=sub.add_parser(name); common(x)
  if name in ("validate","execute","rehearse"):
   assertion_inputs(x)
   for option in ("legacy-capture-receipt","legacy-restore-receipt","legacy-inspection-receipt","legacy-authorization","legacy-authorization-signature","execution-authorization","execution-authorization-signature"): x.add_argument("--"+option,required=True)
  if name in ("execute","rehearse"): x.add_argument("--secret-env"); x.add_argument("--secret-file"); x.add_argument("--age-command",default="age"); x.add_argument("--pg-dump",default="pg_dump")
  if name=="rehearse": x.add_argument("--rehearsal-receipt",required=True); x.add_argument("--rehearsal-outcome-receipt",required=True)
  if name=="reconcile": x.add_argument("--logical-archive",required=True); x.add_argument("--blob-archive",required=True); x.add_argument("--identity-file",required=True); x.add_argument("--age-command",default="age"); x.add_argument("--pg-restore",default="pg_restore")
 x=sub.add_parser("prepare")
 x.add_argument("--origin",required=True); x.add_argument("--freeze-id",required=True); x.add_argument("--operator-assertion-request",required=True); x.add_argument("--service-file",required=True); x.add_argument("--service-name",default="g037"); x.add_argument("--pgpass-file",required=True); x.add_argument("--expiry-seconds",type=int,default=600)
 for channel in RESIDUAL_CHANNELS: x.add_argument("--evidence-"+channel.replace("_","-"),dest="evidence_"+channel,required=True)
 x=sub.add_parser("finalize")
 x.add_argument("--origin",required=True); x.add_argument("--freeze-id",required=True); x.add_argument("--operator-assertion-request",required=True); x.add_argument("--operator-assertion-signature",required=True); x.add_argument("--operator-assertion",required=True)
 for channel in RESIDUAL_CHANNELS: x.add_argument("--evidence-"+channel.replace("_","-"),dest="evidence_"+channel,required=True)
 return p
def main(argv=None):
 try:
  args=parser().parse_args(argv); signer_directory=Path.home()/".g037-production-controller"; args.controller_signing_key=signer_directory/"controller-signing-key.pem"; args.recovery_signing_key=signer_directory/"recovery-signing-key.pem"; import g040_recovery_source; g040_recovery_source.assert_isolated_bootstrap(); result={"prepare":prepare,"finalize":finalize,"validate":validate,"execute":execute,"rehearse":rehearse,"reconcile":reconcile}[args.mode](args); print(canonical_bytes({k:result[k] for k in ("schema","mode","status","assertion_request_sha256","assertion_sha256","expires_at","relation_root","acl_root") if k in result}).decode()); return 0
 except Exception: print(canonical_bytes({"schema":SCHEMA,"status":"rejected"}).decode()); return 2
if __name__=="__main__": raise SystemExit(main())
