#!/usr/bin/env python3
"""G037 execution authorization: cryptographic revalidation at authority use."""
from __future__ import annotations
import argparse, hashlib, json, os, re, stat, subprocess, tempfile, time, uuid
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit
from g035_hosted_recovery_contract import ContractError, MANIFEST_SHA256, REMEDIATION_AUTHORIZATION_SCHEMA, REMEDIATION_PUBLIC_KEY_PEM, canonical_json_bytes, canonical_sha256, verify_short_url_remediation_authorization
from g037_hosted_closure_contract import validate_operator_assertion

SCHEMA="g037-production-remediation-authorization-v1"; PURPOSE="g037-production-short-url-remediation"; POLICY="exact-baseline-to-terminal-ledger-single-commit-v1"
PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAGquC2wytyVU4OEh4Xa3Ks8curo/xWybEkkgJu1GP+w=\n-----END PUBLIC KEY-----\n"; PUBLIC_KEY_SHA256="2ad4754cca38c52eb5daa592a879c7018cde3d716b2290f43bfe5796ac061150"
RECEIPT_SCHEMA="g035-local-recovery-receipt-v4"; _HEX=re.compile(r"^[a-f0-9]{64}$"); _COMMIT=re.compile(r"^[a-f0-9]{40}$"); _FREEZE=re.compile(r"^[a-z0-9][a-z0-9-]{7,127}$")
_INSPECTION_VECTOR=("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256"); _AUTHORIZATION_VECTOR=(*_INSPECTION_VECTOR,"batch_id")
_FIELDS=frozenset(("schema","purpose","policy","authorization_id","issued_at","expires_at","origin","project","current_commit","legacy_repository_commit","manifest_sha256","source_root","terminal_spec","freeze_id","operator_assertion_sha256","operator_assertion_expires_at","recipient_fingerprint","recovery_public_key_fingerprint","capture_scope_sha256","baseline_ledger_state","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_vector")); _BINDINGS=frozenset(_FIELDS-{"schema","authorization_id","issued_at","expires_at"})
@dataclass(frozen=True)
class ExecutionAuthorizationEnvelope:
 raw: bytes
 signature: bytes
@dataclass(frozen=True)
class VerifiedLegacyRemediationChain:
 capture_receipt_sha256:str; restore_receipt_sha256:str; inspection_receipt_sha256:str; legacy_repository_commit:str; legacy_authorization_sha256:str; legacy_authorization_signature_sha256:str; legacy_vector:tuple[tuple[str,Any],...]
def _pairs(pairs):
 out={}
 for k,v in pairs:
  if k in out: raise ContractError("duplicate JSON object key")
  out[k]=v
 return out
def _constant(_): raise ContractError("invalid JSON constant")
def _read(path,label):
 try: raw=Path(path).read_bytes(); value=json.loads(raw.decode("utf8"),object_pairs_hook=_pairs,parse_constant=_constant)
 except (OSError,UnicodeDecodeError,json.JSONDecodeError,ContractError) as exc: raise ContractError(label+" JSON invalid") from exc
 if not isinstance(value,dict) or raw!=canonical_json_bytes(value): raise ContractError(label+" JSON noncanonical")
 return raw,value
def _read_operator_assertion(path):
 raw,value=_read(path,"operator assertion")
 return value
def _verify(raw,signature,pem):
 try:
  from cryptography.hazmat.primitives.serialization import load_pem_public_key
  load_pem_public_key(pem.encode("ascii")).verify(signature,raw)
 except Exception as exc: raise ContractError("authorization signature invalid") from exc
def _hex(v,label):
 if not isinstance(v,str) or not _HEX.fullmatch(v): raise ContractError(label+" digest invalid")
def _uuid(v):
 try: parsed=uuid.UUID(v)
 except Exception as exc: raise ContractError("authorization id invalid") from exc
 if not isinstance(v,str) or str(parsed)!=v: raise ContractError("authorization id invalid")
