"""Focused local-only controller regression tests."""
from __future__ import annotations
import base64, contextlib, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
MODULE=SCRIPTS/"g037_production_controller.py"
spec=importlib.util.spec_from_file_location("g037_controller",MODULE); controller=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(controller)
ORIGIN="https://abcdefghijklmnopqrst.supabase.co"
SERVICE={"host":"db.abcdefghijklmnopqrst.supabase.co","port":"5432","dbname":"postgres","user":"postgres","sslmode":"verify-full","sslrootcert":"ca"}
def remediation_evidence():
 value={"schema":"g037-short-url-remediation-evidence-v1","authorization_id":"11111111-1111-4111-8111-111111111111","policy":"exact-baseline-to-terminal-ledger-single-commit-v1","execution_authorization_sha256":"a"*64,"execution_authorization_signature_sha256":"b"*64,"attempt_marker_sha256":"a"*64,"legacy_repository_commit":"0"*40,"legacy_authorization_sha256":"c"*64,"legacy_authorization_signature_sha256":"d"*64,"legacy_capture_receipt_sha256":"e"*64,"legacy_restore_receipt_sha256":"f"*64,"legacy_inspection_receipt_sha256":"1"*64,"recovery_receipt_sha256":"2"*64,"capture_short_urls_rowset_sha256":"9"*64,"pre_short_urls_rowset_sha256":"9"*64,"survivor_short_urls_rowset_sha256":"3"*64,"deleted_count":1,"duplicate_group_count_before":1,"duplicate_group_count_after":0}; value["remediation_sha256"]=controller.digest(value); return value
