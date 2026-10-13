import {readFileSync} from 'node:fs';
import {main} from '../candidate/apps/web/scripts/apply-readiness-release.mjs';
const pin=JSON.parse(readFileSync(new URL('../reports/manifest-pin.json',import.meta.url))).sha256;
const env=new Proxy({READINESS_RELEASE_MANIFEST_SHA256:pin},{get:(o,k)=>{if(k!=='READINESS_RELEASE_MANIFEST_SHA256') throw new Error('CREDENTIAL_OR_ENV_READ_DENIED');return o[k];}});
main(['--dry-run','--json'],env);
