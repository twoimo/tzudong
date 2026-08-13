import contextlib, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, threading, time, unittest
REAL_SHA256=hashlib.sha256
from argparse import Namespace
from pathlib import Path
from unittest.mock import ANY, Mock, patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
import g040_recovery_source as recovery_source
recovery_source._establish_isolated_bootstrap(Path(__file__).parents[3],"a"*40,"b"*64)
import g035_hosted_recovery_contract as contract
spec=importlib.util.spec_from_file_location("recovery",SCRIPTS/"g035_hosted_recovery.py"); recovery=importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
ROOT=Path(__file__).parents[3]
SCHEMA_ONLY_TOC=(
 b"; Archive created at 2026-07-23\n"
 b"10; 2615 2200 SCHEMA - public pg_database_owner\n"
 b"11; 0 0 COMMENT - SCHEMA public pg_database_owner\n"
 b"12; 0 0 ACL - SCHEMA public pg_database_owner\n"
 b"13; 2615 16400 SCHEMA - auth supabase_admin\n"
 b"14; 2615 16401 SCHEMA - storage supabase_admin\n"
 b"15; 2615 16402 SCHEMA - ocr_private postgres\n"
 b"16; 2615 16403 SCHEMA - provider_budget_private postgres\n"
)
REQUIRED_HOSTED_TABLE_DATA=(
 b"900; 0 1900 TABLE DATA ocr_private ocr_daily_quota_reservations postgres\n",
 b"901; 0 1901 TABLE DATA provider_budget_private admin_provider_budget_policies postgres\n",
 b"902; 0 1902 TABLE DATA provider_budget_private admin_provider_budget_counters postgres\n",
 b"903; 0 1903 TABLE DATA provider_budget_private admin_provider_budget_decisions postgres\n",
)
POSTGRES_TABLE_DATA=REQUIRED_HOSTED_TABLE_DATA+tuple(f"{1000+index}; 0 {2000+index} TABLE DATA public postgres_{index} postgres\n".encode() for index in range(46))
PRIVACY_TABLE_DATA=tuple(f"{1100+index}; 0 {2100+index} TABLE DATA privacy_retention privacy_{index} privacy_workflow_owner\n".encode() for index in range(61))
NON_TABLE_DATA=(
 b"1200; 0 0 SEQUENCE SET public canonical_id_seq postgres\n"
 b"1201; 0 2201 MATERIALIZED VIEW DATA public canonical_rollup postgres\n"
)
SCHEMA_TOC=SCHEMA_ONLY_TOC+b"".join(POSTGRES_TABLE_DATA+PRIVACY_TABLE_DATA)+NON_TABLE_DATA
EXPECTED_POST_DATA_OWNER_COUNTS=(("postgres",454),("privacy_workflow_owner",474),("supabase_admin",3),("supabase_auth_admin",128),("supabase_storage_admin",45))
EXPECTED_POST_DATA_OWNER_RUNS=(("privacy_workflow_owner",1),("supabase_auth_admin",33),("postgres",2),("privacy_workflow_owner",83),("postgres",3),("privacy_workflow_owner",7),("postgres",1),("privacy_workflow_owner",2),("postgres",24),("privacy_workflow_owner",6),("postgres",1),("privacy_workflow_owner",5),("postgres",47),("supabase_storage_admin",9),("postgres",1),("privacy_workflow_owner",1),("supabase_auth_admin",56),("postgres",2),("privacy_workflow_owner",26),("postgres",2),("privacy_workflow_owner",4),("postgres",2),("privacy_workflow_owner",2),("postgres",25),("privacy_workflow_owner",2),("postgres",19),("privacy_workflow_owner",4),("postgres",40),("privacy_workflow_owner",4),("postgres",1),("privacy_workflow_owner",4),("postgres",47),("supabase_storage_admin",8),("supabase_auth_admin",2),("privacy_workflow_owner",57),("postgres",1),("privacy_workflow_owner",2),("postgres",5),("privacy_workflow_owner",13),("postgres",21),("supabase_storage_admin",5),("supabase_auth_admin",18),("postgres",1),("privacy_workflow_owner",61),("postgres",3),("privacy_workflow_owner",3),("postgres",25),("privacy_workflow_owner",9),("postgres",1),("privacy_workflow_owner",9),("postgres",24),("supabase_storage_admin",5),("privacy_workflow_owner",2),("supabase_auth_admin",16),("postgres",2),("privacy_workflow_owner",113),("postgres",36),("privacy_workflow_owner",2),("postgres",4),("privacy_workflow_owner",1),("postgres",9),("privacy_workflow_owner",1),("postgres",1),("privacy_workflow_owner",1),("postgres",4),("privacy_workflow_owner",8),("postgres",5),("privacy_workflow_owner",2),("postgres",28),("privacy_workflow_owner",1),("postgres",2),("privacy_workflow_owner",3),("postgres",9),("privacy_workflow_owner",23),("postgres",5),("privacy_workflow_owner",1),("postgres",4),("privacy_workflow_owner",7),("postgres",1),("privacy_workflow_owner",4),("postgres",39),("supabase_storage_admin",18),("supabase_auth_admin",3),("postgres",1),("supabase_admin",1),("postgres",1),("supabase_admin",1),("postgres",1),("supabase_admin",1),("postgres",4))
POST_DATA_ROWS=tuple(f"{3000+index}; {12000+index} {22000+index} CONSTRAINT public object_{index} constraint_{index} {owner}\n".encode() for index,owner in enumerate(owner for owner,count in EXPECTED_POST_DATA_OWNER_RUNS for unused in range(count)))
POST_DATA_TOC_BYTES=b"; canonical post-data TOC\n\n"+b"".join(POST_DATA_ROWS)+b"; canonical trailer\n"
TEST_TRIGGER_RELATIONS=tuple(("privacy_retention" if index%2 else "public",f"trigger_table_{index}") for index in range(50))
TEST_TRIGGER_DESCRIPTORS_BY_RUN=(
 (35,tuple((*relation,f"trigger_{index}") for index,relation in enumerate((*TEST_TRIGGER_RELATIONS[:40],*TEST_TRIGGER_RELATIONS[:17])))),
 (37,((*TEST_TRIGGER_RELATIONS[0],"trigger_57"),(*TEST_TRIGGER_RELATIONS[40],"trigger_58"))),
 (39,tuple((*relation,f"trigger_{59+index}") for index,relation in enumerate((*TEST_TRIGGER_RELATIONS[1:5],*TEST_TRIGGER_RELATIONS[41:])))),
)
TEST_TRIGGER_MUTABLE_ROWS=list(POST_DATA_ROWS); TEST_TRIGGER_ROWS=[]
for test_run,test_descriptors in TEST_TRIGGER_DESCRIPTORS_BY_RUN:
 test_start=sum(count for unused_owner,count in EXPECTED_POST_DATA_OWNER_RUNS[:test_run-1])
 test_rows=tuple(f"{3000+test_start+index}; {12000+test_start+index} {22000+test_start+index} TRIGGER {schema} {table} {trigger} privacy_workflow_owner\n".encode() for index,(schema,table,trigger) in enumerate(test_descriptors))
 TEST_TRIGGER_MUTABLE_ROWS[test_start:test_start+len(test_rows)]=test_rows; TEST_TRIGGER_ROWS.extend(test_rows)
TEST_TRIGGER_ROWS=tuple(TEST_TRIGGER_ROWS)
TEST_TRIGGER_TOC_BYTES=b"; canonical post-data TOC\n\n"+b"".join(TEST_TRIGGER_MUTABLE_ROWS)+b"; canonical trailer\n"
TEST_TRIGGER_RUNS=recovery._post_data_use_lists(TEST_TRIGGER_TOC_BYTES)
TEST_TRIGGER_ROOT=hashlib.sha256(recovery.canonical_bytes([list(relation) for relation in TEST_TRIGGER_RELATIONS])).hexdigest()
def _test_trigger_sha256(payload):
 actual=REAL_SHA256(payload)
 if actual.hexdigest()==TEST_TRIGGER_ROOT: return Mock(hexdigest=lambda:recovery.POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT)
 return actual