def capture_roots():
 return {"auth_storage_catalog_root":"1"*64,"auth_storage_metadata_root":"2"*64,"storage_blob_root":"3"*64,"short_urls_catalog_root":"8"*64,"short_urls_rowset_root":"9"*64,"short_urls_victim_descriptors_root":"a"*64,"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"recipient_fingerprint":"4"*64,"logical_ciphertext_sha256":"5"*64,"blob_ciphertext_sha256":"6"*64,"object_count":0,"total_bytes":0,"recovery_receipt_sha256":"7"*64}
class ControllerTests(unittest.TestCase):
 def _restrictive_directory(self,directory):
  path=Path(directory)
  if os.name=="nt":
   sid=controller.recovery._windows_current_sid(); self.assertIsNotNone(sid)
   controller.recovery.subprocess.run(["icacls",str(path),"/reset"],stdin=controller.recovery.subprocess.DEVNULL,stdout=controller.recovery.subprocess.PIPE,stderr=controller.recovery.subprocess.PIPE,text=True,timeout=10,check=True)
   controller.recovery.subprocess.run(["icacls",str(path),"/setowner","*"+sid],stdin=controller.recovery.subprocess.DEVNULL,stdout=controller.recovery.subprocess.PIPE,stderr=controller.recovery.subprocess.PIPE,text=True,timeout=10,check=True)
   controller.recovery.subprocess.run(["icacls",str(path),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*"+sid+":F","SYSTEM:F","Administrators:F"],stdin=controller.recovery.subprocess.DEVNULL,stdout=controller.recovery.subprocess.PIPE,stderr=controller.recovery.subprocess.PIPE,text=True,timeout=10,check=True)
  else: path.chmod(0o700)
  self.assertTrue(controller.recovery.restrictive(path,directory=True))
  return path
 def setUp(self):
  self.verify=patch.object(controller,"_verify_remediation",return_value=(object(),{})).start()
  patch.object(controller.remediation_authorization,"authorize_exact_baseline",side_effect=lambda authority,baseline: authority).start()
  patch.object(controller,"_attempt_marker",return_value="a"*64).start()
  self.addCleanup(patch.stopall)
 def test_verify_remediation_extracts_frozen_legacy_chain_attributes(self):
  patch.stopall()
  vector=(("selection_spec_sha256","1"*64),("short_urls_catalog_sha256","2"*64),("pre_short_urls_rowset_sha256","3"*64),("duplicate_group_count",1),("duplicate_victim_count",1),("duplicate_victims_sha256","4"*64),("victim_descriptors_sha256","5"*64),("batch_id","11111111-1111-4111-8111-111111111111"))
  chain=controller.remediation_authorization.VerifiedLegacyRemediationChain("a"*64,"b"*64,"c"*64,"d"*40,"e"*64,"f"*64,vector)
  args=SimpleNamespace(origin=ORIGIN,freeze_id="freeze-0001",legacy_capture_receipt="capture",legacy_restore_receipt="restore",legacy_inspection_receipt="inspection",legacy_authorization="legacy",legacy_authorization_signature="legacy.sig",execution_authorization="execution",execution_authorization_signature="execution.sig")
  assertion={"expires_at":2000}; captured={}
  def authenticate(*_,expected_bindings,**__):
   captured.update(expected_bindings); return object()
  with patch.object(controller.remediation_authorization,"verify_legacy_remediation_chain",return_value=chain),patch.object(controller.remediation_authorization,"authenticate_execution_authorization_document",side_effect=authenticate),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"9"*40,"7"*64,"8"*64)):
   envelope,expected=controller._verify_remediation(args,assertion,"6"*64,controller.digest(assertion))
  self.assertIsNotNone(envelope)
  self.assertEqual({key:captured[key] for key in ("legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256")},{"legacy_capture_receipt_sha256":"a"*64,"legacy_restore_receipt_sha256":"b"*64,"legacy_inspection_receipt_sha256":"c"*64,"legacy_repository_commit":"d"*40,"legacy_authorization_sha256":"e"*64,"legacy_authorization_signature_sha256":"f"*64})
  self.assertEqual(captured["legacy_vector"],dict(vector))
 def test_validate_has_no_database_connection(self):
  args=SimpleNamespace(origin="https://abcdefghijklmnopqrst.supabase.co",freeze_id="freeze-0001",operator_assertion="assertion",controller_signing_key="key",recovery_signing_key="recovery",recipient_file="recipient",recipient_allowlist_file="allow",service_file="service",service_name="g037",pgpass_file="pgpass",destination="dest",recovery_receipt="recovery-receipt",prepared_receipt="prepared",final_receipt="final",outcome_receipt="outcome")
  assertion={"relation_root":"a"*64,"acl_root":"b"*64,"expires_at":int(time.time())+60}
  with patch.object(controller,"_private"),patch.object(controller,"_assert_controller_key"),patch.object(controller,"_assert_key"),patch.object(controller,"_signed_assertion",return_value=({**assertion,"signature":"signature"},assertion)),patch.object(controller,"_validate_assertion"),patch.object(controller.recovery,"recipient_from_files",return_value=("age1"+"a"*58,"f"*64)),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"pgpass"),patch.object(controller.recovery,"safe_destination"),patch.object(controller,"_outside"),patch.object(controller,"validate_sources") as sources:
   self.assertEqual(controller.validate(args)["status"],"valid")
  sources.assert_called_once()
 def test_validate_parser_and_runtime_are_secret_free(self):
  common=["--origin",ORIGIN,"--freeze-id","freeze-0001","--service-file","service","--pgpass-file","pgpass","--destination","dest","--recovery-receipt","recovery-receipt","--prepared-receipt","prepared","--final-receipt","final","--outcome-receipt","outcome","--recipient-file","recipient","--recipient-allowlist-file","allow"]
  assertion=["--operator-assertion","assertion","--legacy-capture-receipt","capture","--legacy-restore-receipt","restore","--legacy-inspection-receipt","inspection","--legacy-authorization","legacy","--legacy-authorization-signature","legacy.sig","--execution-authorization","execution","--execution-authorization-signature","execution.sig",*sum((["--evidence-"+channel.replace("_","-"),channel] for channel in controller.RESIDUAL_CHANNELS),[])]
  validate_args=controller.parser().parse_args(["validate",*common,*assertion])
  self.assertFalse(hasattr(validate_args,"secret_env")); self.assertFalse(hasattr(validate_args,"secret_file"))
  for mode in ("execute","rehearse"):
   execution_args=controller.parser().parse_args([mode,*common,*assertion,*(["--rehearsal-receipt","rehearsal","--rehearsal-outcome-receipt","rehearsal-outcome"] if mode=="rehearse" else [])])
   self.assertTrue(hasattr(execution_args,"secret_env")); self.assertTrue(hasattr(execution_args,"secret_file"))
  self.assertNotIn("--attempt-marker",Path(controller.__file__).read_text("utf-8"))
 def test_execute_and_rehearse_require_exactly_one_secret_reference(self):
  base={"origin":ORIGIN,"freeze_id":"freeze-0001","operator_assertion":"assertion","controller_signing_key":"key","recovery_signing_key":"recovery","recipient_file":"recipient","recipient_allowlist_file":"allow","service_file":"service","service_name":"g037","pgpass_file":"pgpass","destination":"dest","recovery_receipt":"recovery-receipt","prepared_receipt":"prepared","final_receipt":"final","outcome_receipt":"outcome","age_command":"age","pg_dump":"pg_dump","rehearsal_receipt":"rehearsal","rehearsal_outcome_receipt":"rehearsal-outcome"}
  assertion={"relation_root":"a"*64,"acl_root":"b"*64,"expires_at":int(time.time())+60}
  for mode in ("execute","rehearse"):
   for secret_env,secret_file in ((None,None),("reference","file")):
    args=SimpleNamespace(**base,secret_env=secret_env,secret_file=secret_file)
    with self.subTest(mode=mode,secret_env=secret_env,secret_file=secret_file),patch.object(controller,"_private"),patch.object(controller,"_assert_controller_key"),patch.object(controller,"_assert_key"),patch.object(controller,"_signed_assertion",return_value=({**assertion,"signature":"signature"},assertion)),patch.object(controller,"_validate_assertion"),patch.object(controller.recovery,"recipient_from_files",return_value=("age1"+"a"*58,"f"*64)),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"pgpass"),patch.object(controller.recovery,"require_file"),patch.object(controller.recovery,"safe_destination"),patch.object(controller,"_outside"),patch.object(controller,"validate_sources"):
     with self.assertRaisesRegex(controller.ControllerError,"supply exactly one secret reference"): getattr(controller,mode)(args)
 def test_attempt_journal_is_canonical_authorization_bound_and_one_shot(self):
  patch.stopall()
  with tempfile.TemporaryDirectory() as directory:
   journal=Path(directory)/"attempts"; journal.mkdir()
   raw=controller.canonical_bytes({"authorization_id":"11111111-1111-4111-8111-111111111111"})
   envelope=controller.remediation_authorization.ExecutionAuthorizationEnvelope(raw,b"detached-signature")
   args=SimpleNamespace(freeze_id="freeze-0001",attempt_marker="caller-selected-path-is-ignored")
   def write_marker(path,value,label):
    if Path(path).exists(): raise controller.ControllerError(label+" must be fresh")
    Path(path).write_bytes(controller.canonical_bytes(value))
    return controller.digest(value)
   with patch.object(controller,"_attempt_journal_directory",return_value=journal),patch.object(controller,"_write_unsigned",side_effect=write_marker):
    first=controller._attempt_marker(args,ORIGIN,envelope)
    with self.assertRaisesRegex(controller.ControllerError,"must be fresh"):
     controller._attempt_marker(SimpleNamespace(freeze_id="freeze-0001",attempt_marker="different-path"),ORIGIN,envelope)
   marker=json.loads(next(journal.iterdir()).read_text("ascii"))
   self.assertEqual(len(list(journal.iterdir())),1)
   self.assertNotIn("operator_assertion_sha256",marker)
   self.assertEqual(first,controller.digest(marker))
 def test_attempt_journal_path_is_fixed_by_platform(self):
  with patch.object(controller.recovery,"require_dir") as require_dir,patch.object(controller.os,"name","posix"):
   self.assertEqual(str(controller._attempt_journal_directory()),"/var/lib/tzudong-recovery/g037-attempts")
  self.assertEqual(str(require_dir.call_args.args[0]),"/var/lib/tzudong-recovery/g037-attempts")
  self.assertEqual(require_dir.call_args.args[1],"attempt journal")
  with patch.object(controller.recovery,"require_dir") as require_dir,patch.object(controller.os,"name","nt"):
   self.assertEqual(str(controller._attempt_journal_directory()),"C:\\ProgramData\\TzudongRecovery\\g037-attempts")
  self.assertEqual(str(require_dir.call_args.args[0]),"C:\\ProgramData\\TzudongRecovery\\g037-attempts")
  self.assertEqual(require_dir.call_args.args[1],"attempt journal")
 def test_remediation_binding_uses_authenticated_envelope_bytes_after_path_replacement(self):
  envelope=controller.remediation_authorization.ExecutionAuthorizationEnvelope(b'{"authenticated":"authorization"}',b"authenticated-signature")
  capture={**capture_roots(),"recovery_receipt_sha256":"7"*64}
  source={"short_urls_catalog_sha256":"1"*64,"short_urls_rowset_sha256":"2"*64,"victim_descriptors_sha256":"3"*64,"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"selection_spec_sha256":"4"*64,"duplicate_victims_sha256":"3"*64}
  receipt={"evidence":source}; capture["recovery_receipt_sha256"]=controller.digest(receipt)
  expected={"legacy_repository_commit":"0"*40,"legacy_authorization_sha256":"5"*64,"legacy_authorization_signature_sha256":"6"*64,"legacy_capture_receipt_sha256":"7"*64,"legacy_restore_receipt_sha256":"8"*64,"legacy_inspection_receipt_sha256":"9"*64}
  args=SimpleNamespace(recovery_receipt="receipt",execution_authorization="replaced",execution_authorization_signature="replaced.sig")
  with patch.object(controller.recovery,"load_receipt",return_value=receipt),patch.object(controller.recovery,"file_hash",side_effect=AssertionError("mutable CLI path reopened")):
   binding=controller._remediation_binding(envelope,expected,capture,args,"a"*64)
  self.assertEqual(binding["execution_authorization_sha256"],hashlib.sha256(envelope.raw).hexdigest())
  self.assertEqual(binding["execution_authorization_signature_sha256"],hashlib.sha256(envelope.signature).hexdigest())
 def test_attempt_marker_rejects_semantic_and_digest_mutation(self):
  marker={"schema":"g037-execution-attempt-v1","authorization_id":"11111111-1111-4111-8111-111111111111","execution_authorization_sha256":"a"*64,"execution_authorization_signature_sha256":"b"*64,"freeze_id":"freeze-0001","origin":ORIGIN,"issued_at":int(time.time())}
  prepared={"freeze_id":"freeze-0001","origin":ORIGIN,"remediation_evidence":{"authorization_id":marker["authorization_id"],"execution_authorization_sha256":"a"*64,"execution_authorization_signature_sha256":"b"*64,"attempt_marker_sha256":controller.digest(marker)}}
  with patch.object(controller,"_attempt_path",return_value=Path("marker")),patch.object(controller,"_outside",return_value=Path("marker")),patch.object(controller,"_held_custody",return_value=(Path("marker"),(1,1),controller.canonical_bytes(marker))):
   self.assertEqual(controller._read_attempt_marker(SimpleNamespace(),prepared),prepared["remediation_evidence"]["attempt_marker_sha256"])
  mutated={**marker,"issued_at":True}
  with patch.object(controller,"_attempt_path",return_value=Path("marker")),patch.object(controller,"_outside",return_value=Path("marker")),patch.object(controller,"_held_custody",return_value=(Path("marker"),(1,1),controller.canonical_bytes(mutated))):
   with self.assertRaises(controller.ControllerError): controller._read_attempt_marker(SimpleNamespace(),prepared)
 def test_signed_assertion_preserves_authenticated_envelope_and_rejects_mismatches(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/"assertion.json"
   private=Path(directory)/"private.pem"; public=Path(directory)/"public.pem"
   subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(private)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
   controller.recovery._harden_restrictive_file(private)
   public.write_bytes(subprocess.run(["openssl","pkey","-in",str(private),"-pubout"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout)
   payload={"field":"value"}
   signature=base64.b64encode(controller.recovery.openssl_sign("openssl",private,controller.canonical_bytes(payload))).decode("ascii")
   path.write_text(json.dumps({**payload,"signature":signature}),encoding="ascii")
   with patch.object(controller,"AUTHORIZATION_PUBLIC_KEY_PEM",public.read_bytes()),patch.object(controller.recovery,"require_file"):
    envelope,unsigned=controller._signed_assertion(path,"operator assertion")
   self.assertEqual(envelope["signature"],signature); self.assertEqual(unsigned,payload)
   for content,authenticated in (
    ('{"field":"value"}',{"field":"value"}),
    ('{"field":"value","field":"other","signature":"valid"}',{"field":"value"}),
    ('{"field":"tampered","signature":"valid"}',{"field":"value"}),
   ):
    path.write_text(content,encoding="ascii")
    with patch.object(controller,"_signed",return_value=authenticated):
     with self.assertRaises(controller.ControllerError): controller._signed_assertion(path,"operator assertion")
 @patch.object(controller.recovery,"restrictive",side_effect=lambda path, directory=False: Path(path).exists() and not Path(path).is_symlink())
 def test_residual_evidence_requires_exact_restrictive_artifacts(self,_):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   args=SimpleNamespace(freeze_id="freeze-0001")
   attestations={}; observed_at=int(time.time())
   for channel in controller.RESIDUAL_CHANNELS:
    evidence={"schema":"g037-residual-freeze-evidence-v1","channel":channel,"freeze_id":"freeze-0001","status":True,"observed_at":observed_at}
    if channel=="producer_stop": evidence["producers"]=list(controller.PRODUCER_STOP_JOBS)
    artifact=root/(channel+".json"); artifact.write_text(json.dumps(evidence),encoding="utf-8"); artifact.chmod(0o600)
    setattr(args,"evidence_"+channel,str(artifact))
    attestations[channel]={"status":True,"evidence_sha256":hashlib.sha256(artifact.read_bytes()).hexdigest(),"observed_at":observed_at}
   assertion={"attestations":attestations}
   controller._validate_residual_evidence(args,assertion)
   producer_path=root/"producer_stop.json"; producer=json.loads(producer_path.read_text("utf-8")); producer["producers"][0]["job"]="retain"; producer_path.write_text(json.dumps(producer),encoding="utf-8")
   with self.assertRaises(controller.ControllerError): controller._residual_attestations(args,observed_at)
   producer["producers"]=list(controller.PRODUCER_STOP_JOBS); producer_path.write_text(json.dumps(producer),encoding="utf-8")
   attestations["no_owner_write"]["evidence_sha256"]="0"*64
   with self.assertRaises(controller.ControllerError): controller._validate_residual_evidence(args,assertion)
   attestations["no_owner_write"]["evidence_sha256"]=hashlib.sha256((root/"no_owner_write.json").read_bytes()).hexdigest()
   missing=root/"missing"; setattr(args,"evidence_no_owner_write",str(missing))
   with self.assertRaises(controller.ControllerError): controller._validate_residual_evidence(args,assertion)
   setattr(args,"evidence_no_owner_write",str(root/"no_owner_write.json"))
   if os.name!="nt":
    link=root/"link"; link.symlink_to(root/"producer_stop.json"); setattr(args,"evidence_producer_stop",str(link))
    with self.assertRaises(controller.ControllerError): controller._validate_residual_evidence(args,assertion)
    setattr(args,"evidence_producer_stop",str(root/"producer_stop.json"))
   setattr(args,"evidence_producer_stop",getattr(args,"evidence_no_owner_write"))
   with self.assertRaises(controller.ControllerError): controller._validate_residual_evidence(args,assertion)
  # No database or secret reader is part of the structural evidence validation.
 def test_residual_evidence_rejects_false_or_stale_attestations(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory); args=SimpleNamespace()
   for channel in controller.RESIDUAL_CHANNELS:
    path=root/(channel+".json"); path.write_text(json.dumps({"status":True,"observed_at":int(time.time())-901}),encoding="utf-8"); setattr(args,"evidence_"+channel,str(path))
   with patch.object(controller.recovery,"restrictive",return_value=True):
    with self.assertRaisesRegex(controller.ControllerError,"freshness"): controller._residual_attestations(args,int(time.time()))
   (root/(controller.RESIDUAL_CHANNELS[0]+".json")).write_text(json.dumps({"status":False,"observed_at":int(time.time())}),encoding="utf-8")
   for channel in controller.RESIDUAL_CHANNELS[1:]:
    (root/(channel+".json")).write_text(json.dumps({"status":True,"observed_at":int(time.time())}),encoding="utf-8")
   with patch.object(controller.recovery,"restrictive",return_value=True):
    with self.assertRaisesRegex(controller.ControllerError,"status"): controller._residual_attestations(args,int(time.time()))
 def test_main_never_echoes_secret_reference(self):
  out=io.StringIO()
  with contextlib.redirect_stdout(out),contextlib.redirect_stderr(io.StringIO()):
   with self.assertRaises(SystemExit):
    controller.main(["execute","--origin","bad","--freeze-id","freeze-0001","--operator-assertion","operator","--controller-signing-key","private","--recovery-signing-key","recovery","--service-file","service","--pgpass-file","pgpass","--destination","dest","--recovery-receipt","recovery-receipt","--prepared-receipt","prepared","--final-receipt","receipt","--recipient-file","recipient","--recipient-allowlist-file","allow","--secret-env","TOP_SECRET_VALUE"])
  self.assertNotIn("TOP_SECRET_VALUE",out.getvalue())
 def test_prepared_binding_requires_digest_before_claim(self):
  args=SimpleNamespace(freeze_id="freeze-0001")
  terminal={"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":"t"*64}
  capture=capture_roots()
  prepared={"schema":controller.freeze.SCHEMA,"status":"prepared-not-committed","freeze_id":"freeze-0001","origin":"https://x","commit":"h"*40,"manifest_sha256":controller.freeze.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"before_relation_root":"r"*64,"before_acl_root":"a"*64,"held_lock_root":"l"*64,"capture_roots":capture,"remediation_evidence":remediation_evidence(),"terminal":terminal}
  prepared["receipt_sha256"]=controller.digest(prepared)
  with patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)):
   self.assertEqual(controller._prepared_binding(prepared,args,"https://x",Path("."),object()),capture)
   prepared["receipt_sha256"]="0"*64
   with self.assertRaises(controller.ControllerError): controller._prepared_binding(prepared,args,"https://x",Path("."),object())
 def test_terminal_readback_is_a_separate_read_only_transaction(self):
  class Cursor:
   def __init__(s): s.calls=[]
   def execute(s,sql): s.calls.append(sql)
   def close(s): pass
  class Conn:
   def __init__(s): s.c=Cursor(); s.rollbacks=0
   def cursor(s): return s.c
   def rollback(s): s.rollbacks+=1
  conn=Conn()
  with patch.object(controller.closure,"observed_terminal_roots",return_value={"root":"x"}):
   self.assertEqual(controller._terminal_roots(conn,Path("."),object()),{"root":"x"})
  self.assertEqual(conn.c.calls[0],"BEGIN TRANSACTION READ ONLY"); self.assertEqual(conn.rollbacks,1)
 def test_terminal_readback_rolls_back_when_observation_fails(self):
  class Cursor:
   def execute(s,_): pass
   def close(s): pass
  class Conn:
   def cursor(s): return Cursor()
   def rollback(s): s.rolled=True
  conn=Conn()
  with patch.object(controller.closure,"observed_terminal_roots",side_effect=RuntimeError("drift")):
   with self.assertRaises(RuntimeError): controller._terminal_roots(conn,Path("."),object())
  self.assertTrue(conn.rolled)
 def test_deadline_uses_capability_expiry(self):
  self.assertEqual(controller._deadline({"not_after_unix":123}),123.0)
 def test_private_key_mismatch_is_rejected(self):
  with patch.object(controller.recovery,"private_key_public",return_value=b"wrong"),patch.object(controller.recovery.subprocess,"run") as run:
   with self.assertRaises(controller.ControllerError): controller._assert_key("key",b"pinned","key")
  run.assert_not_called()
 def test_diagnostic_outcomes_are_persisted_without_postcommit_readback(self):
  args=SimpleNamespace(origin="https://x",freeze_id="freeze-0001",operator_assertion="assertion",controller_signing_key="key",recovery_signing_key="recovery",recipient_file="recipient",recipient_allowlist_file="allow",service_file="service",service_name="g037",pgpass_file="pgpass",destination="dest",recovery_receipt="recovery-receipt",prepared_receipt="prepared",final_receipt="final",outcome_receipt="outcome",secret_env="REFERENCE",secret_file=None,age_command="age",pg_dump="pg_dump")
  inventory=SimpleNamespace(relation_root="r"*64,acl_root="a"*64)
  terminal={"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":"t"*64}
  for status in ("failed-rolled-back","rollback-failed","commit-ambiguous"):
   writes=[]
   receipt={"status":status,"receipt_sha256":"z"*64,"commit":"h"*40,"terminal":terminal}
   prepared=self._prepared()
   def run(_,**kwargs):
    self.assertEqual(kwargs["assertion"],{"signature":"signed"})
    self.assertEqual(kwargs["precommit_receipt_writer"](prepared),prepared["receipt_sha256"])
    kwargs["final_receipt_writer"](receipt); return {"result":"unused"}
   with patch.object(controller,"validate"),patch.object(controller.recovery,"origin",return_value=ORIGIN),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_read_validated_assertion",return_value=({"signature":"signed"},controller.digest({}))),patch.object(controller.recovery,"recipient_from_files",return_value=("recipient","f"*64)),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"read_secret_reference",return_value="secret"),patch.object(controller,"_connect",return_value=SimpleNamespace(close=lambda:None)),patch.object(controller.freeze,"_inv",return_value=inventory),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)),patch.object(controller.freeze,"run",side_effect=run),patch.object(controller,"_write_signed",side_effect=lambda *values:writes.append(values[2]) or "ignored"),patch.object(controller,"_terminal_roots") as roots:
    controller.execute(args)
   self.assertEqual(writes[-1]["status"],status); roots.assert_not_called()
 def test_committed_final_requires_actual_postcommit_roots(self):
  receipt={"status":"committed","terminal":{"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":"t"*64}}
  self.assertNotEqual(receipt["terminal"],{"catalog_root":"d"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":"t"*64})
 def test_reconcile_binding_rejects_recovery_digest_tamper(self):
  capture={"recovery_receipt_sha256":"a"*64}
  self.assertNotEqual(capture["recovery_receipt_sha256"],controller.digest({"schema":"different"}))
 def test_diagnostic_receipt_has_no_capture_secret_field(self):
  fields={"schema","status","outcome","freeze_receipt_sha256","prepared_receipt_sha256","freeze_id","origin","commit"}
  self.assertNotIn("secret",fields)
 def test_final_and_outcome_receipts_have_exact_authenticated_fields(self):
  prepared=self._prepared(); terminal=self._terminal()
  with patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)):
   committed=controller._final_receipt("committed",prepared,terminal)
   reconciled=controller._final_receipt("reconciled",prepared,terminal)
   outcome=controller._outcome_receipt("committed-unfinalized",prepared,"f"*64)
  self.assertEqual(set(committed),controller.FINAL_RECEIPT_FIELDS)
  self.assertEqual(set(reconciled),controller.FINAL_RECEIPT_FIELDS)
  self.assertEqual(set(outcome),controller.OUTCOME_RECEIPT_FIELDS)
  self.assertEqual(committed["observed_catalog_root"],terminal["catalog_root"])
  self.assertNotIn("prepared_receipt",outcome)
  tampered=self._prepared(); tampered["capture_roots"]["unexpected"]="x"; tampered["receipt_sha256"]=controller.digest({k:v for k,v in tampered.items() if k!="receipt_sha256"})
  with patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)):
   with self.assertRaises(controller.ControllerError): controller._final_receipt("committed",tampered,terminal)
 def _execute_args(self):
  return SimpleNamespace(origin="https://x",freeze_id="freeze-0001",operator_assertion="assertion",controller_signing_key="key",recovery_signing_key="recovery",recipient_file="recipient",recipient_allowlist_file="allow",service_file="service",service_name="g037",pgpass_file="pgpass",destination="dest",recovery_receipt="recovery-receipt",prepared_receipt="prepared",final_receipt="final",outcome_receipt="outcome",secret_env="REFERENCE",secret_file=None,age_command="age",pg_dump="pg_dump")
 def _inventory(self):
  return controller.freeze.Inventory(("public","auth","storage"),(controller.freeze.Relation("public","items",1,"r","owner"),),"r"*64,"a"*64)
 def _terminal(self):
  return {"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":"t"*64}
 def _execute_fixture(self, *, commit_error=False, drift=False):
  events=[]; inventory=self._inventory(); terminal=self._terminal(); args=self._execute_args()
  class Cursor:
   def execute(s,sql,params=()): events.append(sql)
   def close(s): events.append("cursor-close")
  class Conn:
   def cursor(s): return Cursor()
   def commit(s):
    events.append("commit")
    if commit_error: raise RuntimeError("lost acknowledgement")
   def rollback(s): events.append("rollback")
   def close(s): events.append("connection-close")
  capture=capture_roots()
  writes=[]
  patches=[patch.object(controller,"validate"),patch.object(controller,"_remediation_binding",return_value={"authorization":{},"authorization_sha256":"a"*64,"authorization_signature_sha256":"b"*64,"capture_evidence":{}}),patch.object(controller.recovery,"origin",return_value=ORIGIN),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_signed_assertion",return_value=({"expires_at":int(time.time())+60,"signature":"signed"},{"expires_at":int(time.time())+60})),patch.object(controller.recovery,"recipient_from_files",return_value=("recipient","f"*64)),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"read_secret_reference",return_value="secret"),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller,"_connect",return_value=Conn()),patch.object(controller.freeze,"_inv",return_value=inventory),patch.object(controller.freeze,"_locks",side_effect=lambda cur,relations,seconds: events.append("locks") or "l"*64),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)),patch.object(controller.freeze,"validate_operator_assertion"),patch.object(controller.freeze,"_verify_active",side_effect=lambda value,expected:value),patch.object(controller.recovery,"capture_cursor",side_effect=lambda *a,**k: events.append("capture") or capture),patch.object(controller.closure,"rehearse_cursor",side_effect=lambda *a,**k: events.append("rehearse") or remediation_evidence()),patch.object(controller.closure,"apply_cursor",side_effect=lambda *a,**k: events.append("apply") or remediation_evidence()),patch.object(controller.closure,"observed_terminal_roots",side_effect=lambda *a,**k: events.append("observe") or ({**terminal,"catalog_root":"d"*64} if drift and events.count("observe")>1 else terminal)),patch.object(controller,"_write_signed",side_effect=lambda *v:writes.append(v[2]) or (v[2]["receipt_sha256"] if v[2].get("status")=="prepared-not-committed" else controller.digest(v[2])))]
  patches.append(patch.object(controller,"_read_validated_assertion",return_value=({"expires_at":int(time.time())+60,"signature":"signed"},controller.digest({"expires_at":int(time.time())+60}))))
  return args,events,writes,patches
 def test_execute_runs_real_freeze_state_machine_in_order(self):
  args,events,writes,patches=self._execute_fixture()
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   controller.execute(args)
  self.assertLess(events.index("BEGIN"),events.index("locks")); self.assertLess(events.index("locks"),events.index("capture")); self.assertLess(events.index("capture"),events.index("rehearse")); self.assertLess(events.index("rehearse"),events.index("apply")); self.assertLess(events.index("apply"),events.index("commit")); self.assertLess(events.index("commit"),events.index("BEGIN TRANSACTION READ ONLY"))
  self.assertEqual(events.count("commit"),1); self.assertEqual(events.count("apply"),1); self.assertEqual(events.count("BEGIN"),1)
  self.assertEqual([x["status"] for x in writes],["prepared-not-committed","committed","committed"])
  self.assertEqual({k:writes[1][k] for k in ("observed_catalog_root","observed_acl_root","observed_ledger_root")},{"observed_catalog_root":"c"*64,"observed_acl_root":"a"*64,"observed_ledger_root":"l"*64})
 def test_execute_commit_ambiguity_writes_diagnostic_and_no_retry(self):
  args,events,writes,patches=self._execute_fixture(commit_error=True)
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   with self.assertRaises(controller.freeze.FreezeError): controller.execute(args)
  self.assertEqual(events.count("apply"),1); self.assertEqual(events.count("commit"),1); self.assertNotIn("BEGIN TRANSACTION READ ONLY",events)
  self.assertEqual([x["status"] for x in writes],["prepared-not-committed","diagnostic","commit-ambiguous"])
  self.assertEqual(writes[-1]["status"],"commit-ambiguous")
 def test_execute_postcommit_drift_is_committed_unfinalized(self):
  args,events,writes,patches=self._execute_fixture(drift=True)
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   with self.assertRaisesRegex(controller.freeze.FreezeError,"committed-unfinalized"): controller.execute(args)
  self.assertEqual(events.count("commit"),1); self.assertEqual(events.count("apply"),1)
  self.assertEqual([x["status"] for x in writes],["prepared-not-committed","diagnostic","committed-unfinalized"])
 def _prepared(self):
  terminal=self._terminal(); capture=capture_roots()
  value={"schema":controller.freeze.SCHEMA,"status":"prepared-not-committed","freeze_id":"freeze-0001","origin":ORIGIN,"commit":"h"*40,"manifest_sha256":controller.freeze.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"before_relation_root":"r"*64,"before_acl_root":"a"*64,"held_lock_root":"l"*64,"capture_roots":capture,"remediation_evidence":remediation_evidence(),"terminal":terminal}; value["receipt_sha256"]=controller.digest(value); return value
 def _reconcile_patches(self,args,prepared,observed=None,writes=None):
  capture=prepared["capture_roots"]
  if not isinstance(capture,dict):
   return [patch.object(controller.recovery,"origin",return_value=ORIGIN),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_assert_controller_key"),patch.object(controller,"_outside_fresh"),patch.object(controller,"_signed",return_value=prepared)]
  members=[]
  receipt={"evidence":{"logical_ciphertext_sha256":capture["logical_ciphertext_sha256"],"blob_ciphertext_sha256":capture["blob_ciphertext_sha256"],"recipient_fingerprint":capture["recipient_fingerprint"],"catalog_sha256":capture["auth_storage_catalog_root"],"metadata_sha256":capture["auth_storage_metadata_root"],"short_urls_catalog_sha256":capture["short_urls_catalog_root"],"short_urls_rowset_sha256":capture["short_urls_rowset_root"],"victim_descriptors_sha256":capture["short_urls_victim_descriptors_root"],"short_urls_row_count":capture["short_urls_row_count"],"duplicate_group_count":capture["duplicate_group_count"],"duplicate_victim_count":capture["duplicate_victim_count"],"members":members,"object_count":capture["object_count"],"total_bytes":capture["total_bytes"]}}
  if capture["recovery_receipt_sha256"]=="7"*64:
   capture["storage_blob_root"]=controller.digest(members)
   capture["recovery_receipt_sha256"]=controller.digest(receipt)
   unsigned=dict(prepared); unsigned.pop("receipt_sha256"); prepared["receipt_sha256"]=controller.digest(unsigned)
  return [patch.object(controller.recovery,"origin",return_value=ORIGIN),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_assert_controller_key"),patch.object(controller,"_outside_fresh"),patch.object(controller,"_signed",return_value=prepared),patch.object(controller,"_read_attempt_marker",return_value="a"*64),patch.object(controller,"_write_signed",side_effect=lambda *v:(writes.append(v[2]) if writes is not None else None) or controller.digest(v[2])),patch.object(controller.recovery,"load_receipt",return_value=receipt),patch.object(controller.recovery,"verify"),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"pgpass"),patch.object(controller,"_connect",return_value=SimpleNamespace(cursor=lambda:SimpleNamespace(execute=lambda sql:None,close=lambda:None),rollback=lambda:None,close=lambda:None)),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)),patch.object(controller.closure,"observed_terminal_roots",return_value=observed or prepared["terminal"])]
 def test_reconcile_is_read_only_and_never_calls_mutators(self):
  args=self._execute_args(); args.identity_file="identity"; args.logical_archive="logical"; args.blob_archive="blob"; args.pg_restore="pg_restore"; prepared=self._prepared(); writes=[]; patches=self._reconcile_patches(args,prepared,writes=writes)
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   with patch.object(controller.recovery,"capture_cursor",side_effect=AssertionError("capture")),patch.object(controller.closure,"rehearse_cursor",side_effect=AssertionError("rehearse")),patch.object(controller.closure,"apply_cursor",side_effect=AssertionError("apply")):
    self.assertEqual(controller.reconcile(args)["status"],"reconciled")
  self.assertEqual([x["status"] for x in writes],["reconciled","reconciled"])
 def test_reconcile_rejects_each_binding_or_terminal_drift(self):
  args=self._execute_args(); args.identity_file="identity"; args.logical_archive="logical"; args.blob_archive="blob"; args.pg_restore="pg_restore"
  for field in ("source_root","commit","freeze_id","capture_roots","recovery","terminal","attempt_marker"):
   prepared=self._prepared()
   if field=="recovery": prepared["capture_roots"]["recovery_receipt_sha256"]="0"*64
   elif field=="terminal": observed={**prepared["terminal"],"catalog_root":"0"*64}
   elif field=="attempt_marker":
    prepared["remediation_evidence"]["attempt_marker_sha256"]="b"*64
    unsigned=dict(prepared["remediation_evidence"]); unsigned.pop("remediation_sha256"); prepared["remediation_evidence"]["remediation_sha256"]=controller.digest(unsigned)
    unsigned=dict(prepared); unsigned.pop("receipt_sha256"); prepared["receipt_sha256"]=controller.digest(unsigned); observed=None
   else: prepared[field]="0"*64 if field!="freeze_id" else "freeze-0002"; observed=None
   writes=[]; patches=self._reconcile_patches(args,prepared,observed,writes)
   with self.subTest(field=field),contextlib.ExitStack() as stack:
    for item in patches: stack.enter_context(item)
    with patch.object(controller.recovery,"capture_cursor",side_effect=AssertionError("mutation")),patch.object(controller.closure,"rehearse_cursor",side_effect=AssertionError("mutation")),patch.object(controller.closure,"apply_cursor",side_effect=AssertionError("mutation")):
     with self.assertRaises(controller.ControllerError): controller.reconcile(args)
   self.assertEqual(writes,[])
 def test_prepare_uses_real_preflight_and_rolls_back_without_commit(self):
  class Cursor:
   def __init__(s): s.calls=[]; s.last=""
   def execute(s,sql,*_): s.calls.append(sql); s.last=sql
   def fetchall(s):
    if "aclexplode" in s.last: return []
    if "pg_class c JOIN" in s.last: return [("public","items",1,"r","owner"),("auth","schema_migrations",2,"r","supabase_auth_admin"),("storage","buckets_vectors",3,"r","supabase_storage_admin"),("storage","migrations",4,"r","supabase_storage_admin"),("storage","vector_indexes",5,"r","supabase_storage_admin")]
    if "SELECT nspname FROM pg_namespace" in s.last: return [("public",),("auth",),("storage",)]
    return []
   def close(s): pass
  class Conn:
   def __init__(s): s.cursors=[]; s.rollbacks=0; s.commits=0; s.info=SimpleNamespace(transaction_status=0)
   def cursor(s): c=Cursor(); s.cursors.append(c); return c
   def rollback(s): s.rollbacks+=1
   def commit(s): s.commits+=1
   def close(s): s.closed=True
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory); args=SimpleNamespace(origin="https://abcdefghijklmnopqrst.supabase.co",freeze_id="freeze-0001",operator_assertion_request=str(root/"assertion-request"),service_file="service",service_name="g037",pgpass_file="pgpass",expiry_seconds=600)
   for channel in controller.RESIDUAL_CHANNELS:
    evidence={"schema":"g037-residual-freeze-evidence-v1","channel":channel,"freeze_id":"freeze-0001","status":True,"observed_at":int(time.time())}
    if channel=="producer_stop": evidence["producers"]=list(controller.PRODUCER_STOP_JOBS)
    path=root/(channel+".json"); path.write_text(json.dumps(evidence),encoding="utf-8"); path.chmod(0o600); setattr(args,"evidence_"+channel,str(path))
   conn=Conn(); written={}
   def write(_,value,*__): written.update(value); return controller.digest(value)
   with patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"pgpass"),patch.object(controller,"_connect",return_value=conn),patch.object(controller,"_write_unsigned",side_effect=write),patch.object(controller,"_outside_fresh"),patch.object(controller,"validate_operator_assertion_request") as validate_request,patch.object(controller,"validate_sources"),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)),patch.object(controller.recovery,"restrictive",return_value=True):
    result=controller.prepare(args)
  validate_request.assert_called_once()
  self.assertEqual(result["status"],"prepared"); self.assertEqual(conn.commits,0); self.assertEqual(conn.rollbacks,1)
  self.assertIn("BEGIN",conn.cursors[1].calls); self.assertTrue(any("LOCK TABLE" in call for call in conn.cursors[1].calls))
  self.assertEqual(written["relation_root"],result["relation_root"])
 def test_prepare_rejects_overlong_expiry_without_signing_surface(self):
  args=SimpleNamespace(origin="https://abcdefghijklmnopqrst.supabase.co",freeze_id="freeze-0001",operator_assertion_request="request",service_file="service",service_name="g037",pgpass_file="pgpass",expiry_seconds=901)
  with patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"pgpass"):
   with self.assertRaises(controller.ControllerError): controller.prepare(args)
 def test_prepare_and_finalize_parser_have_no_authorization_private_key_surface(self):
  parser=controller.parser()
  self.assertIn("prepare",parser.format_help()); self.assertIn("finalize",parser.format_help())
  prepare=parser.parse_args(["prepare","--origin",ORIGIN,"--freeze-id","freeze-0001","--operator-assertion-request","request","--service-file","service","--pgpass-file","pgpass",*sum((["--evidence-"+channel.replace("_","-"),channel] for channel in controller.RESIDUAL_CHANNELS),[])])
  self.assertFalse(hasattr(prepare,"authorization_signing_key"))
  finalize=parser.parse_args(["finalize","--origin",ORIGIN,"--freeze-id","freeze-0001","--operator-assertion-request","request","--operator-assertion-signature","request.sig","--operator-assertion","assertion",*sum((["--evidence-"+channel.replace("_","-"),channel] for channel in controller.RESIDUAL_CHANNELS),[])])
  self.assertFalse(hasattr(finalize,"authorization_signing_key"))
  with self.assertRaises(SystemExit):
   parser.parse_args(["prepare","--origin",ORIGIN,"--freeze-id","freeze-0001","--authorization-signing-key","key"])
  out=io.StringIO()
  with patch.object(controller,"prepare",return_value={"schema":controller.SCHEMA,"mode":"prepare","status":"prepared","assertion_request_sha256":"a"*64,"expires_at":1,"relation_root":"r"*64,"acl_root":"c"*64,"private_path":"/secret"}),patch("g040_recovery_source.assert_isolated_bootstrap"),contextlib.redirect_stdout(out):
   self.assertEqual(controller.main(["prepare","--origin",ORIGIN,"--freeze-id","freeze-0001","--operator-assertion-request","request","--service-file","service","--pgpass-file","pgpass",*sum((["--evidence-"+channel.replace("_","-"),channel] for channel in controller.RESIDUAL_CHANNELS),[])]),0)
  self.assertNotIn("/secret",out.getvalue())
 def test_unsigned_assertion_accepts_fresh_preparation_evidence_only(self):
  now=int(time.time()); channels=("producer_stop","no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write")
  request={"schema":"g037-write-freeze-assertion-v1","freeze_id":"freeze-0001","origin":ORIGIN,"commit":"a"*40,"manifest_sha256":controller.freeze.MANIFEST_SHA256,"relation_root":"r"*64,"acl_root":"a"*64,"source_root":"s"*64,"terminal_spec":"t"*64,"issued_at":now,"expires_at":now+60,"attestations":{channel:{"status":True,"evidence_sha256":"e"*64,"observed_at":now-1} for channel in channels}}
  controller.validate_operator_assertion_request(request,freeze_id="freeze-0001",origin=ORIGIN,relation_root="r"*64,acl_root="a"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
  request["attestations"]["producer_stop"]["observed_at"]=now+1
  with self.assertRaisesRegex(Exception,"residual attestation invalid"):
   controller.validate_operator_assertion_request(request,freeze_id="freeze-0001",origin=ORIGIN,relation_root="r"*64,acl_root="a"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
 def test_finalize_requires_canonical_request_fixed_key_signature_and_fresh_output(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory); request={"schema":"g037-write-freeze-assertion-v1","freeze_id":"freeze-0001","origin":ORIGIN,"commit":"h"*40,"manifest_sha256":controller.freeze.MANIFEST_SHA256,"relation_root":"r"*64,"acl_root":"a"*64,"source_root":"s"*64,"terminal_spec":"t"*64,"issued_at":1,"expires_at":2,"attestations":{}}
   request_path=root/"request"; signature_path=root/"signature"; request_path.write_bytes(controller.canonical_bytes(request)); signature_path.write_bytes(b"signature")
   args=SimpleNamespace(origin=ORIGIN,freeze_id="freeze-0001",operator_assertion_request=str(request_path),operator_assertion_signature=str(signature_path),operator_assertion=str(root/"assertion"))
   finalized_sha256=controller.digest({**request,"signature":base64.b64encode(b"signature").decode("ascii")})
   with patch.object(controller,"_remediation_custody",side_effect=[request_path,signature_path]),patch.object(controller.recovery,"_source_public_key",return_value=contextlib.nullcontext("pinned-key")) as source_key,patch.object(controller.recovery,"openssl_verify",return_value=True) as verify,patch.object(controller,"_validate_assertion_request") as validate_request,patch.object(controller,"_write_finalized_assertion",return_value=finalized_sha256) as write:
    result=controller.finalize(args)
   self.assertEqual(result["status"],"finalized"); self.assertEqual(result["assertion_sha256"],finalized_sha256); self.assertNotEqual(result["assertion_sha256"],controller.digest(request)); source_key.assert_called_once_with(controller.AUTHORIZATION_PUBLIC_KEY_PEM.encode("ascii")); verify.assert_called_once_with(controller.recovery.command("openssl"),"pinned-key",controller.canonical_bytes(request),b"signature"); validate_request.assert_called_once_with(request,args,controller.repository_root(Path(controller.__file__).resolve())); write.assert_called_once_with(str(root/"assertion"),request,b"signature")
   with patch.object(controller,"_remediation_custody",side_effect=[request_path,signature_path]),patch.object(controller.recovery,"_source_public_key",return_value=contextlib.nullcontext("pinned-key")),patch.object(controller.recovery,"openssl_verify",return_value=False),patch.object(controller,"_validate_assertion_request"),patch.object(controller,"_write_finalized_assertion") as write:
    with self.assertRaisesRegex(controller.ControllerError,"signature invalid"): controller.finalize(args)
   write.assert_not_called()
 def _rehearse_fixture(self, *, malformed_capture=False, baseline_drift=False):
  args=self._execute_args(); args.rehearsal_receipt="rehearsal"; args.rehearsal_outcome_receipt="rehearsal-outcome"
  events=[]; writes=[]; inventory=self._inventory(); terminal=self._terminal(); calls={"inventory":0}
  capture=capture_roots()
  if malformed_capture: capture.pop("storage_blob_root")
  class Cursor:
   def execute(s,sql,params=()): events.append(sql)
   def close(s): events.append("cursor-close")
  class Conn:
   def cursor(s): return Cursor()
   def commit(s): events.append("commit")
   def rollback(s): events.append("rollback")
   def close(s): events.append("connection-close")
  def inv(_):
   calls["inventory"]+=1
   events.append(("preflight","locked-inventory","post-lock-inventory","baseline-inventory")[min(calls["inventory"]-1,3)])
   if baseline_drift and calls["inventory"]==4: return SimpleNamespace(relation_root="d"*64,acl_root=inventory.acl_root)
   return inventory
  def write(*values):
   value=values[2]; writes.append(value)
   events.append("rehearsal-receipt" if values[3]=="rehearsal receipt" else "rehearsal-outcome")
   return value["receipt_sha256"]
  patches=[patch.object(controller,"validate"),patch.object(controller,"_remediation_binding",return_value={"authorization":{},"authorization_sha256":"a"*64,"authorization_signature_sha256":"b"*64,"capture_evidence":{}}),patch.object(controller.recovery,"origin",return_value=ORIGIN),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_outside_fresh",side_effect=lambda path,label:Path(path)),patch.object(controller,"_signed_assertion",return_value=({"expires_at":int(time.time())+60,"signature":"signed"},{"expires_at":int(time.time())+60})),patch.object(controller.recovery,"recipient_from_files",return_value=("recipient","f"*64)),patch.object(controller.recovery,"service",return_value=SERVICE),patch.object(controller.recovery,"read_secret_reference",return_value="secret"),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller,"_connect",return_value=Conn()),patch.object(controller.freeze,"_inv",side_effect=inv),patch.object(controller.freeze,"_locks",side_effect=lambda cur,relations,seconds: events.append("locks") or "l"*64),patch.object(controller.freeze,"_root_source",return_value=(Path("."),"h"*40,"s"*64,"t"*64)),patch.object(controller.freeze,"validate_operator_assertion"),patch.object(controller.freeze,"_verify_active",side_effect=lambda value,expected:value),patch.object(controller.recovery,"capture_cursor",side_effect=lambda *a,**k: events.append("capture") or capture),patch.object(controller.closure,"rehearse_cursor",side_effect=lambda *a,**k: events.append("rehearse") or remediation_evidence()),patch.object(controller.closure,"apply_cursor",side_effect=lambda *a,**k: events.append("apply") or remediation_evidence()),patch.object(controller.closure,"observed_terminal_roots",side_effect=lambda *a,**k: events.append("terminal") or terminal),patch.object(controller,"_write_signed",side_effect=write)]
  patches.append(patch.object(controller,"_read_validated_assertion",return_value=({"expires_at":int(time.time())+60,"signature":"signed"},controller.digest({"expires_at":int(time.time())+60}))))
  return args,events,writes,patches
 def test_rehearse_runs_full_state_machine_and_rolls_back_before_readback(self):
  args,events,writes,patches=self._rehearse_fixture()
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   outcome=controller.rehearse(args)
  for earlier,later in (("preflight","BEGIN"),("BEGIN","locks"),("locks","capture"),("capture","rehearse"),("rehearse","apply"),("apply","terminal"),("terminal","rehearsal-receipt"),("rehearsal-receipt","rollback"),("rollback","BEGIN TRANSACTION READ ONLY"),("BEGIN TRANSACTION READ ONLY","baseline-inventory"),("baseline-inventory","rehearsal-outcome")):
   self.assertLess(events.index(earlier),events.index(later))
  self.assertEqual(events.count("commit"),0); self.assertEqual(events.count("apply"),1); self.assertEqual(events.count("rollback"),2)
  self.assertEqual(events.count("capture"),1); self.assertEqual(events.count("rehearse"),1); self.assertEqual(events.count("locks"),1)
  self.assertEqual([value["status"] for value in writes],["terminal-observed-before-rollback","rehearsed-rolled-back"])
  self.assertEqual(outcome["status"],"rehearsed-rolled-back")
 def test_rehearse_rejects_malformed_capture_without_success_or_retry(self):
  args,events,writes,patches=self._rehearse_fixture(malformed_capture=True)
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   with self.assertRaisesRegex(controller.freeze.FreezeError,"capture roots fields invalid"): controller.rehearse(args)
  self.assertEqual(events.count("commit"),0); self.assertEqual(events.count("apply"),1); self.assertGreaterEqual(events.count("rollback"),1)
  self.assertEqual(events.count("capture"),1); self.assertEqual(events.count("rehearse"),1); self.assertEqual(events.count("locks"),1)
  self.assertEqual(writes,[]); self.assertNotIn("rehearsal-outcome",events)
 def test_rehearse_rejects_baseline_drift_without_success_or_retry(self):
  args,events,writes,patches=self._rehearse_fixture(baseline_drift=True)
  with contextlib.ExitStack() as stack:
   for item in patches: stack.enter_context(item)
   with self.assertRaisesRegex(controller.freeze.FreezeError,"baseline readback drift"): controller.rehearse(args)
  self.assertEqual(events.count("commit"),0); self.assertEqual(events.count("apply"),1); self.assertGreaterEqual(events.count("rollback"),2)
  self.assertEqual(events.count("capture"),1); self.assertEqual(events.count("rehearse"),1); self.assertEqual(events.count("locks"),1)
  self.assertEqual([value["status"] for value in writes],["terminal-observed-before-rollback"]); self.assertNotIn("rehearsal-outcome",events)
 def test_destructive_reread_rejects_replaced_assertion_expiry_or_binding_before_connect_or_capture(self):
  for mode in ("execute","rehearse"):
   for drift in ("operator assertion expired","operator assertion binding drift"):
    args=self._execute_args()
    if mode=="rehearse":
     args.rehearsal_receipt="rehearsal"; args.rehearsal_outcome_receipt="rehearsal-outcome"
    events=[]
    def validated(*_,**__):
     events.append("validate")
    def signed(*_,**__):
     events.append("reread")
     return ({"expires_at":int(time.time())-1,"replacement":drift},{})
    def reject(assertion,*_,**__):
     events.append("assertion-validated")
     self.assertEqual(assertion["replacement"],drift)
     raise controller.ControllerError(drift)
    with self.subTest(mode=mode,drift=drift),patch.object(controller,"validate",side_effect=validated),patch.object(controller,"_validated_binding",return_value=(ORIGIN,SERVICE)),patch.object(controller,"validate_sources",return_value=object()),patch.object(controller,"_outside_fresh"),patch.object(controller,"_private"),patch.object(controller,"_signed_assertion",side_effect=signed),patch.object(controller,"_validate_assertion",side_effect=reject),patch.object(controller,"_connect",side_effect=lambda *_:events.append("connect")),patch.object(controller.recovery,"capture_cursor",side_effect=lambda *_:events.append("capture")),patch.object(controller.closure,"apply_cursor",side_effect=lambda *_:events.append("apply")):
     with self.assertRaisesRegex(controller.ControllerError,drift): getattr(controller,mode)(args)
    self.assertEqual(events,["validate","reread","assertion-validated"])
 def test_project_binding_accepts_only_exact_direct_and_pooler_forms(self):
  args=SimpleNamespace(service_file="service",service_name="g037")
  for entries in (
   SERVICE,
   {**SERVICE,"host":"aws-0-ap-northeast-2.pooler.supabase.com","user":"postgres.abcdefghijklmnopqrst"},
  ):
   with self.subTest(entries=entries),patch.object(controller.recovery,"service",return_value=entries):
    self.assertEqual(controller._bound_service(args,ORIGIN),entries)
  invalid=(
   {**SERVICE,"host":"db.abcdefghijklmnopqrstu.supabase.co"},
   {**SERVICE,"host":"DB.abcdefghijklmnopqrst.supabase.co"},
   {**SERVICE,"host":"db.abcdefghijklmnopqrst.supabase.co.evil"},
   {**SERVICE,"host":"127.0.0.1"},
   {**SERVICE,"user":"postgres.abcdefghijklmnopqrst"},
   {**SERVICE,"dbname":"other"},
   {**SERVICE,"host":"a.pooler.supabase.com","user":"postgres.abcdefghijklmnopqrstu"},
   {**SERVICE,"host":"a.b.pooler.supabase.com","user":"postgres.abcdefghijklmnopqrst"},
  )
  for entries in invalid:
   with self.subTest(entries=entries),patch.object(controller.recovery,"service",return_value=entries):
    with self.assertRaises(controller.ControllerError): controller._bound_service(args,ORIGIN)
 def test_mismatched_project_rejects_before_connections_secrets_or_outputs_in_every_mode(self):
  args=self._execute_args(); args.origin=ORIGIN; args.authorization_signing_key="key"; args.expiry_seconds=60
  for mode in ("prepare","validate","execute","rehearse","reconcile"):
   events=[]; mismatch={**SERVICE,"host":"db.abcdefghijklmnopqrstu.supabase.co"}
   with self.subTest(mode=mode),patch.object(controller.recovery,"service",return_value=mismatch),patch.object(controller,"_connect",side_effect=lambda *_:events.append("connect")),patch.object(controller.recovery,"read_secret_reference",side_effect=lambda *_:events.append("secret")),patch.object(controller.recovery,"capture_cursor",side_effect=lambda *_:events.append("capture")),patch.object(controller.freeze,"_locks",side_effect=lambda *_:events.append("locks")),patch.object(controller,"_write_signed",side_effect=lambda *_:events.append("output")):
    if mode in ("execute","rehearse"):
     with patch.object(controller,"validate"):
      with self.assertRaises(controller.ControllerError): getattr(controller,mode)(args)
    else:
     with self.assertRaises(controller.ControllerError): getattr(controller,mode)(args)
   self.assertEqual(events,[])
 def test_write_signed_publishes_restrictive_hardlink_and_reads_back(self):
  with tempfile.TemporaryDirectory() as directory:
   path=self._restrictive_directory(directory)/"operator-assertion.json"; value={"receipt":"value"}; seen=[]
   def signed(receipt,*_):
    seen.append(Path(receipt))
    self.assertTrue(controller.recovery.restrictive(receipt))
    return value
   with patch.object(controller,"_outside_fresh",side_effect=lambda candidate,_:Path(candidate)),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller,"_signed",side_effect=signed):
    self.assertEqual(controller._write_signed(path,"key",value,"operator assertion",b"public"),controller.digest(value))
   self.assertEqual(seen,[path])
   self.assertTrue(controller.recovery.restrictive(path))
   self.assertEqual(path.read_text(encoding="ascii").endswith("\n"),True)
 def test_write_signed_cleans_restrictive_temp_when_link_fails(self):
  with tempfile.TemporaryDirectory() as directory:
   path=self._restrictive_directory(directory)/"operator-assertion.json"; temporary=[]
   original=controller.recovery._temporary_bytes
   def create(*args,**kwargs):
    result=Path(original(*args,**kwargs)); temporary.append(result); return result
   with patch.object(controller,"_outside_fresh",side_effect=lambda candidate,_:Path(candidate)),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller.recovery,"_temporary_bytes",side_effect=create),patch.object(controller.os,"link",side_effect=FileExistsError()):
    with self.assertRaises(controller.ControllerError): controller._write_signed(path,"key",{"receipt":"value"},"operator assertion",b"public")
   self.assertFalse(path.exists())
   self.assertTrue(temporary and not temporary[0].exists())
 def test_write_signed_cleans_restrictive_temp_after_readback_failure(self):
  with tempfile.TemporaryDirectory() as directory:
   path=self._restrictive_directory(directory)/"operator-assertion.json"; temporary=[]
   original=controller.recovery._temporary_bytes
   def create(*args,**kwargs):
    result=Path(original(*args,**kwargs)); temporary.append(result); return result
   with patch.object(controller,"_outside_fresh",side_effect=lambda candidate,_:Path(candidate)),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller.recovery,"_temporary_bytes",side_effect=create),patch.object(controller,"_signed",side_effect=controller.ControllerError("readback failed")):
    with self.assertRaises(controller.ControllerError): controller._write_signed(path,"key",{"receipt":"value"},"operator assertion",b"public")
   self.assertTrue(controller.recovery.restrictive(path))
   self.assertTrue(temporary and not temporary[0].exists())
 def test_write_signed_fails_closed_when_cleanup_fails_after_authenticated_publication(self):
  with tempfile.TemporaryDirectory() as directory:
   path=self._restrictive_directory(directory)/"operator-assertion.json"; value={"receipt":"value"}; temporary=[]; seen=[]
   original=controller.recovery._temporary_bytes
   def create(*args,**kwargs):
    result=Path(original(*args,**kwargs)); temporary.append(result); return result
   def signed(receipt,*_):
    seen.append(Path(receipt)); self.assertTrue(controller.recovery.restrictive(receipt)); return value
   with patch.object(controller,"_outside_fresh",side_effect=lambda candidate,_:Path(candidate)),patch.object(controller.recovery,"openssl_sign",return_value=b"signature"),patch.object(controller.recovery,"_temporary_bytes",side_effect=create),patch.object(controller,"_signed",side_effect=signed),patch.object(controller.recovery,"_cleanup_temporary_files",side_effect=controller.recovery.RecoveryError("temporary file cleanup failed")):
    with self.assertRaises(controller.recovery.RecoveryError): controller._write_signed(path,"key",value,"operator assertion",b"public")
   self.assertEqual(seen,[path]); self.assertTrue(path.exists()); self.assertTrue(controller.recovery.restrictive(path))
   self.assertTrue(temporary and temporary[0].exists())
   temporary[0].unlink()
if __name__=="__main__": unittest.main()
