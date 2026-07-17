import contextlib, hashlib, importlib.util, io, json, subprocess, sys, tempfile, unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
import g035_hosted_recovery_contract as contract
spec=importlib.util.spec_from_file_location("recovery",SCRIPTS/"g035_hosted_recovery.py"); recovery=importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
ROOT=Path(__file__).parents[3]
def fingerprints(*,pairs=(),ledger_sha256="1"*64,restorable_catalog_sha256="2"*64,managed_catalog_sha256="3"*64,managed_schemas=contract.MANAGED_METADATA_SCHEMAS):
 return {"ledger_pairs":pairs,"ledger_sha256":ledger_sha256,"ledger_count":len(pairs),"restorable_catalog_sha256":restorable_catalog_sha256,"managed_catalog_sha256":managed_catalog_sha256,"managed_metadata_schemas_present":managed_schemas}

class ContractTests(unittest.TestCase):
 def test_manifest_and_immutable_pair_baseline(self):
  manifest=contract.validate_sources(ROOT)
  expected=(("20251219","db_performance_optimization"),("20260118","create_ocr_logs"),("20260425","allow_ocr_logs_user_insert"),("20260506065538","optimize_auth_user_state_indexes"),("20260506085634","optimize_app_query_indexes"),("20260509000100","drop_server_costs"),("20260509000200","drop_admin_ai_settings"),("20260523093000","create_restaurant_popular_rank_snapshots"),("20260525143908","create_youtube_kpi_snapshots"),("20260526083932","add_youtube_channel_growth_snapshot_deltas"),("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"))
  reconstructed=(("20260124","create_document_embeddings_bge"),("20260124","create_restaurants"),("20260124","fix_approved_name_sync"),("20260124","update_embeddings_constraint"),("20260131","fix_search_rpc"),("20260213","create_announcements_table_and_seed"),("20260214","fix_approve_edit_backup_stage"),("20260214","fix_restaurant_rpcs_and_search"),("20260214","fix_submission_item_target_to_backup"),("20260514","admin_user_management_audit"),("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"))
  self.assertEqual(28,len(manifest.migrations)); self.assertEqual(expected,contract.BASELINE_PAIRS)
  self.assertTrue(contract.ledger_prefix(manifest,expected))
  self.assertTrue(contract.ledger_prefix(manifest,[list(pair) for pair in expected]))
  mutated=list(expected); mutated[0]=("20260124","db_performance_optimization")
  self.assertFalse(contract.ledger_prefix(manifest,mutated))
  self.assertFalse(contract.ledger_prefix(manifest,list(reconstructed)))
  self.assertFalse(contract.ledger_prefix(manifest,[("20260531084516","caller_supplied")]))