def _origin(origin,project):
 if not isinstance(project,str) or not re.fullmatch(r"[a-z0-9]{20}",project) or origin!=f"https://{project}.supabase.co" or urlsplit(origin).hostname!=project+".supabase.co": raise ContractError("origin/project invalid")
def _vector(v):
 if not isinstance(v,dict) or set(v)!=set(_AUTHORIZATION_VECTOR): raise ContractError("legacy vector fields invalid")
 for k in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256"): _hex(v.get(k),k)
 if any(not isinstance(v.get(k),int) or isinstance(v[k],bool) or v[k]<0 for k in ("duplicate_group_count","duplicate_victim_count")): raise ContractError("legacy vector counts invalid")
 _uuid(v["batch_id"])
def _validate(v,expected,now):
 if hashlib.sha256(PUBLIC_KEY_PEM.encode()).hexdigest()!=PUBLIC_KEY_SHA256 or set(v)!=_FIELDS or set(expected)!=_BINDINGS or v.get("schema")!=SCHEMA or v.get("purpose")!=PURPOSE or v.get("policy")!=POLICY or v.get("baseline_ledger_state")!="exact-g037-baseline": raise ContractError("execution fields invalid")
 _uuid(v.get("authorization_id")); _origin(v.get("origin"),v.get("project")); _vector(v.get("legacy_vector"))
 if not _COMMIT.fullmatch(v.get("current_commit","")) or not _COMMIT.fullmatch(v.get("legacy_repository_commit","")) or v.get("manifest_sha256")!=MANIFEST_SHA256 or not _FREEZE.fullmatch(v.get("freeze_id","")): raise ContractError("execution target invalid")
 for k in ("manifest_sha256","source_root","terminal_spec","operator_assertion_sha256","recipient_fingerprint","recovery_public_key_fingerprint","capture_scope_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","legacy_authorization_sha256","legacy_authorization_signature_sha256"): _hex(v.get(k),k)
 if any(v[k]!=expected[k] for k in _BINDINGS): raise ContractError("execution binding invalid")
 issued,expires,assertion=v["issued_at"],v["expires_at"],v["operator_assertion_expires_at"]
 if any(not isinstance(x,int) or isinstance(x,bool) for x in (issued,expires,assertion)) or issued>now+30 or expires<=now or expires<=issued or expires-issued>900 or expires>assertion: raise ContractError("execution time invalid")
def _receipt(path,mode,status,prior,custody):
 custody(Path(path),"legacy "+mode); raw,v=_read(path,"legacy receipt")
 required={"schema","mode","status","manifest_sha256","prior_receipt_sha256","evidence","receipt_sha256"}
 if set(v)!=required or v.get("schema")!=RECEIPT_SCHEMA or v.get("mode")!=mode or v.get("status")!=status or v.get("manifest_sha256")!=MANIFEST_SHA256 or v.get("prior_receipt_sha256")!=prior or not isinstance(v.get("evidence"),dict): raise ContractError("legacy receipt invalid")
 got=v.pop("receipt_sha256")
 if not isinstance(got,str) or not _HEX.fullmatch(got) or got!=canonical_sha256(v): raise ContractError("legacy receipt digest invalid")
 v["receipt_sha256"]=got; return v
