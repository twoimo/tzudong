import contextlib, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, threading, time, unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
import g040_recovery_source as recovery_source
recovery_source._establish_isolated_bootstrap(Path(__file__).parents[3],"a"*40,"b"*64)
import g035_hosted_recovery_contract as contract
spec=importlib.util.spec_from_file_location("recovery",SCRIPTS/"g035_hosted_recovery.py"); recovery=importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
ROOT=Path(__file__).parents[3]
def fingerprints(*,pairs=(),ledger_sha256="1"*64,restorable_catalog_sha256="2"*64,managed_catalog_sha256="3"*64,managed_schemas=contract.MANAGED_METADATA_SCHEMAS):
 return {"ledger_pairs":pairs,"ledger_sha256":ledger_sha256,"ledger_count":len(pairs),"restorable_catalog_sha256":restorable_catalog_sha256,"managed_catalog_sha256":managed_catalog_sha256,"managed_metadata_schemas_present":managed_schemas}

class ContractTests(unittest.TestCase):
 def test_direct_isolated_entrypoint_rejects_before_checkout_local_shadow(self):
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw); entry=root/"g035_hosted_recovery.py"; marker=root/"shadow-executed"
   entry.write_bytes((SCRIPTS/"g035_hosted_recovery.py").read_bytes())
   (root/"g035_hosted_recovery_contract.py").write_text(f"open({str(marker)!r},'w').write('executed')",encoding="utf8")
   result=subprocess.run([sys.executable,"-I",str(entry),"validate"],capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0)
   self.assertEqual(result.stderr.strip(),"protected recovery source verification failed")
   self.assertFalse(marker.exists())
 def test_manifest_and_immutable_pair_baseline(self):
  manifest=contract.validate_sources(ROOT)
  expected=(("20251219","db_performance_optimization"),("20260118","create_ocr_logs"),("20260425","allow_ocr_logs_user_insert"),("20260506065538","optimize_auth_user_state_indexes"),("20260506085634","optimize_app_query_indexes"),("20260509000100","drop_server_costs"),("20260509000200","drop_admin_ai_settings"),("20260523093000","create_restaurant_popular_rank_snapshots"),("20260525143908","create_youtube_kpi_snapshots"),("20260526083932","add_youtube_channel_growth_snapshot_deltas"),("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"))
  reconstructed=(("20260124","create_document_embeddings_bge"),("20260124","create_restaurants"),("20260124","fix_approved_name_sync"),("20260124","update_embeddings_constraint"),("20260131","fix_search_rpc"),("20260213","create_announcements_table_and_seed"),("20260214","fix_approve_edit_backup_stage"),("20260214","fix_restaurant_rpcs_and_search"),("20260214","fix_submission_item_target_to_backup"),("20260514","admin_user_management_audit"),("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"))
  self.assertEqual(28,len(manifest.migrations)); self.assertEqual(expected,contract.BASELINE_PAIRS)
  self.assertGreaterEqual(recovery.CAPTURE_TIMEOUT_SECONDS,3600)
  self.assertTrue(contract.ledger_prefix(manifest,expected))
  self.assertTrue(contract.ledger_prefix(manifest,[list(pair) for pair in expected]))
  mutated=list(expected); mutated[0]=("20260124","db_performance_optimization")
  self.assertFalse(contract.ledger_prefix(manifest,mutated))
  self.assertFalse(contract.ledger_prefix(manifest,list(reconstructed)))
  self.assertFalse(contract.ledger_prefix(manifest,[("20260531084516","caller_supplied")]))

 def test_hosted_workflow_uses_exact_local_only_cli_contract(self):
  workflow=(ROOT/".github/workflows/g035-hosted-recovery.yml").read_text(encoding="utf8")
  choices=next(action.choices for action in recovery.parser()._actions if getattr(action,"dest",None)=="mode")
  required={
   mode:{action.dest for action in subparser._actions if action.required}
   for mode,subparser in choices.items()
  }
  self.assertEqual({
   "validate":set(),
   "capture":{"destination","service_file","recipient","g034_artifact","encrypt_command"},
   "production-capture":{"destination","capture_receipt","service_file","recipient","g034_artifact","encrypt_command"},
   "restore-verify":{"dump","capture_receipt","service_file","destination_service","identity_file","decrypt_command"},
   "short-url-remediation-inspect":{"service","service_file","restore_receipt"},
   "short-url-remediation-apply":{"service","service_file","restore_receipt","inspect_receipt","authorization","authorization_signature"},
   "short-url-remediation-verify":{"service","service_file","apply_receipt"},
   "clone-apply":{"service","service_file","restore_receipt"},
   "local-postflight":{"service","service_file","clone_receipt"},
  },required)
  commands={
   "validate":'python backend/supabase/scripts/g035_hosted_recovery.py validate > "$EVIDENCE_RECEIPT_PATH"',
   "capture":'python backend/supabase/scripts/g035_hosted_recovery.py capture --destination "$G035_ENCRYPTED_DESTINATION_PATH" --service-file "$G035_HOSTED_PG_SERVICE_FILE" --recipient "$G035_PUBLIC_RECIPIENT" --g034-artifact "$G035_G034_ARTIFACT" --encrypt-command "$G035_ENCRYPT_COMMAND" > "$EVIDENCE_RECEIPT_PATH"',
   "restore-verify":'python backend/supabase/scripts/g035_hosted_recovery.py restore-verify --dump "$G035_DUMP_PATH" --capture-receipt "$G035_CAPTURE_RECEIPT_PATH" --service-file "$G035_LOCAL_PG_SERVICE_FILE" --destination-service g035-local --identity-file "$G035_OFFLINE_IDENTITY_FILE" --decrypt-command "$G035_DECRYPT_COMMAND" > "$EVIDENCE_RECEIPT_PATH"',
   "short-url-remediation-inspect":'python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-inspect --service g035-local --service-file "$G035_LOCAL_PG_SERVICE_FILE" --restore-receipt "$G035_RESTORE_RECEIPT_PATH" > "$EVIDENCE_RECEIPT_PATH"',
   "short-url-remediation-apply":'python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-apply --service g035-local --service-file "$G035_LOCAL_PG_SERVICE_FILE" --restore-receipt "$G035_RESTORE_RECEIPT_PATH" --inspect-receipt "$G035_SHORT_URL_REMEDIATION_INSPECT_RECEIPT_PATH" --authorization "$G035_REMEDIATION_AUTHORIZATION_PATH" --authorization-signature "$G035_REMEDIATION_AUTHORIZATION_SIGNATURE_PATH" > "$EVIDENCE_RECEIPT_PATH"',
   "short-url-remediation-verify":'python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-verify --service g035-local --service-file "$G035_LOCAL_PG_SERVICE_FILE" --apply-receipt "$G035_SHORT_URL_REMEDIATION_APPLY_RECEIPT_PATH" > "$EVIDENCE_RECEIPT_PATH"',
   "clone-apply":'python backend/supabase/scripts/g035_hosted_recovery.py clone-apply --service g035-local --service-file "$G035_LOCAL_PG_SERVICE_FILE" --restore-receipt "$G035_RESTORE_RECEIPT_PATH" --short-url-remediation-receipt "$G035_SHORT_URL_REMEDIATION_VERIFY_RECEIPT_PATH" > "$EVIDENCE_RECEIPT_PATH"',
   "local-postflight":'python backend/supabase/scripts/g035_hosted_recovery.py local-postflight --service g035-local --service-file "$G035_LOCAL_PG_SERVICE_FILE" --clone-receipt "$G035_CLONE_RECEIPT_PATH" --psql psql > "$EVIDENCE_RECEIPT_PATH"',
  }
  self.assertEqual(set(choices),set(commands)|{"production-capture"})
  for mode,command in commands.items():
   self.assertIn(command,workflow)
   for destination in required[mode]:
    action=next(action for action in choices[mode]._actions if action.dest==destination)
    self.assertIn(action.option_strings[0],command)
  self.assertIn("options: [validate, capture, restore-verify, short-url-remediation-inspect, short-url-remediation-apply, short-url-remediation-verify, clone-apply, local-postflight]",workflow)
  for variable in ("G035_HOSTED_PG_SERVICE_FILE","G035_LOCAL_PG_SERVICE_FILE","G035_OFFLINE_IDENTITY_FILE","G035_REMEDIATION_AUTHORIZATION_PATH","G035_REMEDIATION_AUTHORIZATION_SIGNATURE_PATH","G035_SHORT_URL_REMEDIATION_INSPECT_RECEIPT_PATH","G035_SHORT_URL_REMEDIATION_APPLY_RECEIPT_PATH","G035_SHORT_URL_REMEDIATION_VERIFY_RECEIPT_PATH"):
   self.assertIn(f'{variable}: ${{{{ vars.{variable} }}}}',workflow)
  self.assertIn('capture) test -r "$G035_HOSTED_PG_SERVICE_FILE";',workflow)
  for mode in ("restore-verify","short-url-remediation-inspect","short-url-remediation-apply","short-url-remediation-verify","clone-apply","local-postflight"):
   self.assertIn(f'{mode}) test -r "$G035_LOCAL_PG_SERVICE_FILE";',workflow)
  self.assertEqual(1,workflow.count("--identity-file"))
  self.assertLess(workflow.index('case "$EVIDENCE_RECEIPT_PATH" in'),workflow.index('receipt_parent="$(dirname -- "$EVIDENCE_RECEIPT_PATH")"'))
  self.assertIn('/*|[A-Za-z]:/*|[A-Za-z]:\\\\*) ;;',workflow)
  self.assertIn('case "$canonical_receipt_parent/" in "$canonical_workspace/"*) exit 1;; esac',workflow)
  self.assertIn('test ! -e "$EVIDENCE_RECEIPT_PATH"',workflow)
  self.assertIn('test ! -L "$EVIDENCE_RECEIPT_PATH"',workflow)
  self.assertIn("set -C",workflow)
  self.assertIn("REMEDIATION_PUBLIC_KEY_PEM",recovery.__dict__)
  self.assertNotIn("hosted-apply",workflow)
  self.assertNotIn("${{ secrets.",workflow)
  self.assertNotIn("PRIVATE_KEY",workflow)
  self.assertNotIn("AGE-SECRET-KEY",workflow)
 def test_short_url_authorization_contract_rejects_tampering_and_noncanonical_inputs(self):
  hashes={key:"a"*64 for key in ("inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256")}
  auth={"schema":contract.REMEDIATION_AUTHORIZATION_SCHEMA,**hashes,"repository_commit":"b"*40,"duplicate_group_count":1,"duplicate_victim_count":1,"batch_id":"11111111-1111-1111-1111-111111111111"}
  evidence={key:auth[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}
  def custody(path,label):
   if not path.is_file(): raise contract.ContractError(f"{label} missing")
  def verify(raw,path,pem):
   if path.read_bytes()!=b"valid": raise contract.ContractError("signature invalid")
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"authorization.json"; signature=Path(raw)/"authorization.sig"; signature.write_bytes(b"valid")
   path.write_bytes(contract.canonical_json_bytes(auth))
   verified=contract.verify_short_url_remediation_authorization(path,signature,require_custody=custody,verify_detached=verify,expected_bindings={key:auth[key] for key in ("inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","repository_commit")},inspection_evidence=evidence)
   self.assertEqual(auth["batch_id"],verified["batch_id"])
   with self.assertRaises(TypeError): verified["batch_id"]="changed"
   cases=(
    b'{}',
    contract.canonical_json_bytes({**auth,"unexpected":True}),
    b'{"schema":"g035-short-url-remediation-authorization-v1","schema":"g035-short-url-remediation-authorization-v1"}',
    contract.canonical_json_bytes(auth)+b"\n",
   )
   for payload in cases:
    path.write_bytes(payload)
    with self.assertRaises(contract.ContractError): contract.verify_short_url_remediation_authorization(path,signature,require_custody=custody,verify_detached=verify,expected_bindings={},inspection_evidence=evidence)
   path.write_bytes(contract.canonical_json_bytes({**auth,"manifest_sha256":"c"*64}))
   with self.assertRaisesRegex(contract.ContractError,"binding"): contract.verify_short_url_remediation_authorization(path,signature,require_custody=custody,verify_detached=verify,expected_bindings={"manifest_sha256":"a"*64},inspection_evidence=evidence)
   signature.write_bytes(b"tampered")
   path.write_bytes(contract.canonical_json_bytes(auth))
   with self.assertRaisesRegex(contract.ContractError,"signature"): contract.verify_short_url_remediation_authorization(path,signature,require_custody=custody,verify_detached=verify,expected_bindings={},inspection_evidence=evidence)
 def test_source_binding_rejects_missing_or_substituted_lineage(self):
  expected={"repository_commit":"a"*40,"runtime_source_root":"b"*64}
  with patch.object(recovery,"_recovery_source_binding",return_value=expected):
   self.assertEqual(expected,recovery._require_recovery_source_binding(expected,ROOT))
   with self.assertRaisesRegex(recovery.RecoveryError,"missing"):
    recovery._require_recovery_source_binding({},ROOT)
   with self.assertRaisesRegex(recovery.RecoveryError,"mismatch"):
    recovery._require_recovery_source_binding({**expected,"runtime_source_root":"c"*64},ROOT)
class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.source_binding=patch.object(recovery,"_require_recovery_source_binding",return_value={"repository_commit":"a"*40,"runtime_source_root":"b"*64})
  self.source_binding.start()
 def tearDown(self):
  self.source_binding.stop()
 def service(self,directory,section="g035-local",body=None):
  path=Path(directory)/"service.conf"; path.write_text(body or f"[{section}]\nhost=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n",encoding="utf8"); path.chmod(0o600); return path
 def managed_capture_scope(self):
  return {"managed_metadata_schema_scope":list(contract.MANAGED_METADATA_SCHEMAS),"managed_table_data_exclusions":["--exclude-table-data=auth.*","--exclude-table-data=storage.*"]}
 def test_local_destination_service_rejects_rerouting_and_ambiguous_inputs(self):
  cases=(
   "host=localhost",
   "host=prod.example.com",
   "host=10.0.0.1",
   "host=192.168.1.10",
   "hostaddr=127.0.0.1",
   "host=postgresql://prod.example.com/db",
   "host=127.0.0.1\nhost=localhost",
   "host=127.0.0.1\noptions=-c search_path=public",
   "host=127.0.0.1\nservice=other",
   "host=127.0.0.1\npassfile=/tmp/pass",
   "host=127.0.0.1\n[other]\nhost=127.0.0.1",
  )
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery,"_restrictive",return_value=True):
   for body in cases:
    service=self.service(raw,body="[g035-local]\n"+body+"\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n")
    with self.assertRaises(recovery.RecoveryError): recovery._copy_local_service(Path(raw),service,"g035-local")
 def test_local_destination_service_accepts_loopback_and_socket_exact_bytes(self):
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery,"_restrictive",return_value=True):
   for host in ("127.0.0.1","::1"):
    body=f"[g035-local]\nhost={host}\nport=5432\ndbname=g035_local\napplication_name=g035-local-run-1\nsslmode=disable\n"
    service=self.service(raw,body=body)
    copied=recovery._copy_local_service(Path(raw),service,"g035-local")
    self.assertEqual(service.read_bytes(),copied.read_bytes())
 def test_local_destination_requires_identity_tls_port_and_single_section(self):
  cases=(
   "host=127.0.0.1\nport=0\ndbname=g035_local\napplication_name=g035-local-run\nsslmode=disable\n",
   "host=127.0.0.1\nport=5432\ndbname=postgres\napplication_name=g035-local-run\nsslmode=disable\n",
   "host=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=maintenance\nsslmode=disable\n",
   "host=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-run\nsslmode=require\n",
  )
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery,"_restrictive",return_value=True):
   for values in cases:
    service=self.service(raw,body="[g035-local]\n"+values)
    with self.assertRaises(recovery.RecoveryError): recovery._copy_local_service(Path(raw),service,"g035-local")
 def test_local_destination_rejects_nonrestrictive_and_symlink_files(self):
  with tempfile.TemporaryDirectory() as raw:
   service=self.service(raw)
   with patch.object(recovery,"_restrictive",return_value=False),self.assertRaises(recovery.RecoveryError):
    recovery._copy_local_service(Path(raw),service,"g035-local")
   with patch.object(Path,"is_symlink",return_value=True),self.assertRaises(recovery.RecoveryError):
    recovery._copy_local_service(Path(raw),service,"g035-local")
 def test_windows_dacl_uses_native_tools_without_powershell_modules(self):
  sddl="D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)"
  with tempfile.TemporaryDirectory() as raw:
   service=self.service(raw)
   responses=[
    subprocess.CompletedProcess([],0,'"DOMAIN\\\\user","S-1-5-21-100"\r\n',""),
    subprocess.CompletedProcess([],0,"",""),
   ]
   with patch.object(recovery.subprocess,"run",side_effect=responses) as acl_run,patch.object(recovery,"_windows_saved_sddl",return_value=sddl):
    self.assertTrue(recovery._windows_dacl_restrictive(service))
  self.assertEqual(["whoami","/user","/fo","csv","/nh"],acl_run.call_args_list[0].args[0])
  argv=acl_run.call_args_list[1].args[0]
  self.assertEqual(["icacls",str(service),"/save"],argv[:3])
  self.assertEqual("/c",argv[-1])
  self.assertFalse(Path(argv[3]).exists())
  self.assertNotIn("powershell.exe",str(acl_run.call_args_list))
 def test_windows_saved_sddl_accepts_bomless_utf16le_and_rejects_malformed_bytes(self):
  with tempfile.TemporaryDirectory() as raw:
   export=Path(raw)/"acl.txt"
   export.write_bytes("service.conf D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)\r\n".encode("utf-16-le"))
   self.assertEqual("D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)",recovery._windows_saved_sddl(export))
   export.write_bytes(b"\xff\xfeD\x00:\x00\x00")
   self.assertIsNone(recovery._windows_saved_sddl(export))
 def test_windows_dacl_rejects_broad_inherited_unknown_malformed_and_failures(self):
  rejected=(
   "D:PAI(A;;FA;;;S-1-1-0)(A;;FA;;;S-1-5-21-100)",
   "D:PAI(A;ID;FA;;;S-1-5-21-100)",
   "D:PAI(A;;FA;;;S-1-5-32-545)(A;;FA;;;S-1-5-21-100)",
   "D:PAI(D;;FA;;;S-1-5-21-100)",
   "D:PAI(A;;FA;;;S-1-5-21-100",
  )
  with tempfile.TemporaryDirectory() as raw:
   service=self.service(raw)
   for sddl in rejected:
    responses=[
     subprocess.CompletedProcess([],0,'"DOMAIN\\\\user","S-1-5-21-100"\r\n',""),
     subprocess.CompletedProcess([],0,"",""),
    ]
    with patch.object(recovery.subprocess,"run",side_effect=responses),patch.object(recovery,"_windows_saved_sddl",return_value=sddl):
     self.assertFalse(recovery._windows_dacl_restrictive(service))
   with patch.object(recovery.subprocess,"run",side_effect=[
    subprocess.CompletedProcess([],0,'"DOMAIN\\\\user","S-1-5-21-100"\r\n',""),
    subprocess.CalledProcessError(1,["icacls"]),
   ]):
    self.assertFalse(recovery._windows_dacl_restrictive(service))
 def test_windows_dacl_has_no_posix_mode_fallback(self):
  class File:
   def is_symlink(self): return False
   def is_file(self): return True
   def stat(self): raise AssertionError("mode fallback")
  with patch.object(recovery.os,"name","nt"),patch.object(recovery.subprocess,"run",side_effect=OSError()):
   self.assertFalse(recovery._restrictive(File()))
 def test_restrictive_directory_requires_real_directory_custody(self):
  if recovery.os.name=="nt": self.skipTest("POSIX mode custody assertion")
  with tempfile.TemporaryDirectory() as raw:
   directory=Path(raw)/"custody"; directory.mkdir(); directory.chmod(0o700)
   self.assertTrue(recovery._restrictive_directory(directory))
   directory.chmod(0o755)
   self.assertFalse(recovery._restrictive_directory(directory))
 def test_secure_temporary_file_is_mode_600_before_content_on_posix(self):
  if recovery.os.name=="nt": self.skipTest("POSIX-only mode assertion")
  fd,path=recovery._secure_temporary_file("g035-test-",b"exact")
  try:
   self.assertEqual(0o600,path.stat().st_mode&0o777)
   self.assertTrue(recovery._same_file_identity(fd,path))
   self.assertEqual(b"exact",path.read_bytes())
  finally:
   recovery._close_temporary_file(fd,path)
  self.assertFalse(path.exists())
 def test_secure_temporary_file_applies_windows_acl_before_content(self):
  with tempfile.TemporaryDirectory() as raw:
   candidate=Path(raw)/"temporary"
   fd=recovery.os.open(candidate,recovery.os.O_CREAT|recovery.os.O_EXCL|recovery.os.O_RDWR,0o600)
   seen=[]
   def restrict(path):
    seen.append(path.read_bytes())
   with patch.object(recovery.tempfile,"mkstemp",return_value=(fd,str(candidate))),patch.object(recovery.os,"name","nt"),patch.object(recovery,"_windows_restrict_temporary_file",side_effect=restrict),patch.object(recovery,"_restrictive",return_value=True):
    actual_fd,path=recovery._secure_temporary_file("unused",b"exact")
   try:
    self.assertEqual([b""],seen)
    self.assertEqual(b"exact",path.read_bytes())
   finally:
    recovery._close_temporary_file(actual_fd,path)
 def test_secure_temporary_file_acl_failure_cleans_empty_file(self):
  with tempfile.TemporaryDirectory() as raw:
   candidate=Path(raw)/"temporary"
   fd=recovery.os.open(candidate,recovery.os.O_CREAT|recovery.os.O_EXCL|recovery.os.O_RDWR,0o600)
   with patch.object(recovery.tempfile,"mkstemp",return_value=(fd,str(candidate))),patch.object(recovery.os,"name","nt"),patch.object(recovery,"_windows_restrict_temporary_file",side_effect=recovery.RecoveryError("ACL")):
    with self.assertRaisesRegex(recovery.RecoveryError,"ACL"): recovery._secure_temporary_file("unused",b"exact")
   self.assertFalse(candidate.exists())
 def test_posix_custodied_argument_cannot_be_replaced(self):
  if recovery.os.name=="nt": self.skipTest("POSIX descriptor custody assertion")
  fd,path=recovery._secure_temporary_file("g035-test-",b"exact")
  try:
   argument=recovery._custodied_argument(fd,path)
   self.assertFalse(path.exists())
   path.write_bytes(b"substituted")
   self.assertEqual(b"exact",Path(argument).read_bytes())
  finally:
   recovery._close_temporary_file(fd,path)
  self.assertTrue(path.exists())
 def test_detached_verification_passes_pinned_key_and_exact_payload_from_custodied_descriptors(self):
  with tempfile.TemporaryDirectory() as raw:
   signature=Path(raw)/"authorization.sig"; signature.write_bytes(b"signature"); signature.chmod(0o600)
   args=Namespace(authorization=str(Path(raw)/"authorization.json"),authorization_signature=str(signature))
   inspection={"receipt_sha256":"inspect","evidence":{}}; restored={"receipt_sha256":"restore","prior_receipt_sha256":["capture"]}
   def verify_contract(path,signature_path,**kwargs):
    kwargs["verify_detached"](b"exact payload",signature_path,contract.REMEDIATION_PUBLIC_KEY_PEM)
    return {}
   def openssl(argv,**kwargs):
    self.assertEqual(contract.REMEDIATION_PUBLIC_KEY_PEM.encode("ascii"),Path(argv[argv.index("-inkey")+1]).read_bytes())
    self.assertEqual(b"exact payload",Path(argv[argv.index("-in")+1]).read_bytes())
    self.assertEqual(b"signature",Path(argv[argv.index("-sigfile")+1]).read_bytes())
    if recovery.os.name=="posix": self.assertEqual(3,len(kwargs["pass_fds"]))
    else: self.assertEqual((),kwargs["pass_fds"])
   with patch.object(recovery,"_repository_commit",return_value="a"*40),patch.object(recovery,"verify_short_url_remediation_authorization",side_effect=verify_contract),patch.object(recovery,"run",side_effect=openssl),patch.object(recovery,"_restrictive",return_value=True):
    recovery._authorization(args,inspection,restored)
 def test_run_passes_custodied_descriptor_to_posix_child(self):
  if recovery.os.name!="posix" or not Path("/proc/self/fd").is_dir(): self.skipTest("POSIX procfs descriptor passing required")
  fd,path=recovery._secure_temporary_file("g035-test-",b"exact")
  try:
   argument=recovery._custodied_argument(fd,path)
   completed=recovery.run([sys.executable,"-c",f"import sys; print(open({argument!r},'rb').read().decode())"],env={},pass_fds=(fd,))
   self.assertEqual(b"exact\n",completed.stdout)
  finally:
   recovery._close_temporary_file(fd,path)
 def test_run_rejects_descriptor_passing_outside_posix(self):
  with patch.object(recovery.os,"name","nt"),self.assertRaisesRegex(recovery.RecoveryError,"descriptor passing unavailable"):
   recovery.run(["unused"],env={},pass_fds=(1,))
 def artifact(self,manifest,observed,**changes):
  data={"artifactVersion":2,"blockers":["clone-required","clone-backup-recovery-required"],"catalogChecked":True,"catalogFingerprint":observed["catalog_sha256"],"cloneApplyRisks":1,"cloneBackupRecoveryRequired":True,"hostedLedgerFingerprint":observed["ledger_sha256"],"manifestHash":contract.MANIFEST_SHA256,"preflightReceiptId":None,"prerequisites":{},"repositoryCommit":"a"*40,"requiredLaterPromotionGate":"20260713002500_g014_catalog_contract.sql","safeToApply":False,"sourceFingerprint":recovery._source_fingerprint(manifest),"sourceValid":True,"schemaVersion":1,"ledgerExpectedTerminal":"20260531084516","closureTerminalVersion":"20260713002400"}
  data.update(changes); data["preflightReceiptId"]=recovery._preflight_receipt(data); return data
 def adapter(self,data,observed):
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"artifact.json"; path.write_text(json.dumps(data),encoding="utf8")
   return recovery._g034_adapter(path,ROOT,contract.load_manifest(ROOT),observed,{"repository_commit":"a"*40,"runtime_source_root":"b"*64})
 def test_parser_has_only_local_modes_and_no_mutation_authorization(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertNotIn("hosted-apply",text); self.assertNotIn("pg_dumpall",text)
  for mode in ("validate","capture","restore-verify","clone-apply","local-postflight"): self.assertIn(mode,text)
 def test_public_production_capture_validates_sources_runs_capture_and_returns_verified_canonical_receipt(self):
  captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{"dump_sha256":"a"*64,"dump_bytes":7}}
  captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
  with tempfile.TemporaryDirectory() as raw:
   receipt=Path(raw)/"capture.json"; manifest=object()
   argv=["production-capture","--destination",raw,"--capture-receipt",str(receipt),"--service-file","/custody/service.conf","--recipient","age1"+"q"*58,"--g034-artifact","/custody/g034.json","--encrypt-command","age"]
   stream=io.StringIO()
   with patch.object(recovery,"validate_sources",return_value=manifest) as validate,patch.object(recovery,"run_capture",return_value=captured) as run_capture,patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)),contextlib.redirect_stdout(stream):
    self.assertEqual(0,recovery.main(argv))
   validate.assert_called_once_with(recovery.repository_root(Path(recovery.__file__).resolve()))
   run_capture.assert_called_once()
   self.assertEqual(recovery.canonical_bytes(captured),receipt.read_bytes())
   self.assertEqual(captured,json.loads(stream.getvalue()))
 def test_exact_current_receipt_and_live_fingerprints_are_required(self):
  manifest=contract.load_manifest(ROOT); observed={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}; data=self.artifact(manifest,observed)
  result=self.adapter(data,observed); self.assertIn("capture_readiness_sha256",result)
  self.assertEqual(data["sourceFingerprint"],recovery.digest({"closureMigrationHashes":[entry.sha256 for entry in manifest.migrations],"trackedApprovalSourceHash":recovery.g034_preflight.TRACKED_APPROVAL_SOURCE_SHA256}))
  for change in ({"preflightReceiptId":"0"*64},{"repositoryCommit":"b"*40},{"hostedLedgerFingerprint":"3"*64},{"catalogFingerprint":"4"*64}):
   forged=self.artifact(manifest,observed,**change)
   if "preflightReceiptId" in change: forged["preflightReceiptId"]=change["preflightReceiptId"]
   with self.assertRaisesRegex(recovery.RecoveryError,"readiness"): self.adapter(forged,observed)
 def test_only_recovery_blockers_are_allowed_and_fatal_blockers_rejected(self):
  manifest=contract.load_manifest(ROOT); observed={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}
  for blockers in (["catalog-prerequisite"], ["ledger-terminal"], ["ledger-terminal","clone-required","clone-backup-recovery-required"]):
   with self.subTest(blockers=blockers):
    self.adapter(self.artifact(manifest,observed,blockers=blockers),observed)
  for code in ("manifest-invalid","database-url-missing","catalog-read-failed","catalog-rollback-failed","other"):
   bad=self.artifact(manifest,observed,blockers=[code])
   with self.assertRaisesRegex(recovery.RecoveryError,"readiness"): self.adapter(bad,observed)
 def test_duplicate_or_extra_artifact_keys_are_rejected(self):
  manifest=contract.load_manifest(ROOT); observed={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}; data=self.artifact(manifest,observed)
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"artifact.json"; encoded=json.dumps(data); path.write_text(encoded[:-1]+',"extra":true}',encoding="utf8")
   with patch.object(recovery,"_repository_commit",return_value="a"*40),self.assertRaisesRegex(recovery.RecoveryError,"readiness"): recovery._g034_adapter(path,ROOT,manifest,observed)
 def test_g034_live_fingerprints_match_preflight_canonical_algorithms(self):
  terminal="20260531084516"
  with tempfile.TemporaryDirectory() as raw:
   artifact=Path(raw)/"artifact.json"; artifact.write_text(json.dumps({"ledgerExpectedTerminal":terminal}),encoding="utf8")
   def query(conn,sql,params=None):
    if "schema_migrations" in sql: return [(terminal,)]
    if "to_regclass('public.restaurants_backup')" in sql: return [(True,)]
    if "pg_class" in sql or "pg_proc" in sql: return [(True,)]
    if "pg_locks" in sql: return [(0,)]
    if "pg_roles" in sql: return [(3,)]
    raise AssertionError(sql)
   with patch.object(recovery,"_query_conn",side_effect=query):
    actual=recovery._g034_live_fingerprints(object(),artifact)
  prerequisites={"ledgerTerminalMatches":True,"publicRestaurants":True,"publicRestaurantsBackup":True,"storageObjects":True,"publicApproveSubmissionItem":True,"publicApproveEditSubmissionItem":True,"noWaitingLocks":True,"requiredRolesPresent":True}
  self.assertEqual({"ledger_sha256":recovery.digest([terminal]),"catalog_sha256":recovery.digest(prerequisites)},actual)
 def test_commit_is_git_rev_parse_output_not_git_head_hash(self):
  completed=subprocess.CompletedProcess([],0,"b"*40+"\n","")
  with patch.object(recovery.subprocess,"run",return_value=completed) as run:
   self.assertEqual("b"*40,recovery._repository_commit(ROOT))
  self.assertEqual(["git","-C",str(ROOT),"rev-parse","HEAD"],run.call_args.args[0])
 def test_dump_argv_includes_exact_application_managed_metadata_and_data_exclusion_scope(self):
  class Pipe:
   def close(self): pass
  class Process:
   stdin=Pipe()
   def wait(self,*unused): return 0
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery.subprocess,"Popen",side_effect=(Process(),Process())) as popen,patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)):
   argv=recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},Path(raw))[0]
  self.assertEqual(["pg_dump","--format=custom","--snapshot=snapshot","--blobs",*[f"--schema={schema}" for schema in [*contract.APPLICATION_SCHEMAS,"supabase_migrations","auth","storage"]],"--exclude-table-data=auth.*","--exclude-table-data=storage.*","--extension=pg_trgm","--extension=uuid-ossp","--extension=btree_gin","--extension=vector","--extension=pgcrypto","--dbname=service=g035"],argv)
  self.assertEqual((("pg_trgm","extensions"),("uuid-ossp","extensions"),("btree_gin","extensions"),("vector","public"),("pgcrypto","extensions")),recovery.RECOVERY_EXTENSIONS)
  self.assertEqual(("auth","storage"),contract.MANAGED_METADATA_SCHEMAS)
  self.assertEqual(("--exclude-table-data=auth.*","--exclude-table-data=storage.*"),recovery.MANAGED_TABLE_DATA_EXCLUSIONS)
  self.assertEqual(argv,popen.call_args_list[1].args[0])
 def test_windows_publication_is_no_replace_verified_and_cleanup_safe(self):
  def publish(label,*,existing=None,substitute=False,cleanup=True):
   with tempfile.TemporaryDirectory() as raw:
    parent=Path(raw); temporary=parent/"temporary"; target=parent/"final"; fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600); os.write(fd,b"exact"); identity=(os.fstat(fd).st_dev,os.fstat(fd).st_ino)
    if existing is not None: target.write_bytes(existing)
    def link(source,final):
     if final.exists(): raise recovery.RecoveryError("Windows no-replace publication failed")
     os.link(temporary,final)
     if substitute: final.unlink(); final.write_bytes(b"substituted")
    def reopen(path,expected,digest_value,size,unused_label):
     candidate=os.open(path,os.O_RDONLY)
     if (os.fstat(candidate).st_dev,os.fstat(candidate).st_ino)!=expected: os.close(candidate); raise recovery.RecoveryError("publication invalid")
     return candidate
    removals=[]
    def remove(path,expected):
     removals.append(path)
     if not cleanup and len(removals)==1: return False
     if not recovery._same_path_identity(path,expected): return False
     path.unlink()
     return True
    try:
     with patch.object(recovery.os,"name","nt"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_windows_link_no_replace",side_effect=link),patch.object(recovery,"_windows_reopen_verified_output",side_effect=reopen),patch.object(recovery,"_windows_remove_exact",side_effect=remove):
      with self.assertRaises(recovery.RecoveryError) if existing is not None or substitute or not cleanup else contextlib.nullcontext():
       result=recovery._publish_owned_output(fd,temporary,target,identity,label)
       fd=result[3]
     return target.exists(),target.read_bytes() if target.exists() else None
    finally:
     try: os.close(fd)
     except OSError: pass
  for label in ("encrypted archive","capture receipt"):
   exists,contents=publish(label)
   self.assertTrue(exists); self.assertEqual(b"exact",contents)
  self.assertEqual((True,b"existing"),publish("encrypted archive",existing=b"existing"))
  self.assertEqual((True,b"substituted"),publish("capture receipt",substitute=True))
  self.assertEqual((False,None),publish("encrypted archive",cleanup=False))
 def test_windows_reopen_declares_typed_delete_sharing(self):
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertIn("create_file.argtypes=(ctypes.c_wchar_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p)",source)
  self.assertIn("create_file.restype=ctypes.c_void_p",source)
  self.assertIn("create_file(str(path),0x80000000,0x00000007,None,3,0x00200000,None)",source)
  self.assertIn("handle=create_file(str(path),0x80010080,0x00000007,None,3,0x00200000,None)",source)
  self.assertIn("extended=DispositionInfoEx(0x00000013)",source)
  self.assertIn("disposition(handle,21,ctypes.byref(extended),ctypes.sizeof(extended))",source)
 def test_windows_handle_delete_simulation_preserves_replacement(self):
  with tempfile.TemporaryDirectory() as raw:
   target=Path(raw)/"target"; original=Path(raw)/"original"; original.write_bytes(b"original"); os.link(original,target)
   fd=os.open(original,os.O_RDONLY); identity=(os.fstat(fd).st_dev,os.fstat(fd).st_ino)
   def replace_then_mark(unused):
    target.unlink(); target.write_bytes(b"replacement"); return True
   with patch.object(recovery,"_windows_open_delete_handle",return_value=fd),patch.object(recovery,"_windows_handle_is_regular_nonreparse",return_value=True),patch.object(recovery,"_same_file_identity",return_value=True),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_windows_mark_handle_delete_pending",side_effect=replace_then_mark):
    self.assertTrue(recovery._windows_remove_exact(target,identity))
   self.assertEqual(b"replacement",target.read_bytes())
 @unittest.skipUnless(os.name=="nt","native Windows handle semantics required")
 def test_windows_handle_delete_replacement_race_preserves_replacement(self):
  with tempfile.TemporaryDirectory() as raw:
   target=Path(raw)/"target"; target.write_bytes(b"original"); identity=(target.stat().st_dev,target.stat().st_ino); mark=recovery._windows_mark_handle_delete_pending
   def replace_then_mark(fd):
    target.unlink(); target.write_bytes(b"replacement"); return mark(fd)
   with patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_windows_mark_handle_delete_pending",side_effect=replace_then_mark):
    recovery._windows_remove_exact(target,identity)
   self.assertEqual(b"replacement",target.read_bytes())
 @unittest.skipUnless(os.name=="nt","native Windows handle semantics required")
 def test_windows_reopen_allows_sibling_hard_link_deletion_while_held(self):
  with tempfile.TemporaryDirectory() as raw:
   temporary=Path(raw)/"temporary"; target=Path(raw)/"target"
   fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
   try:
    os.write(fd,b"exact"); identity=(os.fstat(fd).st_dev,os.fstat(fd).st_ino); os.link(temporary,target); os.close(fd); fd=None
    with patch.object(recovery,"_restrictive",return_value=True):
     reopened=recovery._windows_reopen_verified_output(target,identity,hashlib.sha256(b"exact").hexdigest(),5,"test")
    try:
     temporary.unlink()
     self.assertEqual(b"exact",target.read_bytes())
    finally: os.close(reopened)
   finally:
    if fd is not None: os.close(fd)
 def test_owned_outputs_ignore_umask_and_preserve_preexisting_archive(self):
  if recovery.os.name=="nt": self.skipTest("POSIX mode assertion")
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw); output=destination/"g035-dump.enc"; output.write_bytes(b"existing")
   with patch.object(recovery.subprocess,"Popen") as popen,self.assertRaisesRegex(recovery.RecoveryError,"database capture failed"):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},destination)
   self.assertEqual(b"existing",output.read_bytes()); popen.assert_not_called()
   old=os.umask(0o777)
   try:
    fd,identity=recovery._owned_output(destination/"new.enc","test")
   finally: os.umask(old)
   try: self.assertEqual(0o600,os.fstat(fd).st_mode&0o777)
   finally: recovery._unlink_owned_output(fd,destination/"new.enc",identity); os.close(fd)
 def test_archive_cleanup_preserves_replacement_and_reaps_stderr_failure(self):
  if recovery.os.name=="nt": self.skipTest("replacement inode assertion requires POSIX unlink semantics")
  class Pipe:
   def close(self): pass
  class Process:
   def __init__(self,code): self.stdin=Pipe(); self.returncode=code; self.communicated=False; self.terminated=False; self.waited=0
   def communicate(self): self.communicated=True; return b"",b"x"*10000
   def poll(self): return None
   def terminate(self): self.terminated=True
   def wait(self,timeout=None): self.waited+=1; return self.returncode
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw); crypt,dump=Process(0),Process(1)
   def replace(*unused):
    output=destination/"g035-dump.enc"; output.unlink(); output.write_bytes(b"replacement")
    raise recovery.RecoveryError("failed")
   with patch.object(recovery.subprocess,"Popen",side_effect=(crypt,dump)),patch.object(recovery,"_drain_pipeline",side_effect=replace),self.assertRaisesRegex(recovery.RecoveryError,"database capture failed"):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},destination)
   self.assertEqual(b"replacement",(destination/"g035-dump.enc").read_bytes())
   self.assertTrue(crypt.terminated); self.assertTrue(dump.terminated); self.assertGreater(crypt.waited,0); self.assertGreater(dump.waited,0)
 def test_pipeline_drains_saturated_stderr_before_reaping_failure(self):
  class Pipe:
   def close(self): pass
  class Process:
   def __init__(self,code): self.stdin=Pipe(); self.stderr=io.BytesIO(b"x"*10000); self.returncode=code; self.communicated=False; self.terminated=False; self.waited=0
   def communicate(self): self.communicated=True; raise AssertionError("stderr must be drained incrementally")
   def poll(self): return None
   def terminate(self): self.terminated=True
   def wait(self,timeout=None): self.waited+=1; return self.returncode
  with tempfile.TemporaryDirectory() as raw:
   crypt,dump=Process(0),Process(1)
   with patch.object(recovery.subprocess,"Popen",side_effect=(crypt,dump)),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"database capture failed"):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},Path(raw))
   self.assertFalse(crypt.communicated); self.assertFalse(dump.communicated); self.assertEqual(b"",crypt.stderr.read()); self.assertEqual(b"",dump.stderr.read())
   self.assertTrue(crypt.terminated); self.assertTrue(dump.terminated)
   self.assertGreater(crypt.waited,0); self.assertGreater(dump.waited,0)
 def test_pipeline_concurrently_drains_blocking_stderr_and_reaps_success(self):
  class Pipe:
   def __init__(self,ready,peer): self.ready=ready; self.peer=peer; self.payload=b"x"*10000
   def read(self,size):
    self.ready.set()
    if not self.peer.wait(2): raise AssertionError("stderr streams were not drained concurrently")
    result,self.payload=self.payload,b""
    return result
   def close(self): pass
  class Process:
   def __init__(self,code,ready,peer): self.stdin=Pipe(threading.Event(),threading.Event()); self.stderr=Pipe(ready,peer); self.returncode=code; self.terminated=False; self.waited=0
   def poll(self): return None
   def terminate(self): self.terminated=True
   def wait(self,timeout=None): self.waited+=1; return self.returncode
  first,second=threading.Event(),threading.Event(); crypt,dump=Process(0,first,second),Process(0,second,first)
  def popen(argv,**kwargs):
   if argv[0]=="age": kwargs["stdout"].write(b"complete"); return crypt
   return dump
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery.subprocess,"Popen",side_effect=popen),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)):
   recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},Path(raw))
   self.assertEqual(b"complete",(Path(raw)/"g035-dump.enc").read_bytes())
  for process in (crypt,dump):
   self.assertTrue(process.stderr.ready.is_set()); self.assertFalse(process.terminated); self.assertGreater(process.waited,0)
 def test_archive_is_fsynced_before_atomic_no_clobber_publication(self):
  class Pipe:
   def read(self,size): return b""
   def close(self): pass
  class Process:
   def __init__(self): self.stdin=Pipe(); self.stderr=Pipe(); self.returncode=0
   def poll(self): return 0
   def wait(self,timeout=None): return 0
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw); crypt,dump=Process(),Process(); original_fsync=os.fsync; original_link=os.link; observed=[]
   def fsync(fd):
    temporary=next(destination.glob(".g035-dump.enc.*.tmp"),None)
    if temporary is not None and os.fstat(fd).st_ino==temporary.stat().st_ino:
     observed.append(temporary.read_bytes()); self.assertFalse((destination/"g035-dump.enc").exists())
     if recovery.os.name!="nt": self.assertEqual(0o600,temporary.stat().st_mode&0o777)
    return original_fsync(fd)
   def link(temporary,target,**kwargs):
    self.assertEqual([b"complete"],observed); self.assertFalse(target.exists())
    return original_link(temporary,target,**kwargs)
   def popen(argv,**kwargs):
    if argv[0]=="age": kwargs["stdout"].write(b"complete"); return crypt
    return dump
   with patch.object(recovery.subprocess,"Popen",side_effect=popen),patch.object(recovery.os,"fsync",side_effect=fsync),patch.object(recovery.os,"link",side_effect=link),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},destination)
   self.assertEqual(b"complete",(destination/"g035-dump.enc").read_bytes())
 def test_archive_atomic_no_clobber_preserves_racing_existing_final(self):
  class Pipe:
   def read(self,size): return b""
   def close(self): pass
  class Process:
   def __init__(self): self.stdin=Pipe(); self.stderr=Pipe(); self.returncode=0; self.terminated=False; self.waited=0
   def poll(self): return None
   def terminate(self): self.terminated=True
   def wait(self,timeout=None): self.waited+=1; return self.returncode
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw); crypt,dump=Process(),Process(); original_link=os.link
   def link(temporary,target,**kwargs):
    target.write_bytes(b"existing")
    if recovery.os.name=="nt": raise recovery.RecoveryError("Windows no-replace publication failed")
    return original_link(temporary,target,**kwargs)
   def popen(argv,**kwargs):
    if argv[0]=="age": kwargs["stdout"].write(b"complete"); return crypt
    return dump
   publisher=patch.object(recovery if recovery.os.name=="nt" else recovery.os,"_windows_link_no_replace" if recovery.os.name=="nt" else "link",side_effect=link)
   with patch.object(recovery.subprocess,"Popen",side_effect=popen),publisher,patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"database capture failed"):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},destination)
   self.assertEqual(b"existing",(destination/"g035-dump.enc").read_bytes())
   self.assertTrue(crypt.terminated); self.assertTrue(dump.terminated); self.assertGreater(crypt.waited,0); self.assertGreater(dump.waited,0)
 def test_pipeline_timeout_reaps_both_children(self):
  class Process:
   def __init__(self): self.release=threading.Event(); self.terminated=False; self.waited=0; self.returncode=0
   def communicate(self): self.release.wait(); return b"",b""
   def poll(self): return None
   def terminate(self): self.terminated=True; self.release.set()
   def wait(self,timeout=None): self.waited+=1; return 0
  processes=(Process(),Process())
  with self.assertRaisesRegex(recovery.RecoveryError,"database capture failed"):
   recovery._drain_pipeline(processes,time.monotonic()-1)
  for process in processes: self.assertTrue(process.terminated); self.assertGreater(process.waited,0)
 def test_capture_receipt_is_fsynced_before_atomic_no_clobber_publication(self):
  captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{}}
  captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
  with tempfile.TemporaryDirectory() as raw:
   target=Path(raw)/"capture.json"; args=Namespace(capture_receipt=str(target)); payload=recovery.canonical_bytes(captured); original_fsync=os.fsync; original_link=os.link; observed=[]
   def fsync(fd):
    temporary=next(Path(raw).glob(".capture.json.*.tmp"),None)
    if temporary is not None and os.fstat(fd).st_ino==temporary.stat().st_ino:
     observed.append(temporary.read_bytes()); self.assertFalse(target.exists())
     if recovery.os.name!="nt": self.assertEqual(0o600,temporary.stat().st_mode&0o777)
    return original_fsync(fd)
   def link(temporary,final,**kwargs):
    self.assertEqual([payload],observed); self.assertFalse(final.exists())
    return original_link(temporary,final,**kwargs)
   with patch.object(recovery,"run_capture",return_value=captured),patch.object(recovery,"repository_root",return_value=Path("C:/repository")),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery.os,"fsync",side_effect=fsync),patch.object(recovery.os,"link",side_effect=link),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)):
    self.assertEqual(captured,recovery.capture_to_custody(args,object()))
   self.assertEqual(payload,target.read_bytes())
 def test_capture_receipt_cleanup_preserves_replacement(self):
  if recovery.os.name=="nt": self.skipTest("replacement inode assertion requires POSIX unlink semantics")
  captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{}}
  captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
  with tempfile.TemporaryDirectory() as raw:
   target=Path(raw)/"capture.json"; args=Namespace(capture_receipt=str(target))
   def replace(path):
    target.unlink(); target.write_bytes(b"replacement")
    raise recovery.RecoveryError("durability")
   with patch.object(recovery,"run_capture",return_value=captured),patch.object(recovery,"repository_root",return_value=Path("C:/repository")),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_fsync_parent",side_effect=replace),self.assertRaisesRegex(recovery.RecoveryError,"capture receipt persistence invalid"):
    recovery.capture_to_custody(args,object())
   self.assertEqual(b"replacement",target.read_bytes())
 def test_capture_receipt_failure_rolls_back_matching_archive_and_receipt(self):
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw)/"archive"; destination.mkdir(); archive=destination/"g035-dump.enc"; archive.write_bytes(b"captured")
   identity=(archive.stat().st_dev,archive.stat().st_ino)
   captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{"dump_identity":{"device":identity[0],"inode":identity[1]}}}
   captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
   target=Path(raw)/"capture.json"; args=Namespace(capture_receipt=str(target),destination=str(destination))
   with patch.object(recovery,"run_capture",return_value=captured),patch.object(recovery,"repository_root",return_value=Path("C:/repository")),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_publish_owned_output",side_effect=recovery.RecoveryError("publication")):
    with self.assertRaisesRegex(recovery.RecoveryError,"capture receipt persistence invalid"): recovery.capture_to_custody(args,object())
   self.assertFalse(archive.exists()); self.assertFalse(target.exists())
 def test_capture_receipt_failure_preserves_substituted_archive(self):
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw)/"archive"; destination.mkdir(); archive=destination/"g035-dump.enc"; archive.write_bytes(b"captured")
   identity=(archive.stat().st_dev,archive.stat().st_ino)
   captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{"dump_identity":{"device":identity[0],"inode":identity[1]}}}
   captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
   target=Path(raw)/"capture.json"; args=Namespace(capture_receipt=str(target),destination=str(destination))
   def substitute(*unused):
    archive.unlink(); archive.write_bytes(b"substituted")
    raise recovery.RecoveryError("publication")
   with patch.object(recovery,"run_capture",return_value=captured),patch.object(recovery,"repository_root",return_value=Path("C:/repository")),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_publish_owned_output",side_effect=substitute):
    with self.assertRaisesRegex(recovery.RecoveryError,"capture receipt persistence invalid"): recovery.capture_to_custody(args,object())
   self.assertEqual(b"substituted",archive.read_bytes()); self.assertFalse(target.exists())
 def test_capture_receipt_verification_failure_rolls_back_archive_and_receipt(self):
  with tempfile.TemporaryDirectory() as raw:
   destination=Path(raw)/"archive"; destination.mkdir(); archive=destination/"g035-dump.enc"; archive.write_bytes(b"captured")
   identity=(archive.stat().st_dev,archive.stat().st_ino)
   captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{"dump_identity":{"device":identity[0],"inode":identity[1]}}}
   captured["receipt_sha256"]=recovery.digest({key:value for key,value in captured.items() if key!="receipt_sha256"})
   target=Path(raw)/"capture.json"; args=Namespace(capture_receipt=str(target),destination=str(destination))
   with patch.object(recovery,"run_capture",return_value=captured),patch.object(recovery,"repository_root",return_value=Path("C:/repository")),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery.json,"loads",side_effect=ValueError("verification")):
    with self.assertRaisesRegex(recovery.RecoveryError,"capture receipt persistence invalid"): recovery.capture_to_custody(args,object())
   self.assertFalse(archive.exists()); self.assertFalse(target.exists())
 def test_dump_rejects_snapshot_option_injection(self):
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery.subprocess,"Popen") as popen:
   with self.assertRaisesRegex(recovery.RecoveryError,"invalid snapshot"):
    recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"--schema=auth",{},Path(raw))
  popen.assert_not_called()
 def test_capture_binds_readiness_inside_snapshot_connection(self):
  class Conn:
   def __init__(self): self.events=[]
   def cursor(self): return self
   def __enter__(self): return self
   def __exit__(self,*x): pass
   def execute(self,sql,params=None): self.events.append(sql)
   @property
   def description(self): return None if self.events[-1].startswith("BEGIN") else ("rowset",)
   def fetchall(self): return [("snapshot",)]
   def rollback(self): self.events.append("ROLLBACK")
   def close(self): self.events.append("CLOSE")
  conn=Conn(); manifest=contract.load_manifest(ROOT); observed=fingerprints()
  with tempfile.TemporaryDirectory() as raw:
   dest=Path(raw)/"out"; dest.mkdir(); artifact=Path(raw)/"ok.json"; artifact.write_text(json.dumps(self.artifact(manifest,{"ledger_sha256":"1"*64,"catalog_sha256":"2"*64})),encoding="utf8")
   recipient="age19ae5mjee5z9djp8fvvecpr8ll2xdap3k9n2yucyhdy8xy5ujhywsl5zek2"
   args=Namespace(destination=str(dest),service_file=str(self.service(raw,"g035")),recipient=recipient,g034_artifact=str(artifact),pg_dump="pg_dump",encrypt_command="age")
   def dump(*values):
    self.assertNotIn("ROLLBACK",conn.events); self.assertEqual(recipient,values[2]); output=dest/"g035-dump.enc"; output.write_bytes(b"x"); info=output.stat(); return [],hashlib.sha256(b"x").hexdigest(),1,(info.st_dev,info.st_ino)
   with patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"command_exists",side_effect=lambda x:x),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"_fingerprints",return_value=observed),patch.object(recovery,"_target_fingerprint",return_value="f"*64) as target,patch.object(recovery,"_g034_live_fingerprints",return_value={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}),patch.object(recovery,"_recovery_source_binding",return_value={"repository_commit":"a"*40,"runtime_source_root":"b"*64}),patch.object(recovery,"_dump_to_encrypted",side_effect=dump):
    result=recovery.run_capture(args,manifest)
  self.assertEqual(hashlib.sha256(recipient.encode("utf-8")).hexdigest(),result["evidence"]["recipient_fingerprint"])
  self.assertEqual("f"*64,result["evidence"]["target_fingerprint"]); target.assert_called_once_with(conn)
  self.assertNotIn(recipient,json.dumps(result))
  self.assertLess(conn.events.index("SELECT pg_export_snapshot()"),conn.events.index("ROLLBACK"))
  self.assertEqual(list(contract.APPLICATION_SCHEMAS),result["evidence"]["schema_scope"])
  self.assertEqual(["supabase_migrations"],result["evidence"]["recovery_control_schema_scope"])
  self.assertEqual([{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],result["evidence"]["extension_scope"])
  self.assertEqual(["auth","storage"],result["evidence"]["managed_metadata_schema_scope"])
  self.assertEqual(["--exclude-table-data=auth.*","--exclude-table-data=storage.*"],result["evidence"]["managed_table_data_exclusions"])
  self.assertEqual(observed["ledger_pairs"],result["evidence"]["ledger_pairs"])
  self.assertEqual(observed["managed_catalog_sha256"],result["evidence"]["managed_catalog_sha256"])
 def test_connect_binds_servicefile_without_global_environment_mutation(self):
  import types
  with tempfile.TemporaryDirectory() as raw:
   servicefile=Path(raw)/"pg_service.conf"
   servicefile.write_text("[g035]\nhost=remote.example\nport=5432\ndbname=source\nuser=operator\npassword=private\nsslmode=require\n",encoding="utf8")
   env={"PGSERVICEFILE":str(servicefile)}
   connect=lambda **kwargs: kwargs
   with patch.dict(recovery.os.environ,{"PGSERVICEFILE":"original"},clear=False),patch.dict(sys.modules,{"psycopg":types.SimpleNamespace(connect=connect)}):
    self.assertEqual({"host":"remote.example","port":"5432","dbname":"source","user":"operator","password":"private","sslmode":"require","autocommit":True},recovery._connect("g035",env))
    self.assertEqual("original",recovery.os.environ["PGSERVICEFILE"])
   servicefile.write_text("[g035]\nhost=remote.example\nservice=other\n",encoding="utf8")
   with patch.dict(sys.modules,{"psycopg":types.SimpleNamespace(connect=connect)}),self.assertRaisesRegex(recovery.RecoveryError,"invalid service file"):
    recovery._connect("g035",env)
   servicefile.write_text("[g035]\nhost=one\nhost=two\n",encoding="utf8")
   with patch.dict(sys.modules,{"psycopg":types.SimpleNamespace(connect=connect)}),self.assertRaisesRegex(recovery.RecoveryError,"invalid service file"):
    recovery._connect("g035",env)
  with self.assertRaisesRegex(recovery.RecoveryError,"database connection unavailable"):
   recovery._connect("g035",{})
 def test_query_errors_are_bounded(self):
  class Cursor:
   def __enter__(self): return self
   def __exit__(self,*unused): pass
   def execute(self,*unused): raise RuntimeError("private database failure")
  class Conn:
   def cursor(self): return Cursor()
  with self.assertRaisesRegex(recovery.RecoveryError,"database query unavailable"):
   recovery._query_conn(Conn(),"SELECT secret")
 def test_query_without_rowset_returns_empty_list(self):
  class Cursor:
   description=None
   def __enter__(self): return self
   def __exit__(self,*unused): pass
   def execute(self,*unused): pass
   def fetchall(self): raise AssertionError("fetchall called without rowset")
  class Conn:
   def cursor(self): return Cursor()
  self.assertEqual([],recovery._query_conn(Conn(),"BEGIN"))
 def test_capture_rejects_invalid_or_unapproved_age_recipients_before_commands(self):
  with tempfile.TemporaryDirectory() as raw:
   dest=Path(raw)/"out"; dest.mkdir()
   for recipient in ("a"*64,"AGE1"+"q"*58,"age1"+"q"*57,"age1"+"q"*58+" ","age1"+"q"*57+"b","age1"+"q"*58+"--recipient=x","age1"+"q"*58):
    args=Namespace(destination=str(dest),service_file="unused",recipient=recipient,g034_artifact="unused",pg_dump="pg_dump",encrypt_command="age")
    with self.assertRaisesRegex(recovery.RecoveryError,"invalid encryption recipient"),patch.object(recovery,"command_exists") as commands:
     recovery.run_capture(args,None)
    commands.assert_not_called()
 def test_restore_verify_requires_identity_file_argument(self):
  with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
   recovery.parser().parse_args(["restore-verify","--dump","dump","--capture-receipt","capture","--service-file","service","--destination-service","g035-local","--decrypt-command","age"])
 def test_identity_file_requires_restrictive_regular_nonsymlink_file(self):
  with tempfile.TemporaryDirectory() as raw:
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   with patch.object(recovery,"_restrictive",return_value=True): recovery._require_restrictive_regular_file(identity,"identity file")
   with patch.object(recovery,"_restrictive",return_value=False),self.assertRaisesRegex(recovery.RecoveryError,"identity file"):
    recovery._require_restrictive_regular_file(identity,"identity file")
   with patch.object(Path,"is_symlink",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"identity file"):
    recovery._require_restrictive_regular_file(identity,"identity file")
 def test_restore_verify_uses_identity_without_receipting_or_disclosing_it(self):
  class Conn:
   def commit(self): pass
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints(managed_catalog_sha256="4"*64)
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"offline-identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**observed}}
   def execute(argv,**unused):
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute) as execute,patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_create_auth_user_placeholders"),patch.object(recovery,"_fingerprints",return_value=observed):
    result=recovery.run_restore_verify(args,None)
  decrypt_argv=execute.call_args_list[0].args[0]
  self.assertEqual(["age","--decrypt","--identity",str(identity),"--output",decrypt_argv[5],str(dump)],decrypt_argv)
  self.assertNotIn(str(identity),json.dumps(result))
  self.assertNotIn("test-key-material",json.dumps(result))
  self.assertFalse(Path(decrypt_argv[5]).exists())
  self.assertEqual("4"*64,result["evidence"]["managed_catalog_sha256"])
  self.assertNotIn("hosted_managed_catalog_sha256",result["evidence"])
  self.assertEqual("managed schema DDL restored with hosted catalog parity; managed table data excluded",result["evidence"]["managed_metadata_coherence"])
 def test_auth_placeholder_contract_is_exact_bounded_and_never_contains_managed_data(self):
  expected=(("public","ad_banners","created_by"),("public","admin_restaurant_map_overlays","created_by_admin_id"),("public","admin_restaurant_map_overlays","updated_by_admin_id"),("public","admin_user_preferences","user_id"),("public","announcements","created_by"),("public","documents","user_id"),("public","notifications","user_id"),("public","ocr_logs","user_id"),("public","profiles","user_id"),("public","restaurant_requests","user_id"),("public","restaurant_submissions","resolved_by_admin_id"),("public","restaurant_submissions","user_id"),("public","review_likes","user_id"),("public","reviews","edited_by_admin_id"),("public","reviews","user_id"),("public","search_logs","user_id"),("public","user_account_status","user_id"),("public","user_bookmarks","user_id"),("public","user_roles","user_id"),("public","user_stats","user_id"))
  self.assertEqual(expected,recovery.AUTH_USER_REFERENCE_COLUMNS)
  evidence=recovery._auth_placeholder_evidence()
  self.assertEqual({"auth_placeholder_mapping_count":20,"auth_placeholder_mapping_sha256":"b8c180d2ddae2aa409e76889015220cbe18504af42fcd2abeb3f28bcf6ffd266"},evidence)
  self.assertNotIn("auth.users",json.dumps(evidence)); self.assertNotIn("email",json.dumps(evidence)); self.assertNotIn("token",json.dumps(evidence))
 def test_auth_placeholders_deduplicate_source_ids_and_include_bookmark_only_users_before_post_data(self):
  calls=[]
  def query(conn,sql,params=None):
   calls.append((sql,params))
   if "pg_catalog.pg_attribute" in sql: return [(*params,"uuid","pg_catalog")]
   if sql=="SELECT NOT EXISTS (SELECT 1 FROM auth.users)": return [(True,)]
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   recovery._create_auth_user_placeholders(object())
  self.assertEqual(22,len(calls))
  empty_check=calls[-2][0]; insert=calls[-1][0]
  self.assertEqual("SELECT NOT EXISTS (SELECT 1 FROM auth.users)",empty_check)
  self.assertIn("INSERT INTO auth.users (id)",insert); self.assertIn("SELECT DISTINCT id",insert); self.assertIn(" UNION ALL ",insert)
  self.assertNotIn("ON CONFLICT",insert); self.assertNotIn("email",insert); self.assertNotIn("token",insert); self.assertNotIn("metadata",insert)
  self.assertIn("SELECT user_bookmarks.user_id AS id FROM public.user_bookmarks WHERE user_bookmarks.user_id IS NOT NULL",insert)
  def missing(conn,sql,params=None):
   if "pg_catalog.pg_attribute" in sql: return [] if params==recovery.AUTH_USER_REFERENCE_COLUMNS[-1] else [(*params,"uuid","pg_catalog")]
   raise AssertionError("empty check must follow all mapping checks")
  def drifted(conn,sql,params=None):
   return [(*params,"text","pg_catalog")]
  with patch.object(recovery,"_query_conn",side_effect=missing),self.assertRaisesRegex(recovery.RecoveryError,"mapping drift"):
   recovery._create_auth_user_placeholders(object())
  with patch.object(recovery,"_query_conn",side_effect=drifted),self.assertRaisesRegex(recovery.RecoveryError,"mapping drift"):
   recovery._create_auth_user_placeholders(object())
  collision_calls=[]
  def nonempty(conn,sql,params=None):
   collision_calls.append(sql)
   if "pg_catalog.pg_attribute" in sql: return [(*params,"uuid","pg_catalog")]
   if sql=="SELECT NOT EXISTS (SELECT 1 FROM auth.users)": return [(False,)]
   raise AssertionError("must not insert into a nonempty auth.users target")
  with patch.object(recovery,"_query_conn",side_effect=nonempty),self.assertRaisesRegex(recovery.RecoveryError,"target is not empty"):
   recovery._create_auth_user_placeholders(object())
  self.assertNotIn("INSERT INTO auth.users",collision_calls)
 def test_restore_uses_fenced_pre_data_placeholder_post_data_phases_and_fails_each_phase(self):
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints()
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   connections=[]
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS],**self.managed_capture_scope(),**observed}}
   for failing_section in (None,"pre-data","data","post-data"):
    events=[]
    def execute(argv,**unused):
     if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
     else:
      section=argv[1].removeprefix("--section=")
      events.append(section)
      if section==failing_section: raise recovery.RecoveryError("external command failed")
    def query(conn,sql,params=None):
     if sql.startswith("DROP SCHEMA "): events.append(sql)
     return []
    with patch.object(recovery,"_copy_local_service",side_effect=lambda *unused: events.append("fence") or Path(raw)/"service.conf"),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery,"_connect",side_effect=lambda *unused: connections.append(Conn()) or connections[-1]),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_create_auth_user_placeholders",side_effect=lambda conn: events.append("placeholders")),patch.object(recovery,"_fingerprints",return_value=observed):
     if failing_section:
      with self.assertRaisesRegex(recovery.RecoveryError,"external command failed"): recovery.run_restore_verify(args,None)
     else:
      recovery.run_restore_verify(args,None)
    reset=["fence","DROP SCHEMA IF EXISTS g035_recovery_control CASCADE","DROP SCHEMA IF EXISTS public CASCADE","DROP SCHEMA IF EXISTS auth CASCADE","DROP SCHEMA IF EXISTS storage CASCADE"]
    if failing_section=="pre-data": expected=reset+["pre-data"]
    elif failing_section=="data": expected=reset+["pre-data","data"]
    else: expected=reset+["pre-data","data","placeholders","post-data"]
    self.assertEqual(expected,events)
    self.assertGreaterEqual(sum(conn.commits for conn in connections),1)
 def test_restore_rejects_ledger_pair_mutation(self):
  class Conn:
   def commit(self): pass
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints(pairs=(("20260101000000","actual"),))
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**{**observed,"ledger_pairs":[("20260101000000","mutated")]}}}
   def execute(argv,**unused):
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_create_auth_user_placeholders"),patch.object(recovery,"_fingerprints",return_value=observed),self.assertRaisesRegex(recovery.RecoveryError,"restore evidence mismatch"):
    recovery.run_restore_verify(args,None)
 def test_ledger_pairs_normalize_json_lists_but_reject_type_mutation(self):
  pairs=(("20260101000000","actual"),)
  self.assertTrue(recovery._ledger_evidence_equal([list(pair) for pair in pairs],pairs))
  self.assertFalse(recovery._ledger_evidence_equal([["20260101000000",1]],pairs))
 def test_managed_metadata_schemas_normalize_json_lists_but_reject_order_or_value_mutation(self):
  expected=list(contract.MANAGED_METADATA_SCHEMAS)
  observed=tuple(contract.MANAGED_METADATA_SCHEMAS)
  self.assertTrue(recovery._managed_metadata_schemas_equal(expected,observed))
  self.assertFalse(recovery._managed_metadata_schemas_equal(list(reversed(expected)),observed))
  self.assertFalse(recovery._managed_metadata_schemas_equal([*expected[:-1],"unexpected"],observed))
 def test_fingerprints_split_restorable_and_managed_catalog_scopes(self):
  calls=[]
  def query(conn,sql,params=None):
   calls.append((sql,params))
   if "schema_migrations" in sql: return [("20260101000000","actual")]
   if "pg_namespace" in sql: return [("auth",),("storage",)]
   return [("public","restaurants","r")]
  with patch.object(recovery,"_query_conn",side_effect=query):
   actual=recovery._fingerprints(object())
  self.assertEqual((("20260101000000","actual"),),actual["ledger_pairs"])
  self.assertIn("restorable_catalog_sha256",actual); self.assertIn("managed_catalog_sha256",actual)
  self.assertNotIn("catalog_sha256",actual)
  self.assertEqual(list(recovery.DUMP_SCHEMAS),calls[1][1][0])
  self.assertEqual(list(contract.MANAGED_METADATA_SCHEMAS),calls[2][1][0])
 def test_restore_rejects_missing_or_mutated_extension_scope_before_local_reset(self):
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[]}}
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
    recovery.run_restore_verify(args,None)
  connect.assert_not_called(); run.assert_not_called()
 def test_restore_rejects_missing_or_mutated_managed_data_exclusions_before_local_reset(self):
  with tempfile.TemporaryDirectory() as raw:
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(Path(raw)/"missing.enc"),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   extension_scope=[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS]
   for exclusions in (None,["--exclude-table-data=auth.*"],["--exclude-table-data=storage.*","--exclude-table-data=auth.*"],["--exclude-table-data=auth.*","--exclude-table-data=storage.tables"]):
    evidence={"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"extension_scope":extension_scope,"managed_metadata_schema_scope":["auth","storage"]}
    if exclusions is not None: evidence["managed_table_data_exclusions"]=exclusions
    capture={"receipt_sha256":"capture-receipt","evidence":evidence}
    with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
     recovery.run_restore_verify(args,None)
    connect.assert_not_called(); run.assert_not_called()
 def test_restore_fences_local_destination_before_public_reset_and_restore_errors_are_fatal(self):
  events=[]
  class Conn:
   def commit(self): events.append("commit")
   def rollback(self): events.append("rollback")
   def close(self): events.append("close")
  observed=fingerprints()
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="hosted",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   with patch.object(recovery,"_connect") as connect,patch.object(recovery,"_query_conn") as query,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"limited"):
    recovery.run_restore_verify(args,None)
  connect.assert_not_called(); query.assert_not_called(); run.assert_not_called()
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**observed}}
   def execute(argv,**unused):
    events.append(argv[0])
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
    else: raise recovery.RecoveryError("external command failed")
   with patch.object(recovery,"_copy_local_service",side_effect=lambda *unused: events.append("fence") or Path(raw)/"service.conf"),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=lambda conn,sql: events.append(sql) or []),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),self.assertRaisesRegex(recovery.RecoveryError,"external command failed"):
    recovery.run_restore_verify(args,None)
  self.assertLess(events.index("fence"),events.index("DROP SCHEMA IF EXISTS public CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS public CASCADE"),events.index("DROP SCHEMA IF EXISTS auth CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS auth CASCADE"),events.index("DROP SCHEMA IF EXISTS storage CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS storage CASCADE"),events.index("pg_restore"))
 def test_decrypt_failures_are_bounded_policy_rejections(self):
  output=io.StringIO()
  argv=["restore-verify","--dump","dump","--capture-receipt","capture","--service-file","service","--destination-service","g035-local","--identity-file","identity","--decrypt-command","age"]
  with patch.object(recovery,"validate_sources",return_value=object()),patch.object(recovery,"run_restore_verify",side_effect=recovery.RecoveryError("decrypt failed")),contextlib.redirect_stdout(output):
   self.assertEqual(2,recovery.main(argv))
  self.assertEqual("policy_rejected",json.loads(output.getvalue())["evidence"]["reason"])
  self.assertNotIn("decrypt failed",output.getvalue())
 def test_runtime_sql_is_executed_directly_without_outer_write_transaction(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertIn('run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(runtime)],env=env)',text)
  self.assertNotIn('runtime_script.write_text',text)
 def test_clone_requires_the_restore_receipt_digest_and_exact_baseline_before_applying_migrations(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  lock=text.index('_query_conn(conn,"SELECT pg_advisory_lock(35035)")')
  receipt=text.index("_require_restore_initial_ledger(prior,manifest)",lock)
  baseline=text.index('_initial_ledger_state(conn,manifest)',lock)
  apply=text.index("for index,entry in enumerate(manifest.migrations):",lock)
  self.assertLess(lock,receipt); self.assertLess(receipt,baseline); self.assertLess(baseline,apply)
 def test_clone_accepts_exact_full_closure_without_reapplying_sql(self):
  manifest=contract.load_manifest(ROOT); full=recovery._manifest_ledger_pairs(manifest)
  class Conn:
   def commit(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql")
   prior={"receipt_sha256":"x","evidence":{"ledger_pairs":[list(pair) for pair in full],"ledger_sha256":recovery._ledger_sha256(full),"ledger_count":len(full)}}
   with patch.object(recovery,"_require_prior",return_value=prior),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_fingerprints",return_value=fingerprints(pairs=full)),patch.object(recovery,"_ledger_assert"),patch.object(recovery,"_approval_catalog_evidence",return_value=recovery._approval_contract_descriptor()),patch.object(recovery,"run") as run:
    result=recovery.apply_manifest(args,manifest)
  self.assertEqual(1,run.call_count)
  self.assertIn("g035_hosted_clone_runtime.sql",str(run.call_args.args[0]))
  self.assertEqual("full",result["evidence"]["initial_ledger_state"])
  self.assertEqual(0,result["evidence"]["migrations_applied_in_invocation"])
  self.assertEqual(len(manifest.migrations),result["evidence"]["migrations_already_present"])
  self.assertEqual("transformed_local_clone_not_exact_restore",result["evidence"]["clone_state"])
  self.assertEqual(0,result["evidence"]["hosted_mutations"])
 def test_clone_baseline_receipt_is_explicitly_local_only(self):
  manifest=contract.load_manifest(ROOT); full=recovery._manifest_ledger_pairs(manifest)
  class Conn:
   def commit(self): pass
   def rollback(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",short_url_remediation_receipt="remediation",service_file=str(self.service(raw)),psql="psql")
   def prior(unused,mode):
    if mode=="restore-verify": return {"receipt_sha256":"restore"}
    return {"receipt_sha256":"verify","prior_receipt_sha256":["apply"],"evidence":{"apply_receipt_sha256":"apply","restore_receipt_sha256":"restore"}}
   with patch.object(recovery,"_require_prior",side_effect=prior),patch.object(recovery,"_verify_remediation_state"),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_fingerprints",return_value=fingerprints(pairs=full)),patch.object(recovery,"_ledger_assert"),patch.object(recovery,"_require_restore_initial_ledger",return_value="baseline"),patch.object(recovery,"_initial_ledger_state",return_value="baseline"),patch.object(recovery,"sha256_file",side_effect=lambda source: next(entry.sha256 for entry in manifest.migrations if source.name==Path(entry.path).name)),patch.object(recovery,"_approval_catalog_evidence",return_value=recovery._approval_contract_descriptor()),patch.object(recovery,"run"):
    result=recovery.apply_manifest(args,manifest)
  self.assertEqual("baseline",result["evidence"]["initial_ledger_state"])
  self.assertEqual("transformed_local_clone_not_exact_restore",result["evidence"]["clone_state"])
  self.assertEqual(0,result["evidence"]["hosted_mutations"])
 def test_clone_initial_ledger_rejects_partial_mutated_and_extra_states(self):
  manifest=contract.load_manifest(ROOT); full=recovery._manifest_ledger_pairs(manifest)
  cases=(full[:-1],full+(("99999999","extra"),),full[:12]+(("20260627080000","wrong_name"),)+full[13:],full[:12]+(("20260713002500","forbidden"),)+full[13:])
  for pairs in cases:
   with self.subTest(pairs=pairs),patch.object(recovery,"_fingerprints",return_value=fingerprints(pairs=pairs)),self.assertRaisesRegex(recovery.RecoveryError,"initial state"):
    recovery._initial_ledger_state(object(),manifest)
 def test_restore_receipt_accepts_only_exact_baseline_or_full_closure(self):
  manifest=contract.load_manifest(ROOT); full=recovery._manifest_ledger_pairs(manifest)
  for state,pairs in (("baseline",contract.BASELINE_PAIRS),("full",full)):
   prior={"evidence":{"ledger_pairs":[list(pair) for pair in pairs],"ledger_sha256":recovery._ledger_sha256(pairs),"ledger_count":len(pairs)}}
   self.assertEqual(state,recovery._require_restore_initial_ledger(prior,manifest))
  partial=full[:-1]
  prior={"evidence":{"ledger_pairs":[list(pair) for pair in partial],"ledger_sha256":recovery._ledger_sha256(partial),"ledger_count":len(partial)}}
  with self.assertRaisesRegex(recovery.RecoveryError,"restore receipt ledger mismatch"): recovery._require_restore_initial_ledger(prior,manifest)
 def test_committed_same_batch_retry_returns_before_mutations_with_stable_receipt(self):
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
   def rollback(self): raise AssertionError("committed recovery must not roll back")
   def close(self): pass
  args=Namespace(service="g035-local",restore_receipt="restore",inspect_receipt="inspect",authorization="authorization",authorization_signature="signature",service_file="unused")
  auth={"batch_id":"11111111-1111-1111-1111-111111111111","repository_commit":"a"*40,"selection_spec_sha256":"b"*64,"short_urls_catalog_sha256":"c"*64,"duplicate_group_count":1,"duplicate_victim_count":1,"pre_short_urls_rowset_sha256":"d"*64,"victim_descriptors_sha256":"e"*64}
  restored={"receipt_sha256":"restore"}; inspected={"receipt_sha256":"inspect"}; recovered={"local_only":True,"batch_id":auth["batch_id"],"quarantined_row_count":1}
  queries=[]; conn=Conn()
  def query(connection,sql,params=None):
   queries.append(sql)
   if sql.startswith("BEGIN") or sql.startswith("LOCK TABLE"): return []
   raise AssertionError(f"retry mutated or inspected state: {sql}")
  with patch.object(recovery,"_copy_local_service",return_value=Path("service")),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"_require_prior",side_effect=lambda unused,mode: restored if mode=="restore-verify" else inspected),patch.object(recovery,"_authorization",return_value=auth),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_recovered_apply_evidence",return_value=recovered):
   first=recovery.run_short_url_apply(args,None)
   second=recovery.run_short_url_apply(args,None)
  self.assertEqual(first,second); self.assertEqual(2,conn.commits)
  self.assertEqual(["BEGIN ISOLATION LEVEL SERIALIZABLE","LOCK TABLE public.short_urls IN SHARE ROW EXCLUSIVE MODE"]*2,queries)
  self.assertEqual([restored["receipt_sha256"],inspected["receipt_sha256"]],first["prior_receipt_sha256"])
 def test_recovered_control_state_rejects_partial_or_tampered_binding(self):
  auth={"batch_id":"11111111-1111-1111-1111-111111111111","repository_commit":"a"*40,"selection_spec_sha256":"b"*64,"short_urls_catalog_sha256":"c"*64,"duplicate_group_count":1,"duplicate_victim_count":1,"pre_short_urls_rowset_sha256":"d"*64,"victim_descriptors_sha256":"e"*64}
  restored={"receipt_sha256":"f"*64}; inspected={"receipt_sha256":"1"*64}
  with patch.object(recovery,"_query_conn",return_value=[("schema",None,"table")]),self.assertRaisesRegex(recovery.RecoveryError,"partial"):
   recovery._recovered_apply_evidence(object(),auth,restored,inspected)
  catalog="2"*64
  expected=(restored["receipt_sha256"],inspected["receipt_sha256"],recovery.digest(auth),contract.MANIFEST_SHA256,auth["repository_commit"],auth["selection_spec_sha256"],auth["short_urls_catalog_sha256"],1,1,auth["pre_short_urls_rowset_sha256"],auth["victim_descriptors_sha256"],catalog)
  def query(conn,sql,params=None):
   if "to_regnamespace" in sql: return [("schema","batches","quarantine")]
   if "WHERE batch_id=%s" in sql: return [(*expected[:2],"0"*64,*expected[3:],"3"*64,"4"*64,"5"*64)]
   raise AssertionError(sql)
  with patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_quarantine_catalog",return_value=catalog),self.assertRaisesRegex(recovery.RecoveryError,"binding"):
   recovery._recovered_apply_evidence(object(),auth,restored,inspected)
 def test_postflight_executes_runtime_accepts_schema_list_and_rejects_each_receipt_mutation(self):
  manifest=contract.load_manifest(ROOT); pairs=recovery._manifest_ledger_pairs(manifest); observed=fingerprints(pairs=pairs,managed_schemas=list(contract.MANAGED_METADATA_SCHEMAS))
  args=Namespace(service="g035-local",clone_receipt="clone",service_file="unused",psql="psql")
  class Conn:
   def rollback(self): pass
   def close(self): pass
  approval=recovery._approval_contract_descriptor()
  evidence={"clone_state":"transformed_local_clone_not_exact_restore","hosted_mutations":0,"baseline_pairs_sha256":contract.BASELINE_SHA256,**approval,**{key:observed[key] for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256","managed_metadata_schemas_present")}}
  applied={"receipt_sha256":"clone","prior_receipt_sha256":["restore"],"evidence":evidence}
  with patch.object(recovery,"_copy_local_service",return_value=Path("service")),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_require_prior",return_value=applied),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_fingerprints",return_value=observed),patch.object(recovery,"_approval_catalog_evidence",return_value=approval),patch.object(recovery,"run") as run:
   result=recovery.run_postflight(args,manifest)
  self.assertEqual("validated",result["status"]); self.assertIn("g035_hosted_clone_runtime.sql",str(run.call_args.args[0]))
  for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256","managed_metadata_schemas_present","approval_contract_sha256","approval_contract_identities","approval_contract_valid"):
   mutated={**evidence,key:("unexpected" if key!="ledger_count" else evidence[key]+1)}
   with self.subTest(key=key),patch.object(recovery,"_copy_local_service",return_value=Path("service")),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_require_prior",return_value={**applied,"evidence":mutated}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_fingerprints",return_value=observed),patch.object(recovery,"_approval_catalog_evidence",return_value=approval),patch.object(recovery,"run"):
    with self.assertRaisesRegex(recovery.RecoveryError,"clone receipt evidence mismatch"): recovery.run_postflight(args,manifest)
 def test_approval_catalog_contract_rejects_missing_body_security_search_path_and_output_shape_drift(self):
  contract_value={"public.approve_submission_item(uuid,uuid,jsonb)":{"body_hash":"a"*64}}
  class Conn:
   def cursor(self): return contextlib.nullcontext(object())
  mutations={
   "missing":{},
   "body":{next(iter(contract_value)):False},
   "security":{next(iter(contract_value)):False},
   "search_path":{next(iter(contract_value)):False},
   "output_shape":{"unexpected":True},
  }
  for drift,results in mutations.items():
   with self.subTest(drift=drift),patch.object(recovery.g034_preflight,"approval_body_contract",return_value=contract_value),patch.object(recovery.g034_preflight,"approval_catalog_contract",return_value=results),self.assertRaisesRegex(recovery.RecoveryError,"approval contract validation failed"):
    recovery._approval_catalog_evidence(Conn())
 def test_self_commit_post_execution_failures_are_ambiguous(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  protected='run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(source)],env=env)\n       _query_conn(conn,"INSERT INTO supabase_migrations.schema_migrations'
  self.assertIn(protected,text); self.assertIn('except Exception as exc: raise RecoveryError("self_commit_ambiguous")',text)
 def test_self_commit_insert_commit_and_readback_failures_are_ambiguous(self):
  manifest=contract.load_manifest(ROOT); self_entry=next(entry for entry in manifest.migrations if entry.version in contract.SELF_COMMIT_VERSIONS)
  manifest=contract.Manifest((self_entry,),frozenset(),manifest.ledger_terminal_version,manifest.closure_terminal_version)
  class Conn:
   def __init__(self,fail): self.fail=fail; self.commits=0
   def commit(self):
    self.commits+=1
    if self.fail=="commit" and self.commits==1: raise RuntimeError("commit")
   def close(self): pass
   def rollback(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",short_url_remediation_receipt="remediation",service_file=str(self.service(raw)),psql="psql")
   for failure in ("insert","commit","readback"):
    conn=Conn(failure)
    def query(connection,sql,params=None):
     if failure=="insert" and sql.startswith("INSERT"): raise RuntimeError("insert")
     return []
    def ledger(connection,unused,count):
     if failure=="readback" and count==1: raise RuntimeError("readback")
    def prior(unused,mode):
     if mode=="restore-verify": return {"receipt_sha256":"restore"}
     return {"receipt_sha256":"verify","prior_receipt_sha256":["apply"],"evidence":{"apply_receipt_sha256":"apply","restore_receipt_sha256":"restore"}}
    with patch.object(recovery,"_require_prior",side_effect=prior),patch.object(recovery,"_verify_remediation_state"),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"run"),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),patch.object(recovery,"_require_restore_initial_ledger",return_value="baseline"),patch.object(recovery,"_initial_ledger_state",return_value="baseline"),self.assertRaisesRegex(recovery.RecoveryError,"self_commit_ambiguous"):
     recovery.apply_manifest(args,manifest)
 def test_compatibility_sql_is_version_bound_and_migration_atomic(self):
  sql=recovery._compatibility_sql("20260627080000")
  self.assertEqual(recovery._compatibility_hook("20260627080000"),sql[:4])
  self.assertIn("ALTER EXTENSION vector SET SCHEMA extensions;",sql)
  script="\n".join(sql)+"\nDO $$ BEGIN NULL; END $$;"
  self.assertIn("ALTER EXTENSION vector SET SCHEMA extensions;\nDO $$",script)
  self.assertTrue(all(statement.endswith(";") and not statement[:-1].endswith(";") for statement in sql))
  owner_sql=recovery._compatibility_sql("20260713002000")
  self.assertIn(f"DROP FUNCTION {recovery.OBSOLETE_NOTIFICATION_OVERLOAD};",owner_sql)
  self.assertTrue(all(statement.endswith(";") and not statement[:-1].endswith(";") for statement in owner_sql))
  self.assertTrue(any("ALTER FUNCTION" in statement for statement in owner_sql))
  self.assertEqual((),recovery._compatibility_sql("not-a-migration"))
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertIn('script.write_text(f"BEGIN;\\n{chr(10).join(hook)}\\n\\\\i {source.as_posix()}\\nINSERT INTO supabase_migrations.schema_migrations',source)
  self.assertNotIn("_apply_short_urls_duplicate_target_url_hook",source)
 def test_remediation_contract_is_lossless_and_receipts_are_non_sensitive(self):
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertEqual(tuple(recovery.SHORT_URLS_CATALOG),recovery.SHORT_URLS_CATALOG)
  self.assertIn("character_maximum_length",source)
  self.assertIn("column_default",source)
  self.assertIn("is_generated",source)
  self.assertIn("REFERENCES g035_recovery_control.short_url_duplicate_quarantine_batches",source)
  self.assertIn("UNIQUE (batch_id,id)",source)
  self.assertIn("quarantined_ids_sha256",source)
  self.assertIn("deleted_ids_sha256",source)
  self.assertNotIn("target_url\":target_url",source)
 def test_clone_gate_requires_verified_remediation_only_for_baseline(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertIn('verified=_require_prior(args.short_url_remediation_receipt,"short-url-remediation-verify")',text)
  self.assertIn('if initial_state=="baseline":',text)
  self.assertNotIn("hosted-apply",text)
 def test_runtime_quarantine_check_handles_absent_control_schema(self):
  runtime=(Path(__file__).with_name("g035_hosted_clone_runtime.sql")).read_text(encoding="utf8")
  self.assertIn("to_regclass('g035_recovery_control.short_url_duplicate_quarantine')",runtime)
  self.assertIn("EXECUTE 'SELECT EXISTS",runtime)
  self.assertIn("UNIQUE (target_url)",runtime)
 def test_durable_quarantine_batch_binding_and_tamper_detection(self):
  batch="11111111-1111-1111-1111-111111111111"
  descriptors=[{"source_id":"22222222-2222-2222-2222-222222222222","keeper_id":"33333333-3333-3333-3333-333333333333","target_url_sha256":"a"*64,"rank":2,"source_row_sha256":"b"*64}]
  evidence={"local_only":True,"batch_id":batch,"restore_receipt_sha256":"c"*64,"inspection_receipt_sha256":"d"*64,"authorization_sha256":"e"*64,"manifest_sha256":"f"*64,"repository_commit":"1"*40,"selection_spec_sha256":"2"*64,"short_urls_catalog_sha256":"3"*64,"duplicate_group_count":1,"quarantined_row_count":1,"pre_short_urls_rowset_sha256":"4"*64,"victim_descriptors_sha256":recovery.digest(descriptors),"quarantine_catalog_sha256":"5"*64,"quarantined_ids_sha256":recovery._id_digest([descriptors[0]["source_id"]]),"deleted_ids_sha256":recovery._id_digest([descriptors[0]["source_id"]]),"survivor_short_urls_rowset_sha256":"6"*64}
  binding=[tuple(evidence[key] for key in ("restore_receipt_sha256","inspection_receipt_sha256","authorization_sha256","manifest_sha256","repository_commit","selection_spec_sha256","short_urls_catalog_sha256","duplicate_group_count","quarantined_row_count","pre_short_urls_rowset_sha256","victim_descriptors_sha256","quarantine_catalog_sha256","quarantined_ids_sha256","deleted_ids_sha256","survivor_short_urls_rowset_sha256"))]
  state={"duplicate_victim_count":0,"pre_short_urls_rowset_sha256":"6"*64}
  def query(conn,sql,params=None):
   if "short_url_duplicate_quarantine_batches WHERE" in sql: return binding
   if "SELECT EXISTS" in sql: return [(False,)]
   raise AssertionError(sql)
  with patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_durable_descriptors",return_value=descriptors),patch.object(recovery,"_short_url_snapshot",return_value=state),patch.object(recovery,"_quarantine_catalog",return_value="5"*64),patch.object(recovery,"_quarantine_acl_valid",return_value=True):
   self.assertEqual((batch,1,state),recovery._verify_remediation_state(object(),evidence))
   for altered in (
    [{**descriptors[0],"rank":3}],
    [{**descriptors[0],"keeper_id":"44444444-4444-4444-4444-444444444444"}],
    [{**descriptors[0],"target_url_sha256":"c"*64}],
   ):
    with patch.object(recovery,"_durable_descriptors",return_value=altered),self.assertRaisesRegex(recovery.RecoveryError,"durable"):
     recovery._verify_remediation_state(object(),evidence)
   with patch.object(recovery,"_quarantine_catalog",return_value="7"*64),self.assertRaisesRegex(recovery.RecoveryError,"durable"):
    recovery._verify_remediation_state(object(),evidence)
  binding[0]=(*binding[0][:2],"0"*64,*binding[0][3:])
  with patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_durable_descriptors",return_value=descriptors),patch.object(recovery,"_short_url_snapshot",return_value=state),patch.object(recovery,"_quarantine_catalog",return_value="5"*64),patch.object(recovery,"_quarantine_acl_valid",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"durable"):
   recovery._verify_remediation_state(object(),evidence)
 def test_quarantine_acl_inspection_rejects_public_and_role_exposure(self):
  cases=(
   ("schema_public","pg_namespace AS namespace CROSS JOIN",),
   ("table_role","pg_class AS class",),
   ("default_public","pg_default_acl",),
  )
  for _,marker in cases:
   queries=[]
   def query(conn,sql,params=None):
    queries.append(sql)
    return [(marker not in sql,)]
   with self.subTest(marker=marker),patch.object(recovery,"_query_conn",side_effect=query):
    self.assertFalse(recovery._quarantine_acl_valid(object()))
   self.assertEqual(3,len(queries))
   self.assertTrue(all("has_schema_privilege" not in sql and "has_table_privilege" not in sql for sql in queries))
   self.assertTrue(all("acl.grantee=0" in sql for sql in queries))
   self.assertTrue(all("role.rolname IN ('anon','authenticated','service_role')" in sql for sql in queries))
  with patch.object(recovery,"_query_conn",return_value=[(True,)]):
   self.assertTrue(recovery._quarantine_acl_valid(object()))
 def test_durable_quarantine_source_contract_persists_pre_and_post_binding(self):
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  for column in ("restore_receipt_sha256","inspection_receipt_sha256","authorization_sha256","manifest_sha256","repository_commit","selection_spec_sha256","short_urls_catalog_sha256","duplicate_group_count","victim_count","pre_rowset_sha256","victim_descriptors_sha256","quarantine_catalog_sha256","quarantined_ids_sha256","deleted_ids_sha256","survivor_rowset_sha256"):
   self.assertIn(column,source)
  self.assertIn("INSERT INTO g035_recovery_control.short_url_duplicate_quarantine_batches (batch_id,",source)
  self.assertIn("UPDATE g035_recovery_control.short_url_duplicate_quarantine_batches SET quarantined_ids_sha256",source)
  self.assertIn("source_row_sha256<>encode(digest(source_row_jsonb::text,'sha256'),'hex')",source)
  self.assertIn("digest(source_row_jsonb->>'target_url','sha256')",source)
  self.assertIn("information_schema.columns WHERE table_schema='g035_recovery_control'",source)
  self.assertNotIn("has_table_privilege",source)
  self.assertNotIn("has_schema_privilege",source)
  self.assertIn("pg_catalog.aclexplode",source)
  self.assertIn("coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))",source)
  self.assertIn("coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))",source)
 def test_main_rejects_without_diagnostics(self):
  output=io.StringIO()
  with patch.object(recovery,"validate_sources",side_effect=recovery.ContractError("secret")),contextlib.redirect_stdout(output): self.assertEqual(2,recovery.main(["validate"]))
  self.assertEqual("policy_rejected",json.loads(output.getvalue())["evidence"]["reason"]); self.assertNotIn("secret",output.getvalue())
class ManifestDependencyTests(unittest.TestCase):
 def test_marketing_state_machine_is_hashed_and_required_in_dependency_order(self):
  data=json.loads((ROOT/contract.MANIFEST_RELATIVE_PATH).read_text(encoding="utf8"))
  migrations=data["migrations"]
  marketing=next(entry for entry in migrations if entry["version"]=="20260713002200")
  self.assertEqual({"version":"20260713002200","name":"g014_marketing_state_machine","path":"backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql","sha256":"a041f88d781ef50bfdf59feee2af3f09bc02fc64714fe335861ed5e7d99694a3"},marketing)
  self.assertEqual(28,len(migrations))
  self.assertEqual(["20260713002100","20260713002200","20260713002300"],[entry["version"] for entry in migrations[-4:-1]])
  self.assertEqual(contract.FORBIDDEN_VERSIONS,frozenset(data["excludedVersions"]))
  self.assertNotIn("20260713002200",data["excludedVersions"])
 def test_manifest_rejects_marketing_omission_reexclusion_and_reordering(self):
  original=json.loads((ROOT/contract.MANIFEST_RELATIVE_PATH).read_text(encoding="utf8"))
  cases=[]
  omitted=json.loads(json.dumps(original)); omitted["migrations"]=[entry for entry in omitted["migrations"] if entry["version"]!="20260713002200"]; cases.append(omitted)
  reexcluded=json.loads(json.dumps(original)); reexcluded["excludedVersions"].append("20260713002200"); cases.append(reexcluded)
  reordered=json.loads(json.dumps(original)); index=next(i for i,entry in enumerate(reordered["migrations"]) if entry["version"]=="20260713002200"); reordered["migrations"][index],reordered["migrations"][index+1]=reordered["migrations"][index+1],reordered["migrations"][index]; cases.append(reordered)
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw); manifest_path=root/contract.MANIFEST_RELATIVE_PATH; manifest_path.parent.mkdir()
   for data in cases:
    with self.subTest(data=data):
     manifest_path.write_text(json.dumps(data,separators=(",",":")),encoding="utf8")
     with patch.object(contract,"MANIFEST_SHA256",contract.sha256_file(manifest_path)),self.assertRaises(contract.ContractError):
      contract.load_manifest(root)
if __name__=="__main__": unittest.main()
