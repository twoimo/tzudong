"""Extract unchanged read callbacks into a module-owned scope, after baseline build."""
from pathlib import Path
import hashlib
import json
import subprocess

repo = Path('/Users/twoimo/.codex/worktrees/review-query-lifetime-20261012/tzudong')
here = Path(__file__).resolve().parent
target = repo / 'apps/web/components/restaurant/RestaurantDetailPanel.tsx'
original = target.read_text()
expected = subprocess.check_output(['git','show','056a86600f412eb42df4304e3206841679012f3e:apps/web/components/restaurant/RestaurantDetailPanel.tsx'],cwd=repo).decode()
if original != expected:
    raise SystemExit('SOURCE_INPUT_DENIED')
receipt = json.loads((here/'build-before-v1.json').read_text())
if receipt['compileExit'] != 0 or not receipt['cssActualDirectoryValidated']:
    raise SystemExit('BASELINE_BUILD_REQUIRED')

source = original
prefix = '        queryFn: async () => {'
start = source.index(prefix, source.index('const siblingTzuyangReviewQuery'))
end = source.index('\n        },\n    });', start)
sibling_body = source[start+len(prefix):end]
source = source[:start] + '        queryFn: createSiblingTzuyangReviewQuery(restaurant, youtubeLinks),' + source[end+len('\n        },'):]
prefix = '        queryFn: async ({ pageParam = 0 }) => {'
start = source.index(prefix, source.index('} = useInfiniteQuery({'))
end = source.index('\n        },\n        initialPageParam:', start)
review_body = source[start+len(prefix):end]
source = source[:start] + '        queryFn: createRestaurantReviewsQuery(restaurant, categories, user ? { id: user.id } : null),' + source[end+len('\n        },'):]

type_start = source.index('interface Review {')
type_end = source.index('\n\nfunction formatTzuyangReviewDate',type_start)
review_type = source[type_start:type_end]
source = source[:type_start]+source[type_end+2:]
for text in [
    'import type { Tables } from "@/integrations/supabase/types";\n',
    'import {\n    collectDirectRestaurantReviewIds,\n    getRestaurantReviewLookupName,\n    selectRelatedRestaurantReviewIds,\n} from "@/lib/restaurant-review-lookup";\n',
    'import { readPublicProfileSummariesLookup, resolvePublicReviewerDisplay } from "@/lib/public-profile-read";\n',
    "type ReviewRow = Tables<'reviews'>;\n",
    "type ReviewLikeRow = Pick<Tables<'review_likes'>, 'review_id'>;\n",
    "const RESTAURANT_DETAIL_REVIEW_SELECT = 'id,user_id,restaurant_id,visited_at,created_at,content,food_photos,categories,is_verified,is_pinned,is_edited_by_admin,admin_note,like_count';\n",
]:
    if source.count(text) != 1:
        raise SystemExit('EXACT_IMPORT_OR_DECLARATION_REQUIRED')
    source = source.replace(text,'')
source = source.replace('type RestaurantWithVerifiedCount',
    'import { createRestaurantReviewsQuery, createSiblingTzuyangReviewQuery, type RestaurantDetailReview as Review } from "@/lib/restaurant-detail-query-functions";\n\ntype RestaurantWithVerifiedCount',1)

def dedent_body(body):
    return '\n'.join(line[4:] if line.startswith('    ') else line for line in body.splitlines())

header = '''import type { Tables } from '@/integrations/supabase/types';
import type { Restaurant } from '@/types/restaurant';
import { supabase } from '@/integrations/supabase/client';
import { collectDirectRestaurantReviewIds, getRestaurantReviewLookupName, selectRelatedRestaurantReviewIds } from '@/lib/restaurant-review-lookup';
import { buildCanonicalYouTubeWatchUrl, extractCanonicalYouTubeVideoId } from '@/lib/youtube-url';
import { readPublicProfileSummariesLookup, resolvePublicReviewerDisplay } from '@/lib/public-profile-read';

type ReviewRow = Tables<'reviews'>;
type ReviewLikeRow = Pick<Tables<'review_likes'>, 'review_id'>;
const RESTAURANT_DETAIL_REVIEW_SELECT = 'id,user_id,restaurant_id,visited_at,created_at,content,food_photos,categories,is_verified,is_pinned,is_edited_by_admin,admin_note,like_count';

'''
body = header + review_type.replace('interface Review {','export interface RestaurantDetailReview {') + '''

// Query caches outlive the panel. Create callbacks here so their lexical scope
// owns only query input data and the client, never panel state or React setters.
export function createSiblingTzuyangReviewQuery(
    restaurant: Restaurant | null,
    youtubeLinks: string[],
    client: typeof supabase = supabase,
) {
    return async () => {'''+dedent_body(sibling_body).replace('supabase\n','client\n')+'''
    };
}

export function createRestaurantReviewsQuery(
    restaurant: Restaurant | null,
    categories: string[],
    user: { id: string } | null,
    client: typeof supabase = supabase,
) {
    return async ({ pageParam = 0 }: { pageParam?: number }) => {'''+dedent_body(review_body).replace('supabase\n','client\n').replace('readPublicProfileSummariesLookup(supabase,','readPublicProfileSummariesLookup(client,').replace('as Review[]','as RestaurantDetailReview[]')+'''
    };
}
'''
module = repo/'apps/web/lib/restaurant-detail-query-functions.ts'
if module.exists():
    raise SystemExit('NEW_MODULE_ALREADY_EXISTS')
module.write_text(body)
target.write_text(source)
(here/'source-before-component.tsx').write_text(original)
(here/'source-extraction-v1.json').write_text(json.dumps({
    'sourceBefore':receipt['sourceCommit'],
    'originalComponentSha256':hashlib.sha256(original.encode()).hexdigest(),
    'updatedComponentSha256':hashlib.sha256(source.encode()).hexdigest(),
    'newModuleSha256':hashlib.sha256(body.encode()).hexdigest(),
    'siblingBodySha256Before':hashlib.sha256(sibling_body.encode()).hexdigest(),
    'reviewBodySha256Before':hashlib.sha256(review_body.encode()).hexdigest(),
    'changes':'Scope extraction; dedent, imported client name and Review type name only. User argument is owner id copy; keys and cache times unchanged.',
},indent=2)+'\n')
print('two module-owned callbacks extracted; body logic and query policies preserved')