def verify_legacy_remediation_chain(capture_receipt,restore_receipt,inspection_receipt,legacy_authorization,legacy_signature,*,require_custody):
 capture=_receipt(capture_receipt,"capture","captured",[],require_custody)
 restore=_receipt(restore_receipt,"restore-verify","restored",[capture["receipt_sha256"]],require_custody)
 inspection=_receipt(inspection_receipt,"short-url-remediation-inspect","validated",[restore["receipt_sha256"]],require_custody)
 auth_path,sig_path=Path(legacy_authorization),Path(legacy_signature)
 require_custody(auth_path,"legacy authorization"); require_custody(sig_path,"legacy signature")
 auth_raw,_=_read(auth_path,"legacy authorization"); sig_raw=sig_path.read_bytes()
 expected={"capture_receipt_sha256":capture["receipt_sha256"],"restore_receipt_sha256":restore["receipt_sha256"],"inspection_receipt_sha256":inspection["receipt_sha256"],"manifest_sha256":MANIFEST_SHA256}
 def verify(raw,path,pem):
  if path!=sig_path or auth_path.read_bytes()!=auth_raw or sig_path.read_bytes()!=sig_raw: raise ContractError("legacy custody changed")
  _verify(raw,sig_raw,pem)
 try: auth=verify_short_url_remediation_authorization(auth_path,sig_path,require_custody=require_custody,verify_detached=verify,expected_bindings=expected,inspection_evidence=inspection["evidence"])
 except Exception as exc: raise ContractError("legacy authorization invalid") from exc
 if auth_path.read_bytes()!=auth_raw or sig_path.read_bytes()!=sig_raw: raise ContractError("legacy custody changed")
 if set(inspection["evidence"])!=set(_INSPECTION_VECTOR): raise ContractError("legacy inspection vector fields invalid")
 vector={k:auth[k] for k in _AUTHORIZATION_VECTOR}; _vector(vector)
 if any(vector[k]!=inspection["evidence"][k] for k in _INSPECTION_VECTOR) or not _COMMIT.fullmatch(auth.get("repository_commit","")): raise ContractError("legacy vector or commit drift")
 return VerifiedLegacyRemediationChain(capture["receipt_sha256"],restore["receipt_sha256"],inspection["receipt_sha256"],auth["repository_commit"],hashlib.sha256(auth_raw).hexdigest(),hashlib.sha256(sig_raw).hexdigest(),tuple((k,vector[k]) for k in _AUTHORIZATION_VECTOR))
def build_execution_authorization_template(chain,*,origin,project,current_commit,manifest_sha256,source_root,terminal_spec,freeze_id,operator_assertion_sha256,operator_assertion_expires_at,recipient_fingerprint,recovery_public_key_fingerprint,capture_scope_sha256,authorization_id,issued_at,expires_at):
 if not isinstance(chain,VerifiedLegacyRemediationChain): raise ContractError("legacy chain invalid")
 vector=dict(chain.legacy_vector)
 value={"schema":SCHEMA,"purpose":PURPOSE,"policy":POLICY,"authorization_id":authorization_id,"issued_at":issued_at,"expires_at":expires_at,"origin":origin,"project":project,"current_commit":current_commit,"legacy_repository_commit":chain.legacy_repository_commit,"manifest_sha256":manifest_sha256,"source_root":source_root,"terminal_spec":terminal_spec,"freeze_id":freeze_id,"operator_assertion_sha256":operator_assertion_sha256,"operator_assertion_expires_at":operator_assertion_expires_at,"recipient_fingerprint":recipient_fingerprint,"recovery_public_key_fingerprint":recovery_public_key_fingerprint,"capture_scope_sha256":capture_scope_sha256,"baseline_ledger_state":"exact-g037-baseline","legacy_capture_receipt_sha256":chain.capture_receipt_sha256,"legacy_restore_receipt_sha256":chain.restore_receipt_sha256,"legacy_inspection_receipt_sha256":chain.inspection_receipt_sha256,"legacy_authorization_sha256":chain.legacy_authorization_sha256,"legacy_authorization_signature_sha256":chain.legacy_authorization_signature_sha256,"legacy_vector":vector}
 _validate(value,{k:value[k] for k in _BINDINGS},issued_at)
 return value
def restrictive_regular_file(path,label,root=None):
 path=Path(path)
 try: mode=path.stat(follow_symlinks=False).st_mode
 except OSError as exc: raise ContractError(label+" inaccessible") from exc
 if path.is_symlink() or not stat.S_ISREG(mode) or (root and (path.resolve()==root or root in path.resolve().parents)): raise ContractError(label+" custody invalid")
 if os.name!="nt" and mode&0o077: raise ContractError(label+" permissions not restrictive")
 if os.name=="nt":
  from g035_hosted_recovery import _restrictive
  if not _restrictive(path): raise ContractError(label+" permissions not restrictive")
 return path
