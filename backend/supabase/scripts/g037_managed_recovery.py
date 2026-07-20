#!/usr/bin/env python3
"""Fail-closed, local-only encrypted Auth/Storage recovery evidence.

Capture is controller-only through ``capture_cursor``; this CLI only verifies
the resulting signed recovery evidence.
"""
from __future__ import annotations
import argparse, base64, csv, hashlib, json, os, re, secrets, shutil, stat, subprocess, tarfile, tempfile, time
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

SCHEMA="g037-managed-recovery-receipt-v3"; MAX_OBJECT_BYTES=2**31; MAX_TOTAL_BYTES=2**34; TIMEOUT=120; CHUNK=1024*1024
AGE=re.compile(r"^age1[ac-hj-np-z02-9]{58}$"); HEX=re.compile(r"^[a-f0-9]{64}$"); PROJECT=re.compile(r"^[a-z0-9]{20}\.supabase\.co$"); FREEZE_ID=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
# Offline controller/recovery public keys are immutable source policy.  Their
# corresponding private keys are separately controlled and never CLI inputs.
CONTROLLER_PUBLIC_KEY=b"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAqaHsCrD74lzv7J3zcfsjchTndvHTWTj1dWeDjwXK+G8=\n-----END PUBLIC KEY-----\n"
RECOVERY_PUBLIC_KEY=b"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAog0LiLrWnvwFZkEfHe6Oq+SWVf9ufqlJ9TMpXJ+Ogkk=\n-----END PUBLIC KEY-----\n"
CONTROLLER_PUBLIC_KEY_SHA256=hashlib.sha256(CONTROLLER_PUBLIC_KEY).hexdigest(); RECOVERY_PUBLIC_KEY_SHA256=hashlib.sha256(RECOVERY_PUBLIC_KEY).hexdigest()
EXPECTED_FREEZE_SCOPE={"schemas":["public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention"],"ordinary_relations":"all"}
AUTH_TABLE_DATA=("audit_log_entries","flow_state","identities","instances","mfa_amr_claims","mfa_challenges","mfa_factors","one_time_tokens","refresh_tokens","saml_providers","saml_relay_states","schema_migrations","sessions","users")
STORAGE_TABLE_DATA=("buckets","objects","prefixes","s3_multipart_uploads","s3_multipart_upload_parts")
SHORT_URL_SELECTION_SPEC="row_number() over (partition by target_url order by created_at nulls last, id)"
SHORT_URLS_CATALOG=(
 {"name":"id","type":"uuid","nullable":"NO","position":1,"character_maximum_length":None,"column_default":"uuid_generate_v4()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"code","type":"character varying","nullable":"NO","position":2,"character_maximum_length":10,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"target_url","type":"text","nullable":"NO","position":3,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"restaurant_id","type":"uuid","nullable":"YES","position":4,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"restaurant_name","type":"text","nullable":"YES","position":5,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"created_at","type":"timestamp with time zone","nullable":"YES","position":6,"character_maximum_length":None,"column_default":"now()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
)
class RecoveryError(RuntimeError): pass

def _pairs(pairs):
 out={}
 for k,v in pairs:
  if k in out: raise RecoveryError("duplicate JSON object key")
  out[k]=v
 return out
def canonical(value): return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")
def digest(value): return hashlib.sha256(canonical(value)).hexdigest()
def file_hash(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for b in iter(lambda:f.read(CHUNK),b""): h.update(b)
 return h.hexdigest()
def fsync_file(path):
 require_file(path,"durability output")
 flags=os.O_WRONLY
 if hasattr(os,"O_BINARY"): flags|=os.O_BINARY
 fd=os.open(path,flags)
 try: os.fsync(fd)
 finally: os.close(fd)
def _windows_current_sid():
 try:
  out=subprocess.run(["whoami","/user","/fo","csv","/nh"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True).stdout
  rows=list(csv.reader(out.splitlines(),strict=True)); return rows[0][1].upper() if len(rows)==1 and len(rows[0])==2 and re.fullmatch(r"S-\d+(?:-\d+)+",rows[0][1],re.I) else None
 except Exception: return None
def _windows_dacl_restrictive(path):
 try:
  from g040_recovery_authorization import _windows_restrictive
  return bool(_windows_restrictive(Path(path)))
 except Exception: return False
def restrictive(path, *, directory=False):
 try:
  p=Path(path)
  if p.is_symlink() or not (p.is_dir() if directory else p.is_file()): return False
  return _windows_dacl_restrictive(p) if os.name=="nt" else not bool(p.stat().st_mode&0o077)
 except OSError: return False
def require_file(path,label):
 if not restrictive(path): raise RecoveryError(label+" must be a restrictive regular file")
def require_dir(path,label):
 if not restrictive(path,directory=True): raise RecoveryError(label+" must be an owner-restricted directory")
def _harden_restrictive_file(path):
 p=Path(path)
 if os.name=="nt":
  sid=_windows_current_sid()
  if not sid: raise RecoveryError("current Windows SID unavailable")
  subprocess.run(["icacls",str(p),"/setowner","*"+sid],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
  subprocess.run(["icacls",str(p),"/reset"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
  subprocess.run(["icacls",str(p),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*"+sid+":F","SYSTEM:F","Administrators:F"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
  if not _windows_dacl_restrictive(p): raise RecoveryError("output file ACL is not owner-restricted")
 else:
  os.chmod(p,0o600)
  if p.stat().st_mode&0o777!=0o600 or not restrictive(p): raise RecoveryError("output file mode is not owner-restricted")
@contextmanager
def restrictive_output(path,label="output"):
 path=Path(path); require_dir(path.parent,"output directory")
 flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL
 if hasattr(os,"O_BINARY"): flags|=os.O_BINARY
 fd=None; created=False
 try:
  fd=os.open(path,flags,0o600); created=True
  _harden_restrictive_file(path)
  with os.fdopen(fd,"wb",closefd=True) as output:
   fd=None
   yield output
  require_file(path,label)
 except Exception:
  if fd is not None:
   try: os.close(fd)
   except OSError: pass
  if created: path.unlink(missing_ok=True)
  raise
def _fresh_temp_path(directory,prefix):
 directory=Path(directory)
 for _ in range(128):
  path=directory/(prefix+secrets.token_hex(16))
  if not path.exists() and not path.is_symlink(): return path
 raise RecoveryError("fresh temporary output unavailable")
def command(name):
 found=shutil.which(name)
 if not found: raise RecoveryError("required command unavailable")
 return found
def read_secret_reference(env_name,secret_file):
 if bool(env_name)==bool(secret_file): raise RecoveryError("supply exactly one secret reference")
 if env_name:
  if not re.fullmatch(r"[A-Z_][A-Z0-9_]{0,127}",env_name) or not os.environ.get(env_name): raise RecoveryError("secret environment reference unavailable")
  return os.environ[env_name]
 require_file(secret_file,"secret file"); value=Path(secret_file).read_text(encoding="utf8").strip()
 if not value: raise RecoveryError("secret reference unavailable")
 return value
def recipient_from_files(recipient_file,allowlist_file):
 require_file(recipient_file,"recipient file"); require_file(allowlist_file,"recipient allowlist")
 recipient=Path(recipient_file).read_text(encoding="ascii").strip()
 if not AGE.fullmatch(recipient): raise RecoveryError("invalid recipient")
 fp=hashlib.sha256(recipient.encode()).hexdigest(); allowed={x.strip() for x in Path(allowlist_file).read_text(encoding="ascii").splitlines() if x.strip()}
 if not allowed or any(not HEX.fullmatch(x) for x in allowed) or fp not in allowed: raise RecoveryError("recipient is not approved")
 return recipient,fp
def origin(value):
 p=urlparse(value)
 if p.scheme!="https" or p.netloc!=p.hostname or p.username or p.password or p.port or p.query or p.fragment or p.path not in ("", "/") or not p.hostname or not PROJECT.fullmatch(p.hostname): raise RecoveryError("origin must be canonical https://<project-ref>.supabase.co")
 return "https://"+p.hostname
def safe_destination(value):
 dest=Path(value).resolve(); root=Path(__file__).resolve().parents[3]
 if not dest.is_dir() or dest==root or root in dest.parents: raise RecoveryError("destination must be outside repository")
 require_dir(dest,"destination"); return dest
def fresh_outputs(dest, receipt_path=None):
 out={n:dest/n for n in ("g037-auth-storage.dump.age","g037-storage-blobs.tar.age")}
 out["g037-receipt.json"]=Path(receipt_path) if receipt_path else dest/"g037-receipt.json"
 if any(x.exists() or x.is_symlink() for x in out.values()): raise RecoveryError("outputs must be fresh")
 return out
def service(path,section):
 require_file(path,"service file")
 if not re.fullmatch(r"[A-Za-z0-9_.-]{1,63}",section): raise RecoveryError("invalid service name")
 entries={}; headers=0
 for raw in Path(path).read_text(encoding="utf8").splitlines():
  line=raw.strip()
  if not line or line.startswith(("#",";")): continue
  if line.startswith("[") and line.endswith("]"):
   headers+=1
   if line[1:-1]!=section: raise RecoveryError("invalid service section")
   continue
  if headers!=1 or "=" not in line: raise RecoveryError("invalid service file")
  k,v=(x.strip() for x in line.split("=",1))
  if k in entries or k not in {"host","port","dbname","user","sslmode","application_name","connect_timeout","sslrootcert","password"} or not v or "://" in v: raise RecoveryError("invalid service file")
  entries[k]=v
 required={"host","port","dbname","user","sslmode","sslrootcert"}
 if headers!=1 or not required<=entries.keys() or entries["sslmode"]!="verify-full" or "password" in entries or not entries["port"].isdigit() or not 1<=int(entries["port"])<=65535 or not re.fullmatch(r"[A-Za-z0-9.-]+",entries["host"]): raise RecoveryError("service file is not restrictive")
 require_file(entries["sslrootcert"],"database CA")
 return entries
def pgpass(path,entries):
 require_file(path,"pgpass file")
 lines=[x for x in Path(path).read_text(encoding="utf8").splitlines() if x and not x.startswith("#")]
 expected=f"{entries['host']}:{entries['port']}:{entries['dbname']}:{entries['user']}:"
 if len(lines)!=1 or not lines[0].startswith(expected) or lines[0]==expected: raise RecoveryError("pgpass must contain exactly one explicit matching entry")
def no_secret_env(service_file,pgpass_file):
 env={k:os.environ[k] for k in ("PATH","SYSTEMROOT","WINDIR","HOME","USERPROFILE","TEMP","TMP") if k in os.environ}; env.update({"PGSERVICEFILE":str(service_file),"PGPASSFILE":str(pgpass_file),"PGCONNECT_TIMEOUT":"20"}); return env
def sql_catalog(conn):
 with conn.cursor() as cur:
  cur.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); cur.execute("SELECT pg_export_snapshot(), clock_timestamp()"); snapshot,started=cur.fetchone(); cur.execute("SELECT bucket_id,name,version,COALESCE((metadata->>'size')::bigint,0) FROM storage.objects ORDER BY bucket_id,name"); rows=cur.fetchall()
 catalog=[]
 for bucket,name,version,size in rows:
  if not all(isinstance(x,str) and x for x in (bucket,name)) or version is None or not isinstance(size,int) or size<0 or size>MAX_OBJECT_BYTES: raise RecoveryError("storage catalog invalid")
  catalog.append((bucket,name,str(version),size))
 if len({(b,n) for b,n,_,_ in catalog})!=len(catalog): raise RecoveryError("storage catalog duplicate")
 return snapshot,started,catalog
def catalog_readback(conn):
 with conn.cursor() as cur:
  cur.execute("SELECT bucket_id,name,version,COALESCE((metadata->>'size')::bigint,0) FROM storage.objects ORDER BY bucket_id,name"); rows=cur.fetchall()
 normalized=[]
 for b,n,v,s in rows:
  if not all(isinstance(x,str) and x for x in (b,n)) or v is None or not isinstance(s,int) or s<0 or s>MAX_OBJECT_BYTES: raise RecoveryError("storage catalog invalid")
  normalized.append((b,n,str(v),s))
 return normalized
def short_urls_on_cursor(cur):
 """Capture the exact G035 short-url recovery selection on the controller transaction."""
 cur.execute("SELECT COALESCE(json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'position',ordinal_position,'character_maximum_length',character_maximum_length,'column_default',column_default,'is_generated',is_generated,'is_identity',is_identity,'identity_generation',identity_generation) ORDER BY ordinal_position),'[]')::text FROM information_schema.columns WHERE table_schema='public' AND table_name='short_urls'")
 catalog=json.loads(cur.fetchone()[0])
 if catalog!=list(SHORT_URLS_CATALOG): raise RecoveryError("short_urls catalog drift")
 cur.execute("SELECT COALESCE(json_agg(to_jsonb(s) ORDER BY s.id),'[]')::text FROM public.short_urls s")
 rows=json.loads(cur.fetchone()[0])
 cur.execute("WITH r AS (SELECT id,target_url,first_value(id) OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) keeper_id,row_number() OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) rank,to_jsonb(short_urls) row_json FROM public.short_urls) SELECT COALESCE(json_agg(json_build_object('source_id',id::text,'keeper_id',keeper_id::text,'target_url_sha256',encode(digest(target_url,'sha256'),'hex'),'rank',rank,'source_row_sha256',encode(digest(row_json::text,'sha256'),'hex')) ORDER BY id),'[]')::text FROM r WHERE rank>1")
 descriptors=json.loads(cur.fetchone()[0])
 cur.execute("SELECT EXISTS (SELECT 1 FROM public.short_urls WHERE code IS NULL OR target_url IS NULL) OR EXISTS (SELECT 1 FROM public.short_urls GROUP BY code HAVING count(*)>1)")
 if cur.fetchone()[0]: raise RecoveryError("short_urls inspection precondition failed")
 if not isinstance(rows,list) or not isinstance(descriptors,list) or any(not isinstance(item,dict) for item in descriptors): raise RecoveryError("short_urls snapshot invalid")
 return {"selection_spec_sha256":digest(SHORT_URL_SELECTION_SPEC),"short_urls_catalog_sha256":digest(catalog),"short_urls_rowset_sha256":digest(rows),"short_urls_row_count":len(rows),"duplicate_group_count":len({item.get("keeper_id") for item in descriptors}),"duplicate_victim_count":len(descriptors),"victim_descriptor_count":len(descriptors),"duplicate_victims_sha256":digest(descriptors),"victim_descriptors_sha256":digest(descriptors)}
def catalog_on_cursor(cur):
 """Read Storage metadata on the controller transaction; never opens a transaction."""
 cur.execute("SELECT bucket_id,name,version,COALESCE((metadata->>'size')::bigint,0) FROM storage.objects ORDER BY bucket_id,name")
 rows=cur.fetchall(); normalized=[]
 for b,n,v,s in rows:
  if not all(isinstance(x,str) and x for x in (b,n)) or v is None or not isinstance(s,int) or s<0 or s>MAX_OBJECT_BYTES: raise RecoveryError("storage catalog invalid")
  normalized.append((b,n,str(v),s))
 if len({(b,n) for b,n,_,_ in normalized})!=len(normalized): raise RecoveryError("storage catalog duplicate")
 return normalized
def _active_capability(capability, expected, deadline):
 required={"schema","state","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","scope","relation_root","acl_root","held_lock_root","not_before_unix","not_after_unix","controller_public_key_sha256","signature"}
 if not isinstance(capability,Mapping):
  raise RecoveryError("complete exact signed freeze v3 capability required")
 snapshot=dict(capability)
 if set(snapshot)!=required:
  raise RecoveryError("complete exact signed freeze v3 capability required")
 payload=dict(snapshot); signature=payload.pop("signature")
 if not isinstance(signature,str) or not isinstance(expected,dict) or set(expected)!=(required-{"signature"}):
  raise RecoveryError("freeze capability binding invalid")
 with _source_public_key(CONTROLLER_PUBLIC_KEY) as public_key:
  try:
   try: verified=openssl_verify(command("openssl"),public_key,canonical(payload),base64.b64decode(signature,validate=True))
   except (ValueError,TypeError): raise RecoveryError("freeze capability signature invalid")
   if not verified:
    raise RecoveryError("freeze capability signature invalid")
  finally:
   public_key.validate()
 if payload!=expected or payload["schema"]!="g037-write-freeze-v3" or payload["state"]!="active-provisional" or payload["scope"]!=EXPECTED_FREEZE_SCOPE or payload["controller_public_key_sha256"]!=CONTROLLER_PUBLIC_KEY_SHA256:
  raise RecoveryError("freeze capability binding drift")
 if any(not isinstance(payload[k],str) or not HEX.fullmatch(payload[k]) for k in ("manifest_sha256","source_root","terminal_spec","relation_root","acl_root","held_lock_root")) or not FREEZE_ID.fullmatch(payload["freeze_id"]) or not isinstance(payload["not_before_unix"],int) or not isinstance(payload["not_after_unix"],int):
  raise RecoveryError("freeze capability fields invalid")
 now=time.time()
 if payload["not_before_unix"]>now or payload["not_after_unix"]<now or payload["not_after_unix"]<float(deadline):
  raise RecoveryError("freeze capability window invalid")
 return snapshot
def capture_cursor(cur, *, base, secret, recipient, recipient_fingerprint, service_file, pgpass_file, service_name, destination, age_command, pg_dump_command, deadline, freeze_capability=None, expected_binding=None, recovery_signing_key=None, recovery_receipt=None):
 """Capture managed data under the caller's already-held controller transaction."""
 destination=Path(destination); require_dir(destination,"destination")
 if destination.resolve() in (Path(__file__).resolve().parents[3],) or Path(__file__).resolve().parents[3] in destination.resolve().parents: raise RecoveryError("destination must be outside repository")
 active_capability=_active_capability(freeze_capability,expected_binding,deadline)
 if not recovery_signing_key or not recovery_receipt: raise RecoveryError("recovery signing key and receipt path required")
 require_file(recovery_signing_key,"recovery signing key")
 if not signing_key_matches_source(recovery_signing_key): raise RecoveryError("recovery signing key does not match pinned key")
 outputs=fresh_outputs(destination,recovery_receipt)
 catalog=catalog_on_cursor(cur); short_urls=short_urls_on_cursor(cur)
 if sum(x[3] for x in catalog)>MAX_TOTAL_BYTES: raise RecoveryError("total size ceiling exceeded")
 cur.execute("SELECT pg_export_snapshot()"); row=cur.fetchone()
 if not row or not isinstance(row[0],str) or not row[0]: raise RecoveryError("snapshot export failed")
 snapshot=row[0]; started=time.time()
 encrypted_dump(command(pg_dump_command),command(age_command),recipient,snapshot,service_file,pgpass_file,service_name,outputs["g037-auth-storage.dump.age"],deadline)
 commitments=download_archive(base,secret,catalog,command(age_command),recipient,outputs["g037-storage-blobs.tar.age"],deadline)
 if catalog_on_cursor(cur)!=catalog or short_urls_on_cursor(cur)!=short_urls: raise RecoveryError("controller catalog drift detected")
 # Both ciphertext streams are closed and fsynced by their capture helpers before hashes/signing.
 fsync_file(outputs["g037-auth-storage.dump.age"]); fsync_file(outputs["g037-storage-blobs.tar.age"])
 logical=file_hash(outputs["g037-auth-storage.dump.age"]); blobs=file_hash(outputs["g037-storage-blobs.tar.age"])
 evidence={"repository_commit":repo_commit(),"recipient_fingerprint":recipient_fingerprint,"freeze":freeze_evidence(active_capability),"freeze_started_unix":int(started),"freeze_finished_unix":int(time.time()),"catalog_sha256":digest(catalog),"catalog_count":len(catalog),"members":commitments,"object_count":len(commitments),"total_bytes":sum(x["size"] for x in commitments),"logical_ciphertext_sha256":logical,"blob_ciphertext_sha256":blobs,"metadata_sha256":digest({"schemas":["auth","storage","public.short_urls"],"catalog":digest(catalog),"short_urls":short_urls}),"pg_export_snapshot_sha256":hashlib.sha256(snapshot.encode("utf8")).hexdigest(),**short_urls}
 unsigned={"schema":SCHEMA,"mode":"capture","status":"captured","evidence":evidence,"receipt_public_key_sha256":RECOVERY_PUBLIC_KEY_SHA256}
 data=dict(unsigned)
 data["signature"]=base64.b64encode(openssl_sign(command("openssl"),recovery_signing_key,canonical(unsigned))).decode("ascii")
 write_receipt(outputs["g037-receipt.json"],data); persisted=load_receipt(outputs["g037-receipt.json"])
 if persisted != unsigned: raise RecoveryError("persisted recovery receipt mismatch")
 return {"auth_storage_catalog_root":digest(catalog),"auth_storage_metadata_root":evidence["metadata_sha256"],"short_urls_catalog_root":short_urls["short_urls_catalog_sha256"],"short_urls_rowset_root":short_urls["short_urls_rowset_sha256"],"short_urls_victim_descriptors_root":short_urls["victim_descriptors_sha256"],"short_urls_row_count":short_urls["short_urls_row_count"],"duplicate_group_count":short_urls["duplicate_group_count"],"duplicate_victim_count":short_urls["duplicate_victim_count"],"recipient_fingerprint":recipient_fingerprint,"logical_ciphertext_sha256":logical,"blob_ciphertext_sha256":blobs,"object_count":len(commitments),"total_bytes":evidence["total_bytes"],"recovery_receipt_sha256":digest(unsigned)}
def member_name(bucket,name,version):
 pure=PurePosixPath(name)
 if pure.is_absolute() or ".." in pure.parts or not name or "\x00" in name: raise RecoveryError("unsafe object path")
 return "objects/"+hashlib.sha256((bucket+"\0"+name+"\0"+version).encode()).hexdigest()
def storage_url(base,bucket,name): return base+"/storage/v1/object/authenticated/"+quote(bucket,safe="")+"/"+quote(name,safe="/")
def deadline_remaining(deadline):
 remaining=float(deadline)-time.time()
 if remaining<=0: raise RecoveryError("freeze deadline expired")
 return min(TIMEOUT,remaining)
def database_timeout(deadline):
 remaining=deadline_remaining(deadline)
 if remaining<1: raise RecoveryError("freeze deadline too close for database operation")
 return int(remaining)
class _NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): raise HTTPError(args[1],args[2],"redirect rejected",args[3],args[4])
def _reap(process):
 if process is None: return
 try:
  if process.poll() is None: process.kill()
  process.wait(timeout=5)
 except Exception: pass
def encrypted_dump(pg_dump,age,recipient,snapshot,service_file,pgpass_file,service_name,output,deadline):
 crypt=proc=None
 try:
  with restrictive_output(output,"logical ciphertext") as sink:
   crypt=subprocess.Popen([age,"--recipient",recipient],stdin=subprocess.PIPE,stdout=sink,stderr=subprocess.PIPE)
   proc=subprocess.Popen([pg_dump,"--format=custom","--snapshot="+snapshot,"--schema=auth","--schema=storage","--table=public.short_urls","--dbname=service="+service_name],stdin=subprocess.DEVNULL,stdout=crypt.stdin,stderr=subprocess.PIPE,env=no_secret_env(service_file,pgpass_file))
   crypt.stdin.close()
   if proc.wait(deadline_remaining(deadline)) or crypt.wait(deadline_remaining(deadline)): raise RecoveryError("logical dump failed")
 except Exception as exc:
  output.unlink(missing_ok=True); raise RecoveryError("logical dump failed") from exc
 finally:
  if crypt and crypt.stdin and not crypt.stdin.closed: crypt.stdin.close()
  _reap(proc); _reap(crypt)
def download_archive(base,secret,catalog,age,recipient,output,deadline):
 if sum(x[3] for x in catalog)>MAX_TOTAL_BYTES: raise RecoveryError("total size ceiling exceeded")
 commitments=[]; opener=build_opener(_NoRedirect()); crypt=None
 try:
  with restrictive_output(output,"blob ciphertext") as sink:
   crypt=subprocess.Popen([age,"--recipient",recipient],stdin=subprocess.PIPE,stdout=sink,stderr=subprocess.PIPE)
   with tarfile.open(fileobj=crypt.stdin,mode="w|") as archive:
    for bucket,name,version,expected in catalog:
     req=Request(storage_url(base,bucket,name),headers={"Authorization":"Bearer "+secret,"apikey":secret},method="GET")
     with opener.open(req,timeout=deadline_remaining(deadline)) as response:
      if getattr(response,"status",200)!=200 or response.headers.get("Content-Length")!=str(expected): raise RecoveryError("object download failed")
      h=hashlib.sha256(); size=0
      class Stream:
       def read(self,n=-1):
        nonlocal size
        b=response.read(n); h.update(b); size+=len(b); return b
      info=tarfile.TarInfo(member_name(bucket,name,version)); info.size=expected; info.mode=0o600; info.mtime=0; archive.addfile(info,Stream())
      if size!=expected or response.read(1): raise RecoveryError("partial object download")
     commitments.append({"member_sha256":hashlib.sha256(member_name(bucket,name,version).encode()).hexdigest(),"catalog_sha256":digest([bucket,name,version,expected]),"size":expected,"content_sha256":h.hexdigest()})
   crypt.stdin.close()
   if crypt.wait(deadline_remaining(deadline)): raise RecoveryError("blob encryption failed")
 except Exception as exc: output.unlink(missing_ok=True); raise RecoveryError("physical blob capture failed") from exc
 finally:
  if crypt and crypt.stdin and not crypt.stdin.closed: crypt.stdin.close()
  _reap(crypt)
 return commitments
class _TemporaryInput:
 def __init__(self,payload,prefix,directory=None):
  if directory is not None:
   directory=Path(directory); require_dir(directory,"temporary file directory")
  self.fd,self.path=tempfile.mkstemp(prefix=prefix,dir=directory)
  self.identity=self._identity(); self.unlinked=False
  try:
   if os.name=="nt": self._require_path_identity()
   _harden_restrictive_file(self.path)
   if os.name=="nt": self._require_path_identity()
   if not restrictive(self.path): raise RecoveryError("temporary file is not owner-restricted")
   if os.name=="nt": self._require_path_identity()
   view=memoryview(payload)
   while view:
    if os.name=="nt": self._require_path_identity()
    written=os.write(self.fd,view)
    if written<=0: raise RecoveryError("temporary input write failed")
    view=view[written:]
   os.fsync(self.fd)
   self.validate()
   if os.name!="nt":
    Path(self.path).unlink()
    self.unlinked=True
  except Exception:
   self.close()
   raise
 def _identity(self):
  stat_result=os.fstat(self.fd)
  return stat_result.st_dev,stat_result.st_ino
 def _path_matches_identity(self):
  try:
   stat_result=Path(self.path).lstat()
   return stat.S_ISREG(stat_result.st_mode) and not stat.S_ISLNK(stat_result.st_mode) and (stat_result.st_dev,stat_result.st_ino)==self.identity
  except OSError: return False
 def _require_path_identity(self):
  if not self._path_matches_identity(): raise RecoveryError("temporary input path identity changed")
 def validate(self):
  if self._identity()!=self.identity: raise RecoveryError("temporary input identity changed")
  if os.name=="nt":
   self._require_path_identity()
   if not _windows_dacl_restrictive(Path(self.path)): raise RecoveryError("temporary input custody invalid")
   self._require_path_identity()
 def child_path(self):
  self.validate()
  if os.name=="nt": return str(self.path)
  proc_path=f"/proc/self/fd/{self.fd}"
  if not Path(proc_path).exists(): raise RecoveryError("descriptor-backed temporary input unavailable")
  return proc_path
 def subprocess_kwargs(self):
  return {"pass_fds":(self.fd,)} if os.name!="nt" else {}
 def close(self):
  failure=None
  if not getattr(self,"unlinked",True) and not self._path_matches_identity():
   failure=RecoveryError("temporary input path identity changed during cleanup")
  fd=getattr(self,"fd",None)
  if fd is not None:
   self.fd=None
   try: os.close(fd)
   except OSError as exc:
    failure=failure or exc
  if not getattr(self,"unlinked",True) and failure is None:
   if not self._path_matches_identity():
    failure=RecoveryError("temporary input path identity changed during cleanup")
   else:
    try: Path(self.path).unlink()
    except OSError as exc: failure=exc
  if failure: raise RecoveryError("temporary file cleanup failed") from failure
def _temporary_bytes(payload,prefix,directory=None):
 if directory is not None:
  directory=Path(directory); require_dir(directory,"temporary file directory")
 fd,path=tempfile.mkstemp(prefix=prefix,dir=directory)
 try:
  _harden_restrictive_file(path)
  with os.fdopen(fd,"wb") as f:
   f.write(payload); f.flush(); os.fsync(f.fileno())
  return path
 except Exception:
  try: os.close(fd)
  except OSError: pass
  Path(path).unlink(missing_ok=True)
  raise
@contextmanager
def _held_temporary_bytes(payload,prefix,directory=None):
 input_file=None
 try:
  input_file=_TemporaryInput(payload,prefix,directory)
  yield input_file
 finally:
  if input_file is not None: input_file.close()
def _cleanup_temporary_files(*paths):
 failure=None
 for path in paths:
  if path:
   try: Path(path).unlink(missing_ok=True)
   except OSError as exc: failure=exc
 if failure: raise RecoveryError("temporary file cleanup failed") from failure
def _held_private_key(path):
 path=Path(path)
 if path.is_symlink(): raise RecoveryError("signing key custody invalid")
 path=path.resolve(); require_file(path,"signing key")
 if not restrictive(path): raise RecoveryError("signing key custody invalid")
 flags=os.O_RDONLY | getattr(os,"O_BINARY",0)
 if hasattr(os,"O_NOFOLLOW"): flags|=os.O_NOFOLLOW
 descriptor=None
 try:
  descriptor=os.open(path,flags)
  initial=os.fstat(descriptor)
  current=path.lstat()
  if not stat.S_ISREG(initial.st_mode) or stat.S_ISLNK(current.st_mode) or (initial.st_dev,initial.st_ino)!=(current.st_dev,current.st_ino): raise RecoveryError("signing key custody invalid")
  chunks=[]; total=0
  while True:
   part=os.read(descriptor,65536)
   if not part: break
   total+=len(part)
   if total>65536: raise RecoveryError("signing key custody invalid")
   chunks.append(part)
  final=os.fstat(descriptor); current=path.lstat()
  if (final.st_dev,final.st_ino)!=(initial.st_dev,initial.st_ino) or (current.st_dev,current.st_ino)!=(initial.st_dev,initial.st_ino) or not restrictive(path): raise RecoveryError("signing key custody invalid")
  material=b"".join(chunks)
  if not material: raise RecoveryError("signing key custody invalid")
  return material
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError("signing key custody invalid") from exc
 finally:
  if descriptor is not None:
   try: os.close(descriptor)
   except OSError: pass
def private_key_public(key):
 try:
  from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
  from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat,load_pem_private_key
  private=load_pem_private_key(_held_private_key(key),password=None)
  if not isinstance(private,Ed25519PrivateKey): raise RecoveryError("signing key type invalid")
  return private.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo)
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError("signing key unreadable") from exc
def openssl_sign(openssl,key,payload):
 del openssl
 try:
  from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
  from cryptography.hazmat.primitives.serialization import load_pem_private_key
  private=load_pem_private_key(_held_private_key(key),password=None)
  if not isinstance(private,Ed25519PrivateKey): raise RecoveryError("signing key type invalid")
  return private.sign(payload)
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError("Ed25519 signing failed") from exc
def openssl_verify(openssl,key,payload,signature):
 try:
  with _held_temporary_bytes(payload,"g037-payload-") as payload_file, _held_temporary_bytes(signature,"g037-signature-") as signature_file:
   custody_key=key if isinstance(key,_TemporaryInput) else None
   key_path=custody_key.child_path() if custody_key else str(key)
   fds=(payload_file.fd,signature_file.fd)+((custody_key.fd,) if custody_key and os.name!="nt" else ())
   run_kwargs={"pass_fds":fds} if os.name!="nt" else {}
   subprocess.run([openssl,"pkeyutl","-verify","-rawin","-pubin","-inkey",key_path,"-in",payload_file.child_path(),"-sigfile",signature_file.child_path()],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=TIMEOUT,check=True,**run_kwargs)
   payload_file.validate(); signature_file.validate()
   if custody_key: custody_key.validate()
   return True
 except Exception: return False
@contextmanager
def _source_public_key(material):
 with _held_temporary_bytes(material,"g037-pinned-public-") as public_key:
  yield public_key
def signed_json(path,material,label):
 require_file(path,label)
 try:
  with _source_public_key(material) as public_key:
   data=json.loads(Path(path).read_text(encoding="ascii"),object_pairs_hook=_pairs); sig=base64.b64decode(data.pop("signature"),validate=True)
   if not openssl_verify(command("openssl"),public_key,canonical(data),sig): raise RecoveryError(label+" signature invalid")
   return data
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError(label+" unreadable") from exc
def freeze_evidence(data):
 return {"receipt":data,"sha256":digest(data)}
def validate_preserved_freeze(evidence):
 freeze=evidence.get("freeze")
 if not isinstance(freeze,dict) or set(freeze)!={"receipt","sha256"} or not isinstance(freeze.get("receipt"),dict) or freeze.get("sha256")!=digest(freeze["receipt"]): raise RecoveryError("freeze evidence binding invalid")
 data=freeze["receipt"]; required={"schema","state","freeze_id","origin","commit","manifest_sha256","source_root","terminal_spec","scope","relation_root","acl_root","held_lock_root","not_before_unix","not_after_unix","controller_public_key_sha256","signature"}
 if set(data)!=required: raise RecoveryError("freeze evidence fields invalid")
 signature=base64.b64decode(data["signature"],validate=True); payload=dict(data); payload.pop("signature")
 with _source_public_key(CONTROLLER_PUBLIC_KEY) as public_key:
  if not openssl_verify(command("openssl"),public_key,canonical(payload),signature): raise RecoveryError("freeze evidence signature invalid")
  public_key.validate()
 if payload["schema"]!="g037-write-freeze-v3" or payload["state"]!="active-provisional" or payload["scope"]!=EXPECTED_FREEZE_SCOPE or payload["controller_public_key_sha256"]!=CONTROLLER_PUBLIC_KEY_SHA256 or not FREEZE_ID.fullmatch(payload["freeze_id"]) or any(not isinstance(payload[k],str) or not HEX.fullmatch(payload[k]) for k in ("manifest_sha256","source_root","terminal_spec","relation_root","acl_root","held_lock_root")) or not all(isinstance(payload[k],int) for k in ("not_before_unix","not_after_unix")) or not all(isinstance(evidence.get(k),int) for k in ("freeze_started_unix","freeze_finished_unix")) or evidence["freeze_started_unix"] < payload["not_before_unix"] or evidence["freeze_finished_unix"] > payload["not_after_unix"]: raise RecoveryError("freeze evidence validity invalid")
 return data
def write_receipt(path,data):
 path=Path(path)
 if path.exists() or path.is_symlink(): raise RecoveryError("receipt must be fresh")
 temp=_fresh_temp_path(path.parent,".g037-receipt-"); published=False
 try:
  with restrictive_output(temp,"receipt temporary") as f:
   payload=canonical(data)+b"\n"
   f.write(payload); f.flush(); os.fsync(f.fileno())
  require_file(temp,"receipt temporary")
  try: os.link(temp,path)
  except FileExistsError as exc: raise RecoveryError("receipt must be fresh") from exc
  published=True
  require_file(path,"receipt")
  if path.read_bytes()!=payload: raise RecoveryError("persisted receipt readback mismatch")
  if os.name!="nt":
   directory=os.open(path.parent,os.O_RDONLY)
   try: os.fsync(directory)
   finally: os.close(directory)
 except Exception:
  if published: path.unlink(missing_ok=True)
  raise
 finally:
  temp.unlink(missing_ok=True)
def repo_commit():
 try: return subprocess.run(["git","-C",str(Path(__file__).resolve().parents[3]),"rev-parse","HEAD"],capture_output=True,text=True,timeout=20,check=True).stdout.strip()
 except Exception as exc: raise RecoveryError("source commit unavailable") from exc
def signing_key_matches_source(key):
 try: return private_key_public(key)==RECOVERY_PUBLIC_KEY
 except Exception: return False
def validate_evidence(evidence):
 required={"repository_commit","recipient_fingerprint","freeze","freeze_started_unix","freeze_finished_unix","catalog_sha256","catalog_count","members","object_count","total_bytes","logical_ciphertext_sha256","blob_ciphertext_sha256","metadata_sha256","pg_export_snapshot_sha256","selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count","duplicate_victims_sha256","victim_descriptors_sha256"}
 if not isinstance(evidence,dict) or set(evidence)!=required: raise RecoveryError("receipt evidence scope invalid")
 hashes=("recipient_fingerprint","catalog_sha256","logical_ciphertext_sha256","blob_ciphertext_sha256","metadata_sha256","pg_export_snapshot_sha256","selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256")
 counts=("catalog_count","object_count","total_bytes","short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count")
 if (not isinstance(evidence.get("repository_commit"),str) or not re.fullmatch(r"[0-9a-f]{40,64}",evidence["repository_commit"]) or any(not isinstance(evidence.get(key),str) or not HEX.fullmatch(evidence[key]) for key in hashes) or any(not isinstance(evidence.get(key),int) or isinstance(evidence[key],bool) or evidence[key]<0 for key in counts)): raise RecoveryError("receipt evidence fields invalid")
 short_urls={key:evidence[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count","duplicate_victims_sha256","victim_descriptors_sha256")}
 if evidence["selection_spec_sha256"]!=digest(SHORT_URL_SELECTION_SPEC) or evidence["short_urls_catalog_sha256"]!=digest(list(SHORT_URLS_CATALOG)) or evidence["duplicate_victim_count"]!=evidence["victim_descriptor_count"] or evidence["duplicate_victims_sha256"]!=evidence["victim_descriptors_sha256"] or evidence["metadata_sha256"]!=digest({"schemas":["auth","storage","public.short_urls"],"catalog":evidence["catalog_sha256"],"short_urls":short_urls}): raise RecoveryError("receipt short_urls binding invalid")
 if not isinstance(evidence["members"],list): raise RecoveryError("receipt members invalid")
 return evidence
def load_receipt(path):
 data=signed_json(path,RECOVERY_PUBLIC_KEY,"receipt")
 if data.get("schema")!=SCHEMA or data.get("mode")!="capture" or data.get("status")!="captured" or data.get("receipt_public_key_sha256")!=RECOVERY_PUBLIC_KEY_SHA256: raise RecoveryError("receipt invalid")
 validate_evidence(data.get("evidence")); return data
_TOC_TOKEN=re.compile(r"^[A-Za-z_][A-Za-z0-9_$().,\[\]]*$")
_TOC_KINDS=("TEXT SEARCH CONFIGURATION","TEXT SEARCH DICTIONARY","TEXT SEARCH PARSER","TEXT SEARCH TEMPLATE","MATERIALIZED VIEW","FOREIGN TABLE","SEQUENCE OWNED BY","DEFAULT ACL","TABLE DATA","SCHEMA","TABLE","SEQUENCE","DEFAULT","CONSTRAINT","INDEX","TRIGGER","POLICY","COMMENT","ACL","FUNCTION","PROCEDURE","TYPE","DOMAIN","CAST","OPERATOR","AGGREGATE","COLLATION","VIEW","RULE")
_TOC_TABLE_KINDS={"DEFAULT","CONSTRAINT","INDEX","TRIGGER","POLICY","RULE"}
_TOC_SCHEMA_KINDS={"FUNCTION","PROCEDURE","TYPE","DOMAIN","CAST","OPERATOR","AGGREGATE","COLLATION","VIEW","MATERIALIZED VIEW","FOREIGN TABLE","TEXT SEARCH CONFIGURATION","TEXT SEARCH DICTIONARY","TEXT SEARCH PARSER","TEXT SEARCH TEMPLATE"}

def _toc_tokens(value):
 return value.split() if all(token=="-" or _TOC_TOKEN.fullmatch(token) for token in value.split()) else None
def _toc_scope(schema,table=None):
 return schema in {"auth","storage"} or schema=="public" and table=="short_urls"
def _toc_relation(kind,fields):
 if len(fields)<3 or not _toc_scope(fields[0],fields[1]): return None
 if fields[0]=="public" and kind in {"SEQUENCE","SEQUENCE OWNED BY"}: return None
 if kind in {"TABLE","TABLE DATA","SEQUENCE","SEQUENCE OWNED BY"} and len(fields)!=3: return None
 if kind in _TOC_TABLE_KINDS and len(fields)!=4: return None
 return (kind,*fields[:-1])
def _toc_object(line):
 match=re.fullmatch(r"\d+;\s+\d+\s+\d+\s+(.+)",line)
 if not match: return None
 body=match.group(1).strip()
 kind=next((candidate for candidate in _TOC_KINDS if body==candidate or body.startswith(candidate+" ")),None)
 if kind is None: return None
 fields=_toc_tokens(body[len(kind):].strip())
 if not fields: return None
 if kind=="SCHEMA":
  return (kind,fields[1]) if len(fields)==3 and fields[0]=="-" and fields[1] in {"auth","storage","public"} else None
 if kind in {"TABLE","TABLE DATA","SEQUENCE","SEQUENCE OWNED BY"}|_TOC_TABLE_KINDS:
  return _toc_relation(kind,fields)
 if kind in _TOC_SCHEMA_KINDS:
  return (kind,fields[0],fields[1]) if len(fields)==3 and fields[0] in {"auth","storage"} else None
 if kind in {"ACL","COMMENT"}:
  if len(fields)==4 and fields[:2]==["-","SCHEMA"] and fields[2] in {"auth","storage","public"}: return (kind,"SCHEMA",fields[2])
  if len(fields)==4 and fields[1] in {"TABLE","SEQUENCE","FUNCTION","PROCEDURE","TYPE","DOMAIN","VIEW","MATERIALIZED","FOREIGN"} and _toc_scope(fields[0],fields[2]) and (fields[0]!="public" or fields[1]=="TABLE"):
   return (kind,*fields[:-1])
  return None
 if kind=="DEFAULT ACL":
  return (kind,fields[0],fields[4]) if len(fields)==6 and fields[0] in {"auth","storage","public"} and fields[1:4]==["DEFAULT","PRIVILEGES","FOR"] and fields[4] in {"TABLES","SEQUENCES","FUNCTIONS","TYPES","SCHEMAS"} else None
 return None
def toc_inventory_valid(toc):
 required={("SCHEMA",schema) for schema in ("auth","storage","public")}
 required|={("TABLE","public","short_urls"),("TABLE DATA","public","short_urls")}
 required|={("TABLE DATA",schema,table) for schema,tables in (("auth",AUTH_TABLE_DATA),("storage",STORAGE_TABLE_DATA)) for table in tables}
 seen=set()
 for line in toc:
  if not line.strip() or line.lstrip().startswith(";"): continue
  item=_toc_object(line)
  if item is None or item in seen: return False
  seen.add(item)
 return required<=seen and {item for item in seen if item[0]=="TABLE DATA"}=={item for item in required if item[0]=="TABLE DATA"}
def verify(args):
 dest=safe_destination(args.destination); recipient,fp=recipient_from_files(args.recipient_file,args.recipient_allowlist_file); require_file(args.identity_file,"age identity"); data=load_receipt(args.receipt); e=data["evidence"]; validate_preserved_freeze(e)
 if e.get("recipient_fingerprint")!=fp or file_hash(args.logical_archive)!=e.get("logical_ciphertext_sha256") or file_hash(args.blob_archive)!=e.get("blob_ciphertext_sha256"): raise RecoveryError("archive/recipient binding invalid")
 age=command(args.age_command); pg_restore=command(args.pg_restore)
 with tempfile.TemporaryDirectory(prefix="g037-verify-",dir=dest) as temp:
  logical=Path(temp)/"logical.dump"; blobs=Path(temp)/"blobs.tar"
  for source,target in ((Path(args.logical_archive),logical),(Path(args.blob_archive),blobs)):
   require_file(source,"ciphertext archive")
   with source.open("rb") as encrypted, target.open("xb") as sink:
    result=subprocess.run([age,"--decrypt","--identity",args.identity_file],stdin=encrypted,stdout=sink,stderr=subprocess.PIPE,timeout=TIMEOUT)
    if result.returncode: raise RecoveryError("decryption failed")
   target.chmod(0o600)
  result=subprocess.run([pg_restore,"--list",str(logical)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=TIMEOUT)
  toc=result.stdout.decode("utf8","replace").splitlines()
  if result.returncode or not toc_inventory_valid(toc): raise RecoveryError("logical archive TOC inventory invalid")
  expected=e.get("members"); observed=[]
  if not isinstance(expected,list) or len(expected)!=e.get("object_count") or len({x.get("member_sha256") for x in expected if isinstance(x,dict)})!=len(expected): raise RecoveryError("receipt member commitments invalid")
  with tarfile.open(blobs,"r:") as archive:
   for member in archive:
    if not member.isfile() or not member.name.startswith("objects/") or member.name!=PurePosixPath(member.name).as_posix() or ".." in PurePosixPath(member.name).parts or member.size>MAX_OBJECT_BYTES: raise RecoveryError("unsafe blob archive")
    stream=archive.extractfile(member); h=hashlib.sha256(); size=0
    for b in iter(lambda:stream.read(CHUNK),b""): h.update(b); size+=len(b)
    observed.append({"member_sha256":hashlib.sha256(member.name.encode()).hexdigest(),"size":size,"content_sha256":h.hexdigest()})
  exp={(x["member_sha256"],x["size"],x["content_sha256"],x["catalog_sha256"]) for x in expected}; obs={(x["member_sha256"],x["size"],x["content_sha256"]) for x in observed}
  if len(observed)!=len(obs) or len(observed)!=len(exp) or {(a,b,c) for a,b,c,_ in exp}!=obs or sum(x["size"] for x in observed)!=e.get("total_bytes"): raise RecoveryError("object archive verification failed")
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True)
 v=sub.add_parser("verify"); v.add_argument("--destination",required=True); v.add_argument("--recipient-file",required=True); v.add_argument("--recipient-allowlist-file",required=True); v.add_argument("--age-command",default="age"); v.add_argument("--receipt",required=True); v.add_argument("--logical-archive",required=True); v.add_argument("--blob-archive",required=True); v.add_argument("--identity-file",required=True); v.add_argument("--pg-restore",default="pg_restore")
 return p
def main(argv=None):
 try:
  args=parser().parse_args(argv); verify(args); print(canonical({"schema":SCHEMA,"mode":args.mode,"status":"valid"}).decode()); return 0
 except (RecoveryError,OSError,ValueError) as exc: print(canonical({"schema":SCHEMA,"status":"rejected"}).decode()); return 2
if __name__=="__main__": raise SystemExit(main())
