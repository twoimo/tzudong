"""Rebind only review-media source/readback expectations after an authorized edit."""
import ast
import hashlib
from pathlib import Path
import pprint
import re

ROOT = Path(__file__).resolve().parents[6]
DIR = ROOT / 'backend/supabase'
parents = [DIR / 'migrations' / n for n in (
    '20261008192455_review_media_commit_cleanup.sql', '20261008200719_review_verification_private.sql')]
integration = DIR / 'migrations/20261008201635_review_media_catalog_integration.sql'
readback = DIR / 'scripts/local_catalog_readback.sql'
parser = DIR / 'scripts/local-migrate.py'
functions = {}
for path in parents:
    for m in re.finditer(r'CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\((.*?)\)\s*RETURNS (.*?)\s+LANGUAGE (sql|plpgsql)(.*?)AS \$\$(.*?)\$\$;', path.read_text(), re.S):
        name, args, result, language, attrs, body = m.groups()
        parts = [p.strip().split() for p in args.split(',') if p.strip()]
        signature = name + '(' + ','.join(p[1].replace('timestamptz', 'timestamp with time zone') for p in parts) + ')'
        final = body.replace('auth.uid()', 'privacy_retention.g041_current_claim_user_id()') if name.startswith('public.') else body
        functions[signature] = (hashlib.sha256(body.encode()).hexdigest(), hashlib.sha256(final.encode()).hexdigest(),
            'SECURITY DEFINER' in attrs, 'i' if 'IMMUTABLE' in attrs else 'v', language, ' '.join(result.split()), [p[0] for p in parts])

def q(s): return "'" + s.replace("'", "''") + "'"
def arr(a): return 'ARRAY[' + ','.join(q(x) for x in a) + ']::text[]'
def row(signature, before):
    old, final, definer, vol, lang, result, names = functions[signature]
    fields = [q(signature)] + ([q(old)] if before else []) + [q(final), str(definer).lower(), q(vol), q(lang), q(result), arr(names)]
    return '    (' + ','.join(fields) + ')'
sql = integration.read_text()
sql = re.sub(r'(INSERT INTO review_media_expected VALUES\n).*?(;\nREVOKE ALL ON pg_temp.review_media_expected)', lambda m: m[1] + ',\n'.join(row(s,True) for s in sorted(functions)) + m[2], sql, flags=re.S)
sql = re.sub(r'(FOR v_expected IN SELECT \* FROM \(VALUES\n)    \(\'public.finish_review_media_cleanup\(\).*?(\n  \) AS expected\(signature,body_sha256,definer,volatility,language,result,argument_names\))',lambda m: m[1] + ',\n'.join(row(s,False) for s in sorted(functions)) + m[2],sql,flags=re.S)
sql = sql.replace("pronamespace='review_media_private'::regnamespace)<>6", "pronamespace='review_media_private'::regnamespace)<>7")
integration.write_text(sql)
start, end = '-- REVIEW_MEDIA_READBACK_BEGIN\n', '-- REVIEW_MEDIA_READBACK_END'
checks = sql.split(start,1)[1].split(end,1)[0].replace('-- The same independent catalog-only checks are embedded in canonical readback.\n','')
r = readback.read_text()
r = r.split(start,1)[0] + start + checks + end + r.split(end,1)[1]
r = re.sub(r'(WITH expected\(signature\) AS \(VALUES\n)  \(\'public.finish_review_media_cleanup\(\).*?(\n\)\nSELECT json_build_array\(\'review_media_functions\')', lambda m: m[1] + ',\n'.join('  ('+q(s)+')' for s in sorted(functions)) + m[2],r,flags=re.S)
readback.write_text(r)
p = parser.read_text()
rows = [[s,'privacy_workflow_owner',f[5],f[2],f[3],['search_path=""'],f[1],False,s.startswith('public.'),False,['authenticated'] if s.startswith('public.') else []] for s,f in sorted(functions.items())]
p = re.sub(r'REVIEW_MEDIA_FUNCTIONS = .*?\nREVIEW_MEDIA_STORAGE_POLICIES = ', lambda m: 'REVIEW_MEDIA_FUNCTIONS = ' + pprint.pformat(rows, width=100) + '\nREVIEW_MEDIA_STORAGE_POLICIES = ',p,flags=re.S)
parser.write_text(p)
print(f'Bound {len(functions)} functions, {sum(s.startswith("public.") for s in functions)} public RPCs')