def authenticate_execution_authorization_document(authorization,signature,*,require_custody,expected_bindings,now=None):
 require_custody(Path(authorization),"execution authorization"); require_custody(Path(signature),"execution authorization signature")
 raw,v=_read(authorization,"execution authorization"); sig=Path(signature).read_bytes(); _verify(raw,sig,PUBLIC_KEY_PEM); _validate(v,expected_bindings,int(time.time()) if now is None else now)
 return ExecutionAuthorizationEnvelope(bytes(raw),bytes(sig))
def _freeze(v):
 if isinstance(v,dict): return MappingProxyType({k:_freeze(x) for k,x in v.items()})
 if isinstance(v,list): return tuple(_freeze(x) for x in v)
 return v
def authorize_exact_baseline(envelope,*,expected_bindings,now=None,baseline_is_exact):
 if type(envelope) is not ExecutionAuthorizationEnvelope or type(envelope.raw) is not bytes or type(envelope.signature) is not bytes: raise ContractError("execution envelope invalid")
 try: v=json.loads(envelope.raw.decode("utf8"),object_pairs_hook=_pairs,parse_constant=_constant)
 except (UnicodeDecodeError,json.JSONDecodeError,ContractError) as exc: raise ContractError("execution envelope invalid") from exc
 if envelope.raw!=canonical_json_bytes(v): raise ContractError("execution envelope noncanonical")
 _verify(envelope.raw,envelope.signature,PUBLIC_KEY_PEM); _validate(v,expected_bindings,int(time.time()) if now is None else now)
 if not callable(baseline_is_exact) or baseline_is_exact() is not True: raise ContractError("exact baseline required")
 return _freeze(v)
def verify_execution_authorization(authorization,signature,*,require_custody,expected_bindings,now=None,baseline_is_exact):
 return authorize_exact_baseline(authenticate_execution_authorization_document(authorization,signature,require_custody=require_custody,expected_bindings=expected_bindings,now=now),expected_bindings=expected_bindings,now=now,baseline_is_exact=baseline_is_exact)
def _path(value):
 return value if isinstance(value,Path) else Path(value)
def _windows_restrictive_directory(path):
 path=_path(path)
 if path.is_symlink() or not path.is_dir(): return False
 from g035_hosted_recovery import _windows_dacl_restrictive
 return _windows_dacl_restrictive(path,directory=True)
def _restrictive_output_parent(path, root):
 parent=_path(path).parent.resolve(strict=True); root=_path(root).resolve()
 try: mode=parent.stat(follow_symlinks=False).st_mode
 except OSError as exc: raise ContractError("output parent inaccessible") from exc
 if parent.is_symlink() or not stat.S_ISDIR(mode) or parent==root or root in parent.parents: raise ContractError("output parent must be restrictive and outside repository")
 if os.name!="nt" and mode&0o077: raise ContractError("output parent permissions not restrictive")
 if os.name=="nt" and not _windows_restrictive_directory(parent): raise ContractError("output parent permissions not restrictive")
 return parent
def _same_output_file(fd,path):
 try: descriptor=os.fstat(fd); named=os.lstat(path)
 except OSError as exc: raise ContractError("output identity changed") from exc
 if not stat.S_ISREG(descriptor.st_mode) or not stat.S_ISREG(named.st_mode) or descriptor.st_nlink!=1 or named.st_nlink!=1 or not os.path.samestat(descriptor,named): raise ContractError("output identity changed")
def _write_all(fd,data):
 offset=0
 while offset<len(data):
  written=os.write(fd,data[offset:])
  if not isinstance(written,int) or written<=0: raise ContractError("output write failed")
  offset+=written
