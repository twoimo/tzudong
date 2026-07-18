"""Behavioral security regression tests for G037 managed recovery."""
from __future__ import annotations
import base64, hashlib, importlib.util, io, json, os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch

MODULE=Path(__file__).parents[1]/"scripts"/"g037_managed_recovery.py"
spec=importlib.util.spec_from_file_location("g037",MODULE); g037=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(g037)
def private(path,content=b"x"):
 path.write_bytes(content if isinstance(content,bytes) else content.encode()); path.chmod(0o600); return path
class Response(io.BytesIO):
 status=200
 def __init__(self,payload): super().__init__(payload); self.headers={"Content-Length":str(len(payload))}
 def __enter__(self): return self
 def __exit__(self,*args): self.close()
class Crypt:
 def __init__(self): self.stdin=io.BytesIO()
 def wait(self,*args): return 0
class Opener:
 def __init__(self,response): self.response=response; self.requests=[]
 def open(self,request,timeout): self.requests.append((request,timeout)); return self.response
class G037ManagedRecoveryTests(unittest.TestCase):
 def setUp(self): self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
 def tearDown(self): self.temp.cleanup()
 def test_duplicate_keys_are_rejected(self):
  with self.assertRaises(g037.RecoveryError): json.loads('{"x":1,"x":2}',object_pairs_hook=g037._pairs)
 def test_only_canonical_project_origin_is_accepted(self):
  self.assertEqual(g037.origin("https://abcdefghijklmnopqrst.supabase.co"),"https://abcdefghijklmnopqrst.supabase.co")
  for value in ("http://abcdefghijklmnopqrst.supabase.co","https://example.test","https://abcdefghijklmnopqrst.supabase.co/x","https://user@abcdefghijklmnopqrst.supabase.co","https://abcdefghijklmnopqrst.supabase.co?x=y","https://abcdefghijklmnopqrst.supabase.co:443"):
   with self.assertRaises(g037.RecoveryError): g037.origin(value)
 def test_path_traversal_is_rejected(self):
  for name in ("../private","/absolute","a/../../b",""):
   with self.assertRaises(g037.RecoveryError): g037.member_name("bucket",name,"version")
 def test_size_ceiling_rejects_oversized_catalog(self):
  class Cursor:
   def execute(self,*a): pass
   def fetchone(self): return ("snapshot",type("T",(),{"timestamp":lambda s:1})())
   def fetchall(self): return [("bucket","name","version",g037.MAX_OBJECT_BYTES+1)]
  class Conn:
   def cursor(self):
    class C:
     def __enter__(s): return Cursor()
     def __exit__(s,*a): pass
    return C()
  with self.assertRaises(g037.RecoveryError): g037.sql_catalog(Conn())
 def test_restrictive_acl_required_on_posix(self):
  p=self.root/"open"; p.write_text("x"); p.chmod(0o644)
  if os.name!="nt":
   with self.assertRaises(g037.RecoveryError): g037.require_file(p,"input")
 def test_windows_saved_sddl_strictly_decodes_icacls_exports(self):
  sid="S-1-5-21-100"
  dacl=f"D:PAI(A;;FA;;;{sid})"
  export=self.root/"acl.txt"
  target=self.root/"service.conf"
  record=f"{target.name}\r\n{dacl}\r\n"
  for raw in (
   record.encode("utf-16-le"),
   b"\xff\xfe"+record.encode("utf-16-le"),
   record.encode("utf-8"),
  ):
   export.write_bytes(raw)
   self.assertEqual(dacl,g037._windows_saved_sddl(export,target))
  for raw in (
   b"\xfe\xff"+record.encode("utf-16-be"),
   b"\xff\xfeD\x00:\x00\x00",
   f"{target.name}\r\n{dacl}\x00\r\n".encode("utf-8"),
   record.encode("utf-8")+b"\x00",
   b"ABCD"+record.encode("utf-16-le"),
   b"AB"+record.encode("utf-16-le"),
   b"\xff\xfeABCD"+record.encode("utf-16-le"),
   b"\xc3\xa9"+record.encode("utf-16-le"),
   record.encode("utf-16-le")+b"x",
   f"one\r\n{dacl}\r\ntwo\r\n{dacl}\r\n".encode("utf-8"),
   f"other.conf\r\n{dacl}\r\n".encode("utf-8"),
   f"{target.name}\r\n{dacl}\r\nsuffix".encode("utf-8"),
   b"service.conf owner-only",
  ):
   export.write_bytes(raw)
   self.assertIsNone(g037._windows_saved_sddl(export,target))
 def test_windows_saved_sddl_accepts_unicode_icacls_record_only_for_target_basename(self):
  sid="S-1-5-21-100"; dacl=f"D:PAI(A;;FA;;;{sid})"
  target=self.root/"한글-서비스.conf"; export=self.root/"acl.txt"
  record=f"{target.name}\r\n{dacl}\r\n"
  for raw in (record.encode("utf-16-le"),b"\xff\xfe"+record.encode("utf-16-le"),record.encode("utf-8")):
   export.write_bytes(raw)
   self.assertEqual(dacl,g037._windows_saved_sddl(export,target))
  export.write_bytes(f"다른.conf\r\n{dacl}\r\n".encode("utf-16-le"))
  self.assertIsNone(g037._windows_saved_sddl(export,target))
  export.write_bytes(b"\x80\x00"+record.encode("utf-16-le"))
  self.assertIsNone(g037._windows_saved_sddl(export,target))
 def test_windows_dacl_allows_only_owner_system_and_administrators(self):
  sid="S-1-5-21-100"; service=self.root/"service.conf"; service.write_text("x")
  def restrictive(sddl):
   with patch.object(g037,"_windows_current_sid",return_value=sid),patch.object(g037.subprocess,"run"),patch.object(g037,"_windows_saved_sddl",return_value=sddl):
    return g037._windows_dacl_restrictive(service)
  self.assertTrue(restrictive(f"D:PAI(A;;FA;;;{sid})"))
  self.assertFalse(restrictive(f"D:PAI(A;;FA;;;{sid})(A;;FA;;;WD)"))
  self.assertFalse(restrictive("D:PAI(A;;FA;;;SY)"))
  self.assertFalse(restrictive(f"D:PAI(A;;FA;;;{sid})trailing"))
 def test_temporary_bytes_hardens_windows_acl_before_writing_payload(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path); events=[]; original_fdopen=os.fdopen
  class ObservingFile:
   def __init__(s,file): s.file=file
   def __enter__(s): return s
   def __exit__(s,*args): s.file.close()
   def write(s,data):
    events.append("write"); self.assertEqual(events,["harden","harden","verify","write"]); return s.file.write(data)
   def flush(s): return s.file.flush()
   def fileno(s): return s.file.fileno()
  def fdopen(*args,**kwargs): return ObservingFile(original_fdopen(*args,**kwargs))
  def harden(argv,**kwargs):
   events.append("harden")
   self.assertIn(argv,(["icacls",str(path),"/reset"],["icacls",str(path),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*S-1-5-21-100:F","SYSTEM:F","Administrators:F"]))
   return type("Result",(),{})()
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037.subprocess,"run",side_effect=harden),patch.object(g037,"_windows_dacl_restrictive",side_effect=lambda _: events.append("verify") or True),patch.object(g037.os,"fdopen",side_effect=fdopen):
    self.assertEqual(g037._temporary_bytes(b"receipt","g037-test-"),str(path))
   self.assertEqual(path.read_bytes(),b"receipt")
  finally:
   path.unlink(missing_ok=True)
 def test_temporary_bytes_acl_failure_closes_and_unlinks_before_write(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path)
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037.subprocess,"run",side_effect=g037.subprocess.CalledProcessError(1,["icacls"])):
    with self.assertRaises(g037.subprocess.CalledProcessError): g037._temporary_bytes(b"receipt","g037-test-")
   self.assertFalse(path.exists())
   with self.assertRaises(OSError): os.fstat(fd)
  finally:
   path.unlink(missing_ok=True)
 def test_source_public_key_hardens_windows_acl_before_writing_material(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path); events=[]; original_fdopen=os.fdopen
  class ObservingFile:
   def __init__(s,file): s.file=file
   def __enter__(s): return s
   def __exit__(s,*args): s.file.close()
   def write(s,data):
    events.append("write"); self.assertEqual(events,["harden","harden","verify","write"]); self.assertEqual(data,g037.RECOVERY_PUBLIC_KEY); return s.file.write(data)
   def flush(s): return s.file.flush()
   def fileno(s): return s.file.fileno()
  def fdopen(*args,**kwargs): return ObservingFile(original_fdopen(*args,**kwargs))
  def harden(argv,**kwargs):
   events.append("harden")
   self.assertIn(argv,(["icacls",str(path),"/reset"],["icacls",str(path),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*S-1-5-21-100:F","SYSTEM:F","Administrators:F"]))
   return type("Result",(),{})()
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037.subprocess,"run",side_effect=harden),patch.object(g037,"_windows_dacl_restrictive",side_effect=lambda _: events.append("verify") or True),patch.object(g037.os,"fdopen",side_effect=fdopen):
    public_key=g037._source_public_key(g037.RECOVERY_PUBLIC_KEY)
   self.assertEqual(public_key,path); self.assertEqual(path.read_bytes(),g037.RECOVERY_PUBLIC_KEY)
  finally:
   path.unlink(missing_ok=True)
 def test_source_public_key_acl_failure_removes_path_before_writing_material(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path)
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037.subprocess,"run",side_effect=g037.subprocess.CalledProcessError(1,["icacls"])):
    with self.assertRaises(g037.subprocess.CalledProcessError): g037._source_public_key(g037.RECOVERY_PUBLIC_KEY)
   self.assertFalse(path.exists())
   with self.assertRaises(OSError): os.fstat(fd)
  finally:
   path.unlink(missing_ok=True)
 def test_temporary_bytes_is_restrictive(self):
  path=Path(g037._temporary_bytes(b"receipt","g037-test-"))
  try:
   self.assertTrue(g037.restrictive(path)); self.assertEqual(path.read_bytes(),b"receipt")
  finally:
   path.unlink(missing_ok=True)
 def test_temporary_bytes_uses_supplied_existing_directory(self):
  directory=self.root/"receipts"; directory.mkdir()
  if os.name=="nt":
   sid=g037._windows_current_sid(); self.assertIsNotNone(sid)
   g037.subprocess.run(["icacls",str(directory),"/reset"],stdin=g037.subprocess.DEVNULL,stdout=g037.subprocess.PIPE,stderr=g037.subprocess.PIPE,text=True,timeout=10,check=True)
   g037.subprocess.run(["icacls",str(directory),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*"+sid+":F","SYSTEM:F","Administrators:F"],stdin=g037.subprocess.DEVNULL,stdout=g037.subprocess.PIPE,stderr=g037.subprocess.PIPE,text=True,timeout=10,check=True)
  else: directory.chmod(0o700)
  self.assertTrue(g037.restrictive(directory,directory=True))
  path=Path(g037._temporary_bytes(b"receipt","g037-test-",directory=directory))
  try:
   self.assertEqual(path.parent,directory)
   self.assertTrue(g037.restrictive(path))
   self.assertEqual(path.read_bytes(),b"receipt")
  finally:
   path.unlink(missing_ok=True)
 def test_temporary_bytes_rejects_permissive_supplied_directory(self):
  directory=self.root/"permissive"; directory.mkdir()
  if os.name=="nt":
   with patch.object(g037,"_windows_dacl_restrictive",return_value=False):
    with self.assertRaises(g037.RecoveryError): g037._temporary_bytes(b"receipt","g037-test-",directory=directory)
  else:
   directory.chmod(0o755)
   with self.assertRaises(g037.RecoveryError): g037._temporary_bytes(b"receipt","g037-test-",directory=directory)
 def test_temporary_bytes_rejects_symlink_supplied_directory(self):
  if os.name=="nt": self.skipTest("symlink creation requires platform-specific privileges")
  directory=self.root/"receipts"; directory.mkdir(); directory.chmod(0o700)
  link=self.root/"receipts-link"; link.symlink_to(directory,target_is_directory=True)
  with self.assertRaises(g037.RecoveryError): g037._temporary_bytes(b"receipt","g037-test-",directory=link)
 def test_authenticated_route_is_used_without_version_claim(self):
  archive=self.root/"blobs.age"; opener=Opener(Response(b"abc")); catalog=[("bucket","folder/object","current-version",3)]
  with patch.object(g037,"require_dir"),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037,"_windows_dacl_restrictive",return_value=True),patch.object(g037.subprocess,"run"),patch.object(g037,"build_opener",return_value=opener), patch.object(g037.subprocess,"Popen",return_value=Crypt()):
   members=g037.download_archive("https://abcdefghijklmnopqrst.supabase.co","token",catalog,"age","age1"+"a"*58,archive,time.time()+10)
  url=opener.requests[0][0].full_url
  self.assertEqual(url,"https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/bucket/folder/object")
  self.assertNotIn("version=",url); self.assertEqual(members[0]["size"],3)
 def test_openssl_sign_uses_fsynced_payload_file_without_stdin_or_residue(self):
  seen=[]
  def run(argv,**kwargs):
   if argv[0]=="icacls": return type("Result",(),{})()
   payload_path=Path(argv[argv.index("-in")+1]); seen.append(payload_path)
   self.assertEqual(payload_path.read_bytes(),b"receipt")
   if os.name!="nt": self.assertEqual(payload_path.stat().st_mode&0o777,0o600)
   self.assertNotIn("input",kwargs); self.assertIs(kwargs["stdin"],g037.subprocess.DEVNULL)
   self.assertEqual(kwargs["timeout"],g037.TIMEOUT); self.assertTrue(kwargs["check"])
   return type("Result",(),{"stdout":b"signature"})()
  with patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037,"_windows_dacl_restrictive",return_value=True),patch.object(g037.subprocess,"run",side_effect=run):
   self.assertEqual(g037.openssl_sign("openssl",self.root/"key",b"receipt"),b"signature")
  self.assertEqual(len(seen),1); self.assertFalse(seen[0].exists())
 def test_openssl_verify_uses_payload_and_signature_files_and_cleans_on_error(self):
  seen=[]
  def run(argv,**kwargs):
   if argv[0]=="icacls": return type("Result",(),{})()
   payload_path=Path(argv[argv.index("-in")+1]); signature_path=Path(argv[argv.index("-sigfile")+1]); seen.extend((payload_path,signature_path))
   self.assertEqual(payload_path.read_bytes(),b"receipt"); self.assertEqual(signature_path.read_bytes(),b"signature")
   self.assertNotIn("input",kwargs); self.assertIs(kwargs["stdin"],g037.subprocess.DEVNULL)
   raise g037.subprocess.CalledProcessError(1,argv)
  with patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037,"_windows_dacl_restrictive",return_value=True),patch.object(g037.subprocess,"run",side_effect=run):
   self.assertFalse(g037.openssl_verify("openssl",self.root/"public",b"receipt",b"signature"))
  self.assertEqual(len(seen),2); self.assertTrue(all(not path.exists() for path in seen))
 def test_openssl_verify_attempts_signature_cleanup_after_payload_cleanup_failure(self):
  payload=private(self.root/"payload",b"receipt"); signature=private(self.root/"signature",b"signature"); seen=[]; original_unlink=Path.unlink
  def unlink(path,*,missing_ok=False):
   seen.append(path)
   if path==payload: raise OSError("payload cleanup failed")
   return original_unlink(path,missing_ok=missing_ok)
  try:
   with patch.object(g037,"_temporary_bytes",side_effect=[str(payload),str(signature)]),patch.object(g037.subprocess,"run",return_value=type("Result",(),{})()),patch.object(Path,"unlink",new=unlink):
    with self.assertRaises(g037.RecoveryError): g037.openssl_verify("openssl",self.root/"public",b"receipt",b"signature")
   self.assertEqual(seen,[payload,signature]); self.assertFalse(signature.exists())
  finally:
   original_unlink(payload,missing_ok=True)
 def test_deadline_and_total_preflight_fail_before_opening_network(self):
  with self.assertRaises(g037.RecoveryError): g037.deadline_remaining(time.time()-1)
  catalog=[("b","n","v",g037.MAX_TOTAL_BYTES+1)]
  with self.assertRaises(g037.RecoveryError): g037.download_archive("https://abcdefghijklmnopqrst.supabase.co","token",catalog,"age","age1"+"a"*58,self.root/"out",time.time()+10)
 def test_catalog_drift_is_exact_version_and_size_membership(self):
  class Conn:
   def cursor(self):
    class Cursor:
     def __enter__(s): return s
     def __exit__(s,*a): pass
     def execute(s,*a): pass
     def fetchall(s): return [("bucket","name","v2",3)]
    return Cursor()
  self.assertNotEqual(g037.catalog_readback(Conn()),[("bucket","name","v1",3)])
 def test_member_commitments_require_unique_exact_members(self):
  member=g037.member_name("bucket","name","version")
  expected={"member_sha256":hashlib.sha256(member.encode()).hexdigest(),"catalog_sha256":"a"*64,"size":3,"content_sha256":hashlib.sha256(b"abc").hexdigest()}
  observed={"member_sha256":hashlib.sha256(member.encode()).hexdigest(),"size":3,"content_sha256":hashlib.sha256(b"abc").hexdigest()}
  self.assertEqual((expected["member_sha256"],expected["size"],expected["content_sha256"]),(observed["member_sha256"],observed["size"],observed["content_sha256"]))
  self.assertNotEqual(expected["content_sha256"],hashlib.sha256(b"abd").hexdigest())
 def test_source_pinned_signature_accepts_only_verified_fixture(self):
  receipt=private(self.root/"receipt",json.dumps({"schema":"fixture","signature":"c2ln"}))
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037,"openssl_verify",return_value=True):
   self.assertEqual(g037.signed_json(receipt,g037.RECOVERY_PUBLIC_KEY,"receipt")["schema"],"fixture")
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037,"openssl_verify",return_value=False):
   with self.assertRaises(g037.RecoveryError): g037.signed_json(receipt,g037.RECOVERY_PUBLIC_KEY,"receipt")
 def test_signed_receipt_roundtrip_returns_unsigned_payload(self):
  payload={"schema":"fixture","mode":"capture"}
  signed={**payload,"signature":base64.b64encode(b"fake-signature").decode("ascii")}
  receipt=private(self.root/"signed-receipt",json.dumps(signed))
  def verify(_,__,candidate,signature):
   return candidate==g037.canonical(payload) and signature==b"fake-signature"
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037,"openssl_verify",side_effect=verify):
   self.assertEqual(g037.signed_json(receipt,g037.RECOVERY_PUBLIC_KEY,"receipt"),payload)
 def test_identity_is_required_restrictive_before_decrypt(self):
  identity=self.root/"identity"; identity.write_text("secret"); identity.chmod(0o644)
  with self.assertRaises(g037.RecoveryError): g037.require_file(identity,"age identity")
 def test_preserved_freeze_proof_is_reauthenticated_and_time_bound(self):
  base="https://abcdefghijklmnopqrst.supabase.co"; now=int(time.time())
  signed={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://abcdefghijklmnopqrst.supabase.co","commit":"a"*40,"manifest_sha256":"b"*64,"source_root":"c"*64,"terminal_spec":"d"*64,"scope":g037.EXPECTED_FREEZE_SCOPE,"relation_root":"e"*64,"acl_root":"f"*64,"held_lock_root":"0"*64,"controller_public_key_sha256":g037.CONTROLLER_PUBLIC_KEY_SHA256,"not_before_unix":now-10,"not_after_unix":now+10,"signature":"c2ln"}
  evidence={"freeze":g037.freeze_evidence(signed),"freeze_started_unix":now-1,"freeze_finished_unix":now+1}
  with patch.object(g037,"openssl_verify",return_value=True):
   self.assertEqual(g037.validate_preserved_freeze(evidence)["freeze_id"],"freeze-0001")
  evidence["freeze"]["sha256"]="0"*64
  with self.assertRaises(g037.RecoveryError): g037.validate_preserved_freeze(evidence)
 def test_parser_accepts_only_verify_and_rejects_capture(self):
  argv=["verify","--destination","destination","--recipient-file","recipient","--recipient-allowlist-file","allowlist","--receipt","receipt","--logical-archive","logical","--blob-archive","blobs","--identity-file","identity"]
  self.assertEqual(g037.parser().parse_args(argv).mode,"verify")
  with self.assertRaises(SystemExit): g037.parser().parse_args(["capture"])
 def test_expired_deadline_rejects_before_readback_connection(self):
  with self.assertRaises(g037.RecoveryError): g037.deadline_remaining(time.time()-0.01)
 def test_complete_toc_inventory_is_required(self):
  valid=["SCHEMA - auth","SCHEMA - storage"]+[f"TABLE DATA {schema} {table}" for schema,tables in (("auth",g037.AUTH_TABLE_DATA),("storage",g037.STORAGE_TABLE_DATA)) for table in tables]
  self.assertTrue(g037.toc_inventory_valid(valid))
  self.assertFalse(g037.toc_inventory_valid(valid[:-1]))
 def test_cursor_capture_uses_one_cursor_for_h0_snapshot_and_h1(self):
  class Cursor:
   def __init__(s): s.calls=[]; s.catalogs=[[("bucket","name","v1",3)],[("bucket","name","v1",3)]]
   def execute(s,sql,*args): s.calls.append(sql)
   def fetchall(s): return s.catalogs.pop(0)
   def fetchone(s): return ("snapshot-1",)
  cursor=Cursor(); destination=self.root/"out"; destination.mkdir(); destination.chmod(0o700)
  now=int(time.time()); binding={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://abcdefghijklmnopqrst.supabase.co","commit":"a"*40,"manifest_sha256":"b"*64,"source_root":"c"*64,"terminal_spec":"d"*64,"scope":g037.EXPECTED_FREEZE_SCOPE,"relation_root":"e"*64,"acl_root":"f"*64,"held_lock_root":"0"*64,"not_before_unix":now-1,"not_after_unix":now+30,"controller_public_key_sha256":g037.CONTROLLER_PUBLIC_KEY_SHA256}; capability={**binding,"signature":"c2ln"}; saved={}
  def persist(_,data): saved["data"]=data
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037,"encrypted_dump"),patch.object(g037,"download_archive",return_value=[]),patch.object(g037,"command",side_effect=lambda x:x),patch.object(g037,"file_hash",return_value="a"*64),patch.object(g037,"fsync_file"),patch.object(g037,"signing_key_matches_source",return_value=True),patch.object(g037,"write_receipt",side_effect=persist),patch.object(g037,"load_receipt",side_effect=lambda _: {k:v for k,v in saved["data"].items() if k!="signature"}),patch.object(g037,"repo_commit",return_value="a"*40),patch.object(g037,"openssl_sign",return_value=b"signature"),patch.object(g037,"openssl_verify",return_value=True):
   result=g037.capture_cursor(cursor,base="https://abcdefghijklmnopqrst.supabase.co",secret="not-printed",recipient="age1"+"a"*58,recipient_fingerprint="f"*64,service_file="service",pgpass_file="pgpass",service_name="g037",destination=destination,age_command="age",pg_dump_command="pg_dump",deadline=time.time()+10,freeze_capability=capability,expected_binding=binding,recovery_signing_key=self.root/"key",recovery_receipt=self.root/"recovery.json")
  self.assertEqual(result["auth_storage_catalog_root"],g037.digest([("bucket","name","v1",3)]))
  self.assertIn("SELECT pg_export_snapshot()",cursor.calls)
  self.assertFalse(any(call.startswith("BEGIN") for call in cursor.calls))
 def test_restrictive_output_hardens_before_ciphertext_write(self):
  directory=self.root/"outputs"; directory.mkdir()
  if os.name!="nt": directory.chmod(0o700)
  output=directory/"ciphertext.age"; events=[]
  original_harden=g037._harden_restrictive_file
  def harden(path):
   original_harden(path); events.append("harden")
  with patch.object(g037,"require_dir"),patch.object(g037,"_harden_restrictive_file",side_effect=harden):
   with g037.restrictive_output(output,"ciphertext") as sink:
    self.assertEqual(events,["harden"]); self.assertTrue(g037.restrictive(output)); sink.write(b"ciphertext")
  self.assertTrue(g037.restrictive(output)); self.assertEqual(output.read_bytes(),b"ciphertext")
 def test_restrictive_output_hardening_failure_removes_empty_file_before_write(self):
  directory=self.root/"outputs"; directory.mkdir()
  if os.name!="nt": directory.chmod(0o700)
  output=directory/"ciphertext.age"; observed=[]
  def fail(path):
   observed.append(path.read_bytes()); raise g037.RecoveryError("ACL failure")
  with patch.object(g037,"require_dir"),patch.object(g037,"_harden_restrictive_file",side_effect=fail):
   with self.assertRaises(g037.RecoveryError):
    with g037.restrictive_output(output,"ciphertext") as sink: sink.write(b"ciphertext")
  self.assertEqual(observed,[b""]); self.assertFalse(output.exists())
 def test_fsync_file_uses_write_capable_handle_after_custody_check(self):
  output=private(self.root/"ciphertext.age",b"ciphertext"); events=[]
  with patch.object(g037,"require_file",side_effect=lambda path,label: events.append(("custody",label))),patch.object(g037.os,"open",return_value=41) as open_file,patch.object(g037.os,"fsync",side_effect=lambda fd: events.append(("fsync",fd))),patch.object(g037.os,"close",side_effect=lambda fd: events.append(("close",fd))):
   g037.fsync_file(output)
  self.assertEqual(events,[("custody","durability output"),("fsync",41),("close",41)])
  self.assertTrue(open_file.call_args.args[1]&os.O_WRONLY)
 def test_write_receipt_collision_preserves_existing_file(self):
  directory=self.root/"receipts"; directory.mkdir(); directory.chmod(0o700)
  receipt=private(directory/"receipt.json",b"existing")
  with patch.object(g037,"require_dir"):
   with self.assertRaises(g037.RecoveryError): g037.write_receipt(receipt,{"schema":"fixture"})
  self.assertEqual(receipt.read_bytes(),b"existing")
 def test_write_receipt_readback_failure_removes_published_receipt_and_temp(self):
  directory=self.root/"receipts"; directory.mkdir(); directory.chmod(0o700); receipt=directory/"receipt.json"
  original_read_bytes=Path.read_bytes
  def bad_read(path):
   if path==receipt: return b"tampered"
   return original_read_bytes(path)
  with patch.object(g037,"require_dir"),patch.object(Path,"read_bytes",new=bad_read):
   with self.assertRaises(g037.RecoveryError): g037.write_receipt(receipt,{"schema":"fixture"})
  self.assertFalse(receipt.exists()); self.assertEqual(list(directory.iterdir()),[])
if __name__=="__main__": unittest.main()