class ControllerTests(unittest.TestCase):
 def service(self,directory,section="g035-local",body=None):
  path=Path(directory)/"service.conf"; path.write_text(body or f"[{section}]\nhost=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n",encoding="utf8"); path.chmod(0o600); return path
 def managed_capture_scope(self):
  return {"managed_metadata_schema_scope":list(contract.MANAGED_METADATA_SCHEMAS),"managed_table_data_exclusions":["--exclude-table-data=auth.*","--exclude-table-data=storage.*"]}
 def test_local_destination_service_rejects_rerouting_and_ambiguous_inputs(self):
  cases=(
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
   for host in ("localhost","127.0.0.1","::1","/var/run/postgresql"):
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
 def artifact(self,manifest,observed,**changes):
  data={"artifactVersion":2,"blockers":["clone-required","clone-backup-recovery-required"],"catalogChecked":True,"catalogFingerprint":observed["catalog_sha256"],"cloneApplyRisks":1,"cloneBackupRecoveryRequired":True,"hostedLedgerFingerprint":observed["ledger_sha256"],"manifestHash":contract.MANIFEST_SHA256,"preflightReceiptId":None,"prerequisites":{},"repositoryCommit":"a"*40,"requiredLaterPromotionGate":"20260713002500_g014_catalog_contract.sql","safeToApply":False,"sourceFingerprint":recovery._source_fingerprint(manifest),"sourceValid":True,"schemaVersion":1,"ledgerExpectedTerminal":"20260531084516","closureTerminalVersion":"20260713002400"}
  data.update(changes); data["preflightReceiptId"]=recovery._preflight_receipt(data); return data
 def adapter(self,data,observed):
  with tempfile.TemporaryDirectory() as raw:
   path=Path(raw)/"artifact.json"; path.write_text(json.dumps(data),encoding="utf8")
   with patch.object(recovery,"_repository_commit",return_value="a"*40): return recovery._g034_adapter(path,ROOT,contract.load_manifest(ROOT),observed)
 def test_parser_has_only_local_modes_and_no_mutation_authorization(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  self.assertNotIn("hosted-apply",text); self.assertNotIn("pg_dumpall",text)
  for mode in ("validate","capture","restore-verify","clone-apply","local-postflight"): self.assertIn(mode,text)
 def test_exact_current_receipt_and_live_fingerprints_are_required(self):
  manifest=contract.load_manifest(ROOT); observed={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}; data=self.artifact(manifest,observed)
  result=self.adapter(data,observed); self.assertIn("capture_readiness_sha256",result)
  for change in ({"preflightReceiptId":"0"*64},{"repositoryCommit":"b"*40},{"hostedLedgerFingerprint":"3"*64},{"catalogFingerprint":"4"*64}):
   forged=self.artifact(manifest,observed,**change)
   if "preflightReceiptId" in change: forged["preflightReceiptId"]=change["preflightReceiptId"]
   with self.assertRaisesRegex(recovery.RecoveryError,"readiness"): self.adapter(forged,observed)
 def test_only_remediation_blockers_are_allowed_and_fatal_blockers_rejected(self):
  manifest=contract.load_manifest(ROOT); observed={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}
  allowed=self.artifact(manifest,observed,blockers=["catalog-prerequisite"]); self.adapter(allowed,observed)
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
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery.subprocess,"Popen",side_effect=(Process(),Process())) as popen:
   argv=recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},Path(raw))
  self.assertEqual(["pg_dump","--format=custom","--snapshot=snapshot","--blobs",*[f"--schema={schema}" for schema in [*contract.APPLICATION_SCHEMAS,"supabase_migrations","auth","storage"]],"--exclude-table-data=auth.*","--exclude-table-data=storage.*","--extension=pg_trgm","--extension=uuid-ossp","--extension=btree_gin","--extension=vector","--extension=pgcrypto","--dbname=service=g035"],argv)
  self.assertEqual((("pg_trgm","extensions"),("uuid-ossp","extensions"),("btree_gin","extensions"),("vector","public"),("pgcrypto","extensions")),recovery.RECOVERY_EXTENSIONS)
  self.assertEqual(("auth","storage"),contract.MANAGED_METADATA_SCHEMAS)
  self.assertEqual(("--exclude-table-data=auth.*","--exclude-table-data=storage.*"),recovery.MANAGED_TABLE_DATA_EXCLUSIONS)
  self.assertEqual(argv,popen.call_args_list[1].args[0])
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
   recipient="age1"+"q"*58
   args=Namespace(destination=str(dest),service_file=str(self.service(raw,"g035")),recipient=recipient,g034_artifact=str(artifact),pg_dump="pg_dump",encrypt_command="age")
   def dump(*values):
    self.assertNotIn("ROLLBACK",conn.events); self.assertEqual(recipient,values[2]); (dest/"g035-dump.enc").write_bytes(b"x"); return []
   with patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"command_exists",side_effect=lambda x:x),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"_fingerprints",return_value=observed),patch.object(recovery,"_g034_live_fingerprints",return_value={"ledger_sha256":"1"*64,"catalog_sha256":"2"*64}),patch.object(recovery,"_repository_commit",return_value="a"*40),patch.object(recovery,"_dump_to_encrypted",side_effect=dump):
    result=recovery.run_capture(args,manifest)
  self.assertEqual(hashlib.sha256(recipient.encode("utf-8")).hexdigest(),result["evidence"]["recipient_fingerprint"])
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
 def test_capture_rejects_invalid_age_recipients(self):
  with tempfile.TemporaryDirectory() as raw:
   dest=Path(raw)/"out"; dest.mkdir()
   for recipient in ("a"*64,"AGE1"+"q"*58,"age1"+"q"*57,"age1"+"q"*58+" ","age1"+"q"*57+"b","age1"+"q"*58+"--recipient=x"):
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
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints(managed_catalog_sha256="4"*64)
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"offline-identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**observed}}
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
  self.assertEqual({"auth_placeholder_mapping_count":20,"auth_placeholder_mapping_sha256":recovery.digest(expected)},evidence)
  self.assertNotIn("auth.users",json.dumps(evidence)); self.assertNotIn("email",json.dumps(evidence)); self.assertNotIn("token",json.dumps(evidence))
 def test_auth_placeholders_deduplicate_source_ids_and_require_empty_fenced_target(self):
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
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints()
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS],**self.managed_capture_scope(),**observed}}
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
    with patch.object(recovery,"_copy_local_service",side_effect=lambda *unused: events.append("fence") or Path(raw)/"service.conf"),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_create_auth_user_placeholders",side_effect=lambda conn: events.append("placeholders")),patch.object(recovery,"_fingerprints",return_value=observed):
     if failing_section:
      with self.assertRaisesRegex(recovery.RecoveryError,"external command failed"): recovery.run_restore_verify(args,None)
     else:
      recovery.run_restore_verify(args,None)
    if failing_section=="pre-data": expected=["fence","DROP SCHEMA public CASCADE","DROP SCHEMA auth CASCADE","DROP SCHEMA storage CASCADE","pre-data"]
    elif failing_section=="data": expected=["fence","DROP SCHEMA public CASCADE","DROP SCHEMA auth CASCADE","DROP SCHEMA storage CASCADE","pre-data","data"]
    else: expected=["fence","DROP SCHEMA public CASCADE","DROP SCHEMA auth CASCADE","DROP SCHEMA storage CASCADE","pre-data","data","placeholders","post-data"]
    self.assertEqual(expected,events)
 def test_restore_rejects_ledger_pair_mutation(self):
  class Conn:
   def rollback(self): pass
   def close(self): pass
  observed=fingerprints(pairs=(("20260101000000","actual"),))
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**{**observed,"ledger_pairs":[("20260101000000","mutated")]}}}
   def execute(argv,**unused):
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_create_auth_user_placeholders"),patch.object(recovery,"_fingerprints",return_value=observed),self.assertRaisesRegex(recovery.RecoveryError,"restore evidence mismatch"):
    recovery.run_restore_verify(args,None)
 def test_ledger_pairs_normalize_json_lists_but_reject_type_mutation(self):
  pairs=(("20260101000000","actual"),)
  self.assertTrue(recovery._ledger_evidence_equal([list(pair) for pair in pairs],pairs))
  self.assertFalse(recovery._ledger_evidence_equal([["20260101000000",1]],pairs))
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
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[]}}
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
    recovery.run_restore_verify(args,None)
  connect.assert_not_called(); run.assert_not_called()
 def test_restore_rejects_missing_or_mutated_managed_data_exclusions_before_local_reset(self):
  with tempfile.TemporaryDirectory() as raw:
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(Path(raw)/"missing.enc"),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   extension_scope=[{"name":name,"schema":schema} for name,schema in recovery.RECOVERY_EXTENSIONS]
   for exclusions in (None,["--exclude-table-data=auth.*"],["--exclude-table-data=storage.*","--exclude-table-data=auth.*"],["--exclude-table-data=auth.*","--exclude-table-data=storage.tables"]):
    evidence={"extension_scope":extension_scope,"managed_metadata_schema_scope":["auth","storage"]}
    if exclusions is not None: evidence["managed_table_data_exclusions"]=exclusions
    capture={"receipt_sha256":"capture-receipt","evidence":evidence}
    with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"_connect") as connect,patch.object(recovery,"run") as run,self.assertRaisesRegex(recovery.RecoveryError,"managed metadata scope"):
     recovery.run_restore_verify(args,None)
    connect.assert_not_called(); run.assert_not_called()
 def test_restore_fences_local_destination_before_public_reset_and_restore_errors_are_fatal(self):
  events=[]
  class Conn:
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
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),"extension_scope":[{"name":"pg_trgm","schema":"extensions"},{"name":"uuid-ossp","schema":"extensions"},{"name":"btree_gin","schema":"extensions"},{"name":"vector","schema":"public"},{"name":"pgcrypto","schema":"extensions"}],**self.managed_capture_scope(),**observed}}
   def execute(argv,**unused):
    events.append(argv[0])
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
    else: raise recovery.RecoveryError("external command failed")
   with patch.object(recovery,"_copy_local_service",side_effect=lambda *unused: events.append("fence") or Path(raw)/"service.conf"),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=lambda conn,sql: events.append(sql) or []),patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),self.assertRaisesRegex(recovery.RecoveryError,"external command failed"):
    recovery.run_restore_verify(args,None)
  self.assertLess(events.index("fence"),events.index("DROP SCHEMA public CASCADE"))
  self.assertLess(events.index("DROP SCHEMA public CASCADE"),events.index("DROP SCHEMA auth CASCADE"))
  self.assertLess(events.index("DROP SCHEMA auth CASCADE"),events.index("DROP SCHEMA storage CASCADE"))
  self.assertLess(events.index("DROP SCHEMA storage CASCADE"),events.index("pg_restore"))
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
  receipt=text.index("_require_restore_baseline(prior)",lock)
  baseline=text.index("_ledger_assert(conn,manifest,0)",lock)
  apply=text.index("for index,entry in enumerate(manifest.migrations):",lock)
  self.assertLess(lock,receipt); self.assertLess(receipt,baseline); self.assertLess(baseline,apply)
 def test_restore_receipt_requires_authoritative_baseline_digest_and_pairs(self):
  prior={"evidence":{"ledger_pairs":[list(pair) for pair in contract.BASELINE_PAIRS],"ledger_sha256":contract.BASELINE_SHA256,"ledger_count":len(contract.BASELINE_PAIRS)}}
  recovery._require_restore_baseline(prior)
  prior["evidence"]["ledger_pairs"][0][0]="20260124"
  with self.assertRaisesRegex(recovery.RecoveryError,"restore receipt ledger mismatch"): recovery._require_restore_baseline(prior)
 def test_self_commit_post_execution_failures_are_ambiguous(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  protected='run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(source)],env=env)\n      _query_conn(conn,"INSERT INTO supabase_migrations.schema_migrations'
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
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql")
   for failure in ("insert","commit","readback"):
    conn=Conn(failure)
    def query(connection,sql,params=None):
     if failure=="insert" and sql.startswith("INSERT"): raise RuntimeError("insert")
     return []
    def ledger(connection,unused,count):
     if failure=="readback" and count==1: raise RuntimeError("readback")
    with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"run"),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),patch.object(recovery,"_require_restore_baseline"),self.assertRaisesRegex(recovery.RecoveryError,"self_commit_ambiguous"):
     recovery.apply_manifest(args,manifest)
 def test_documents_policy_compatibility_hook_is_exact_and_version_bound(self):
  expected=("DROP POLICY IF EXISTS documents_select_own ON public.documents;","DROP POLICY IF EXISTS documents_insert_own ON public.documents;","DROP POLICY IF EXISTS documents_update_own ON public.documents;","DROP POLICY IF EXISTS documents_delete_own ON public.documents;")
  self.assertEqual(expected,recovery._compatibility_hook("20260627080000"))
  self.assertEqual((),recovery._compatibility_hook("20260627080001"))
 def test_documents_policy_hook_is_fenced_before_psql_and_failures_are_fatal(self):
  manifest=contract.load_manifest(ROOT); entry=next(item for item in manifest.migrations if item.version=="20260627080000")
  manifest=contract.Manifest((entry,),frozenset(),manifest.ledger_terminal_version,manifest.closure_terminal_version)
  class Conn:
   def commit(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql")
   events=[]; scripts=[]
   def query(unused,sql,params=None):
    events.append("lock" if "pg_advisory_lock" in sql else "unlock" if "pg_advisory_unlock" in sql else "query"); return []
   def ledger(unused,unused_manifest,count): events.append(f"ledger-{count}")
   def execute(argv,**unused):
    scripts.append(Path(argv[-1]).read_text(encoding="utf8")); events.append("psql"); raise recovery.RecoveryError("external command failed")
   def baseline(unused): events.append("baseline")
   with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),patch.object(recovery,"_require_restore_baseline",side_effect=baseline),patch.object(recovery,"_apply_vector_extension_relocation_hook"),patch.object(recovery,"run",side_effect=execute),self.assertRaisesRegex(recovery.RecoveryError,"external command failed"):
    recovery.apply_manifest(args,manifest)
  self.assertLess(events.index("lock"),events.index("baseline")); self.assertLess(events.index("baseline"),events.index("ledger-0")); self.assertLess(events.index("ledger-0"),events.index("psql"))
  self.assertEqual("BEGIN;\n"+"\n".join(recovery._compatibility_hook(entry.version))+"\n",scripts[0][:scripts[0].index("\\i ")])
 def test_short_urls_duplicate_target_url_hook_is_version_bound_and_fail_closed(self):
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
  conn=Conn()
  self.assertEqual(0,recovery._apply_short_urls_duplicate_target_url_hook(conn,"20260713000101"))
  self.assertEqual(0,conn.commits)
  with patch.object(recovery,"_query_conn",side_effect=[[(1,)]]),self.assertRaisesRegex(recovery.RecoveryError,"precondition"):
   recovery._apply_short_urls_duplicate_target_url_hook(conn,"20260713000100")
  with patch.object(recovery,"_query_conn",side_effect=[[],[],[(4,)],[],[],[]]):
   self.assertEqual(4,recovery._apply_short_urls_duplicate_target_url_hook(conn,"20260713000100"))
  self.assertEqual(1,conn.commits)
  with patch.object(recovery,"_query_conn",side_effect=[[],[],[(4,)],[],[],[(1,)]]),self.assertRaisesRegex(recovery.RecoveryError,"postcondition"):
   recovery._apply_short_urls_duplicate_target_url_hook(conn,"20260713000100")
 def test_short_urls_hook_cannot_run_before_local_ledger_fence(self):
  manifest=contract.load_manifest(ROOT); entry=next(item for item in manifest.migrations if item.version=="20260713000100")
  manifest=contract.Manifest((entry,),frozenset(),manifest.ledger_terminal_version,manifest.closure_terminal_version)
  class Conn:
   def commit(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql"); events=[]
   def query(unused,sql,params=None): events.append("lock" if "pg_advisory_lock" in sql else "unlock" if "pg_advisory_unlock" in sql else "query"); return []
   def ledger(unused,unused_manifest,count): events.append(f"ledger-{count}")
   def hook(unused,version):
    self.assertEqual("20260713000100",version); self.assertIn("ledger-0",events); events.append("hook"); return 0
   with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),patch.object(recovery,"_require_restore_baseline",side_effect=lambda unused: events.append("baseline")),patch.object(recovery,"_apply_short_urls_duplicate_target_url_hook",side_effect=hook),patch.object(recovery,"_fingerprints",return_value=fingerprints()),patch.object(recovery,"run",side_effect=lambda *unused,**kwargs: events.append("psql")):
    recovery.apply_manifest(args,manifest)
  self.assertLess(events.index("lock"),events.index("baseline")); self.assertLess(events.index("baseline"),events.index("ledger-0")); self.assertLess(events.index("ledger-0"),events.index("hook")); self.assertLess(events.index("hook"),events.index("psql"))
 def test_vector_extension_relocation_hook_is_version_bound_and_fail_closed(self):
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
  conn=Conn()
  self.assertIsNone(recovery._apply_vector_extension_relocation_hook(conn,"20260627080001"))
  with patch.object(recovery,"_query_conn",side_effect=[[("public",)],[],[("extensions",)],[]]):
   recovery._apply_vector_extension_relocation_hook(conn,"20260627080000")
  self.assertEqual(1,conn.commits)
  with patch.object(recovery,"_query_conn",return_value=[("extensions",)]),self.assertRaisesRegex(recovery.RecoveryError,"precondition"):
   recovery._apply_vector_extension_relocation_hook(conn,"20260627080000")
  with patch.object(recovery,"_query_conn",side_effect=[[("public",)],[],[("public",)]]),self.assertRaisesRegex(recovery.RecoveryError,"postcondition"):
   recovery._apply_vector_extension_relocation_hook(conn,"20260627080000")
 def test_vector_extension_hook_is_after_ledger_fence_before_policy_psql(self):
  manifest=contract.load_manifest(ROOT); entry=next(item for item in manifest.migrations if item.version=="20260627080000")
  manifest=contract.Manifest((entry,),frozenset(),manifest.ledger_terminal_version,manifest.closure_terminal_version)
  class Conn:
   def commit(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql"); events=[]
   def query(unused,sql,params=None): events.append("lock" if "pg_advisory_lock" in sql else "unlock" if "pg_advisory_unlock" in sql else "query"); return []
   def ledger(unused,unused_manifest,count): events.append(f"ledger-{count}")
   def vector_hook(unused,version):
    self.assertEqual("20260627080000",version); self.assertIn("ledger-0",events); events.append("vector"); return None
   with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),patch.object(recovery,"_require_restore_baseline",side_effect=lambda unused: events.append("baseline")),patch.object(recovery,"_apply_vector_extension_relocation_hook",side_effect=vector_hook),patch.object(recovery,"run",side_effect=lambda *unused,**kwargs: events.append("psql")):
    recovery.apply_manifest(args,manifest)
  self.assertLess(events.index("lock"),events.index("baseline")); self.assertLess(events.index("baseline"),events.index("ledger-0")); self.assertLess(events.index("ledger-0"),events.index("vector")); self.assertLess(events.index("vector"),events.index("psql"))
 def test_cross_schema_owner_hook_is_exact_version_bound_and_fail_closed(self):
  expected=("public.account_deletion_require_service_role()","public.account_deletion_is_active_admin(uuid)","public.account_deletion_write_audit(public.account_deletion_requests,text,text)","public.preview_account_deletion(uuid,uuid,timestamptz)","public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)","public.apply_account_deletion_database_cleanup(uuid,uuid)","public.list_account_deletion_storage_objects(uuid,uuid)","public.finalize_account_deletion_storage(uuid,uuid,boolean)","public.finalize_account_deletion_auth(uuid,uuid,boolean)","public.fail_account_deletion(uuid,uuid,text)","privacy_retention.require_service_role()","privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)")
  self.assertEqual(expected,recovery.CROSS_SCHEMA_OWNER_FUNCTIONS)
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
  conn=Conn()
  self.assertEqual(0,recovery._apply_cross_schema_owner_hook(conn,"20260713002001"))
  queries=[]
  def query(unused,sql,params=None):
   queries.append((sql,params))
   if sql==recovery.CROSS_SCHEMA_OWNER_RESOLVE_SQL: return [(1,)]
   if sql==recovery.CROSS_SCHEMA_OWNER_VERIFY_SQL: return [("postgres",)]
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   self.assertEqual(12,recovery._apply_cross_schema_owner_hook(conn,"20260713002000"))
  self.assertEqual(1,conn.commits)
  alters=[sql for sql,params in queries if sql.startswith("ALTER FUNCTION ")]
  self.assertEqual([f"ALTER FUNCTION {signature} OWNER TO postgres" for signature in expected],alters)
  with patch.object(recovery,"_query_conn",return_value=[]),self.assertRaisesRegex(recovery.RecoveryError,"precondition"):
   recovery._apply_cross_schema_owner_hook(conn,"20260713002000")
  with patch.object(recovery,"_query_conn",side_effect=[[(1,)],[],[("supabase_admin",)]]),self.assertRaisesRegex(recovery.RecoveryError,"postcondition"):
   recovery._apply_cross_schema_owner_hook(conn,"20260713002000")
 def test_obsolete_notification_overload_hook_is_exact_and_fail_closed(self):
  self.assertEqual("public.create_user_notification(uuid,public.notification_type,text,text,jsonb)",recovery.OBSOLETE_NOTIFICATION_OVERLOAD)
  self.assertEqual("public.create_user_notification(uuid,text,text,text,jsonb)",recovery.CANONICAL_NOTIFICATION_FUNCTION)
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
  conn=Conn(); queries=[]
  calls=0
  def query(unused,sql,params=None):
   nonlocal calls
   queries.append((sql,params))
   if sql==recovery.CROSS_SCHEMA_OWNER_RESOLVE_SQL:
    calls+=1; return [(1,)] if calls in (1,2,4) else []
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   self.assertEqual(1,recovery._apply_obsolete_notification_overload_hook(conn,"20260713002000"))
  self.assertEqual(1,conn.commits)
  self.assertEqual([f"DROP FUNCTION {recovery.OBSOLETE_NOTIFICATION_OVERLOAD}"],[sql for sql,params in queries if sql.startswith("DROP FUNCTION ")])
  with patch.object(recovery,"_query_conn",return_value=[]),self.assertRaisesRegex(recovery.RecoveryError,"precondition"):
   recovery._apply_obsolete_notification_overload_hook(conn,"20260713002000")
  with patch.object(recovery,"_query_conn",side_effect=[[(1,)],[(1,)],[],[],[]]),self.assertRaisesRegex(recovery.RecoveryError,"postcondition"):
   recovery._apply_obsolete_notification_overload_hook(conn,"20260713002000")
 def test_public_function_owner_hook_is_public_only_and_fail_closed(self):
  self.assertEqual("20260713002000",recovery.PUBLIC_FUNCTION_OWNERS_HOOK_VERSION)
  self.assertIn("namespace.nspname='public'",recovery.PUBLIC_FUNCTION_OWNERS_SQL)
  self.assertIn("procedure.oid::regprocedure::text",recovery.PUBLIC_FUNCTION_OWNERS_SQL)
  class Conn:
   def __init__(self): self.commits=0
   def commit(self): self.commits+=1
  conn=Conn(); initial=[("public.alpha(integer)","supabase_admin"),("public.beta()","postgres"),("public.g013()","privacy_workflow_owner")]; calls=[]
  def query(unused,sql,params=None):
   calls.append((sql,params))
   if sql==recovery.PUBLIC_FUNCTION_OWNERS_SQL: return initial if sum(1 for item in calls if item[0]==sql)==1 else [("public.alpha(integer)","postgres"),("public.beta()","postgres"),("public.g013()","privacy_workflow_owner")]
   return []
  with patch.object(recovery,"_query_conn",side_effect=query):
   self.assertEqual(("public.alpha(integer)",),recovery._apply_public_function_owners_hook(conn,"20260713002000"))
  self.assertEqual(1,conn.commits)
  self.assertEqual(["ALTER FUNCTION public.alpha(integer) OWNER TO postgres"],[sql for sql,params in calls if sql.startswith("ALTER FUNCTION ")])
  self.assertEqual((),recovery._apply_public_function_owners_hook(conn,"20260713002001"))
  with patch.object(recovery,"_query_conn",return_value=[("public.alpha()","authenticated")]),self.assertRaisesRegex(recovery.RecoveryError,"precondition"):
   recovery._apply_public_function_owners_hook(conn,"20260713002000")
  with patch.object(recovery,"_query_conn",side_effect=[[("public.alpha()","supabase_admin")],[],[("public.alpha()","supabase_admin")]]),self.assertRaisesRegex(recovery.RecoveryError,"postcondition"):
   recovery._apply_public_function_owners_hook(conn,"20260713002000")
 def test_clone_receipt_records_only_short_url_deleted_count_and_hook_digest(self):
  manifest=contract.load_manifest(ROOT); entry=next(item for item in manifest.migrations if item.version=="20260713000100")
  manifest=contract.Manifest((entry,),frozenset(),manifest.ledger_terminal_version,manifest.closure_terminal_version)
  class Conn:
   def commit(self): pass
   def close(self): pass
  with tempfile.TemporaryDirectory() as raw:
   args=Namespace(service="g035-local",restore_receipt="unused",service_file=str(self.service(raw)),psql="psql")
   with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_query_conn",return_value=[]),patch.object(recovery,"_ledger_assert"),patch.object(recovery,"_require_restore_baseline"),patch.object(recovery,"_apply_short_urls_duplicate_target_url_hook",return_value=4),patch.object(recovery,"_apply_obsolete_notification_overload_hook",return_value=0),patch.object(recovery,"_apply_public_function_owners_hook",return_value=()),patch.object(recovery,"_apply_cross_schema_owner_hook",return_value=0),patch.object(recovery,"_fingerprints",return_value=fingerprints()),patch.object(recovery,"run"):
    result=recovery.apply_manifest(args,manifest)
  self.assertEqual(4,result["evidence"]["compatibility_hook_deleted_row_count"])
  self.assertEqual(recovery.digest((recovery.COMPATIBILITY_HOOKS,recovery.VECTOR_EXTENSION_RELOCATION_HOOK_VERSION,recovery.VECTOR_EXTENSION_RELOCATION_HOOK,recovery.OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION,recovery.OBSOLETE_NOTIFICATION_OVERLOAD,recovery.CANONICAL_NOTIFICATION_FUNCTION,recovery.PUBLIC_FUNCTION_OWNERS_HOOK_VERSION,recovery.PUBLIC_FUNCTION_OWNERS_SQL,recovery.CROSS_SCHEMA_OWNER_HOOK_VERSION,recovery.CROSS_SCHEMA_OWNER_FUNCTIONS,recovery.SHORT_URLS_DUPLICATE_TARGET_URL_HOOK_VERSION,recovery.SHORT_URLS_DUPLICATE_TARGET_URL_HOOK)),result["evidence"]["compatibility_hook_sha256"])
  self.assertEqual(0,result["evidence"]["compatibility_hook_owner_function_count"])
  self.assertEqual(0,result["evidence"]["compatibility_hook_obsolete_function_count"])
  self.assertEqual(0,result["evidence"]["compatibility_hook_public_function_count"])
  self.assertEqual(recovery.digest(()),result["evidence"]["compatibility_hook_public_function_sha256"])
  self.assertNotIn("compatibility_hook_count",result["evidence"])
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