def _write_fresh_restrictive(path,data,root):
 path=_path(path); parent=_restrictive_output_parent(path,root); path=parent/path.name
 if path.exists() or path.is_symlink(): raise ContractError("output must be fresh and outside repository")
 fd=None; identity=None
 try:
  fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_EXCL|getattr(os,"O_BINARY",0),0o600)
  created=os.fstat(fd); identity=(created.st_dev,created.st_ino)
  _same_output_file(fd,path)
  if os.name=="nt":
   from g035_hosted_recovery import _windows_current_sid
   sid=_windows_current_sid()
   if not sid: raise ContractError("Windows identity unavailable")
   subprocess.run(["icacls",str(path),"/reset"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
   subprocess.run(["icacls",str(path),"/inheritance:r","/remove:g","SYSTEM","Administrators","OWNER RIGHTS","/grant:r","*"+sid+":F","SYSTEM:F","Administrators:F"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
  else: os.fchmod(fd,0o600)
  _same_output_file(fd,path)
  restrictive_regular_file(path,"output",_path(root).resolve())
  _same_output_file(fd,path)
  _write_all(fd,data); os.fsync(fd); _same_output_file(fd,path)
  os.lseek(fd,0,os.SEEK_SET)
  readback=bytearray()
  while len(readback)<len(data):
   chunk=os.read(fd,len(data)-len(readback))
   if not chunk: break
   readback.extend(chunk)
  if bytes(readback)!=data: raise ContractError("output readback failed")
  _same_output_file(fd,path)
 except Exception:
  if fd is not None:
   try: os.close(fd)
   except OSError: pass
   fd=None
  try:
   named=os.lstat(path)
   if identity==(named.st_dev,named.st_ino) and not stat.S_ISLNK(named.st_mode): path.unlink()
  except OSError: pass
  raise
 else:
  os.close(fd)
def main(argv=None):
 p=argparse.ArgumentParser(); s=p.add_subparsers(dest="mode",required=True); b=s.add_parser("build-template")
 for n in ("capture-receipt","restore-receipt","inspection-receipt","legacy-authorization","legacy-signature","operator-assertion","output","origin","project","current-commit","source-root","terminal-spec","freeze-id","relation-root","acl-root","recipient-fingerprint","recovery-public-key-fingerprint","capture-scope-sha256","authorization-id"): b.add_argument("--"+n,required=True)
 b.add_argument("--issued-at",required=True,type=int); b.add_argument("--expires-at",required=True,type=int); a=p.parse_args(argv)
 root=Path(__file__).resolve().parents[3]; custody=lambda x,label: restrictive_regular_file(x,label,root)
 chain=verify_legacy_remediation_chain(a.capture_receipt,a.restore_receipt,a.inspection_receipt,a.legacy_authorization,a.legacy_signature,require_custody=custody)
 custody(a.operator_assertion,"operator assertion"); assertion=_read_operator_assertion(a.operator_assertion)
 validate_operator_assertion(assertion,freeze_id=a.freeze_id,origin=a.origin,relation_root=a.relation_root,acl_root=a.acl_root,commit=a.current_commit,source_root=a.source_root,terminal_spec=a.terminal_spec)
 value=build_execution_authorization_template(chain,origin=a.origin,project=a.project,current_commit=a.current_commit,manifest_sha256=MANIFEST_SHA256,source_root=a.source_root,terminal_spec=a.terminal_spec,freeze_id=a.freeze_id,operator_assertion_sha256=canonical_sha256(assertion),operator_assertion_expires_at=assertion["expires_at"],recipient_fingerprint=a.recipient_fingerprint,recovery_public_key_fingerprint=a.recovery_public_key_fingerprint,capture_scope_sha256=a.capture_scope_sha256,authorization_id=a.authorization_id,issued_at=a.issued_at,expires_at=a.expires_at)
 _write_fresh_restrictive(a.output,canonical_json_bytes(value),root); return 0
if __name__=="__main__": main()
