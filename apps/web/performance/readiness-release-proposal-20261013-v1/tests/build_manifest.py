from pathlib import Path
import hashlib,json,copy
P=Path(__file__).resolve().parents[1]; C=P/'candidate'; O=P/'original'
sha=lambda b:hashlib.sha256(b).hexdigest()
fixture=json.loads((P/'reports/fixture.json').read_text())
binding=json.loads((O/'apps/web/performance/readiness-operating-20261012/atomic-readiness-binding-v1.json').read_text())
plans=json.loads((P/'reports/materials.json').read_text())
old=json.loads((O/'apps/web/performance/readiness-operating-20261012/hosted-preflight-readback-v1.json').read_text())
prior,final=copy.deepcopy(fixture['prior']),copy.deepcopy(fixture['final'])
for state in (prior,final): state['membershipSha256']=old['membershipSha256']
paths=['apps/web/scripts/apply-supabase-migration.mjs','apps/web/scripts/supabase-migration-transaction.mjs','apps/web/scripts/privacy-safe-cli-log.mjs','backend/supabase/scripts/g037_supabase_statement_vector.mjs','apps/web/scripts/readiness-release.mjs','apps/web/scripts/apply-readiness-release.mjs']
bundle=C/'backend/supabase/release-bundles/readiness11-v1.sql'
manifest={'version':1,'id':'review_media_readiness11_v1','bundle':{'path':str(bundle.relative_to(C)),'sha256':sha(bundle.read_bytes()),'bytes':bundle.stat().st_size},'sources':[{'path':s['source'],'bytes':s['bytes'],'sha256':s['sha256'],'vectorSha256':p['vectorSha256']} for s,p in zip(binding['sources'],plans)],'dependencies':[{'path':p,'bytes':(C/p).stat().st_size,'sha256':sha((C/p).read_bytes())} for p in paths], 'prior':prior,'final':final,'ledger':{'prefixCount':old['ledgerCount'],'prefixSha256':old['ledgerSha256']},'evidence':{'sourceHead':'03cd3c8c93041b0835f55943f76ff058c4620a88','catalogContractOrigin':'isolated PostgreSQL 17.6 reference clone; fresh hosted read-only equality required before apply','ledgerAndMembershipOrigin':'readiness-operating-20261012/hosted-preflight-readback-v1.json; historical, not fresh hosted receipt','hostedVerified':False,'foundationUnitsInPayload':0}}
raw=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
(C/'.github/supabase-readiness-release-manifest.v1.json').write_bytes(raw)
(P/'reports/manifest-pin.json').write_text(json.dumps({'sha256':sha(raw),'bytes':len(raw)},indent=2)+'\n')
print(json.dumps({'manifestSha256':sha(raw),'sourceCount':11,'fixtureFoundationInPayload':0}))
