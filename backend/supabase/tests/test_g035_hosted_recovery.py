import contextlib, hashlib, importlib.util, io, json, subprocess, sys, tempfile, unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
import g035_hosted_recovery_contract as contract
spec=importlib.util.spec_from_file_location("recovery",SCRIPTS/"g035_hosted_recovery.py"); recovery=importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
ROOT=Path(__file__).parents[3]

class ContractTests(unittest.TestCase):
 def test_manifest_and_immutable_pair_baseline(self):
  manifest=contract.validate_sources(ROOT)
  self.assertEqual(27,len(manifest.migrations)); self.assertEqual(12,len(contract.BASELINE_PAIRS))
  self.assertTrue(contract.ledger_prefix(manifest,list(contract.BASELINE_PAIRS)))
  self.assertFalse(contract.ledger_prefix(manifest,[("20260531084516","caller_supplied")]))

class ControllerTests(unittest.TestCase):
 def service(self,directory,section="g035-local",body=None):
  path=Path(directory)/"service.conf"; path.write_text(body or f"[{section}]\nhost=127.0.0.1\nport=5432\ndbname=g035_local\napplication_name=g035-local-rehearsal\nsslmode=disable\n",encoding="utf8"); path.chmod(0o600); return path
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
 def test_dump_argv_includes_only_application_and_recovery_control_schemas(self):
  class Pipe:
   def close(self): pass
  class Process:
   stdin=Pipe()
   def wait(self,*unused): return 0
  with tempfile.TemporaryDirectory() as raw,patch.object(recovery.subprocess,"Popen",side_effect=(Process(),Process())) as popen:
   argv=recovery._dump_to_encrypted("pg_dump","age","age1"+"q"*58,"snapshot",{},Path(raw))
  schemas=[value.removeprefix("--schema=") for value in argv if value.startswith("--schema=")]
  self.assertEqual([*contract.APPLICATION_SCHEMAS,"supabase_migrations"],schemas)
  self.assertEqual(1,schemas.count("supabase_migrations"))
  self.assertNotIn("auth",schemas); self.assertNotIn("storage",schemas)
  self.assertEqual(argv,popen.call_args_list[1].args[0])
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
  conn=Conn(); manifest=contract.load_manifest(ROOT); observed={"ledger_pairs":[],"ledger_sha256":"1"*64,"ledger_count":0,"catalog_sha256":"2"*64}
  with tempfile.TemporaryDirectory() as raw:
   dest=Path(raw)/"out"; dest.mkdir(); artifact=Path(raw)/"ok.json"; artifact.write_text(json.dumps(self.artifact(manifest,observed)),encoding="utf8")
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
  self.assertEqual(observed["ledger_pairs"],result["evidence"]["ledger_pairs"])
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
  observed={"ledger_pairs":[],"ledger_sha256":"1"*64,"ledger_count":0,"catalog_sha256":"2"*64}
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"offline-identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),**observed}}
   def execute(argv,**unused):
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute) as execute,patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_fingerprints",return_value=observed):
    result=recovery.run_restore_verify(args,None)
  decrypt_argv=execute.call_args_list[0].args[0]
  self.assertEqual(["age","--decrypt","--identity",str(identity),"--output",decrypt_argv[5],str(dump)],decrypt_argv)
  self.assertNotIn(str(identity),json.dumps(result))
  self.assertNotIn("test-key-material",json.dumps(result))
  self.assertFalse(Path(decrypt_argv[5]).exists())
 def test_restore_rejects_ledger_pair_mutation(self):
  class Conn:
   def rollback(self): pass
   def close(self): pass
  observed={"ledger_pairs":[("20260101000000","actual")],"ledger_sha256":"1"*64,"ledger_count":1,"catalog_sha256":"2"*64}
  with tempfile.TemporaryDirectory() as raw:
   dump=Path(raw)/"dump.enc"; dump.write_bytes(b"ciphertext")
   identity=Path(raw)/"identity"; identity.write_bytes(b"test-key-material"); identity.chmod(0o600)
   args=Namespace(destination_service="g035-local",capture_receipt="capture",dump=str(dump),identity_file=str(identity),decrypt_command="age",pg_restore="pg_restore",service_file=str(self.service(raw)))
   capture={"receipt_sha256":"capture-receipt","evidence":{"dump_sha256":hashlib.sha256(b"ciphertext").hexdigest(),**{**observed,"ledger_pairs":[("20260101000000","mutated")]}}}
   def execute(argv,**unused):
    if argv[0]=="age": Path(argv[5]).write_bytes(b"plain")
   with patch.object(recovery,"_require_prior",return_value=capture),patch.object(recovery,"command_exists",side_effect=lambda command:command),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"run",side_effect=execute),patch.object(recovery,"_connect",return_value=Conn()),patch.object(recovery,"_fingerprints",return_value=observed),self.assertRaisesRegex(recovery.RecoveryError,"restore evidence mismatch"):
    recovery.run_restore_verify(args,None)
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
 def test_clone_requires_the_exact_baseline_before_applying_migrations(self):
  text=(SCRIPTS/"g035_hosted_recovery.py").read_text(encoding="utf8")
  lock=text.index('_query_conn(conn,"SELECT pg_advisory_lock(35035)")')
  baseline=text.index("_ledger_assert(conn,manifest,0)",lock)
  apply=text.index("for index,entry in enumerate(manifest.migrations):",lock)
  self.assertLess(lock,baseline); self.assertLess(baseline,apply)
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
    with patch.object(recovery,"_require_prior",return_value={"receipt_sha256":"x"}),patch.object(recovery,"command_exists",return_value="psql"),patch.object(recovery,"_restrictive",return_value=True),patch.object(recovery,"_connect",return_value=conn),patch.object(recovery,"run"),patch.object(recovery,"_query_conn",side_effect=query),patch.object(recovery,"_ledger_assert",side_effect=ledger),self.assertRaisesRegex(recovery.RecoveryError,"self_commit_ambiguous"):
     recovery.apply_manifest(args,manifest)
 def test_main_rejects_without_diagnostics(self):
  output=io.StringIO()
  with patch.object(recovery,"validate_sources",side_effect=recovery.ContractError("secret")),contextlib.redirect_stdout(output): self.assertEqual(2,recovery.main(["validate"]))
  self.assertEqual("policy_rejected",json.loads(output.getvalue())["evidence"]["reason"]); self.assertNotIn("secret",output.getvalue())
if __name__=="__main__": unittest.main()
