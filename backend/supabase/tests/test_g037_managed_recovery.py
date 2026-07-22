"""Behavioral security regression tests for G037 managed recovery."""
from __future__ import annotations
import base64, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, time, unittest
from collections.abc import Mapping
from pathlib import Path
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/"scripts"; sys.path.insert(0,str(SCRIPTS))
MODULE=SCRIPTS/"g037_managed_recovery.py"
spec=importlib.util.spec_from_file_location("g037",MODULE); g037=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(g037)
import g037_write_freeze as freeze
import g040_recovery_authorization as g040
def private(path,content=b"x"):
 path.write_bytes(content if isinstance(content,bytes) else content.encode()); path.chmod(0o600); g037._harden_restrictive_file(path); return path
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
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
  if os.name=="nt":
   validator=patch.object(g040,"_windows_restrictive",return_value=True); validator.start(); self.addCleanup(validator.stop)
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
 def test_windows_dacl_admission_uses_in_process_validator_and_fails_closed(self):
  private_key=self.root/"production-private-key.pem"; private_key.write_bytes(b"key")
  source=Path(g037.__file__).read_text(encoding="utf8")
  admission=source[source.index("def _windows_dacl_restrictive"):source.index("def restrictive")]
  self.assertNotIn("subprocess",admission); self.assertNotIn("icacls",admission)
  with patch.object(g040,"_windows_restrictive",return_value=True) as validator,patch.object(g037.subprocess,"run") as run:
   self.assertTrue(g037._windows_dacl_restrictive(private_key))
  validator.assert_called_once_with(private_key); run.assert_not_called()
  with patch.object(g040,"_windows_restrictive",return_value=False),patch.object(g037.subprocess,"run") as run:
   self.assertFalse(g037._windows_dacl_restrictive(private_key))
  run.assert_not_called()
  with patch.object(g040,"_windows_restrictive",side_effect=OSError("validator failure")),patch.object(g037.subprocess,"run") as run:
   self.assertFalse(g037._windows_dacl_restrictive(private_key))
  run.assert_not_called()
 def test_temporary_input_is_unlinked_and_descriptor_backed_on_posix(self):
  if os.name=="nt": self.skipTest("POSIX descriptor custody")
  with g037._held_temporary_bytes(b"receipt","g037-test-",directory=self.root) as held:
   self.assertFalse(Path(held.path).exists())
   self.assertEqual(Path(held.child_path()).read_bytes(),b"receipt")
   self.assertIn(held.fd,held.subprocess_kwargs()["pass_fds"])
   with patch.object(Path,"exists",side_effect=[False,True]):
    self.assertEqual(held.child_path(),f"/dev/fd/{held.fd}")
 def test_temporary_input_write_failure_closes_and_unlinks(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path)
  with patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037.os,"write",side_effect=OSError("write failed")):
   with self.assertRaises(OSError):
    with g037._held_temporary_bytes(b"receipt","g037-test-"): pass
  self.assertFalse(path.exists())
  with self.assertRaises(OSError): os.fstat(fd)
 def test_temporary_input_fsync_failure_closes_and_unlinks(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path)
  with patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037.os,"fsync",side_effect=OSError("fsync failed")):
   with self.assertRaises(OSError):
    with g037._held_temporary_bytes(b"receipt","g037-test-"): pass
  self.assertFalse(path.exists())
 def test_temporary_input_rejects_permissive_supplied_directory(self):
  directory=self.root/"permissive"; directory.mkdir()
  if os.name!="nt": directory.chmod(0o755)
  with patch.object(g037,"restrictive",return_value=False):
   with self.assertRaises(g037.RecoveryError):
    with g037._held_temporary_bytes(b"receipt","g037-test-",directory=directory): pass
 def test_windows_temporary_input_validates_acl_before_and_after_child(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path)
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_harden_restrictive_file"),patch.object(g037,"restrictive",return_value=True),patch.object(g037,"_windows_dacl_restrictive",side_effect=[True,False]):
    with self.assertRaises(g037.RecoveryError):
     with g037._held_temporary_bytes(b"receipt","g037-test-") as held:
      held.child_path(); held.validate()
  finally:
   path.unlink(missing_ok=True)
 def test_windows_replacement_before_write_and_cleanup_is_fail_closed(self):
  fd,path=tempfile.mkstemp(dir=self.root); path=Path(path); unlinks=[]
  def unlink(candidate,*args,**kwargs): unlinks.append(Path(candidate))
  try:
   with patch.object(g037.os,"name","nt"),patch.object(g037.tempfile,"mkstemp",return_value=(fd,str(path))),patch.object(g037,"_harden_restrictive_file"),patch.object(g037,"restrictive",return_value=True),patch.object(g037._TemporaryInput,"_path_matches_identity",side_effect=[True,True,False,False]),patch.object(g037.os,"write") as write,patch.object(Path,"unlink",new=unlink):
    with self.assertRaises(g037.RecoveryError):
     with g037._held_temporary_bytes(b"receipt","g037-test-"): pass
   write.assert_not_called(); self.assertEqual(unlinks,[])
  finally:
   path.unlink(missing_ok=True)
 def test_authenticated_route_is_used_without_version_claim(self):
  archive=self.root/"blobs.age"; opener=Opener(Response(b"abc")); catalog=[("bucket","folder/object","current-version",3)]
  with patch.object(g037,"require_dir"),patch.object(g037,"_windows_current_sid",return_value="S-1-5-21-100"),patch.object(g037,"_windows_dacl_restrictive",return_value=True),patch.object(g037.subprocess,"run"),patch.object(g037,"build_opener",return_value=opener), patch.object(g037.subprocess,"Popen",return_value=Crypt()):
   members=g037.download_archive("https://abcdefghijklmnopqrst.supabase.co","token",catalog,"age","age1"+"a"*58,archive,time.time()+10)
  url=opener.requests[0][0].full_url
  self.assertEqual(url,"https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/bucket/folder/object")
  self.assertNotIn("version=",url); self.assertEqual(members[0]["size"],3)
 def test_openssl_inputs_are_descriptor_backed_and_not_reopenable_on_posix(self):
  if os.name=="nt": self.skipTest("POSIX descriptor custody")
  def run(argv,**kwargs):
   paths=(Path(argv[argv.index("-in")+1]),Path(argv[argv.index("-sigfile")+1]))
   self.assertEqual(paths[0].read_bytes(),b"receipt"); self.assertEqual(paths[1].read_bytes(),b"signature")
   self.assertFalse(any(Path(os.readlink(path)).exists() for path in paths))
   self.assertEqual(len(kwargs["pass_fds"]),2)
   raise g037.subprocess.CalledProcessError(1,argv)
  with patch.object(g037.subprocess,"run",side_effect=run):
   self.assertFalse(g037.openssl_verify("openssl",self.root/"public",b"receipt",b"signature"))
 def test_openssl_sign_never_passes_private_key_path_to_subprocess(self):
  key=private(self.root/"key",b"not-a-private-key")
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037.subprocess,"run") as run:
   with self.assertRaises(g037.RecoveryError): g037.openssl_sign("openssl",key,b"receipt")
  run.assert_not_called()
 def test_openssl_real_ed25519_smoke(self):
  openssl=g037.command("openssl"); key=self.root/"key.pem"
  subprocess.run([openssl,"genpkey","-algorithm","ED25519","-out",str(key)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  private(key,key.read_bytes())
  public=self.root/"public.pem"
  subprocess.run([openssl,"pkey","-in",str(key),"-pubout","-out",str(public)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  private(public,public.read_bytes())
  signature=g037.openssl_sign(openssl,key,b"receipt")
  self.assertTrue(g037.openssl_verify(openssl,public,b"receipt",signature))
 def test_capture_key_admission_never_exposes_private_path_to_subprocess(self):
  key=self.root/"capture-signing-key.pem"
  subprocess.run([g037.command("openssl"),"genpkey","-algorithm","ED25519","-out",str(key)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  private(key,key.read_bytes()); public=g037.private_key_public(key)
  with patch.object(g037,"RECOVERY_PUBLIC_KEY",public),patch.object(g037,"restrictive",return_value=True),patch.object(g037.subprocess,"run") as run:
   self.assertTrue(g037.signing_key_matches_source(key))
  run.assert_not_called()
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
  with patch.object(g037,"_windows_dacl_restrictive",return_value=False):
   with self.assertRaises(g037.RecoveryError): g037.require_file(identity,"age identity")
 def test_preserved_freeze_proof_is_reauthenticated_and_time_bound(self):
  base="https://abcdefghijklmnopqrst.supabase.co"; now=int(time.time())
  signed={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://abcdefghijklmnopqrst.supabase.co","commit":"a"*40,"manifest_sha256":"b"*64,"source_root":"c"*64,"terminal_spec":"d"*64,"scope":g037.EXPECTED_FREEZE_SCOPE,"relation_root":"e"*64,"acl_root":"f"*64,"held_lock_root":"0"*64,"controller_public_key_sha256":g037.CONTROLLER_PUBLIC_KEY_SHA256,"not_before_unix":now-10,"not_after_unix":now+10,"signature":"c2ln"}
  evidence={"freeze":g037.freeze_evidence(signed),"freeze_started_unix":now-1,"freeze_finished_unix":now+1}
  with patch.object(g037,"openssl_verify",return_value=True):
   self.assertEqual(g037.validate_preserved_freeze(evidence)["freeze_id"],"freeze-0001")
  evidence["freeze"]["sha256"]="0"*64
  with self.assertRaises(g037.RecoveryError): g037.validate_preserved_freeze(evidence)
 def test_active_capability_snapshots_real_verified_controller_mapping(self):
  private_key=self.root/"controller-private.pem"; public_key=self.root/"controller-public.pem"
  subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(private_key)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  g037._harden_restrictive_file(private_key)
  public_key.write_bytes(subprocess.run(["openssl","pkey","-in",str(private_key),"-pubout"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout)
  public=public_key.read_bytes(); public_sha256=hashlib.sha256(public).hexdigest(); now=int(time.time())
  binding={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://abcdefghijklmnopqrst.supabase.co","commit":"a"*40,"manifest_sha256":"b"*64,"source_root":"c"*64,"terminal_spec":"d"*64,"scope":g037.EXPECTED_FREEZE_SCOPE,"relation_root":"e"*64,"acl_root":"f"*64,"held_lock_root":"0"*64,"not_before_unix":now-1,"not_after_unix":now+30,"controller_public_key_sha256":public_sha256}
  signature=base64.b64encode(g037.openssl_sign("openssl",private_key,g037.canonical(binding))).decode("ascii"); signed={**binding,"signature":signature}
  with patch.object(freeze,"CONTROLLER_PUBLIC_KEY_PEM",public.decode("ascii")),patch.object(freeze,"CONTROLLER_PUBLIC_KEY_SHA256",public_sha256),patch.object(g037,"CONTROLLER_PUBLIC_KEY",public),patch.object(g037,"CONTROLLER_PUBLIC_KEY_SHA256",public_sha256):
   verified=freeze._verify_active(signed,binding)
   self.assertIsInstance(verified,freeze.VerifiedControllerCapability)
   self.assertEqual(g037._active_capability(verified,binding,time.time()+5),signed)
   self.assertEqual(verified["signature"],signature)
   class ChangingMapping(Mapping):
    def __iter__(s): return iter(signed)
    def __len__(s): return len(signed)
    def __getitem__(s,key): return "invalid" if key=="signature" else signed[key]
   with self.assertRaises(g037.RecoveryError): g037._active_capability(ChangingMapping(),binding,time.time()+5)
   with self.assertRaises(g037.RecoveryError): g037._active_capability({**signed,"signature":"invalid"},binding,time.time()+5)
 def test_parser_accepts_only_verify_and_rejects_capture(self):
  argv=["verify","--destination","destination","--recipient-file","recipient","--recipient-allowlist-file","allowlist","--receipt","receipt","--logical-archive","logical","--blob-archive","blobs","--identity-file","identity"]
  self.assertEqual(g037.parser().parse_args(argv).mode,"verify")
  with self.assertRaises(SystemExit): g037.parser().parse_args(["capture"])
 def test_expired_deadline_rejects_before_readback_connection(self):
  with self.assertRaises(g037.RecoveryError): g037.deadline_remaining(time.time()-0.01)
 def test_toc_inventory_is_exact_and_structural(self):
  def line(number,body): return f"{number}; 0 0 {body}"
  valid=["; Archive created at 2026-07-18 00:00:00 UTC","; TOC Entries: 42",line(1,"SCHEMA - auth postgres"),line(2,"SCHEMA - storage postgres"),line(3,"SCHEMA - public postgres"),line(4,"TABLE public short_urls postgres"),line(5,"TABLE DATA public short_urls postgres")]
  valid += [line(number,f"TABLE DATA {schema} {table} postgres") for number,(schema,table) in enumerate(((schema,table) for schema,tables in (("auth",g037.AUTH_TABLE_DATA),("storage",g037.STORAGE_TABLE_DATA)) for table in tables),6)]
  valid += [line(30,"TABLE auth users postgres"),line(31,"SEQUENCE auth users_id_seq postgres"),line(32,"SEQUENCE OWNED BY auth users_id_seq postgres"),line(33,"DEFAULT auth users id postgres"),line(34,"CONSTRAINT auth users users_pkey postgres"),line(35,"INDEX auth users users_email_key postgres"),line(36,"TRIGGER auth users audit_trigger postgres"),line(37,"POLICY auth users user_policy postgres"),line(38,"ACL auth TABLE users postgres"),line(39,"ACL - SCHEMA auth postgres"),line(40,"DEFAULT ACL auth DEFAULT PRIVILEGES FOR TABLES postgres"),line(41,"COMMENT public TABLE short_urls postgres"),line(42,"FUNCTION storage search() postgres")]
  self.assertTrue(g037.toc_inventory_valid(valid))
  self.assertFalse(g037.toc_inventory_valid([item for item in valid if "TABLE public short_urls " not in item]))
  self.assertFalse(g037.toc_inventory_valid([item for item in valid if "TABLE DATA public short_urls " not in item]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE DATA public short_urls_backup postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE public accounts postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE DATA auth unexpected postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(44,"TABLE DATA auth users postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+["43; 0 malformed TABLE DATA public short_urls postgres"]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE public short_urls_backup postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE public short_urls postgres; TABLE DATA public short_urls postgres")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,'TABLE public "short_urls" postgres')]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"TABLE auth users postgres TABLE DATA public short_urls")]))
  self.assertFalse(g037.toc_inventory_valid(valid+[line(43,"CONSTRAINT auth users users_pkey postgres TABLE DATA public short_urls")]))
 def test_cursor_capture_uses_one_cursor_for_h0_snapshot_and_h1(self):
  class Cursor:
   def __init__(s): s.calls=[]; s.catalogs=[[("bucket","name","v1",3)],[("bucket","name","v1",3)]]
   def execute(s,sql,*args): s.calls.append(sql)
   def fetchall(s): return s.catalogs.pop(0)
   def fetchone(s): return ("snapshot-1",)
  cursor=Cursor(); destination=self.root/"out"; destination.mkdir(); destination.chmod(0o700)
  now=int(time.time()); binding={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://abcdefghijklmnopqrst.supabase.co","commit":"a"*40,"manifest_sha256":"b"*64,"source_root":"c"*64,"terminal_spec":"d"*64,"scope":g037.EXPECTED_FREEZE_SCOPE,"relation_root":"e"*64,"acl_root":"f"*64,"held_lock_root":"0"*64,"not_before_unix":now-1,"not_after_unix":now+30,"controller_public_key_sha256":g037.CONTROLLER_PUBLIC_KEY_SHA256}; capability=freeze._verified_controller_capability({**binding,"signature":"c2ln"}); saved={}
  def persist(_,data): saved["data"]=data
  with patch.object(g037,"restrictive",return_value=True),patch.object(g037,"short_urls_on_cursor",return_value={"selection_spec_sha256":"b"*64,"short_urls_catalog_sha256":"c"*64,"short_urls_rowset_sha256":"d"*64,"short_urls_row_count":1,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":"e"*64,"victim_descriptors_sha256":"e"*64}),patch.object(g037,"encrypted_dump"),patch.object(g037,"download_archive",return_value=[]),patch.object(g037,"command",side_effect=lambda x:x),patch.object(g037,"file_hash",return_value="a"*64),patch.object(g037,"fsync_file"),patch.object(g037,"signing_key_matches_source",return_value=True),patch.object(g037,"write_receipt",side_effect=persist),patch.object(g037,"load_receipt",side_effect=lambda _: {k:v for k,v in saved["data"].items() if k!="signature"}),patch.object(g037,"repo_commit",return_value="a"*40),patch.object(g037,"openssl_sign",return_value=b"signature"),patch.object(g037,"openssl_verify",return_value=True):
   result=g037.capture_cursor(cursor,base="https://abcdefghijklmnopqrst.supabase.co",secret="not-printed",recipient="age1"+"a"*58,recipient_fingerprint="f"*64,service_file="service",pgpass_file="pgpass",service_name="g037",destination=destination,age_command="age",pg_dump_command="pg_dump",deadline=time.time()+10,freeze_capability=capability,expected_binding=binding,recovery_signing_key=self.root/"key",recovery_receipt=self.root/"recovery.json")
  self.assertEqual(result["auth_storage_catalog_root"],g037.digest([("bucket","name","v1",3)]))
  self.assertIn("SELECT pg_export_snapshot()",cursor.calls)
  self.assertFalse(any(call.startswith("BEGIN") for call in cursor.calls))
  self.assertEqual(saved["data"]["evidence"]["freeze"]["receipt"],dict(capability))
  self.assertIsInstance(capability,freeze.VerifiedControllerCapability)
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
 def test_encrypted_dump_binds_snapshot_and_exact_short_urls_table(self):
  output=self.root/"logical.age"; calls=[]
  def popen(argv,**kwargs):
   calls.append(argv); return Crypt()
  with patch.object(g037,"subprocess") as process:
   process.PIPE=g037.subprocess.PIPE; process.DEVNULL=g037.subprocess.DEVNULL; process.Popen.side_effect=popen
   with patch.object(g037,"require_dir"),patch.object(g037,"_harden_restrictive_file"),patch.object(g037,"restrictive",return_value=True),patch.object(g037,"deadline_remaining",return_value=1):
    g037.encrypted_dump("pg_dump","age","age1"+"a"*58,"snapshot","service","pgpass","g037",output,time.time()+10)
  argv=calls[1]
  self.assertIn("--snapshot=snapshot",argv); self.assertIn("--table=public.short_urls",argv)
  self.assertNotIn("--schema=public",argv)
 def test_short_urls_snapshot_uses_g035_selection_and_rejects_catalog_drift(self):
  catalog=json.dumps(list(g037.SHORT_URLS_CATALOG)); rows=json.dumps([{"id":"1"}]); descriptors=json.dumps([{"keeper_id":"1","source_id":"2"}])
  class Cursor:
   def __init__(s): s.calls=[]; s.values=[(catalog,),(rows,),(descriptors,),(False,)]
   def execute(s,sql): s.calls.append(sql)
   def fetchone(s): return s.values.pop(0)
  cursor=Cursor(); evidence=g037.short_urls_on_cursor(cursor)
  self.assertEqual(evidence["short_urls_row_count"],1); self.assertEqual(evidence["duplicate_group_count"],1)
  self.assertIn("row_number() OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id)",cursor.calls[2])
  class Drift(Cursor):
   def __init__(s): super().__init__(); s.values[0]=(json.dumps([]),)
  with self.assertRaises(g037.RecoveryError): g037.short_urls_on_cursor(Drift())
 def test_receipt_short_urls_scope_is_exact_and_drift_fails_closed(self):
  short={"selection_spec_sha256":g037.digest(g037.SHORT_URL_SELECTION_SPEC),"short_urls_catalog_sha256":g037.digest(list(g037.SHORT_URLS_CATALOG)),"short_urls_rowset_sha256":"b"*64,"short_urls_row_count":1,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":"c"*64,"victim_descriptors_sha256":"c"*64}
  evidence={"repository_commit":"a"*40,"recipient_fingerprint":"d"*64,"freeze":{},"freeze_started_unix":1,"freeze_finished_unix":1,"catalog_sha256":"e"*64,"catalog_count":0,"members":[],"object_count":0,"total_bytes":0,"logical_ciphertext_sha256":"f"*64,"blob_ciphertext_sha256":"0"*64,"pg_export_snapshot_sha256":"1"*64,**short}
  evidence["metadata_sha256"]=g037.digest({"schemas":["auth","storage","public.short_urls"],"catalog":evidence["catalog_sha256"],"short_urls":short})
  self.assertEqual(g037.validate_evidence(evidence),evidence)
  del evidence["short_urls_rowset_sha256"]
  with self.assertRaises(g037.RecoveryError): g037.validate_evidence(evidence)
if __name__=="__main__": unittest.main()
