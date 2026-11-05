import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveAdBannerPersistenceUrls } from "@/lib/ad-banner-url";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type { AdBannerFormData, DisplayTarget } from "@/types/ad-banner";

export const runtime = "nodejs";
const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const MAX_BANNER_MUTATION_REQUEST_BYTES = 64 * 1024;

const AD_BANNER_SELECT = [
  "id",
  "title",
  "description",
  "image_url",
  "video_url",
  "media_type",
  "link_url",
  "is_active",
  "priority",
  "display_target",
  "created_at",
  "updated_at",
  "created_by",
].join(",");

type BannerMutationBody = {
  data?: unknown;
  expectedUpdatedAt?: unknown;
  id?: unknown;
};

function privateNoStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isObservedRevision(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && value === value.trim()
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function parseBannerMutationData(value: unknown): AdBannerFormData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = data.description === undefined || data.description === null
    ? null
    : typeof data.description === "string" ? data.description : null;
  const displayTarget = Array.isArray(data.display_target)
    && data.display_target.every((target): target is DisplayTarget => target === "sidebar" || target === "mobile_popup")
    ? data.display_target
    : null;

  if (
    !title
    || title.length > 100
    || (data.description !== undefined && data.description !== null && typeof data.description !== "string")
    || typeof data.is_active !== "boolean"
    || !Number.isInteger(data.priority)
    || (data.priority as number) < 0
    || (data.priority as number) > 1000
    || !displayTarget
  ) return null;

  const urls = resolveAdBannerPersistenceUrls({
    image_url: data.image_url,
    video_url: data.video_url,
    media_type: data.media_type,
    link_url: data.link_url,
  });
  if (!urls) return null;

  return {
    title,
    description,
    ...urls,
    is_active: data.is_active,
    priority: data.priority as number,
    display_target: [...displayTarget],
  };
}

async function readMutationBody(request: NextRequest) {
  const parsed = await readBoundedJsonRequest(request, MAX_BANNER_MUTATION_REQUEST_BYTES);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return null;
  return parsed.value as BannerMutationBody;
}

async function readCurrentBanner(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  id: string,
) {
  return supabase
    .from("ad_banners")
    .select(AD_BANNER_SELECT)
    .eq("id", id)
    .maybeSingle();
}

async function mutationMissResponse(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  id: string,
) {
  const { data, error } = await readCurrentBanner(supabase, id);
  if (error) return privateNoStoreJson({ code: "banner_readback_failed" }, { status: 500 });
  if (!data) return privateNoStoreJson({ code: "banner_not_found" }, { status: 404 });
  return privateNoStoreJson({ code: "banner_revision_conflict", banner: data }, { status: 409 });
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return auth.response;
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("ad_banners")
      .select(AD_BANNER_SELECT)
      .order("priority", { ascending: false });

    if (error) return privateNoStoreJson({ code: "banner_read_failed" }, { status: 500 });
    return privateNoStoreJson({ banners: data ?? [] });
  } catch {
    return privateNoStoreJson({ code: "banner_read_failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return auth.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return privateNoStoreJson({ code: "banner_mutation_forbidden" }, { status: 403 });
  }

  try {
    const body = await readMutationBody(request);
    const id = body?.id;
    const expectedUpdatedAt = body?.expectedUpdatedAt;
    const data = parseBannerMutationData(body?.data);
    if (!isUuid(id) || !isObservedRevision(expectedUpdatedAt) || !data) {
      return privateNoStoreJson({ code: "banner_mutation_invalid" }, { status: 400 });
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data: updated, error } = await supabase
      .from("ad_banners")
      .update({
        title: data.title,
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        video_url: data.video_url ?? null,
        media_type: data.media_type,
        link_url: data.link_url || null,
        is_active: data.is_active,
        priority: data.priority,
        display_target: [...data.display_target],
      })
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select(AD_BANNER_SELECT)
      .maybeSingle();

    if (error) return privateNoStoreJson({ code: "banner_update_failed" }, { status: 500 });
    if (!updated) return mutationMissResponse(supabase, id);
    return privateNoStoreJson({ banner: updated });
  } catch {
    return privateNoStoreJson({ code: "banner_update_failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return auth.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return privateNoStoreJson({ code: "banner_mutation_forbidden" }, { status: 403 });
  }

  try {
    const body = await readMutationBody(request);
    const id = body?.id;
    const expectedUpdatedAt = body?.expectedUpdatedAt;
    if (!isUuid(id) || !isObservedRevision(expectedUpdatedAt)) {
      return privateNoStoreJson({ code: "banner_mutation_invalid" }, { status: 400 });
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data: deleted, error } = await supabase
      .from("ad_banners")
      .delete()
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select(AD_BANNER_SELECT)
      .maybeSingle();

    if (error) return privateNoStoreJson({ code: "banner_delete_failed" }, { status: 500 });
    if (!deleted) return mutationMissResponse(supabase, id);
    return privateNoStoreJson({ deletedBanner: deleted });
  } catch {
    return privateNoStoreJson({ code: "banner_delete_failed" }, { status: 500 });
  }
}