OLD_REMEDIATION_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA1aTLvmOtTWC1LZTYK8ocOBGlhWnC6k8a/ePCKSFdWPI=\n-----END PUBLIC KEY-----\n"
PINNED_SUPABASE_CA=b"""-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
"""
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
  self.assertEqual(29,len(manifest.migrations)); self.assertEqual(expected,contract.BASELINE_PAIRS)
  self.assertGreaterEqual(recovery.CAPTURE_TIMEOUT_SECONDS,3600)
  self.assertTrue(contract.ledger_prefix(manifest,expected))
  self.assertTrue(contract.ledger_prefix(manifest,[list(pair) for pair in expected]))
  mutated=list(expected); mutated[0]=("20260124","db_performance_optimization")
  self.assertFalse(contract.ledger_prefix(manifest,mutated))
  self.assertFalse(contract.ledger_prefix(manifest,list(reconstructed)))
  self.assertFalse(contract.ledger_prefix(manifest,[("20260531084516","caller_supplied")]))

 def test_restore_cli_requires_external_receipt_and_one_channel(self):
  restore=next(action.choices["restore-verify"] for action in recovery.parser()._actions if getattr(action,"dest",None)=="mode")
  required={action.dest for action in restore._actions if action.required}
  self.assertEqual({"dump","capture_receipt","restore_receipt","service_file","destination_service","decrypt_command"},required)
  with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
   recovery.parser().parse_args(["restore-verify","--dump","dump","--capture-receipt","capture","--restore-receipt","/receipt","--service-file","service","--destination-service","g035-local","--decrypt-command","age"])
  args=recovery.parser().parse_args(["restore-verify","--dump","dump","--capture-receipt","capture","--restore-receipt","/receipt","--service-file","service","--destination-service","g035-local","--identity-fd","3","--decrypt-command","age"])
  self.assertEqual("3",args.identity_fd)
  self.assertIsNone(args.identity_handle)
 def test_runnable_workflow_excludes_restore_and_runbook_requires_pipe_custody(self):
  workflow=(ROOT/".github/workflows/g035-hosted-recovery.yml").read_text(encoding="utf8")
  runbook=(ROOT/"backend/supabase/docs/g035-hosted-recovery-runbook.md").read_text(encoding="utf8")
  self.assertNotIn("G035_OFFLINE_IDENTITY_FILE",workflow)
  self.assertNotIn("restore-verify)",workflow)
  self.assertNotIn("options: [validate, capture, restore-verify",workflow)
  self.assertNotIn("--identity-file",workflow+runbook)
  self.assertIn('git show "$source_commit:$bootstrap" | python -I -',workflow)
  self.assertIn('--entrypoint "$entrypoint" -- "$@"',workflow)
  self.assertNotRegex(workflow,r"(?m)^\s*(?:validate|capture|short-url-remediation-[a-z-]+|clone-apply|local-postflight\))?[^\n]*python\s+backend/supabase/scripts/g035_hosted_recovery\.py")
  self.assertIn("--restore-receipt <fresh-external-restore-receipt.json>",runbook)
  self.assertIn("--identity-fd 3",runbook)
  self.assertIn("--identity-handle <canonical-inherited-handle>",runbook)
  self.assertIn("successful child publishes canonical receipt bytes itself",runbook)
 def test_rotated_custody_pins_new_authority_and_rejects_old_authority(self):
  self.assertEqual("e338e9dbfd309838b16980d62fe72a71c526e329506285f4c5811d725d941213",contract.REMEDIATION_PUBLIC_KEY_SHA256)
  self.assertEqual(contract.REMEDIATION_PUBLIC_KEY_SHA256,hashlib.sha256(contract.REMEDIATION_PUBLIC_KEY_PEM.encode("ascii")).hexdigest())
  self.assertEqual("c529b89f584d1d02f2543887e31cf85515b74cbd5a93cffd58efd93e6245ed7f",contract.APPROVED_AGE_RECIPIENT_SHA256)
  self.assertNotEqual(OLD_REMEDIATION_PUBLIC_KEY_PEM,contract.REMEDIATION_PUBLIC_KEY_PEM)
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
   with patch.object(contract,"REMEDIATION_PUBLIC_KEY_PEM",OLD_REMEDIATION_PUBLIC_KEY_PEM):
    with self.assertRaisesRegex(contract.ContractError,"pinned key mismatch"):
     contract.verify_short_url_remediation_authorization(path,signature,require_custody=custody,verify_detached=verify,expected_bindings={key:auth[key] for key in ("inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","repository_commit")},inspection_evidence=evidence)
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
  self.windows_restrict=patch.object(recovery,"_windows_restrict_temporary_file")
  if recovery.os.name=="nt": self.windows_restrict.start()
  @contextlib.contextmanager
  def workspace():
   with tempfile.TemporaryDirectory() as raw: yield Path(raw)
  self.workspace=patch.object(recovery,"_restricted_restore_directory",side_effect=workspace)
  self.workspace.start()
 def tearDown(self):
  self.source_binding.stop()
  self.windows_restrict.stop()
  self.workspace.stop()
 def service(self,directory,section="g035-local",body=None):
  path=Path(directory)/"service.conf"; path.write_text(body or f"[{section}]\nhost=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n",encoding="utf8"); path.chmod(0o600); return path
 def hosted_service_body(self,sslrootcert="/external/supabase-ca.pem"):
  return f"[g035]\nhost=remote.example\nport=5432\ndbname=source\nuser=operator\nconnect_timeout=10\napplication_name=g035-capture\nsslmode=verify-full\nsslrootcert={sslrootcert}\n"
 def managed_capture_scope(self):
  return {"schema_scope":list(contract.APPLICATION_SCHEMAS),"managed_metadata_schema_scope":list(contract.MANAGED_METADATA_SCHEMAS),"managed_table_data_exclusions":["--exclude-table-data=auth.*","--exclude-table-data=storage.*"]}
 def test_hosted_capture_service_accepts_only_pinned_external_ca_with_verify_full(self):
  self.assertEqual(1367,len(PINNED_SUPABASE_CA))
  self.assertEqual("700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",hashlib.sha256(PINNED_SUPABASE_CA).hexdigest())
  self.assertEqual(hashlib.sha256(PINNED_SUPABASE_CA).hexdigest(),recovery.HOSTED_CA_SHA256)
  with tempfile.TemporaryDirectory() as raw:
   ca=Path(raw)/"supabase-ca.pem"; ca.write_bytes(PINNED_SUPABASE_CA); ca.chmod(0o600)
   service=self.service(raw,"g035",self.hosted_service_body(ca))
   source,entries=recovery._parse_hosted_service(service,"g035")
   self.assertEqual(service.read_bytes(),source)
   self.assertEqual("verify-full",entries["sslmode"])
   self.assertEqual(str(ca),entries["sslrootcert"])
   copied=recovery._copy_service(Path(raw),service,"g035")
   self.assertEqual(service.read_bytes(),copied.read_bytes())
 def test_hosted_capture_service_rejects_missing_weaker_and_unpinned_roots(self):
  base="[g035]\nhost=remote.example\nport=5432\ndbname=source\nuser=operator\nconnect_timeout=10\napplication_name=g035-capture\n"
  cases=(
   base+"sslmode=verify-full\n",
   base+"sslrootcert=system\n",
   base+"sslmode=require\nsslrootcert=/tmp/supabase-ca.pem\n",
   base+"sslmode=verify-full\nsslrootcert=system\n",
   base+"sslmode=verify-full\nsslrootcert=SYSTEM\n",
   base+"sslmode=verify-full\nsslrootcert=/etc/ssl/cert.pem\n",
   base+"sslmode=verify-full\nsslrootcert=ca.pem\n",
   base+"sslmode=verify-full\nsslrootcert=~/ca.pem\n",
   base+"sslmode=verify-full\nsslrootcert=$PGSSLROOTCERT\n",
   base+"sslmode=verify-full\nsslrootcert=${PGSSLROOTCERT}\n",
   base+"sslmode=verify-full\nsslrootcert=%PGSSLROOTCERT%\n",
   base+"sslmode=verify-full\nsslrootcert=/tmp/ca.pem\nsslrootcert=/tmp/ca.pem\n",
   base+"sslmode=verify-full\nsslrootcert=/tmp/ca.pem\nsslcert=/tmp/client.pem\n",
  )
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery,"_restrictive",return_value=True):
   for body in cases:
    service=self.service(raw,"g035",body)
    with self.subTest(body=body),self.assertRaises(recovery.RecoveryError):
     recovery._copy_service(Path(raw),service,"g035")
 def test_hosted_ca_rejects_symlink_wrong_hash_size_mode_owner_and_replacement(self):
  with tempfile.TemporaryDirectory() as raw:
   directory=Path(raw); ca=directory/"supabase-ca.pem"; ca.write_bytes(PINNED_SUPABASE_CA); ca.chmod(0o600)
   symlink=directory/"linked-ca.pem"; symlink.symlink_to(ca)
   with self.assertRaises(recovery.RecoveryError): recovery._verify_hosted_sslrootcert(str(symlink))
   ca.write_bytes(b"x"*recovery.HOSTED_CA_SIZE); ca.chmod(0o600)
   with self.assertRaisesRegex(recovery.RecoveryError,"pin mismatch"): recovery._verify_hosted_sslrootcert(str(ca))
   ca.write_bytes(b"x"); ca.chmod(0o600)
   with self.assertRaisesRegex(recovery.RecoveryError,"custody"): recovery._verify_hosted_sslrootcert(str(ca))
   ca.write_bytes(PINNED_SUPABASE_CA); ca.chmod(0o644)
   with self.assertRaisesRegex(recovery.RecoveryError,"custody"): recovery._verify_hosted_sslrootcert(str(ca))
   ca.chmod(0o600)
   with patch.object(recovery.os,"getuid",return_value=ca.stat().st_uid+1),self.assertRaisesRegex(recovery.RecoveryError,"custody"):
    recovery._verify_hosted_sslrootcert(str(ca))
   info=ca.stat(); changed=list(info); changed[1]+=1
   with patch.object(recovery.os,"fstat",side_effect=(info,os.stat_result(changed))),self.assertRaisesRegex(recovery.RecoveryError,"changed"):
    recovery._verify_hosted_sslrootcert(str(ca))
 def test_hosted_ca_rejects_missing_and_repository_paths(self):
  with tempfile.TemporaryDirectory() as raw:
   with self.assertRaises(recovery.RecoveryError): recovery._verify_hosted_sslrootcert(str(Path(raw)/"missing.pem"))
  with tempfile.TemporaryDirectory(dir=ROOT) as raw:
   ca=Path(raw)/"supabase-ca.pem"; ca.write_bytes(PINNED_SUPABASE_CA); ca.chmod(0o600)
   with self.assertRaisesRegex(recovery.RecoveryError,"external"): recovery._verify_hosted_sslrootcert(str(ca))
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
   "host=127.0.0.1\nsslrootcert=system",
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
    copied.unlink()
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
 @unittest.skip("superseded by direct WinAPI ACL coverage")
 def test_windows_dacl_uses_native_tools_without_powershell_modules(self):
  sddl="D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)"
  with tempfile.TemporaryDirectory() as raw:
   service=self.service(raw)
   responses=[
    subprocess.CompletedProcess([],0,'"DOMAIN\\\\user","S-1-5-21-100"\r\n',""),
    subprocess.CompletedProcess([],0,"",""),
   ]
   with patch.object(recovery.subprocess,"run",side_effect=responses) as acl_run,patch.object(recovery,"_windows_security_metadata",return_value=("S-1-5-21-100",True)),patch.object(recovery,"_windows_saved_sddl",return_value=sddl):
    self.assertTrue(recovery._windows_dacl_restrictive(service))
  self.assertEqual(["whoami","/user","/fo","csv","/nh"],acl_run.call_args_list[0].args[0])
  argv=acl_run.call_args_list[1].args[0]
  self.assertEqual(["icacls",str(service),"/save"],argv[:3])
  self.assertEqual("/c",argv[-1])
  self.assertFalse(Path(argv[3]).exists())
  self.assertNotIn("powershell.exe",str(acl_run.call_args_list))
 @unittest.skip("superseded by direct WinAPI ACL coverage")
 def test_windows_saved_sddl_accepts_bomless_utf16le_and_rejects_malformed_bytes(self):
  with tempfile.TemporaryDirectory() as raw:
   export=Path(raw)/"acl.txt"
   export.write_bytes("service.conf D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)\r\n".encode("utf-16-le"))
   self.assertEqual("D:PAI(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;S-1-5-21-100)",recovery._windows_saved_sddl(export))
   export.write_bytes(b"\xff\xfeD\x00:\x00\x00")
   self.assertIsNone(recovery._windows_saved_sddl(export))
 @unittest.skip("superseded by direct WinAPI ACL coverage")
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
    with patch.object(recovery.subprocess,"run",side_effect=responses),patch.object(recovery,"_windows_security_metadata",return_value=("S-1-5-21-100",True)),patch.object(recovery,"_windows_saved_sddl",return_value=sddl):
     self.assertFalse(recovery._windows_dacl_restrictive(service))
   with patch.object(recovery.subprocess,"run",side_effect=[
    subprocess.CompletedProcess([],0,'"DOMAIN\\\\user","S-1-5-21-100"\r\n',""),
    subprocess.CalledProcessError(1,["icacls"]),
   ]):
    self.assertFalse(recovery._windows_dacl_restrictive(service))
 def test_windows_dacl_rejects_untrusted_owner_and_unprotected_descriptor(self):
  with tempfile.TemporaryDirectory() as raw:
   service=self.service(raw)
   with patch.object(recovery,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(recovery,"_windows_security_metadata",return_value=("S-1-5-21-999",True)):
    self.assertFalse(recovery._windows_dacl_restrictive(service))
   with patch.object(recovery,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(recovery,"_windows_security_metadata",return_value=("S-1-5-21-100",False)):
    self.assertFalse(recovery._windows_dacl_restrictive(service))
 def test_windows_dacl_has_no_posix_mode_fallback(self):
  class File:
   def is_symlink(self): return False
   def is_file(self): return True
   def stat(self): raise AssertionError("mode fallback")
  with patch.object(recovery.os,"name","nt"),patch.object(recovery,"_windows_dacl_restrictive",return_value=False) as native:
   self.assertFalse(recovery._restrictive(File()))
  native.assert_called_once()
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
 @unittest.skip("superseded by direct WinAPI ACL coverage")
 def test_windows_temporary_file_acl_removes_exact_logon_sid_before_granting(self):
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"temporary"
   logon_sid="S-1-5-5-22-33\r\n"
   with patch.object(recovery,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(recovery.subprocess,"run",side_effect=[subprocess.CompletedProcess([],0,logon_sid,""),subprocess.CompletedProcess([],0,"",""),subprocess.CompletedProcess([],0,"",""),subprocess.CompletedProcess([],0,"","")]) as acl_run,patch.object(recovery,"_windows_dacl_restrictive",return_value=True):
    recovery._windows_restrict_temporary_file(path)
  self.assertEqual([
   ["whoami","/logonid"],
   ["icacls",str(path),"/inheritance:r"],
   ["icacls",str(path),"/remove:g","*S-1-5-5-22-33"],
   ["icacls",str(path),"/grant:r","*S-1-5-21-100:(F)","*S-1-5-18:(F)","*S-1-5-32-544:(F)"],
  ],[call.args[0] for call in acl_run.call_args_list])
 @unittest.skip("superseded by direct WinAPI ACL coverage")
 def test_windows_logon_sid_discovery_rejects_malformed_broad_and_failed_output(self):
  cases=(
   "S-1-5-5-22\r\n",
   "S-1-5-5-22-33-44\r\n",
   "S-1-1-0\r\n",
   "not-a-sid\r\n",
   "S-1-5-5-22-33\r\nS-1-5-5-44-55\r\n",
   " S-1-5-5-22-33\r\n",
  )
  for output in cases:
   with patch.object(recovery.subprocess,"run",return_value=subprocess.CompletedProcess([],0,output,"")) as logon_run:
    self.assertIsNone(recovery._windows_logon_sids())
   self.assertEqual(["whoami","/logonid"],logon_run.call_args.args[0])
  with patch.object(recovery.subprocess,"run",side_effect=subprocess.CalledProcessError(1,["whoami"])):
   self.assertIsNone(recovery._windows_logon_sids())
 @unittest.skip("logon SID tooling is intentionally not used")
 def test_windows_native_logon_command_discovers_one_exact_sid(self):
  discovered=recovery._windows_logon_sids()
  self.assertIsNotNone(discovered)
  self.assertEqual(1,len(discovered))
  self.assertRegex(discovered[0],r"^S-1-5-5-\d+-\d+$")
 @unittest.skip("superseded by direct WinAPI ACL coverage")
 def test_windows_logon_discovery_failure_leaves_temporary_file_empty_and_removed(self):
  with tempfile.TemporaryDirectory() as raw:
   candidate=Path(raw)/"temporary"
   fd=recovery.os.open(candidate,recovery.os.O_CREAT|recovery.os.O_EXCL|recovery.os.O_RDWR,0o600)
   with patch.object(recovery.tempfile,"mkstemp",return_value=(fd,str(candidate))),patch.object(recovery.os,"name","nt"),patch.object(recovery,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(recovery.subprocess,"run",side_effect=subprocess.CalledProcessError(1,["whoami"])):
    with self.assertRaisesRegex(recovery.RecoveryError,"ACL"): recovery._secure_temporary_file("unused",b"secret-content")
   self.assertFalse(candidate.exists())
 def test_secure_temporary_file_applies_windows_acl_before_content(self):
  if sys.platform!="win32": self.skipTest("Windows ACL ordering assertion")
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
  if sys.platform!="win32": self.skipTest("Windows ACL cleanup assertion")
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
 def test_posix_custodied_argument_falls_back_to_dev_fd(self):
  if recovery.os.name=="nt": self.skipTest("POSIX descriptor custody assertion")
  fd,path=recovery._secure_temporary_file("g035-test-",b"exact")
  try:
   with patch.object(Path,"exists",side_effect=[False,True]):
    argument=recovery._custodied_argument(fd,path)
   self.assertEqual(argument,f"/dev/fd/{fd}")
   self.assertEqual(Path(argument).read_bytes(),b"exact")
  finally:
   recovery._close_temporary_file(fd,path)
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
   with patch.object(recovery,"_repository_commit",return_value="a"*40),patch.object(recovery,"verify_short_url_remediation_authorization",side_effect=verify_contract),patch.object(recovery,"run",side_effect=openssl),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_windows_restrict_temporary_file"):
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
  captured=recovery.receipt("capture","captured",{"dump_sha256":"a"*64,"dump_bytes":7})
  with tempfile.TemporaryDirectory() as raw:
   receipt=Path(raw)/"capture.json"; manifest=object()
   argv=["production-capture","--destination",raw,"--capture-receipt",str(receipt),"--service-file","/custody/service.conf","--recipient","age1"+"q"*58,"--g034-artifact","/custody/g034.json","--encrypt-command","age"]
   stream=io.BytesIO()
   with patch.object(recovery,"validate_sources",return_value=manifest) as validate,patch.object(recovery,"run_capture",return_value=captured) as run_capture,patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_unlink_owned_output",side_effect=lambda fd,path,identity:path.unlink(missing_ok=True)),patch.object(recovery.sys,"stdout",type("Stdout",(),{"buffer":stream})()):
    self.assertEqual(0,recovery.main(argv))
    self.assertEqual(captured,recovery.read_json_receipt(receipt))
    self.assertEqual(b"}",stream.getvalue()[-1:])
    tampered=stream.getvalue().replace(b'"dump_sha256":"'+b"a"*64,b'"dump_sha256":"'+b"b"*64,1)
    self.assertNotEqual(stream.getvalue(),tampered)
    for payload in (stream.getvalue()+b"\n",tampered):
     receipt.write_bytes(payload)
     with self.assertRaises(recovery.RecoveryError): recovery.read_json_receipt(receipt)
   validate.assert_called_once_with(recovery.repository_root(Path(recovery.__file__).resolve()))
   run_capture.assert_called_once()
   self.assertEqual(recovery.canonical_bytes(captured),stream.getvalue())
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
  terminal="20260531084516"; cursor=Mock(); conn=Mock(); conn.cursor.return_value=cursor
  approvals={
   "public.approve_submission_item(uuid,uuid,jsonb)":False,
   "public.approve_edit_submission_item(uuid,uuid,jsonb)":True,
  }
  with tempfile.TemporaryDirectory() as raw:
   artifact=Path(raw)/"artifact.json"; artifact.write_text(json.dumps({"ledgerExpectedTerminal":terminal}),encoding="utf8")
   def query(actual_conn,sql,params=None):
    self.assertIs(actual_conn,conn)
    if "schema_migrations" in sql: return [(terminal,)]
    if "to_regclass('public.restaurants_backup')" in sql: return [(True,)]
    if "pg_class" in sql: return [(True,)]
    if "pg_locks" in sql: return [(0,)]
    if "pg_roles" in sql: return [(3,)]
    raise AssertionError(sql)
   with patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery.g034_preflight,"approval_catalog_contract",return_value=approvals) as approval,patch.object(recovery.g034_preflight,"catalog_retirement_dependency_exists",return_value=False) as retired:
    actual=recovery._g034_live_fingerprints(conn,artifact)
  prerequisites={"ledgerTerminalMatches":True,"publicRestaurants":True,"publicRestaurantsBackup":True,"storageObjects":True,"publicApproveSubmissionItem":False,"publicApproveEditSubmissionItem":True,"noWaitingLocks":True,"requiredRolesPresent":True}
  self.assertEqual({"ledger_sha256":recovery.digest([terminal]),"catalog_sha256":recovery.digest(prerequisites)},actual)
  approval.assert_called_once_with(cursor); retired.assert_called_once_with(cursor); cursor.close.assert_called_once_with()
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
  self.assertEqual(("public","shortener_private","account_deletion_private","privacy_retention","ocr_private","provider_budget_private"),contract.APPLICATION_SCHEMAS)
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
    output=destination/"g035-dump.enc"; output.unlink(missing_ok=True); output.write_bytes(b"replacement")
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
  captured={"schema":recovery.RECEIPT_SCHEMA,"mode":"capture","status":"captured","evidence":{"ledger_pairs":(("1","baseline"),)}}
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
   ca=Path(raw)/"supabase-ca.pem"; ca.write_bytes(PINNED_SUPABASE_CA); ca.chmod(0o600)
   recipient="age1643wr4n3598yu8px5fc6qjpq753rh2j4qk3ar4ree23fz9ke4eqqc9xgmw"
   args=Namespace(destination=str(dest),service_file=str(self.service(raw,"g035",self.hosted_service_body(ca))),recipient=recipient,g034_artifact=str(artifact),pg_dump="pg_dump",encrypt_command="age")
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
   directory=Path(raw)
   ca=directory/"supabase-ca.pem"
   ca.write_bytes(PINNED_SUPABASE_CA)
   ca.chmod(0o600)
   servicefile=directory/"pg_service.conf"
   servicefile.write_text(self.hosted_service_body(ca),encoding="utf8")
   env={"PGSERVICEFILE":str(servicefile)}
   connect=lambda **kwargs: kwargs
   with patch.dict(recovery.os.environ,{"PGSERVICEFILE":"original"},clear=False),patch.dict(sys.modules,{"psycopg":types.SimpleNamespace(connect=connect)}):
    self.assertEqual({"host":"remote.example","port":"5432","dbname":"source","user":"operator","connect_timeout":"10","application_name":"g035-capture","sslmode":"verify-full","sslrootcert":str(ca),"autocommit":True},recovery._connect("g035",env))
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
 def test_identity_channel_parser_and_posix_pipe_custody(self):
  for value in ("2","03","+3"," 3","3 ","999999999999999999999999"):
   with self.assertRaises(recovery.RecoveryError): recovery._parse_inherited_channel(value,"identity fd")
  self.assertEqual(10,recovery._parse_inherited_channel("10","identity fd"))
  if recovery.os.name!="posix": self.skipTest("POSIX pipe required")
  read_fd,write_fd=os.pipe()
  try:
   os.set_inheritable(read_fd,True)
   stream=recovery._owned_identity_stream(Namespace(identity_fd=str(read_fd),identity_handle=None))
   self.assertFalse(os.get_inheritable(stream.fileno()))
   with self.assertRaises(OSError): os.fstat(read_fd)
   stream.close()
  finally: os.close(write_fd)
 @unittest.skipUnless(os.name=="nt","Windows anonymous pipe required")
 def test_windows_identity_handle_is_duplicated_noninheritable_and_original_is_closed(self):
  import ctypes, msvcrt
  from ctypes import wintypes
  read_fd,write_fd=os.pipe(); stream=None
  handle=msvcrt.get_osfhandle(read_fd)
  try:
   os.set_handle_inheritable(handle,True)
   os.write(write_fd,b"test-key-material"); os.close(write_fd); write_fd=-1
   stream=recovery._owned_identity_stream(Namespace(identity_fd=None,identity_handle=str(handle)))
   duplicate_handle=msvcrt.get_osfhandle(stream.fileno())
   self.assertFalse(os.get_handle_inheritable(duplicate_handle))
   flags=wintypes.DWORD()
   kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
   kernel32.GetHandleInformation.argtypes=(wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD))
   kernel32.GetHandleInformation.restype=wintypes.BOOL
   self.assertFalse(kernel32.GetHandleInformation(wintypes.HANDLE(handle),ctypes.byref(flags)))
   self.assertEqual(b"test-key-material",stream.read())
   read_fd=-1
  finally:
   if stream is not None: stream.close()
   if read_fd>=0:
    try: os.close(read_fd)
    except OSError: pass
   if write_fd>=0: os.close(write_fd)
 @unittest.skipUnless(os.name=="nt","Windows anonymous pipe required")
 def test_windows_rejected_noninheritable_identity_handle_is_closed(self):
  import ctypes, msvcrt
  from ctypes import wintypes
  read_fd,write_fd=os.pipe(); handle=msvcrt.get_osfhandle(read_fd)
  try:
   os.set_handle_inheritable(handle,False)
   with self.assertRaisesRegex(recovery.RecoveryError,"identity channel"):
    recovery._owned_identity_stream(Namespace(identity_fd=None,identity_handle=str(handle)))
   flags=wintypes.DWORD()
   kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
   kernel32.GetHandleInformation.argtypes=(wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD))
   kernel32.GetHandleInformation.restype=wintypes.BOOL
   self.assertFalse(kernel32.GetHandleInformation(wintypes.HANDLE(handle),ctypes.byref(flags)))
   read_fd=-1
  finally:
   if read_fd>=0:
    try: os.close(read_fd)
    except OSError: pass
   os.close(write_fd)
 @unittest.skipUnless(os.name=="nt","Windows restore ACL required")
 def test_windows_restore_workspace_service_and_plaintext_use_exact_dacls(self):
  self.windows_restrict.stop()
  self.workspace.stop()
  with tempfile.TemporaryDirectory() as raw:
   source=Path(raw)/"source.conf"
   source.write_text("[g035-local]\nhost=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n",encoding="utf8")
   recovery._windows_restrict_temporary_file(source)
   with patch.object(recovery,"_restrictive_directory",return_value=True):
    with recovery._restricted_restore_directory() as workspace:
     self.assertTrue(recovery._windows_dacl_restrictive(workspace,directory=True))
     service=recovery._copy_local_service(workspace,source,"g035-local")
     plain=workspace/"database.pgdump"; plain.write_bytes(b"plain")
     recovery._windows_restrict_temporary_file(plain)
     self.assertTrue(recovery._windows_dacl_restrictive(service))
     self.assertTrue(recovery._windows_dacl_restrictive(plain))
 def test_pre_data_use_list_comments_only_exact_schema_creation_and_rejects_toc_drift(self):
  expected=SCHEMA_TOC
  for entry in (
   b"10; 2615 2200 SCHEMA - public pg_database_owner\n",
   b"13; 2615 16400 SCHEMA - auth supabase_admin\n",
   b"14; 2615 16401 SCHEMA - storage supabase_admin\n",
  ):
   expected=expected.replace(entry,b";"+entry)
  self.assertEqual(expected,recovery._pre_data_use_list(SCHEMA_TOC))
  self.assertIn(b"COMMENT - SCHEMA public pg_database_owner",expected)
  self.assertIn(b"ACL - SCHEMA public pg_database_owner",expected)
  self.assertIn(b"SCHEMA - ocr_private postgres",expected)
  self.assertIn(b"SCHEMA - provider_budget_private postgres",expected)
  self.assertEqual((("ocr_private","postgres"),("provider_budget_private","postgres")),recovery.REQUIRED_HOSTED_SCHEMA_TOC)
  mutations=(
   SCHEMA_TOC.replace(b"pg_database_owner",b"postgres",1),
   SCHEMA_TOC.replace(b"10; 2615 2200 SCHEMA - public pg_database_owner\n",b""),
   SCHEMA_TOC.replace(
    b"10; 2615 2200 SCHEMA - public pg_database_owner\n",
    b"10; 2615 2200 SCHEMA - public pg_database_owner\n15; 2615 2200 SCHEMA - public pg_database_owner\n",
   ),
   SCHEMA_TOC.replace(b"13; 2615 16400 SCHEMA - auth supabase_admin\n",b"13; 2615 16400 SCHEMA - auth postgres\n"),
   SCHEMA_TOC.replace(b"14; 2615 16401 SCHEMA - storage supabase_admin\n",b""),
   SCHEMA_TOC.replace(b"15; 2615 16402 SCHEMA - ocr_private postgres\n",b""),
   SCHEMA_TOC.replace(b"16; 2615 16403 SCHEMA - provider_budget_private postgres\n",b"16; 2615 16403 SCHEMA - provider_budget_private privacy_workflow_owner\n"),
  )
  for mutation in mutations:
   with self.subTest(mutation=mutation),self.assertRaisesRegex(recovery.RecoveryError,"schema TOC drift"):
    recovery._pre_data_use_list(mutation)
 def test_data_use_lists_partition_exact_source_pinned_owners_and_all_other_data_once(self):
  postgres,privacy,privacy_relations=recovery._data_use_lists(SCHEMA_TOC)
  self.assertEqual((postgres,privacy,privacy_relations),recovery._data_use_lists(SCHEMA_TOC))
  self.assertEqual(tuple(("privacy_retention",f"privacy_{index}") for index in range(61)),privacy_relations)
  self.assertEqual({
   ("ocr_private","ocr_daily_quota_reservations"),
   ("provider_budget_private","admin_provider_budget_policies"),
   ("provider_budget_private","admin_provider_budget_counters"),
   ("provider_budget_private","admin_provider_budget_decisions"),
  },set(recovery.REQUIRED_HOSTED_TABLE_DATA_RELATIONS))
  for entry in POSTGRES_TABLE_DATA:
   self.assertIn(entry,postgres)
   self.assertIn(b";"+entry,privacy)
  for entry in PRIVACY_TABLE_DATA:
   self.assertIn(b";"+entry,postgres)
   self.assertIn(entry,privacy)
  for entry in NON_TABLE_DATA.splitlines(keepends=True):
   self.assertIn(entry,postgres)
   self.assertIn(b";"+entry,privacy)
  self.assertEqual(50,sum(not line.startswith(b";") and b" TABLE DATA " in line for line in postgres.splitlines()))
  self.assertEqual(61,sum(not line.startswith(b";") and b" TABLE DATA " in line for line in privacy.splitlines()))

 def test_data_use_lists_reject_owner_count_owner_alias_managed_data_and_classification_drift(self):
  required_relation_mutations=(
   *(SCHEMA_TOC.replace(entry,b"",1) for entry in REQUIRED_HOSTED_TABLE_DATA),
   SCHEMA_TOC.replace(b"ocr_private ocr_daily_quota_reservations",b"public ocr_daily_quota_reservations",1),
   SCHEMA_TOC.replace(b"provider_budget_private admin_provider_budget_policies",b"public admin_provider_budget_policies",1),
   SCHEMA_TOC.replace(b"provider_budget_private admin_provider_budget_counters",b"public admin_provider_budget_counters",1),
   SCHEMA_TOC.replace(b"provider_budget_private admin_provider_budget_decisions",b"public admin_provider_budget_decisions",1),
  )
  for mutation in required_relation_mutations:
   with self.subTest(required_relation_mutation=mutation),self.assertRaises(recovery.RecoveryError):
    recovery._data_use_lists(mutation)
  compensating_owner_swap=SCHEMA_TOC.replace(
   b"TABLE DATA ocr_private ocr_daily_quota_reservations postgres",
   b"TABLE DATA ocr_private ocr_daily_quota_reservations privacy_workflow_owner",
   1,
  ).replace(
   b"TABLE DATA privacy_retention privacy_0 privacy_workflow_owner",
   b"TABLE DATA privacy_retention privacy_0 postgres",
   1,
  )
  with self.assertRaisesRegex(recovery.RecoveryError,"required hosted TABLE DATA owner drift"):
   recovery._data_use_lists(compensating_owner_swap)
  mutations=(
   SCHEMA_TOC.replace(POSTGRES_TABLE_DATA[0],b"",1),
   SCHEMA_TOC.replace(b"privacy_retention privacy_0",b"auth privacy_0",1),
   SCHEMA_TOC.replace(b"TABLE DATA public postgres_0",b"TABLE  DATA public postgres_0",1),
   SCHEMA_TOC.replace(b"public postgres_45 postgres",b"public postgres_0 postgres",1),
   SCHEMA_TOC.replace(b"1045; 0 2045 TABLE DATA",b"1000; 0 2045 TABLE DATA",1),
   SCHEMA_TOC.replace(b"privacy_workflow_owner\n",b"privacy_workflow_owner extra\n",1),
  )
  for mutation in mutations:
   with self.subTest(mutation=mutation),self.assertRaises(recovery.RecoveryError):
    recovery._data_use_lists(mutation)
 def test_post_data_use_lists_pin_exact_totals_runs_order_and_canonical_bytes(self):
  self.assertEqual(EXPECTED_POST_DATA_OWNER_COUNTS,recovery.POST_DATA_OWNER_COUNTS)
  self.assertEqual(EXPECTED_POST_DATA_OWNER_RUNS,recovery.POST_DATA_OWNER_RUNS)
  use_lists=recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
  self.assertEqual(tuple(owner for owner,unused in use_lists),tuple(owner for owner,unused in EXPECTED_POST_DATA_OWNER_RUNS))
  self.assertEqual(90,len(use_lists))
  source_lines=POST_DATA_TOC_BYTES.splitlines(keepends=True); selected=[]
  for (owner,count),(actual_owner,payload) in zip(EXPECTED_POST_DATA_OWNER_RUNS,use_lists):
   self.assertEqual(owner,actual_owner)
   candidate_lines=payload.splitlines(keepends=True)
   self.assertEqual(len(source_lines),len(candidate_lines))
   self.assertTrue(all(candidate==source or candidate==b";"+source for source,candidate in zip(source_lines,candidate_lines)))
   active=[line for line in candidate_lines if line.strip() and not line.startswith(b";")]
   self.assertEqual(count,len(active)); self.assertTrue(all(line.rstrip().endswith(b" "+owner.encode()) for line in active))
   selected.extend(int(line.split(b";",1)[0]) for line in active)
   self.assertEqual(b"; canonical post-data TOC\n\n",b"".join(candidate_lines[:2]))
   self.assertEqual(b"; canonical trailer\n",candidate_lines[-1])
  self.assertEqual([3000+index for index in range(len(POST_DATA_ROWS))],selected)
 def test_post_data_toc_rejects_malformed_duplicate_unknown_owner_count_and_run_drift(self):
  malformed=(
   POST_DATA_TOC_BYTES.replace(b"3000;",b"0;",1),
   POST_DATA_TOC_BYTES.replace(b"12000 22000",b"x 22000",1),
   POST_DATA_TOC_BYTES.replace(POST_DATA_ROWS[0],b"3000; 12000 22000 supabase_auth_admin\n",1),
   POST_DATA_TOC_BYTES.replace(b"supabase_auth_admin\n",b"rds_superuser\n",1),
   POST_DATA_TOC_BYTES.replace(b"3001;",b"3000;",1),
   POST_DATA_TOC_BYTES.replace(POST_DATA_ROWS[0],b"",1),
   POST_DATA_TOC_BYTES.replace(b"supabase_auth_admin\n",b"privacy_workflow_owner\n",1),
  )
  for raw in malformed:
   with self.subTest(raw=raw[:100]),self.assertRaises(recovery.RecoveryError):
    recovery._post_data_use_lists(raw)
  runs=list(EXPECTED_POST_DATA_OWNER_RUNS); runs[0]=("privacy_workflow_owner",2); runs[3]=("privacy_workflow_owner",82)
  with patch.object(recovery,"POST_DATA_OWNER_RUNS",tuple(runs)),self.assertRaisesRegex(recovery.RecoveryError,"run drift"):
   recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
  counts=list(EXPECTED_POST_DATA_OWNER_COUNTS); counts[0]=("postgres",453)
  with patch.object(recovery,"POST_DATA_OWNER_COUNTS",tuple(counts)),self.assertRaisesRegex(recovery.RecoveryError,"count drift"):
   recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
 def test_post_data_use_list_validation_rejects_omission_duplication_and_owner_mutation(self):
  valid=recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
  owner,payload=valid[0]; omitted=((owner,payload.replace(POST_DATA_ROWS[0],b";"+POST_DATA_ROWS[0],1)),)+valid[1:]
  with self.assertRaisesRegex(recovery.RecoveryError,"coverage"):
   recovery._validate_post_data_use_lists(POST_DATA_TOC_BYTES,omitted)
  second_run_row=POST_DATA_ROWS[EXPECTED_POST_DATA_OWNER_RUNS[0][1]]
  duplicated=((owner,payload.replace(b";"+second_run_row,second_run_row,1)),)+valid[1:]
  with self.assertRaisesRegex(recovery.RecoveryError,"coverage"):
   recovery._validate_post_data_use_lists(POST_DATA_TOC_BYTES,duplicated)
  mutated=(("postgres",valid[0][1]),)+valid[1:]
  with self.assertRaisesRegex(recovery.RecoveryError,"coverage"):
   recovery._validate_post_data_use_lists(POST_DATA_TOC_BYTES,mutated)
 def test_post_data_source_requires_canonical_section_list_owner_runs_and_no_monolithic_fallback(self):
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf-8")
  self.assertIn('post_data_toc=run([restore,"--section=post-data","--list",str(plain)]',source)
  self.assertIn('argv=[restore,"--section=post-data",f"--use-list={path}",f"--role={owner}","--dbname=service=g035-local",str(plain)]',source)
  self.assertIn('POST_DATA_PRIVACY_TRIGGER_RUNS = ((35,57),(37,2),(39,13))',source)
  self.assertNotIn('POST_DATA_PRIVACY_TRIGGER_RUN =',source)
  self.assertNotIn('run([restore,"--section=post-data","--dbname=service=g035-local",str(plain)]',source)
  self.assertNotIn("--no-owner",source); self.assertNotIn("--no-acl",source)
 def test_post_data_storage_auth_schema_authority_pins_run_role_schema_owner_and_rejects_mutation(self):
  self.assertEqual((82,"supabase_storage_admin","auth","supabase_admin"),recovery.POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY)
  self.assertEqual(("supabase_storage_admin",18),recovery.POST_DATA_OWNER_RUNS[81])
  recovery._validate_post_data_storage_auth_schema_contract()
  mutations=([82,"supabase_storage_admin","auth","supabase_admin"],(81,"supabase_storage_admin","auth","supabase_admin"),(82,"postgres","auth","supabase_admin"),(82,"supabase_storage_admin","storage","supabase_admin"),(82,"supabase_storage_admin","auth","postgres"))
  for mutation in mutations:
   with self.subTest(mutation=mutation),patch.object(recovery,"POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY",mutation),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
    recovery._validate_post_data_storage_auth_schema_contract()
  runs=list(recovery.POST_DATA_OWNER_RUNS); runs[81]=("supabase_storage_admin",17)
  with patch.object(recovery,"POST_DATA_OWNER_RUNS",tuple(runs)),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
   recovery._validate_post_data_storage_auth_schema_contract()
  self.assertIn("coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))",recovery.POST_DATA_SCHEMA_AUTHORITY_SQL)
  self.assertIn("pg_catalog.has_schema_privilege(target.oid,namespace.oid,'USAGE')",recovery.POST_DATA_SCHEMA_AUTHORITY_SQL)
  self.assertIn("EXISTS (SELECT 1 FROM pg_catalog.aclexplode(namespace.nspacl)",recovery.POST_DATA_SCHEMA_AUTHORITY_SQL)
  for row in (
   ("auth","postgres",[],False,False,False,False),
   ("auth","supabase_admin",None,False,False,False,False),
   ("auth","supabase_admin",[],True,False,False,False),
   ("auth","supabase_admin",[],False,False,True,False),
   ("auth","supabase_admin",[],False,True,False,False),
  ):
   with self.subTest(row=row),patch.object(recovery,"_query_conn",return_value=[row]),self.assertRaises(recovery.RecoveryError):
    recovery._read_post_data_storage_auth_schema_state(object(),baseline=True)
 def test_post_data_storage_auth_schema_authority_restores_exact_acl_and_effective_state(self):
  state={"owner":"supabase_admin","acl":[["auditor","supabase_admin","USAGE",False],["supabase_admin","supabase_admin","CREATE",False],["supabase_admin","supabase_admin","USAGE",False]],"usage":False,"create":False,"direct_usage":False,"direct_create":False}
  original=json.loads(json.dumps(state)); statements=[]; current_role=None
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  conn=Conn()
  def query(unused,sql,params=None):
   nonlocal current_role
   statements.append(sql)
   if sql==recovery.POST_DATA_SCHEMA_AUTHORITY_SQL:
    self.assertEqual(("supabase_storage_admin","auth"),params)
    return [("auth",state["owner"],state["acl"],state["usage"],state["create"],state["direct_usage"],state["direct_create"])]
   if sql.startswith("SET LOCAL ROLE "): current_role=sql.removeprefix("SET LOCAL ROLE "); return []
   if sql=="GRANT USAGE ON SCHEMA auth TO supabase_storage_admin":
    self.assertEqual("supabase_admin",current_role); state["acl"].append(["supabase_storage_admin","supabase_admin","USAGE",False]); state["acl"].sort(); state["usage"]=state["direct_usage"]=True; return []
   if sql=="REVOKE USAGE ON SCHEMA auth FROM supabase_storage_admin":
    self.assertEqual("supabase_admin",current_role); state["acl"].remove(["supabase_storage_admin","supabase_admin","USAGE",False]); state["usage"]=state["direct_usage"]=False; return []
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline=recovery._open_post_data_storage_auth_schema_window(conn)
   self.assertTrue(state["usage"] and state["direct_usage"]); self.assertFalse(state["create"] or state["direct_create"])
   recovery._close_post_data_storage_auth_schema_window(conn,baseline)
  self.assertEqual(original,state)
  self.assertEqual(1,statements.count("GRANT USAGE ON SCHEMA auth TO supabase_storage_admin"))
  self.assertEqual(1,statements.count("REVOKE USAGE ON SCHEMA auth FROM supabase_storage_admin"))
  privilege_sql=[sql for sql in statements if sql.startswith(("GRANT ","REVOKE "))]
  self.assertFalse(any(any(forbidden in sql for forbidden in (" PUBLIC"," ALL "," CREATE ","privacy_workflow_owner")) for sql in privilege_sql))
  self.assertEqual(2,conn.commits); self.assertEqual(0,conn.rollbacks)
 def test_post_data_storage_auth_schema_window_is_bounded_to_run_82_and_cleans_up_on_failure(self):
  events=[]; baseline=("baseline",)
  def authority(unused_env,operation,*args):
   events.append(("authority",operation,args))
   return baseline if operation is recovery._open_post_data_storage_auth_schema_window else None
  def execute(argv,**unused):
   events.append(("run",argv))
   if "--use-list=run-82.list" in argv: raise recovery.RecoveryError("run 82 failed")
  with patch.object(recovery,"_with_post_data_storage_auth_schema_connection",side_effect=authority),patch.object(recovery,"run",side_effect=execute):
   recovery._restore_post_data_owner_run("pg_restore",Path("database.pgdump"),{},81,"postgres",Path("run-81.list"))
   with self.assertRaisesRegex(recovery.RecoveryError,"run 82 failed"):
    recovery._restore_post_data_owner_run("pg_restore",Path("database.pgdump"),{},82,"supabase_storage_admin",Path("run-82.list"))
   recovery._restore_post_data_owner_run("pg_restore",Path("database.pgdump"),{},83,"supabase_auth_admin",Path("run-83.list"))
  self.assertEqual([
   ("run",["pg_restore","--section=post-data","--use-list=run-81.list","--role=postgres","--dbname=service=g035-local","database.pgdump"]),
   ("authority",recovery._open_post_data_storage_auth_schema_window,()),
   ("run",["pg_restore","--section=post-data","--use-list=run-82.list","--role=supabase_storage_admin","--dbname=service=g035-local","database.pgdump"]),
   ("authority",recovery._close_post_data_storage_auth_schema_window,(baseline,)),
   ("run",["pg_restore","--section=post-data","--use-list=run-83.list","--role=supabase_auth_admin","--dbname=service=g035-local","database.pgdump"]),
  ],events)
 def test_post_data_trigger_authority_pins_exact_roles_signatures_owners_and_schema(self):
  self.assertEqual((
   ("postgres","privacy_retention.g014_account_deletion_admin_removal_fence()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_account_deletion_item_binding_guard()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_account_deletion_prevent_activated_class_mutation()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_account_deletion_prevent_activated_policy_mutation()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_account_deletion_request_binding_guard()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_account_deletion_seed_external_jobs()","privacy_workflow_owner",True),
   ("postgres","privacy_retention.g014_reject_audit_mutation()","privacy_workflow_owner",True),
   ("postgres","public.g014_marketing_batch_transition()","privacy_workflow_owner",True),
   ("postgres","public.g014_marketing_operation_terminal_guard()","privacy_workflow_owner",True),
   ("postgres","public.g014_marketing_public_recipient_transition()","privacy_workflow_owner",True),
   ("supabase_auth_admin","public.handle_new_user()","postgres",False),
   ("supabase_auth_admin","public.handle_new_user_avatar()","postgres",False),
   ("supabase_storage_admin","privacy_retention.g014_account_deletion_storage_write_fence()","privacy_workflow_owner",False),
  ),recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY)
  self.assertEqual((("privacy_retention","supabase_storage_admin","privacy_workflow_owner"),),recovery.POST_DATA_TRIGGER_SCHEMA_AUTHORITY)
  recovery._validate_post_data_trigger_authority_contract()
 def test_post_data_trigger_authority_rejects_contract_mutation_and_baseline_drift(self):
  role,signature,owner,expected_effective=recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY[0]
  valid=(signature,owner,[[owner,owner,"EXECUTE",False]],expected_effective,False)
  mutations=(
   [],
   [valid,valid],
   [("public.wrong()",owner,valid[2],expected_effective,False)],
   [(signature,"postgres",valid[2],expected_effective,False)],
   [(signature,owner,valid[2],False,False)],
   [(signature,owner,valid[2],expected_effective,True)],
   [(signature,owner,[[role,owner,"EXECUTE",False]],expected_effective,False)],
   [(signature,owner,[[owner,owner,"UPDATE",False]],expected_effective,False)],
   [(signature,owner,[[owner,owner,"EXECUTE",False],[owner,owner,"EXECUTE",False]],expected_effective,False)],
  )
  for rows in mutations:
   with self.subTest(rows=rows),patch.object(recovery,"_query_conn",return_value=rows),self.assertRaises(recovery.RecoveryError):
    recovery._read_post_data_trigger_authority_baseline(object())
  contract=recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY
  contract_mutations=(list(contract),contract[::-1],((contract[0][0],contract[0][1],"postgres",True),)+contract[1:],(contract[0][:3]+(False,),)+contract[1:])
  for mutation in contract_mutations:
   with self.subTest(contract=mutation),patch.object(recovery,"POST_DATA_TRIGGER_FUNCTION_AUTHORITY",mutation),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
    recovery._validate_post_data_trigger_authority_contract()
  self.assertNotIn("coalesce(procedure.proacl,'{}'::aclitem[])",recovery.POST_DATA_FUNCTION_AUTHORITY_SQL)
  self.assertNotIn("coalesce(namespace.nspacl,'{}'::aclitem[])",recovery.POST_DATA_SCHEMA_AUTHORITY_SQL)
  self.assertNotIn("coalesce(class.relacl,'{}'::aclitem[])",recovery.POST_DATA_TABLE_TRIGGER_STATE_SQL)
  def query(unused,sql,params=None):
   if sql==recovery.POST_DATA_FUNCTION_AUTHORITY_SQL:
    target_role,target_signature=params
    target=next(item for item in recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY if item[:2]==(target_role,target_signature))
    return [(target_signature,target[2],[[target[2],target[2],"EXECUTE",False]],target[3],False)]
   return [("privacy_retention","privacy_workflow_owner",[["privacy_workflow_owner","privacy_workflow_owner","CREATE",False],["privacy_workflow_owner","privacy_workflow_owner","USAGE",False]],False,True,False,False)]
  with patch.object(recovery,"_query_conn",side_effect=query),self.assertRaisesRegex(recovery.RecoveryError,"schema authority state"):
   recovery._read_post_data_trigger_authority_baseline(object())
 def test_post_data_trigger_authority_grants_and_revokes_only_exact_acl_delta_and_restores_baseline(self):
  function_state={(role,signature):{"owner":owner,"acl":[[owner,owner,"EXECUTE",False]],"baseline_effective":effective,"effective":effective,"direct":False} for role,signature,owner,effective in recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY}
  schema_state={("privacy_retention","supabase_storage_admin"):{"owner":"privacy_workflow_owner","acl":[["privacy_workflow_owner","privacy_workflow_owner","CREATE",False],["privacy_workflow_owner","privacy_workflow_owner","USAGE",False]],"usage":False,"create":False,"direct_usage":False,"direct_create":False}}
  original_functions={key:{"owner":state["owner"],"acl":[list(item) for item in state["acl"]],"baseline_effective":state["baseline_effective"],"effective":state["effective"],"direct":state["direct"]} for key,state in function_state.items()}; original_schemas={key:{"owner":state["owner"],"acl":[list(item) for item in state["acl"]],"usage":state["usage"],"create":state["create"],"direct_usage":state["direct_usage"],"direct_create":state["direct_create"]} for key,state in schema_state.items()}; statements=[]; current_role=None
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  conn=Conn()
  def query(unused,sql,params=None):
   nonlocal current_role
   statements.append(sql)
   if sql==recovery.POST_DATA_FUNCTION_AUTHORITY_SQL:
    role,signature=params; state=function_state[(role,signature)]
    return [(signature,state["owner"],state["acl"],state["effective"],state["direct"])]
   if sql==recovery.POST_DATA_SCHEMA_AUTHORITY_SQL:
    role,schema=params; state=schema_state[(schema,role)]
    return [(schema,state["owner"],state["acl"],state["usage"],state["create"],state["direct_usage"],state["direct_create"])]
   if sql.startswith("SET LOCAL ROLE "):
    current_role=sql.removeprefix("SET LOCAL ROLE "); return []
   for role,signature,owner,baseline_effective in recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
    state=function_state[(role,signature)]
    if sql==recovery._post_data_function_authority_statement(role,signature,True):
     self.assertFalse(baseline_effective); self.assertEqual(owner,current_role); state["acl"].append([role,owner,"EXECUTE",False]); state["acl"].sort(); state["effective"]=state["direct"]=True; return []
    if sql==recovery._post_data_function_authority_statement(role,signature,False):
     self.assertFalse(baseline_effective); self.assertEqual(owner,current_role); state["acl"].remove([role,owner,"EXECUTE",False]); state["effective"]=state["baseline_effective"]; state["direct"]=False; return []
   for schema,role,owner in recovery.POST_DATA_TRIGGER_SCHEMA_AUTHORITY:
    state=schema_state[(schema,role)]
    if sql==recovery._post_data_schema_authority_statement(schema,role,True):
     self.assertEqual(owner,current_role); state["acl"].append([role,owner,"USAGE",False]); state["acl"].sort(); state["usage"]=state["direct_usage"]=True; return []
    if sql==recovery._post_data_schema_authority_statement(schema,role,False):
     self.assertEqual(owner,current_role); state["acl"].remove([role,owner,"USAGE",False]); state["usage"]=state["direct_usage"]=False; return []
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline=recovery._open_post_data_trigger_authority_window(conn)
   self.assertTrue(all(state["effective"] for state in function_state.values())); self.assertTrue(all(state["direct"] is (not state["baseline_effective"]) for state in function_state.values()))
   self.assertTrue(schema_state[("privacy_retention","supabase_storage_admin")]["usage"])
   self.assertFalse(schema_state[("privacy_retention","supabase_storage_admin")]["create"])
   recovery._close_post_data_trigger_authority_window(conn,baseline)
  self.assertEqual(original_functions,function_state); self.assertEqual(original_schemas,schema_state)
  for role,signature,unused_owner,baseline_effective in recovery.POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
   expected_count=0 if baseline_effective else 1
   self.assertEqual(expected_count,statements.count(f"GRANT EXECUTE ON FUNCTION {signature} TO {role}"))
   self.assertEqual(expected_count,statements.count(f"REVOKE EXECUTE ON FUNCTION {signature} FROM {role}"))
  self.assertEqual(1,statements.count("GRANT USAGE ON SCHEMA privacy_retention TO supabase_storage_admin"))
  self.assertEqual(1,statements.count("REVOKE USAGE ON SCHEMA privacy_retention FROM supabase_storage_admin"))
  privilege_statements=[sql for sql in statements if sql.startswith(("GRANT ","REVOKE "))]
  self.assertFalse(any(any(forbidden in sql for forbidden in (" PUBLIC"," ALL "," CREATE ","BYPASSRLS","SUPERUSER")) for sql in privilege_statements))
  self.assertEqual(2,conn.commits); self.assertEqual(0,conn.rollbacks)
 def test_post_data_fk_authority_pins_exact_contract_and_rejects_alias_order_and_type_mutations(self):
  expected=(
   ("postgres","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
   ("postgres","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
   ("privacy_workflow_owner","auth","users","supabase_auth_admin"),
   ("privacy_workflow_owner","privacy_retention","marketing_campaign_batch_recipients","privacy_workflow_owner"),
   ("privacy_workflow_owner","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
   ("privacy_workflow_owner","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
   ("privacy_workflow_owner","privacy_retention","privacy_guardian_verifications","privacy_workflow_owner"),
   ("privacy_workflow_owner","privacy_retention","privacy_onboarding_challenges","privacy_workflow_owner"),
   ("privacy_workflow_owner","public","marketing_campaign_recipients","postgres"),
  )
  self.assertEqual(expected,recovery.POST_DATA_FK_TABLE_AUTHORITY)
  self.assertEqual((("auth","privacy_workflow_owner","supabase_admin"),),recovery.POST_DATA_FK_SCHEMA_AUTHORITY)
  recovery._validate_post_data_fk_authority_contract()
  mutations=(list(expected),expected[::-1],(("postgres","privacy_retention","privacy_audit_events","postgres"),)+expected[1:],(("postgres","privacy_retention","privacy-audit-events","privacy_workflow_owner"),)+expected[1:])
  for mutation in mutations:
   with self.subTest(mutation=mutation),patch.object(recovery,"POST_DATA_FK_TABLE_AUTHORITY",mutation),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
    recovery._validate_post_data_fk_authority_contract()
  for mutation in ([("auth","privacy_workflow_owner","supabase_admin")],(("privacy_retention","privacy_workflow_owner","supabase_admin"),),(("auth","authenticated","supabase_admin"),)):
   with self.subTest(schema_mutation=mutation),patch.object(recovery,"POST_DATA_FK_SCHEMA_AUTHORITY",mutation),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
    recovery._validate_post_data_fk_authority_contract()
  self.assertIn("pg_catalog.acldefault('r',class.relowner)",recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL)
  self.assertIn("pg_catalog.has_table_privilege(target.oid,class.oid,'REFERENCES')",recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL)
  self.assertNotIn("'{}'::aclitem[]",recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL)
 def test_post_data_fk_authority_rejects_missing_owner_effective_direct_acl_and_create_drift(self):
  first=recovery.POST_DATA_FK_TABLE_AUTHORITY[0]
  def query(unused,sql,params=None,mutation=None):
   if sql==recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL:
    role,schema,table=params; item=next(item for item in recovery.POST_DATA_FK_TABLE_AUTHORITY if item[:3]==(role,schema,table))
    row=(schema,table,item[3],[[item[3],item[3],"SELECT",False]],False,False)
    return mutation(item,row) if item==first and mutation is not None else [row]
   schema,role=params
   return [(schema,"supabase_admin",[["supabase_admin","supabase_admin","CREATE",False],["supabase_admin","supabase_admin","USAGE",False]],False,False,False,False)]
  mutations=(
   lambda item,row:[],
   lambda item,row:[(row[0],row[1],"postgres",*row[3:])],
   lambda item,row:[(*row[:4],True,False)],
   lambda item,row:[(*row[:5],True)],
   lambda item,row:[(*row[:3],[[item[0],item[3],"REFERENCES",False]],False,False)],
  )
  for mutation in mutations:
   with self.subTest(mutation=mutation),patch.object(recovery,"_query_conn",side_effect=lambda conn,sql,params=None,m=mutation:query(conn,sql,params,m)),self.assertRaisesRegex(recovery.RecoveryError,"table authority state"):
    recovery._read_post_data_fk_authority_state(object(),baseline=True)
  def schema_query(unused,sql,params=None):
   if sql==recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL: return query(unused,sql,params)
   return [("auth","supabase_admin",[["supabase_admin","supabase_admin","USAGE",False]],False,True,False,False)]
  with patch.object(recovery,"_query_conn",side_effect=schema_query),self.assertRaisesRegex(recovery.RecoveryError,"schema authority state"):
   recovery._read_post_data_fk_authority_state(object(),baseline=True)
 def test_post_data_fk_window_aggregates_shared_object_grants_and_rejects_disagreement(self):
  object_acl={}
  tables=[]
  for role,schema,table,owner in recovery.POST_DATA_FK_TABLE_AUTHORITY:
   acl=object_acl.setdefault((schema,table,owner),((owner,owner,"SELECT",False),))
   tables.append((role,schema,table,owner,acl,False,False))
  schemas=(("auth","privacy_workflow_owner","supabase_admin",(("supabase_admin","supabase_admin","USAGE",False),),False,False,False,False),)
  baseline=(tuple(tables),schemas)
  window_tables,unused_schemas=recovery._post_data_fk_window_state(baseline)
  for table in ("privacy_audit_events","privacy_consent_events"):
   views=tuple(item for item in window_tables if item[1:3]==("privacy_retention",table))
   self.assertEqual(2,len(views))
   self.assertEqual(views[0][4],views[1][4])
   self.assertEqual((True,True),views[0][5:])
   self.assertEqual((True,True),views[1][5:])
   self.assertIn(("postgres","privacy_workflow_owner","REFERENCES",False),views[0][4])
   self.assertIn(("privacy_workflow_owner","privacy_workflow_owner","REFERENCES",False),views[0][4])
  audit_duplicate=next(index for index,item in enumerate(tables) if item[:3]==("privacy_workflow_owner","privacy_retention","privacy_audit_events"))
  contradictions=(
   (*tables[audit_duplicate][:3],"postgres",*tables[audit_duplicate][4:]),
   (*tables[audit_duplicate][:4],tuple(sorted((*tables[audit_duplicate][4],("auditor","postgres","REFERENCES",False)))),False,False),
   (*tables[audit_duplicate][:5],True,False),
   (*tables[audit_duplicate][:5],False,True),
  )
  for contradiction in contradictions:
   changed=(*tables[:audit_duplicate],contradiction,*tables[audit_duplicate+1:])
   with self.subTest(contradiction=contradiction),self.assertRaisesRegex(recovery.RecoveryError,"baseline invalid"):
    recovery._post_data_fk_window_state((changed,schemas))
 def test_post_data_fk_authority_preserves_heterogeneous_acl_and_restores_exact_baseline(self):
  states={}
  for index,(schema,table,owner) in enumerate(dict.fromkeys((item[1],item[2],item[3]) for item in recovery.POST_DATA_FK_TABLE_AUTHORITY)):
   acl=[[owner,owner,"SELECT",False]]
   if index%2: acl.append(["auditor","postgres","REFERENCES",False])
   states[(schema,table)]={"owner":owner,"acl":sorted(acl)}
  schema_state={"owner":"supabase_admin","acl":[["auditor","supabase_admin","USAGE",False],["supabase_admin","supabase_admin","CREATE",False],["supabase_admin","supabase_admin","USAGE",False]],"usage":False,"create":False,"direct_usage":False,"direct_create":False}
  original=json.loads(json.dumps({"tables":{"|".join(key):value for key,value in states.items()},"schema":schema_state}))
  statements=[]; current_role=None
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  conn=Conn()
  def query(unused,sql,params=None):
   nonlocal current_role
   statements.append(sql)
   if sql==recovery.POST_DATA_FK_TABLE_AUTHORITY_SQL:
    role,schema,table=params; state=states[(schema,table)]
    direct=[role,state["owner"],"REFERENCES",False] in state["acl"]
    return [(schema,table,state["owner"],state["acl"],direct,direct)]
   if sql==recovery.POST_DATA_SCHEMA_AUTHORITY_SQL:
    role,schema=params
    return [(schema,schema_state["owner"],schema_state["acl"],schema_state["usage"],schema_state["create"],schema_state["direct_usage"],schema_state["direct_create"])]
   if sql.startswith("SET LOCAL ROLE "): current_role=sql.removeprefix("SET LOCAL ROLE "); return []
   for role,schema,table,owner in recovery.POST_DATA_FK_TABLE_AUTHORITY:
    state=states[(schema,table)]
    if sql==recovery._post_data_fk_table_statement(role,schema,table,True):
     self.assertEqual(owner,current_role); state["acl"].append([role,owner,"REFERENCES",False]); state["acl"].sort(); return []
    if sql==recovery._post_data_fk_table_statement(role,schema,table,False):
     self.assertEqual(owner,current_role); state["acl"].remove([role,owner,"REFERENCES",False]); return []
   if sql==recovery._post_data_schema_authority_statement("auth","privacy_workflow_owner",True):
    self.assertEqual("supabase_admin",current_role); schema_state["acl"].append(["privacy_workflow_owner","supabase_admin","USAGE",False]); schema_state["acl"].sort(); schema_state["usage"]=schema_state["direct_usage"]=True; return []
   if sql==recovery._post_data_schema_authority_statement("auth","privacy_workflow_owner",False):
    self.assertEqual("supabase_admin",current_role); schema_state["acl"].remove(["privacy_workflow_owner","supabase_admin","USAGE",False]); schema_state["usage"]=schema_state["direct_usage"]=False; return []
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline=recovery._open_post_data_fk_authority_window(conn)
   for role,schema,table,owner in recovery.POST_DATA_FK_TABLE_AUTHORITY:
    self.assertIn([role,owner,"REFERENCES",False],states[(schema,table)]["acl"])
   self.assertTrue(schema_state["usage"] and schema_state["direct_usage"]); self.assertFalse(schema_state["create"]); self.assertFalse(schema_state["direct_create"])
   recovery._close_post_data_fk_authority_window(conn,baseline)
  self.assertEqual(original,{"tables":{"|".join(key):value for key,value in states.items()},"schema":schema_state})
  table_privilege_sql=[]
  for role,schema,table,unused_owner in recovery.POST_DATA_FK_TABLE_AUTHORITY:
   grant=recovery._post_data_fk_table_statement(role,schema,table,True)
   revoke=recovery._post_data_fk_table_statement(role,schema,table,False)
   self.assertEqual(1,statements.count(grant))
   self.assertEqual(1,statements.count(revoke))
   table_privilege_sql.extend((grant,revoke))
  self.assertEqual(18,len(table_privilege_sql))
  privilege_sql=[sql for sql in statements if sql.startswith(("GRANT ","REVOKE "))]
  self.assertEqual(20,len(privilege_sql))
  self.assertFalse(any("*" in sql or " PUBLIC" in sql or " ALL " in sql or " CREATE " in sql or any(privilege in sql for privilege in (" INSERT "," SELECT "," UPDATE "," DELETE "," TRIGGER "," TRUNCATE "," MAINTAIN ")) for sql in privilege_sql))
  self.assertEqual(2,conn.commits); self.assertEqual(0,conn.rollbacks)
 def test_post_data_table_trigger_scope_is_strictly_derived_from_exact_runs_and_root(self):
  self.assertEqual(((35,57),(37,2),(39,13)),recovery.POST_DATA_PRIVACY_TRIGGER_RUNS)
  self.assertEqual(50,recovery.POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT)
  self.assertEqual("cbc67324f680a0e0d5bd9861e69e313dd86f2bc00d0da462fe1861c5c7de3dae",recovery.POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT)
  with patch.object(recovery.hashlib,"sha256",side_effect=_test_trigger_sha256):
   self.assertEqual(TEST_TRIGGER_RELATIONS,recovery._post_data_privacy_trigger_relations(TEST_TRIGGER_RUNS))
   run_payload=TEST_TRIGGER_RUNS[34][1]
   mutations=(
    run_payload.replace(b"TRIGGER public trigger_table_0 trigger_0",b"CONSTRAINT public trigger_table_0 trigger_0",1),
    run_payload.replace(b"TRIGGER public trigger_table_0 trigger_0",b"TRIGGER public trigger_table_0 trigger_40",1),
    run_payload.replace(b"TRIGGER public trigger_table_0",b"TRIGGER changed trigger_table_0",1),
    run_payload.replace(b"trigger_0 privacy_workflow_owner\n",b"trigger_0 postgres\n",1),
    run_payload.replace(TEST_TRIGGER_ROWS[0],b";"+TEST_TRIGGER_ROWS[0],1),
    run_payload.replace(b";"+POST_DATA_ROWS[0],POST_DATA_ROWS[0],1),
   )
   for payload in mutations:
    runs=(*TEST_TRIGGER_RUNS[:34],(recovery.PRIVACY_DATA_ROLE,payload),*TEST_TRIGGER_RUNS[35:])
    with self.subTest(payload=payload),self.assertRaises(recovery.RecoveryError):
     recovery._post_data_privacy_trigger_relations(runs)
   for run in (37,39):
    original=TEST_TRIGGER_RUNS[run-1][1]
    active=next(line for line in original.splitlines(keepends=True) if not line.startswith(b";") and b" TRIGGER " in line)
    payload=original.replace(active,active.replace(b" TRIGGER ",b" CONSTRAINT ",1),1)
    runs=(*TEST_TRIGGER_RUNS[:run-1],(recovery.PRIVACY_DATA_ROLE,payload),*TEST_TRIGGER_RUNS[run:])
    with self.subTest(run=run),self.assertRaisesRegex(recovery.RecoveryError,"descriptor invalid"):
     recovery._post_data_privacy_trigger_relations(runs)
  self.assertNotIn("relations",recovery._restore_post_data_with_trigger_authority.__code__.co_varnames[:6])
  with patch.object(recovery,"POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT","0"*64),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
   recovery._validate_post_data_privacy_trigger_contract()
  with patch.object(recovery,"POST_DATA_PRIVACY_TRIGGER_RUNS",((35,57),(37,2))),self.assertRaisesRegex(recovery.RecoveryError,"contract invalid"):
   recovery._validate_post_data_privacy_trigger_contract()
 def test_post_data_table_trigger_window_preserves_heterogeneous_acl_and_grants_exact_subset(self):
  relations=TEST_TRIGGER_RELATIONS
  state={}
  for index,relation in enumerate(relations):
   effective=index%3==0
   acl=[[recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"SELECT",False]]
   if index%5==0: acl.append(["auditor","postgres","REFERENCES",False])
   state[relation]={"owner":recovery.PRIVACY_DATA_ROLE,"rls":bool(index%2),"force":bool(index%4),"acl":sorted(acl),"effective":effective}
  baseline_state=json.loads(json.dumps({f"{key[0]}.{key[1]}":value for key,value in state.items()}))
  added=tuple(relation for relation in relations if not state[relation]["effective"])
  grant=recovery._post_data_table_trigger_statement(added,True); revoke=recovery._post_data_table_trigger_statement(added,False)
  statements=[]
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  conn=Conn()
  def query(unused,sql,params=None):
   statements.append(sql)
   if sql==recovery.POST_DATA_TABLE_TRIGGER_STATE_SQL:
    unused_role,schema,table=params; item=state[(schema,table)]
    return [(schema,table,item["owner"],item["rls"],item["force"],item["acl"],item["effective"])]
   if sql==grant:
    for relation in added:
     item=state[relation]; item["acl"].append([recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"TRIGGER",False]); item["acl"].sort(); item["effective"]=True
   elif sql==revoke:
    for relation in added:
     item=state[relation]; item["acl"].remove([recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"TRIGGER",False])
     item["effective"]=any(acl[2]=="TRIGGER" and acl[0] in (recovery.PRIVACY_DATA_ROLE,"PUBLIC") for acl in item["acl"])
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline,actual_added=recovery._open_post_data_table_trigger_window(conn,relations)
   changed=added[0]; inherited=added[1]
   state[changed]["rls"]=not state[changed]["rls"]; state[changed]["force"]=not state[changed]["force"]
   state[changed]["acl"].append(["auditor","postgres","UPDATE",True]); state[changed]["acl"].sort()
   state[inherited]["acl"].append(["PUBLIC","postgres","TRIGGER",False]); state[inherited]["acl"].sort()
   desired=json.loads(json.dumps({f"{key[0]}.{key[1]}":value for key,value in state.items()}))
   for relation in added:
    item=desired[f"{relation[0]}.{relation[1]}"]
    item["acl"].remove([recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"TRIGGER",False])
    item["effective"]=any(acl[2]=="TRIGGER" and acl[0] in (recovery.PRIVACY_DATA_ROLE,"PUBLIC") for acl in item["acl"])
   self.assertEqual(added,actual_added); self.assertTrue(all(item["effective"] for item in state.values()))
   recovery._close_post_data_table_trigger_window(conn,relations,baseline,actual_added)
  self.assertNotEqual(baseline_state,{f"{key[0]}.{key[1]}":value for key,value in state.items()})
  self.assertEqual(desired,{f"{key[0]}.{key[1]}":value for key,value in state.items()})
  self.assertEqual(1,statements.count(grant)); self.assertEqual(1,statements.count(revoke))
  privilege_sql=[sql for sql in statements if sql.startswith(("GRANT ","REVOKE "))]
  self.assertEqual([grant,revoke],privilege_sql)
  self.assertFalse(any("*" in sql or any(privilege in sql for privilege in (" INSERT "," SELECT "," UPDATE "," DELETE "," REFERENCES "," TRUNCATE "," MAINTAIN "," ALL ")) for sql in privilege_sql))
  self.assertEqual(2,conn.commits); self.assertEqual(0,conn.rollbacks)
 def test_post_data_table_trigger_rejects_identity_owner_acl_and_window_drift(self):
  relations=TEST_TRIGGER_RELATIONS
  valid=lambda relation:(relation[0],relation[1],recovery.PRIVACY_DATA_ROLE,True,False,[[recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"SELECT",False]],False)
  for mutation in (
   ("wrong",relations[0][1],recovery.PRIVACY_DATA_ROLE,True,False,[],False),
   (relations[0][0],relations[0][1],"postgres",True,False,[],False),
   (relations[0][0],relations[0][1],recovery.PRIVACY_DATA_ROLE,True,False,None,False),
   (relations[0][0],relations[0][1],recovery.PRIVACY_DATA_ROLE,True,False,[["bad","postgres","CREATE",False]],False),
   (relations[0][0],relations[0][1],recovery.PRIVACY_DATA_ROLE,True,False,[["bad","postgres","SELECT",False],["bad","postgres","SELECT",False]],False),
   (relations[0][0],relations[0][1],recovery.PRIVACY_DATA_ROLE,True,False,[[recovery.PRIVACY_DATA_ROLE,"postgres","TRIGGER",False]],False),
  ):
   def query(unused,unused_sql,params=None,mutation=mutation):
    relation=(params[1],params[2])
    return [mutation if relation==relations[0] else valid(relation)]
   with self.subTest(mutation=mutation),patch.object(recovery,"_query_conn",side_effect=query),self.assertRaises(recovery.RecoveryError):
    recovery._read_post_data_table_trigger_state(object(),relations,baseline=True)
  duplicate=(*relations[:-1],relations[0])
  with self.assertRaisesRegex(recovery.RecoveryError,"inventory invalid"):
   recovery._read_post_data_table_trigger_state(object(),duplicate)
 def test_post_data_table_trigger_cleanup_proves_live_grant_order_and_revoke_isolation(self):
  relations=TEST_TRIGGER_RELATIONS
  baseline=tuple((*relation,recovery.PRIVACY_DATA_ROLE,False,False,(),False) for relation in relations)
  temporary=(recovery.PRIVACY_DATA_ROLE,recovery.PRIVACY_DATA_ROLE,"TRIGGER",False)
  live=tuple((*item[:5],(temporary,),True) for item in baseline)
  revoke=recovery._post_data_table_trigger_statement(relations,False)
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  def run(first,second):
   events=[]; reads=iter((first,second)); conn=Conn()
   def read(unused_conn,unused_relations):
    events.append("READ")
    return next(reads)
   def query(unused_conn,sql,params=None):
    events.append(sql)
    return []
   with patch.object(recovery,"_read_post_data_table_trigger_state",side_effect=read),patch.object(recovery,"_query_conn",side_effect=query):
    recovery._close_post_data_table_trigger_window(conn,relations,baseline,relations)
   return conn,events
  conn,events=run(live,baseline)
  self.assertEqual(["BEGIN","READ","SET LOCAL ROLE "+recovery.PRIVACY_DATA_ROLE,revoke,"READ"],events)
  self.assertEqual((1,0),(conn.commits,conn.rollbacks))
  missing=((*live[0][:5],(),True),*live[1:])
  with patch.object(recovery,"_read_post_data_table_trigger_state",side_effect=(missing,baseline)),patch.object(recovery,"_query_conn",return_value=[]):
   conn=Conn()
   with self.assertRaisesRegex(recovery.RecoveryError,"state invalid"):
    recovery._close_post_data_table_trigger_window(conn,relations,baseline,relations)
  self.assertEqual((1,1),(conn.commits,conn.rollbacks))
  mutated=((*baseline[0][:3],True,*baseline[0][4:]),*baseline[1:])
  with patch.object(recovery,"_read_post_data_table_trigger_state",side_effect=(live,mutated)),patch.object(recovery,"_query_conn",return_value=[]):
   conn=Conn()
   with self.assertRaisesRegex(recovery.RecoveryError,"state invalid"):
    recovery._close_post_data_table_trigger_window(conn,relations,baseline,relations)
  self.assertEqual((1,1),(conn.commits,conn.rollbacks))
 def test_post_data_trigger_authority_cleanup_runs_on_owner_restore_failure_and_preserves_failure(self):
  events=[]; authority_baseline=("authority-baseline",); table_baseline=("table-baseline",); fk_baseline=("fk-baseline",); added=(TEST_TRIGGER_RELATIONS[0],)
  def authority_connection(unused_env,operation,*args):
   events.append(("authority",operation,args))
   return authority_baseline if operation is recovery._open_post_data_trigger_authority_window else None
  def table_connection(unused_env,operation,*args):
   events.append(("table",operation,args))
   return (table_baseline,added) if operation is recovery._open_post_data_table_trigger_window else None
  def fk_connection(unused_env,operation,*args):
   events.append(("fk",operation,args))
   return fk_baseline if operation is recovery._open_post_data_fk_authority_window else None
  patches=(patch.object(recovery.hashlib,"sha256",side_effect=_test_trigger_sha256),patch.object(recovery,"_with_post_data_trigger_authority_connection",side_effect=authority_connection),patch.object(recovery,"_with_post_data_table_trigger_connection",side_effect=table_connection),patch.object(recovery,"_with_post_data_fk_authority_connection",side_effect=fk_connection),patch.object(recovery,"_restore_post_data_runs",side_effect=recovery.RecoveryError("owner run failed")))
  with patches[0],patches[1],patches[2],patches[3],patches[4],self.assertRaisesRegex(recovery.RecoveryError,"owner run failed"):
   recovery._restore_post_data_with_trigger_authority("pg_restore",3,Path("database.pgdump"),{},Path("."),TEST_TRIGGER_RUNS)
  self.assertEqual([
   ("authority",recovery._open_post_data_trigger_authority_window,()),
   ("table",recovery._open_post_data_table_trigger_window,(TEST_TRIGGER_RELATIONS,)),
   ("fk",recovery._open_post_data_fk_authority_window,()),
   ("fk",recovery._close_post_data_fk_authority_window,(fk_baseline,)),
   ("table",recovery._close_post_data_table_trigger_window,(TEST_TRIGGER_RELATIONS,table_baseline,added)),
   ("authority",recovery._close_post_data_trigger_authority_window,(authority_baseline,)),
  ],events)
  events.clear()
  def failed_fk_cleanup(unused_env,operation,*args):
   events.append(("fk",operation,args))
   if operation is recovery._open_post_data_fk_authority_window: return fk_baseline
   raise recovery.RecoveryError("FK cleanup failed")
  with patch.object(recovery.hashlib,"sha256",side_effect=_test_trigger_sha256),patch.object(recovery,"_with_post_data_trigger_authority_connection",side_effect=authority_connection),patch.object(recovery,"_with_post_data_table_trigger_connection",side_effect=table_connection),patch.object(recovery,"_with_post_data_fk_authority_connection",side_effect=failed_fk_cleanup),patch.object(recovery,"_restore_post_data_runs",side_effect=recovery.RecoveryError("owner run failed")),self.assertRaisesRegex(recovery.RecoveryError,"FK cleanup failed"):
   recovery._restore_post_data_with_trigger_authority("pg_restore",3,Path("database.pgdump"),{},Path("."),TEST_TRIGGER_RUNS)
  self.assertEqual(recovery._close_post_data_trigger_authority_window,events[-1][1])
  self.assertIn(("table",recovery._close_post_data_table_trigger_window,(TEST_TRIGGER_RELATIONS,table_baseline,added)),events)
  events.clear()
  def failed_table_cleanup(unused_env,operation,*args):
   events.append(("table",operation,args))
   if operation is recovery._open_post_data_table_trigger_window: return table_baseline,added
   raise recovery.RecoveryError("table cleanup failed")
  with patch.object(recovery.hashlib,"sha256",side_effect=_test_trigger_sha256),patch.object(recovery,"_with_post_data_trigger_authority_connection",side_effect=authority_connection),patch.object(recovery,"_with_post_data_table_trigger_connection",side_effect=failed_table_cleanup),patch.object(recovery,"_with_post_data_fk_authority_connection",side_effect=fk_connection),patch.object(recovery,"_restore_post_data_runs",side_effect=recovery.RecoveryError("owner run failed")),self.assertRaisesRegex(recovery.RecoveryError,"table cleanup failed"):
   recovery._restore_post_data_with_trigger_authority("pg_restore",3,Path("database.pgdump"),{},Path("."),TEST_TRIGGER_RUNS)
  self.assertEqual(recovery._close_post_data_trigger_authority_window,events[-1][1])
  events.clear()
  def failed_table_open(unused_env,operation,*args):
   events.append(("table",operation,args))
   raise recovery.RecoveryError("table open failed")
  with patch.object(recovery.hashlib,"sha256",side_effect=_test_trigger_sha256),patch.object(recovery,"_with_post_data_trigger_authority_connection",side_effect=authority_connection),patch.object(recovery,"_with_post_data_table_trigger_connection",side_effect=failed_table_open),self.assertRaisesRegex(recovery.RecoveryError,"table open failed"):
   recovery._restore_post_data_with_trigger_authority("pg_restore",3,Path("database.pgdump"),{},Path("."),TEST_TRIGGER_RUNS)
  self.assertEqual([
   ("authority",recovery._open_post_data_trigger_authority_window,()),
   ("table",recovery._open_post_data_table_trigger_window,(TEST_TRIGGER_RELATIONS,)),
   ("authority",recovery._close_post_data_trigger_authority_window,(authority_baseline,)),
  ],events)
 def test_privacy_insert_window_preserves_effective_insert_matrix_and_targets_exact_subset(self):
  relations=recovery._data_use_lists(SCHEMA_TOC)[2]
  original={relation:((),True) if index%3==0 else (("DELETE","SELECT"),False) if index%3==1 else (("INSERT","SELECT"),True) for index,relation in enumerate(relations)}
  state=dict(original); statements=[]
  class Conn:
   def __init__(self): self.commits=0; self.rollbacks=0
   def commit(self): self.commits+=1
   def rollback(self): self.rollbacks+=1
  conn=Conn()
  added=tuple(relation for relation in relations if not original[relation][1])
  def query(unused,sql,params=None):
   statements.append((sql,params))
   if sql==recovery.PRIVACY_RELATION_STATE_SQL:
    privileges,effective_insert=state[params[1:]]
    return [(recovery.PRIVACY_DATA_ROLE,False,True,list(privileges),effective_insert)]
   if sql.startswith("GRANT INSERT ON TABLE "):
    for relation in added:
     privileges,unused_effective=state[relation]
     state[relation]=(tuple(sorted((*privileges,"INSERT"))),True)
   if sql.startswith("REVOKE INSERT ON TABLE "):
    for relation in added:
     privileges,unused_effective=state[relation]
     state[relation]=(tuple(privilege for privilege in privileges if privilege!="INSERT"),False)
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline,observed_added=recovery._open_privacy_insert_window(conn,relations)
   self.assertEqual(added,observed_added)
   self.assertEqual(tuple((*relation,*original[relation]) for relation in relations),baseline)
   for relation in relations:
    privileges,effective_insert=state[relation]
    self.assertTrue(effective_insert)
    expected_privileges=tuple(sorted((*original[relation][0],"INSERT"))) if relation in added else original[relation][0]
    self.assertEqual(expected_privileges,privileges)
   recovery._close_privacy_insert_window(conn,relations,baseline,observed_added)
  expected_targets=",".join(f'"{schema}"."{relation}"' for schema,relation in added)
  sql=[statement for statement,unused in statements]
  self.assertIn(f"GRANT INSERT ON TABLE {expected_targets} TO privacy_workflow_owner",sql)
  self.assertIn(f"REVOKE INSERT ON TABLE {expected_targets} FROM privacy_workflow_owner",sql)
  self.assertEqual(original,state)
  self.assertEqual(2,conn.commits); self.assertEqual(0,conn.rollbacks)
  self.assertIn("pg_catalog.aclexplode(class.relacl)",recovery.PRIVACY_RELATION_STATE_SQL)
  self.assertIn("pg_catalog.has_table_privilege(role.oid,class.oid,'INSERT')",recovery.PRIVACY_RELATION_STATE_SQL)
  self.assertNotIn("DISTINCT",recovery.PRIVACY_RELATION_STATE_SQL)
  self.assertNotIn("COALESCE",recovery.PRIVACY_RELATION_STATE_SQL)
 def test_privacy_insert_window_issues_no_grant_or_revoke_when_all_effective_baselines_have_insert(self):
  relations=recovery._data_use_lists(SCHEMA_TOC)[2]; statements=[]
  class Conn:
   def commit(self): pass
   def rollback(self): pass
  def query(unused,sql,params=None):
   statements.append(sql)
   if sql==recovery.PRIVACY_RELATION_STATE_SQL:
    privileges=[] if relations.index(params[1:])%2==0 else ["INSERT","SELECT"]
    return [(recovery.PRIVACY_DATA_ROLE,False,True,privileges,True)]
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   baseline,added=recovery._open_privacy_insert_window(Conn(),relations)
   recovery._close_privacy_insert_window(Conn(),relations,baseline,added)
  self.assertEqual((),added)
  self.assertFalse(any(sql.startswith(("GRANT INSERT","REVOKE INSERT")) for sql in statements))
 def test_privacy_insert_window_rejects_catalog_inventory_privilege_and_boolean_mutations(self):
  relations=recovery._data_use_lists(SCHEMA_TOC)[2]
  valid=(recovery.PRIVACY_DATA_ROLE,False,True,["DELETE","SELECT"],False)
  mutations=(
   (),
   (("postgres",False,True,["DELETE","SELECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,True,True,["DELETE","SELECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,False,["DELETE","SELECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["CONNECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["SELECT","DELETE"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["SELECT","SELECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["INSERT","SELECT"],False),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["DELETE","SELECT"],None),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["DELETE","SELECT"],1),),
   ((recovery.PRIVACY_DATA_ROLE,False,True,["DELETE","SELECT"]),),
   (valid,valid),
  )
  for rows in mutations:
   with self.subTest(rows=rows),patch.object(recovery,"_query_conn",return_value=list(rows)),self.assertRaisesRegex(recovery.RecoveryError,"privilege state"):
    recovery._read_privacy_relation_baseline(object(),relations)
  with patch.object(recovery,"_query_conn",return_value=[valid]),self.assertRaisesRegex(recovery.RecoveryError,"inventory"):
   recovery._read_privacy_relation_baseline(object(),relations[:-1])
 def test_privacy_insert_cleanup_detects_drift_and_still_revokes_only_added_subset(self):
  relations=recovery._data_use_lists(SCHEMA_TOC)[2]
  baseline=tuple((*relation,("INSERT","SELECT"),True) if index==0 else (*relation,("DELETE","SELECT"),False) for index,relation in enumerate(relations))
  added=tuple(relations[1:])
  state={(schema,relation):(tuple(sorted((*privileges,"INSERT"))),True) for schema,relation,privileges,effective_insert in baseline}
  state[relations[0]]=(("INSERT",),True)
  statements=[]
  class Conn:
   def commit(self): statements.append("commit")
   def rollback(self): statements.append("rollback")
  def query(unused,sql,params=None):
   statements.append(sql)
   if sql==recovery.PRIVACY_RELATION_STATE_SQL:
    privileges,effective_insert=state[params[1:]]
    return [(recovery.PRIVACY_DATA_ROLE,False,True,list(privileges),effective_insert)]
   if sql.startswith("REVOKE INSERT ON TABLE "):
    for relation in added:
     privileges,unused_effective=state[relation]
     state[relation]=(tuple(privilege for privilege in privileges if privilege!="INSERT"),False)
   return []
  with patch.object(recovery,"_query_conn",side_effect=query),self.assertRaisesRegex(recovery.RecoveryError,"privilege state"):
   recovery._close_privacy_insert_window(Conn(),relations,baseline,added)
  self.assertEqual((("INSERT",),True),state[relations[0]])
  self.assertEqual((("DELETE","SELECT"),False),state[relations[1]])
  expected_targets=",".join(f'"{schema}"."{relation}"' for schema,relation in added)
  self.assertIn(f"REVOKE INSERT ON TABLE {expected_targets} FROM privacy_workflow_owner",statements)
 def test_privacy_insert_cleanup_exactly_restores_direct_and_effective_baseline_after_failed_restore(self):
  relations=recovery._data_use_lists(SCHEMA_TOC)[2]
  original={relation:((),True) if index==0 else (("DELETE","SELECT"),False) for index,relation in enumerate(relations)}
  state=dict(original); connections=[]; added=tuple(relations[1:])
  class Conn:
   def commit(self): pass
   def rollback(self): pass
   def close(self): pass
  def connect(unused,env):
   connection=Conn(); connections.append(connection); return connection
  def query(unused,sql,params=None):
   if sql==recovery.PRIVACY_RELATION_STATE_SQL:
    privileges,effective_insert=state[params[1:]]
    return [(recovery.PRIVACY_DATA_ROLE,False,True,list(privileges),effective_insert)]
   if sql.startswith("GRANT INSERT ON TABLE "):
    for relation in added:
     privileges,unused_effective=state[relation]
     state[relation]=(tuple(sorted((*privileges,"INSERT"))),True)
   if sql.startswith("REVOKE INSERT ON TABLE "):
    for relation in added:
     privileges,unused_effective=state[relation]
     state[relation]=(tuple(privilege for privilege in privileges if privilege!="INSERT"),False)
   return []
  with patch.object(recovery,"_connect",side_effect=connect),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"run",side_effect=recovery.RecoveryError("data restore failed")),self.assertRaisesRegex(recovery.RecoveryError,"data restore failed"):
   recovery._restore_privacy_data("pg_restore",Path("privacy.list"),Path("database.pgdump"),{},relations)
  self.assertEqual(original,state)
  self.assertEqual(2,len(connections))
 def test_restore_verify_passes_only_stdin_identity_to_age(self):
  class Conn:
   def commit(self): pass
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints(managed_catalog_sha256="4"*64)
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)),identity_fd="3",identity_handle=None)
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS],**self.managed_capture_scope(),**observed}}
   events=[]; data_use_lists={}; post_use_lists=[]; restore_paths=[]
   def execute(argv,**kwargs):
    self.assertEqual("pg_restore",argv[0])
    events.append(("restore",tuple(argv)))
    for argument in argv:
     if argument.startswith("--use-list="):
      path=Path(argument.split("=",1)[1]); restore_paths.append(path)
      if "--section=data" in argv: data_use_lists[next(item for item in argv if item.startswith("--role="))]=path.read_bytes()
      if "--section=post-data" in argv: post_use_lists.append((next(item for item in argv if item.startswith("--role=")),path.read_bytes()))
    stdout=POST_DATA_TOC_BYTES if "--list" in argv and "--section=post-data" in argv else SCHEMA_TOC if "--list" in argv else b""
    return subprocess.CompletedProcess(argv,0,stdout=stdout,stderr=b"")
   def decrypt(argv,**kwargs):
    self.assertEqual(["age","--decrypt","--identity","-",str(dump)],argv)
    self.assertIsInstance(kwargs["stdin"],io.BytesIO)
    kwargs["stdout"].write(b"plain")
    return subprocess.CompletedProcess(argv,0)
   def query(unused,sql,*args):
    events.append(("sql",sql))
    return []
   def privacy_connection(unused,operation,*operation_args):
    exact=operation_args[0]
    if operation is recovery._open_privacy_insert_window:
     events.append(("privacy-insert",True,exact))
     return tuple((*relation,(),False) for relation in exact),exact
    events.append(("privacy-insert",False,exact))
   def post_data_with_authority(*operation_args):
    events.append(("trigger-authority",True))
    try:
     with patch.object(recovery,"_with_post_data_storage_auth_schema_connection",side_effect=lambda unused_env,operation,*args: () if operation is recovery._open_post_data_storage_auth_schema_window else None):
      return recovery._restore_post_data_runs(*operation_args)
    finally: events.append(("trigger-authority",False))
   with patch.object(recovery,"sha256_file",return_value=capture["evidence"]["dump_sha256"]),patch.object(recovery,"_owned_identity_stream",return_value=io.BytesIO(b"key")),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery.subprocess,"run",side_effect=decrypt) as decrypt_run,patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_with_privacy_connection",side_effect=privacy_connection),patch.object(recovery,"_restore_post_data_with_trigger_authority",side_effect=post_data_with_authority),patch.object(recovery,"_create_auth_user_placeholders"),patch.object(recovery,"_normalize_restored_vector_extension",side_effect=lambda unused:events.append(("postflight",True)) or "public"),patch.object(recovery,"_fingerprints",return_value=observed):
    result=recovery.run_restore_verify(args,None)
   self.assertEqual(["age","--decrypt","--identity","-",str(dump)],decrypt_run.call_args.args[0])
   self.assertNotIn("key",json.dumps(result))
   list_index=next(index for index,event in enumerate(events) if event[0]=="restore" and event[1][1]=="--list")
   post_toc_index=next(index for index,event in enumerate(events) if event[0]=="restore" and event[1][1:3]==("--section=post-data","--list"))
   drop_index=next(index for index,event in enumerate(events) if event==("sql","DROP SCHEMA IF EXISTS public CASCADE"))
   create_index=next(index for index,event in enumerate(events) if event==("sql","CREATE SCHEMA public AUTHORIZATION pg_database_owner"))
   public_usage_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE ON SCHEMA public TO PUBLIC, anon, authenticated, service_role, postgres"))
   grant_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner"))
   auth_create_index=next(index for index,event in enumerate(events) if event==("sql","CREATE SCHEMA auth AUTHORIZATION supabase_admin"))
   auth_grant_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin"))
   storage_create_index=next(index for index,event in enumerate(events) if event==("sql","CREATE SCHEMA storage AUTHORIZATION supabase_admin"))
   storage_grant_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin"))
   extensions_reset_index=next(index for index,event in enumerate(events) if event==("sql","DO $$ BEGIN IF pg_catalog.to_regnamespace('extensions') IS NOT NULL THEN RAISE EXCEPTION 'local extensions schema reset drift'; END IF; END $$"))
   extensions_create_index=next(index for index,event in enumerate(events) if event==("sql","CREATE SCHEMA extensions AUTHORIZATION postgres"))
   extensions_public_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role"))
   extensions_dashboard_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE, CREATE ON SCHEMA extensions TO dashboard_user"))
   extensions_admin_index=next(index for index,event in enumerate(events) if event==("sql","GRANT USAGE, CREATE ON SCHEMA extensions TO supabase_admin"))
   pre_index=next(index for index,event in enumerate(events) if event[0]=="restore" and "--section=pre-data" in event[1])
   data_indices=[index for index,event in enumerate(events) if event[0]=="restore" and "--section=data" in event[1]]
   post_indices=[index for index,event in enumerate(events) if event[0]=="restore" and "--section=post-data" in event[1] and "--list" not in event[1]]
   post_index=post_indices[0]
   self.assertLess(list_index,drop_index)
   self.assertLess(list_index,post_toc_index); self.assertLess(post_toc_index,drop_index)
   self.assertLess(drop_index,create_index)
   self.assertLess(create_index,public_usage_index)
   self.assertLess(public_usage_index,grant_index)
   self.assertLess(grant_index,auth_create_index)
   self.assertLess(auth_create_index,auth_grant_index)
   self.assertLess(auth_grant_index,storage_create_index)
   self.assertLess(storage_create_index,storage_grant_index)
   self.assertLess(storage_grant_index,extensions_reset_index)
   self.assertLess(grant_index,pre_index)
   self.assertLess(grant_index,extensions_reset_index)
   self.assertLess(extensions_reset_index,extensions_create_index)
   self.assertLess(extensions_create_index,extensions_public_index)
   self.assertLess(extensions_public_index,extensions_dashboard_index)
   self.assertLess(extensions_dashboard_index,extensions_admin_index)
   self.assertLess(extensions_admin_index,pre_index)
   self.assertEqual(2,len(data_indices))
   self.assertLess(pre_index,data_indices[0])
   self.assertLess(data_indices[0],data_indices[1])
   self.assertLess(data_indices[1],post_index)
   self.assertEqual(90,len(post_indices))
   self.assertEqual(list(range(post_indices[0],post_indices[-1]+1)),post_indices)
   plain_path=events[data_indices[0]][1][-1]
   postgres_list=next(argument.split("=",1)[1] for argument in events[data_indices[0]][1] if argument.startswith("--use-list="))
   privacy_list=next(argument.split("=",1)[1] for argument in events[data_indices[1]][1] if argument.startswith("--use-list="))
   self.assertEqual(("pg_restore","--section=data",f"--use-list={postgres_list}","--role=postgres","--dbname=service=g035-local",plain_path),events[data_indices[0]][1])
   self.assertEqual(("pg_restore","--section=data",f"--use-list={privacy_list}","--role=privacy_workflow_owner","--dbname=service=g035-local",plain_path),events[data_indices[1]][1])
   expected_postgres,expected_privacy,expected_relations=recovery._data_use_lists(SCHEMA_TOC)
   self.assertEqual((expected_postgres,expected_privacy),(data_use_lists["--role=postgres"],data_use_lists["--role=privacy_workflow_owner"]))
   expected_post_runs=recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
   self.assertEqual(tuple(("--role="+owner,payload) for owner,payload in expected_post_runs),tuple(post_use_lists))
   for index,((owner,unused_count),event_index) in enumerate(zip(EXPECTED_POST_DATA_OWNER_RUNS,post_indices),1):
    path=next(argument.split("=",1)[1] for argument in events[event_index][1] if argument.startswith("--use-list="))
    self.assertEqual(("pg_restore","--section=post-data",f"--use-list={path}",f"--role={owner}","--dbname=service=g035-local",plain_path),events[event_index][1])
   self.assertFalse(any(event[0]=="restore" and event[1]==("pg_restore","--section=post-data","--dbname=service=g035-local",plain_path) for event in events))
   grant_event=events.index(("privacy-insert",True,expected_relations)); revoke_event=events.index(("privacy-insert",False,expected_relations))
   self.assertLess(data_indices[0],grant_event)
   self.assertLess(grant_event,data_indices[1])
   self.assertLess(data_indices[1],revoke_event)
   self.assertLess(revoke_event,post_index)
   authority_open=events.index(("trigger-authority",True)); authority_close=events.index(("trigger-authority",False)); postflight=events.index(("postflight",True))
   self.assertLess(revoke_event,authority_open)
   self.assertLess(authority_open,post_indices[0]); self.assertLess(post_indices[-1],authority_close)
   self.assertLess(authority_close,postflight)
   self.assertTrue(all(not path.exists() for path in restore_paths))
   for event in events:
    if event[0]=="restore":
     self.assertNotIn("--no-owner",event[1])
     self.assertNotIn("--no-acl",event[1])
     self.assertNotIn("--disable-triggers",event[1])
   self.assertLess(pre_index,post_index)
   pre_argv=events[pre_index][1]
   self.assertEqual(1,sum(argument.startswith("--use-list=") for argument in pre_argv))
   self.assertNotIn("--no-owner",pre_argv)
   self.assertNotIn("--no-acl",pre_argv)
 def test_owned_restore_use_list_preserves_existing_file_and_cleanup_is_identity_safe(self):
  with tempfile.TemporaryDirectory() as raw:
   first=Path(raw)/"postgres.list"; second=Path(raw)/"privacy.list"
   fd,identity=recovery._owned_restore_use_list(first,b"postgres")
   try:
    second.write_bytes(b"occupied")
    with self.assertRaises(recovery.RecoveryError):
     recovery._owned_restore_use_list(second,b"privacy")
   finally:
    recovery._unlink_owned_output(fd,first,identity)
    os.close(fd)
   self.assertFalse(first.exists())
   self.assertEqual(b"occupied",second.read_bytes())
 def test_post_data_run_identity_drift_and_invocation_failure_delete_every_owned_list(self):
  runs=recovery._post_data_use_lists(POST_DATA_TOC_BYTES)
  for mode in ("failure","drift"):
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as raw:
    workspace=Path(raw); plain=workspace/"database.pgdump"; plain_fd,plain_identity=recovery._owned_output(plain,"plaintext restore")
    try:
     os.write(plain_fd,b"plain"); os.fsync(plain_fd)
     def execute(argv,**unused):
      if mode=="failure": raise recovery.RecoveryError("post-data invocation failed")
      paths=sorted(workspace.glob("post-data-*.list"))
      os.chmod(paths[-1],0o644)
      return subprocess.CompletedProcess(argv,0,stdout=b"",stderr=b"")
     expected="post-data invocation failed" if mode=="failure" else "custody lost"
     with patch.object(recovery,"run",side_effect=execute),self.assertRaisesRegex(recovery.RecoveryError,expected):
      recovery._restore_post_data_runs("pg_restore",plain_fd,plain,{},workspace,runs)
     self.assertEqual([],list(workspace.glob("post-data-*.list")))
    finally:
     recovery._unlink_owned_output(plain_fd,plain,plain_identity); os.close(plain_fd)
 def test_restore_preserves_hosted_vector_extension_schema(self):
  queries=[]
  with patch.object(recovery,"_query_conn",side_effect=lambda unused,sql: queries.append(sql) or [("public",)]):
   self.assertEqual(recovery._normalize_restored_vector_extension(object()),"public")
  self.assertEqual(len(queries),1)
  self.assertNotIn("ALTER EXTENSION",queries[0])
  self.assertEqual(
   recovery.RESTORED_VECTOR_LAYOUT_CONTRACT,
   ("preserve-hosted-vector-schema-v1","public"),
  )
  self.assertEqual(
   recovery._local_clone_compatibility_sql("20260713002000"),
   recovery.LOCAL_CLONE_VECTOR_RELOCATION_SQL,
  )
  self.assertEqual(recovery._local_clone_compatibility_sql("20260713002100"), ())
  self.assertEqual(
   sum("ALTER EXTENSION vector SET SCHEMA extensions" in statement for statement in recovery.LOCAL_CLONE_VECTOR_RELOCATION_SQL),
   1,
  )
 def test_restore_rejects_unknown_vector_extension_layout(self):
  with patch.object(recovery,"_query_conn",return_value=[("unexpected",)]),self.assertRaisesRegex(recovery.RecoveryError,"vector extension layout"):
   recovery._normalize_restored_vector_extension(object())
 def test_receipt_contract_requires_exact_prior_cardinality_and_canonical_shape(self):
  for mode,count in (("capture",0),("restore-verify",1),("short-url-remediation-inspect",1),("short-url-remediation-apply",2),("short-url-remediation-verify",1),("clone-apply",1),("local-postflight",1)):
   item=recovery.receipt(mode,{"capture":"captured","restore-verify":"restored","short-url-remediation-inspect":"validated","short-url-remediation-apply":"applied","short-url-remediation-verify":"validated","clone-apply":"applied","local-postflight":"validated"}[mode],{},["a"*64]*count)
   self.assertEqual(item,recovery._receipt_contract(item))
   item["prior_receipt_sha256"].append("b"*64)
   with self.assertRaises(recovery.RecoveryError): recovery._receipt_contract(item)
  item=recovery.receipt("capture","captured",{})
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"receipt.json"
   for payload in (recovery.canonical_bytes({**item,"ignored":True}),recovery.canonical_bytes(item)+b"\n"):
    path.write_bytes(payload)
    with patch.object(recovery,"_restrictive",return_value=True):
     with self.assertRaises(recovery.RecoveryError): recovery.read_json_receipt(path)
 def test_restore_receipt_is_external_fresh_and_no_clobber(self):
  result=recovery.receipt("restore-verify","restored",{"ledger_pairs":(("1","baseline"),)},["a"*64])
  with tempfile.TemporaryDirectory() as raw:
   base=Path(raw).resolve(); repository=base/"repository"; repository.mkdir()
   target=base/"restore.json"; args=Namespace(restore_receipt=str(target))
   with patch.object(recovery,"repository_root",return_value=repository),patch.object(recovery,"_restrictive_directory",return_value=True),patch.object(recovery,"_windows_restrict_temporary_file"),patch.object(recovery,"_restrictive",return_value=True):
    self.assertEqual(result,recovery._publish_restore_receipt(args,result))
   self.assertEqual(recovery.canonical_bytes(result),target.read_bytes())
   with patch.object(recovery,"repository_root",return_value=repository),patch.object(recovery,"_restrictive_directory",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"custody"):
    recovery._publish_restore_receipt(args,result)
 def test_restore_receipt_target_rejects_parent_traversal_and_directory_links(self):
  with tempfile.TemporaryDirectory() as raw:
   base=Path(raw); repository=base/"repository"; repository.mkdir(); outside=base/"outside"; outside.mkdir()
   traversal=outside/".."/"repository"/"receipt.json"
   with patch.object(recovery,"repository_root",return_value=repository),patch.object(recovery,"_restrictive_directory",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"custody"):
    recovery._restore_receipt_target(Namespace(restore_receipt=str(traversal)))
   link=outside/"linked"
   try: link.symlink_to(repository,target_is_directory=True)
   except OSError: return
   with patch.object(recovery,"repository_root",return_value=repository),patch.object(recovery,"_restrictive_directory",return_value=True),self.assertRaisesRegex(recovery.RecoveryError,"custody"):
    recovery._restore_receipt_target(Namespace(restore_receipt=str(link/"receipt.json")))
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
 def test_restore_rejects_ledger_pair_mutation(self):
  args=Namespace(destination_service="g035-local",capture_receipt="capture",dump="missing",decrypt_command="age",pg_restore="pg_restore",service_file="service",identity_fd="3",identity_handle=None)
  capture={"receipt_sha256":"capture","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"extension_scope":[]}}
  with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
   recovery.run_restore_verify(args,None)
  connect.assert_not_called(); run.assert_not_called()
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
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_fd="3",identity_handle=None,decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[]}}
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
    recovery.run_restore_verify(args,None)
  connect.assert_not_called(); run.assert_not_called()
 def test_restore_rejects_missing_or_mutated_managed_data_exclusions_before_local_reset(self):
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(Path(raw)/"missing.enc"),identity_fd="3",identity_handle=None,decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   extension_scope=[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS]
   for exclusions in (None,["--exclude-table-data=auth.*"],["--exclude-table-data=storage.*","--exclude-table-data=auth.*"],["--exclude-table-data=auth.*","--exclude-table-data=storage.tables"]):
    evidence={"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"extension_scope":extension_scope,"managed_metadata_schema_scope":["auth","storage"]}
    if exclusions is not None: evidence["managed_table_data_exclusions"]=exclusions
    capture={"receipt_sha256":"capture-receipt","evidence":evidence}
    with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
     recovery.run_restore_verify(args,None)
    connect.assert_not_called(); run.assert_not_called()
 def test_restore_rejects_missing_or_mutated_application_schema_scope_before_local_reset(self):
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(Path(raw)/"missing.enc"),identity_fd="3",identity_handle=None,decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   extension_scope=[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS]
   expected=list(contract.APPLICATION_SCHEMAS)
   for schema_scope in (None,expected[:-2],list(reversed(expected)),[*expected[:-1],"unexpected"]):
    evidence={"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"extension_scope":extension_scope,"managed_metadata_schema_scope":["auth","storage"],"managed_table_data_exclusions":["--exclude-table-data=auth.*","--exclude-table-data=storage.*"]}
    if schema_scope is not None: evidence["schema_scope"]=schema_scope
    capture={"receipt_sha256":"capture-receipt","evidence":evidence}
    with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"application schema scope"):
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
   args=Namespace(destination_service="hosted",capture_receipt="capture",dump=str(dump),identity_fd="3",identity_handle=None,decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   with patch.object(recovery,"_connect") as connect,patch.object(recovery,"_query_conn") as query,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"limited"):
    recovery.run_restore_verify(args,None)
  connect.assert_not_called(); query.assert_not_called(); run.assert_not_called()
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_fd="3",identity_handle=None,decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"recipient_fingerprint":contract.APPROVED_AGE_RECIPIENT_SHA256,"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**observed}}
   def execute(argv,**unused):
    if "--list" in argv:
     events.append("pg_restore post-data --list" if "--section=post-data" in argv else "pg_restore --list")
     return subprocess.CompletedProcess(argv,0,stdout=POST_DATA_TOC_BYTES if "--section=post-data" in argv else SCHEMA_TOC,stderr=b"")
    events.append("pg_restore pre-data")
    raise recovery.RecoveryError("external command failed")
   def decrypt(argv,**kwargs):
    kwargs["stdout"].write(b"plain")
    return subprocess.CompletedProcess(argv,0)
   with patch.object(recovery,"_copy_local_service",side_effect=lambda *unused: events.append("fence") or Path(raw)/"service.conf"),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=lambda conn,sql: events.append(sql) or []),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"sha256_file",return_value=capture["evidence"]["dump_sha256"]),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_owned_identity_stream",return_value=io.BytesIO(b"key")),patch.object(recovery,"run",side_effect=execute),patch.object(recovery.subprocess,"run",side_effect=decrypt),self.assertRaisesRegex(recovery.RecoveryError,"external command failed"):
    recovery.run_restore_verify(args,None)
  self.assertLess(events.index("fence"),events.index("pg_restore --list"))
  self.assertLess(events.index("pg_restore --list"),events.index("DROP SCHEMA IF EXISTS public CASCADE"))
  self.assertLess(events.index("pg_restore --list"),events.index("pg_restore post-data --list"))
  self.assertLess(events.index("pg_restore post-data --list"),events.index("DROP SCHEMA IF EXISTS public CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS public CASCADE"),events.index("DROP SCHEMA IF EXISTS auth CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS auth CASCADE"),events.index("DROP SCHEMA IF EXISTS storage CASCADE"))
  self.assertLess(events.index("DROP SCHEMA IF EXISTS storage CASCADE"),events.index("CREATE SCHEMA public AUTHORIZATION pg_database_owner"))
  self.assertLess(events.index("CREATE SCHEMA public AUTHORIZATION pg_database_owner"),events.index("GRANT USAGE ON SCHEMA public TO PUBLIC, anon, authenticated, service_role, postgres"))
  self.assertLess(events.index("GRANT USAGE ON SCHEMA public TO PUBLIC, anon, authenticated, service_role, postgres"),events.index("GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner"))
  self.assertLess(events.index("GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner"),events.index("CREATE SCHEMA auth AUTHORIZATION supabase_admin"))
  self.assertLess(events.index("CREATE SCHEMA auth AUTHORIZATION supabase_admin"),events.index("GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin"))
  self.assertLess(events.index("GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin"),events.index("CREATE SCHEMA storage AUTHORIZATION supabase_admin"))
  self.assertLess(events.index("CREATE SCHEMA storage AUTHORIZATION supabase_admin"),events.index("GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin"))
  self.assertLess(events.index("GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin"),events.index("DO $$ BEGIN IF pg_catalog.to_regnamespace('extensions') IS NOT NULL THEN RAISE EXCEPTION 'local extensions schema reset drift'; END IF; END $$"))
  self.assertLess(events.index("GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner"),events.index("DO $$ BEGIN IF pg_catalog.to_regnamespace('extensions') IS NOT NULL THEN RAISE EXCEPTION 'local extensions schema reset drift'; END IF; END $$"))
  self.assertLess(events.index("DO $$ BEGIN IF pg_catalog.to_regnamespace('extensions') IS NOT NULL THEN RAISE EXCEPTION 'local extensions schema reset drift'; END IF; END $$"),events.index("CREATE SCHEMA extensions AUTHORIZATION postgres"))
  self.assertLess(events.index("CREATE SCHEMA extensions AUTHORIZATION postgres"),events.index("GRANT USAGE, CREATE ON SCHEMA extensions TO supabase_admin"))
  self.assertLess(events.index("GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner"),events.index("pg_restore pre-data"))
 def test_restore_rejection_is_silent_and_does_not_publish_receipt(self):
  output=io.StringIO()
  argv=["restore-verify","--dump","dump","--capture-receipt","capture","--restore-receipt","C:/receipt","--service-file","service","--destination-service","g035-local","--identity-handle","3","--decrypt-command","age"]
  with patch.object(recovery,"validate_sources",return_value=object()),patch.object(recovery,"run_restore_verify",side_effect=recovery.RecoveryError("decrypt failed")),contextlib.redirect_stdout(output):
   self.assertEqual(2,recovery.main(argv))
  self.assertEqual("",output.getvalue())
 def test_restore_success_is_silent_and_publishes_from_source(self):
  result=recovery.receipt("restore-verify","restored",{})
  output=io.StringIO()
  argv=["restore-verify","--dump","dump","--capture-receipt","capture","--restore-receipt","C:/receipt","--service-file","service","--destination-service","g035-local","--identity-handle","3","--decrypt-command","age"]
  with patch.object(recovery,"validate_sources",return_value=object()),patch.object(recovery,"_restore_receipt_target"),patch.object(recovery,"run_restore_verify",return_value=result),patch.object(recovery,"_publish_restore_receipt",return_value=result) as publish,contextlib.redirect_stdout(output):
   self.assertEqual(0,recovery.main(argv))
  publish.assert_called_once_with(ANY,result)
  self.assertEqual("",output.getvalue())
 def test_malformed_restore_receipts_fail_silently_without_traceback(self):
  output=io.StringIO(); errors=io.StringIO()
  argv=["restore-verify","--dump","dump","--capture-receipt","capture","--restore-receipt","C:/receipt","--service-file","service","--destination-service","g035-local","--identity-handle","3","--decrypt-command","age"]
  missing_evidence=recovery.receipt("capture","captured",{})
  del missing_evidence["evidence"]
  missing_evidence["receipt_sha256"]=recovery.digest({key:value for key,value in missing_evidence.items() if key!="receipt_sha256"})
  for payload in (b"\xff",b"[]",recovery.canonical_bytes(missing_evidence)):
   with tempfile.TemporaryDirectory() as raw:
    capture=Path(raw)/"capture.json"; capture.write_bytes(payload)
    current=[str(capture) if value=="capture" else value for value in argv]
    with patch.object(recovery,"validate_sources",return_value=object()),patch.object(recovery,"_restore_receipt_target"),contextlib.redirect_stdout(output),contextlib.redirect_stderr(errors):
     self.assertEqual(2,recovery.main(current))
  self.assertEqual("",output.getvalue())
  self.assertEqual("",errors.getvalue())
 def test_runtime_sql_is_executed_directly_without_outer_write_transaction(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertIn('for fixture in (runtime,g041_runtime): run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(fixture)],env=env)',text)
  self.assertIn('g035_hosted_clone_runtime.sql',text)
  self.assertIn('g041_auth_boundary_runtime.sql',text)
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
  self.assertEqual(2,run.call_count)
  self.assertIn("g035_hosted_clone_runtime.sql",str(run.call_args_list[0].args[0]))
  self.assertIn("g041_auth_boundary_runtime.sql",str(run.call_args_list[1].args[0]))
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
  self.assertEqual("validated",result["status"])
  self.assertEqual(2,run.call_count)
  self.assertIn("g035_hosted_clone_runtime.sql",str(run.call_args_list[0].args[0]))
  self.assertIn("g041_auth_boundary_runtime.sql",str(run.call_args_list[1].args[0]))
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
  approval_statements=recovery.g034_preflight.approval_source_statements()
  self.assertTrue(all(statement.rstrip(";") + ";" in owner_sql for statement in approval_statements))
  owner_guard=next(index for index,statement in enumerate(owner_sql) if "public function owner compatibility precondition failed" in statement)
  self.assertTrue(all(owner_sql.index(statement.rstrip(";")+";") < owner_guard for statement in approval_statements))
  self.assertEqual(recovery.PUBLIC_FUNCTION_OWNERS_ALLOWED,recovery.PUBLIC_FUNCTION_OWNERS_POSTCONDITION)
  self.assertNotIn("DECLARE function_row record",owner_sql[owner_guard])
  self.assertNotIn("ALTER FUNCTION",owner_sql[owner_guard])
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
  self.assertEqual(1,source.count("pg_catalog.has_table_privilege(role.oid,class.oid,'INSERT')"))
  self.assertEqual(2,source.count("pg_catalog.has_schema_privilege"))
  self.assertIn("pg_catalog.aclexplode",source)
  self.assertIn("coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))",source)
  self.assertIn("coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))",source)
 def test_main_rejects_without_diagnostics(self):
  output=io.BytesIO()
  with patch.object(recovery,"validate_sources",side_effect=recovery.ContractError("secret")),patch.object(recovery.sys,"stdout",type("Stdout",(),{"buffer":output})()): self.assertEqual(2,recovery.main(["validate"]))
  self.assertEqual("policy_rejected",json.loads(output.getvalue())["evidence"]["reason"]); self.assertNotIn(b"secret",output.getvalue())
class ManifestDependencyTests(unittest.TestCase):
 def test_marketing_state_machine_is_hashed_and_required_in_dependency_order(self):
  data=json.loads((ROOT/contract.MANIFEST_RELATIVE_PATH).read_text(encoding="utf8"))
  migrations=data["migrations"]
  marketing=next(entry for entry in migrations if entry["version"]=="20260713002200")
  self.assertEqual({"version":"20260713002200","name":"g014_marketing_state_machine","path":"backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql","sha256":"a041f88d781ef50bfdf59feee2af3f09bc02fc64714fe335861ed5e7d99694a3"},marketing)
  self.assertEqual(29,len(migrations))
  self.assertEqual(
   ["20260713002100","20260713002200","20260713002300"],
   [entry["version"] for entry in migrations if entry["version"] in {"20260713002100","20260713002200","20260713002300"}],
  )
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
class G041FixtureWiringTests(unittest.TestCase):
 def test_clone_apply_and_postflight_execute_g041_runtime_fixture(self):
  source=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf-8")
  fixture='backend/supabase/tests/g041_auth_boundary_runtime.sql'
  self.assertEqual(source.count(fixture),2)
  self.assertEqual(source.count("for fixture in (runtime,g041_runtime)"),2)

if __name__=="__main__": unittest.main()
