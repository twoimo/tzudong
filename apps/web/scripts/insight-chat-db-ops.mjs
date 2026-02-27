#!/usr/bin/env node

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const args = new Set(process.argv.slice(2));
const shouldFixVideoLinks = args.has('--fix-video-links');
const allowWarnOnly = args.has('--allow-warn');

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env', override: false });

const requiredEnv = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

function logStatus(kind, message) {
  const prefix = kind === 'PASS' ? '✅' : kind === 'WARN' ? '⚠️' : '❌';
  console.log(`[db-ops] ${prefix} ${kind}: ${message}`);
}

function toErrorMessage(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parseEmbedding(value) {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'number') ? value : null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseEmbedding(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

function extractYoutubeVideoId(url) {
  if (typeof url !== 'string' || !url.trim()) return '';

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      return pathParts[0] || '';
    }

    if (host.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;

      if (pathParts[0] === 'shorts' || pathParts[0] === 'embed') {
        return pathParts[1] || '';
      }
    }
  } catch {
    const watchMatch = url.match(/[?&]v=([^&]+)/i);
    if (watchMatch?.[1]) return watchMatch[1];

    const youtuMatch = url.match(/youtu\.be\/([^?&#/]+)/i);
    if (youtuMatch?.[1]) return youtuMatch[1];

    const shortsMatch = url.match(/youtube\.com\/(?:shorts|embed)\/([^?&#/]+)/i);
    if (shortsMatch?.[1]) return shortsMatch[1];
  }

  return '';
}

function toCanonicalYoutubeLink(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function run() {
  const failures = [];
  const warnings = [];

  if (missingEnv.length > 0) {
    const message = `missing required env: ${missingEnv.join(', ')}`;
    failures.push(message);
    logStatus('FAIL', message);
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const tableNames = ['videos', 'video_frame_captions', 'restaurants', 'transcript_embeddings_bge'];
  const tableCounts = {};

  for (const tableName of tableNames) {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    if (error) {
      const message = `${tableName} count check failed: ${toErrorMessage(error)}`;
      failures.push(message);
      logStatus('FAIL', message);
      continue;
    }

    tableCounts[tableName] = count ?? 0;
    if ((count ?? 0) > 0) {
      logStatus('PASS', `${tableName} rows=${count}`);
    } else {
      const message = `${tableName} is empty`;
      warnings.push(message);
      logStatus('WARN', message);
    }
  }

  const { data: transcriptRows, error: transcriptError } = await supabase
    .from('transcript_embeddings_bge')
    .select('video_id,recollect_id,embedding,sparse_embedding')
    .limit(1);

  if (transcriptError || !Array.isArray(transcriptRows) || transcriptRows.length === 0) {
    const message = `failed to fetch transcript seed: ${toErrorMessage(transcriptError)}`;
    failures.push(message);
    logStatus('FAIL', message);
  }

  const transcriptSeed = transcriptRows?.[0] ?? null;
  const parsedEmbedding = parseEmbedding(transcriptSeed?.embedding);
  const parsedSparse = transcriptSeed?.sparse_embedding && typeof transcriptSeed.sparse_embedding === 'object'
    ? transcriptSeed.sparse_embedding
    : {};

  if (!parsedEmbedding || parsedEmbedding.length !== 1024) {
    const message = `transcript embedding dimension invalid (expected 1024, got ${parsedEmbedding?.length ?? 0})`;
    failures.push(message);
    logStatus('FAIL', message);
  } else {
    logStatus('PASS', 'transcript embedding dimension=1024');
  }

  const { data: approvedRestaurants, error: approvedRestaurantsError } = await supabase
    .from('restaurants')
    .select('id,approved_name,youtube_link,status')
    .eq('status', 'approved')
    .limit(5000);

  if (approvedRestaurantsError || !Array.isArray(approvedRestaurants)) {
    const message = `failed to fetch approved restaurants: ${toErrorMessage(approvedRestaurantsError)}`;
    failures.push(message);
    logStatus('FAIL', message);
  }

  let missingVideoIdCount = 0;
  let normalizedCount = 0;

  if (Array.isArray(approvedRestaurants)) {
    for (const row of approvedRestaurants) {
      const youtubeLink = typeof row.youtube_link === 'string' ? row.youtube_link : '';
      const videoId = extractYoutubeVideoId(youtubeLink);

      if (!videoId) {
        missingVideoIdCount += 1;
        continue;
      }

      if (shouldFixVideoLinks) {
        const canonical = toCanonicalYoutubeLink(videoId);
        if (youtubeLink !== canonical) {
          const { error } = await supabase
            .from('restaurants')
            .update({ youtube_link: canonical })
            .eq('id', row.id)
            .eq('status', 'approved');

          if (!error) {
            normalizedCount += 1;
          }
        }
      }
    }

    if (missingVideoIdCount > 0) {
      const message = `approved restaurants with unparsable youtube_link: ${missingVideoIdCount}`;
      warnings.push(message);
      logStatus('WARN', message);
    } else {
      logStatus('PASS', `approved restaurants youtube_link parseable (${approvedRestaurants.length}/${approvedRestaurants.length})`);
    }

    if (shouldFixVideoLinks) {
      logStatus('PASS', `normalized youtube_link rows=${normalizedCount}`);
    }
  }

  const firstRestaurantName = Array.isArray(approvedRestaurants) && approvedRestaurants[0]?.approved_name
    ? String(approvedRestaurants[0].approved_name)
    : '';

  const firstRestaurantCategory = await (async () => {
    if (!Array.isArray(approvedRestaurants) || approvedRestaurants.length === 0) return '한식';
    const { data, error } = await supabase
      .from('restaurants')
      .select('categories')
      .eq('status', 'approved')
      .not('categories', 'is', null)
      .limit(1)
      .single();

    if (error || !data || !Array.isArray(data.categories) || data.categories.length === 0) return '한식';
    return String(data.categories[0]);
  })();

  async function rpcCheck(name, payload, validator) {
    try {
      const { data, error } = await supabase.rpc(name, payload);
      if (error) {
        const message = `${name} rpc error: ${toErrorMessage(error)}`;
        failures.push(message);
        logStatus('FAIL', message);
        return;
      }

      const valid = validator(data);
      if (!valid.ok) {
        const message = `${name} invalid response: ${valid.reason}`;
        failures.push(message);
        logStatus('FAIL', message);
        return;
      }

      logStatus('PASS', `${name} ok (${valid.detail})`);
    } catch (error) {
      const message = `${name} failed: ${toErrorMessage(error)}`;
      failures.push(message);
      logStatus('FAIL', message);
    }
  }

  if (parsedEmbedding && parsedEmbedding.length === 1024) {
    await rpcCheck(
      'search_video_ids_by_query',
      {
        query_embedding: parsedEmbedding,
        query_sparse: parsedSparse,
        dense_weight: 0.6,
        match_threshold: 0.2,
        match_count: 3,
      },
      (data) => {
        if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
        return { ok: true, detail: `rows=${data.length}`, reason: '' };
      },
    );

    await rpcCheck(
      'match_documents_hybrid',
      {
        query_embedding: parsedEmbedding,
        query_sparse: parsedSparse,
        dense_weight: 0.6,
        match_threshold: 0.2,
        match_count: 3,
      },
      (data) => {
        if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
        return { ok: true, detail: `rows=${data.length}`, reason: '' };
      },
    );
  }

  await rpcCheck(
    'get_video_metadata_filtered',
    { min_view_count: 0, p_limit: 3, p_order_by: 'view_count' },
    (data) => {
      if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
      return { ok: true, detail: `rows=${data.length}`, reason: '' };
    },
  );

  await rpcCheck(
    'get_all_approved_restaurant_names',
    {},
    (data) => {
      if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
      return { ok: true, detail: `rows=${data.length}`, reason: '' };
    },
  );

  await rpcCheck(
    'search_restaurants_by_name',
    { keyword: (firstRestaurantName || '광명').slice(0, 2), p_limit: 3 },
    (data) => {
      if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
      return { ok: true, detail: `rows=${data.length}`, reason: '' };
    },
  );

  await rpcCheck(
    'search_restaurants_by_category',
    { p_category: firstRestaurantCategory, p_limit: 3 },
    (data) => {
      if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
      return { ok: true, detail: `rows=${data.length}`, reason: '' };
    },
  );

  await rpcCheck(
    'get_categories_by_restaurant_name_or_youtube_url',
    { p_restaurant_name: firstRestaurantName || null, p_video_id: null },
    (data) => {
      if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
      return { ok: true, detail: `rows=${data.length}`, reason: '' };
    },
  );

  const { data: captionSeed, error: captionSeedError } = await supabase
    .from('video_frame_captions')
    .select('video_id,recollect_id,start_sec,end_sec')
    .limit(1);

  if (captionSeedError || !Array.isArray(captionSeed) || captionSeed.length === 0) {
    const message = `failed to load caption seed: ${toErrorMessage(captionSeedError)}`;
    failures.push(message);
    logStatus('FAIL', message);
  } else {
    const first = captionSeed[0];
    await rpcCheck(
      'get_video_captions_for_range',
      {
        p_video_id: first.video_id,
        p_recollect_id: first.recollect_id,
        p_start_sec: Math.max(0, Number(first.start_sec ?? 0) - 1),
        p_end_sec: Number(first.end_sec ?? 1) + 1,
      },
      (data) => {
        if (!Array.isArray(data)) return { ok: false, reason: 'not array', detail: '' };
        return { ok: true, detail: `rows=${data.length}`, reason: '' };
      },
    );
  }

  if (warnings.length > 0) {
    logStatus('WARN', `warnings=${warnings.length}`);
  }

  if (failures.length > 0) {
    logStatus('FAIL', `failed checks=${failures.length}`);
    process.exit(1);
  }

  if (warnings.length > 0 && !allowWarnOnly) {
    logStatus('PASS', 'all required checks passed (with warnings)');
    process.exit(0);
  }

  logStatus('PASS', 'all DB checks passed');
}

run().catch((error) => {
  logStatus('FAIL', `unexpected error: ${toErrorMessage(error)}`);
  process.exit(1);
});
