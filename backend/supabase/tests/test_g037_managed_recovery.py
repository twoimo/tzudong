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
 def test_authenticated_route_is_used_without_version_claim(self):
  archive=self.root/"blobs.age"; opener=Opener(Response(b"abc")); catalog=[("bucket","folder/object","current-version",3)]
  with patch.object(g037,"build_opener",return_value=opener), patch.object(g037.subprocess,"Popen",return_value=Crypt()):
   members=g037.download_archive("https://abcdefghijklmnopqrst.supabase.co","token",catalog,"age","age1"+"a"*58,archive,time.time()+10)
  url=opener.requests[0][0].full_url
  self.assertEqual(url,"https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/bucket/folder/object")
  self.assertNotIn("version=",url); self.assertEqual(members[0]["size"],3)
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
if __name__=="__main__": unittest.main()
