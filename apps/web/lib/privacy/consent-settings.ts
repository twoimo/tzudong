import type { Database } from '@/integrations/supabase/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type PrivacyConsentArgs = Database['public']['Functions']['submit_privacy_consent']['Args'];
export type ConsentChannel = Extract<PrivacyConsentArgs['p_channel'], 'email' | 'sms' | 'push'>;
const CHANNELS: readonly ConsentChannel[] = ['email', 'sms', 'push'];
type OrdinaryConsentPurpose = Extract<
  PrivacyConsentArgs['p_purpose'],
  'email_marketing' | 'sms_marketing' | 'push_marketing'
>;
type ConsentPurpose = Extract<PrivacyConsentArgs['p_purpose'], OrdinaryConsentPurpose | 'night_marketing'>;
type ConsentDecision = PrivacyConsentArgs['p_decision'];

const ORDINARY_PURPOSE_BY_CHANNEL: Record<ConsentChannel, OrdinaryConsentPurpose> = {
  email: 'email_marketing',
  sms: 'sms_marketing',
  push: 'push_marketing',
};

export type ConsentStates = {
  ordinary: Record<ConsentChannel, boolean>;
  night: Record<ConsentChannel, boolean>;
};

export type ConsentSettingsRequest = {
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  decision: ConsentDecision;
  policyVersionId: string;
  noticeSha256: string;
  idempotencyKey: string;
  correlationId: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isChannel(value: unknown): value is ConsentChannel {
  return typeof value === 'string' && CHANNELS.some((channel) => channel === value);
}

function isConsentDecision(value: unknown): value is ConsentDecision {
  return value === 'granted' || value === 'withdrawn';
}

function isPolicyVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function emptyConsentStates(): ConsentStates {
  return {
    ordinary: { email: false, sms: false, push: false },
    night: { email: false, sms: false, push: false },
  };
}

export function parseCurrentPolicy(value: unknown) {
  if (!isRecord(value)
    || !isUuid(value.policyVersionId)
    || !isPolicyVersion(value.version)
    || typeof value.contentSha256 !== 'string' || !SHA256_PATTERN.test(value.contentSha256)
    || value.locale !== 'ko-KR'
    || value.approvalBound !== true) {
    return null;
  }

  return {
    policyVersionId: value.policyVersionId,
    version: value.version,
    contentSha256: value.contentSha256,
  };
}

function isConsentPurposeForChannel(
  purpose: unknown,
  channel: ConsentChannel,
): purpose is ConsentPurpose {
  return purpose === 'night_marketing' || purpose === ORDINARY_PURPOSE_BY_CHANNEL[channel];
}

export function parseConsentRequest(value: unknown): ConsentSettingsRequest | null {
  if (!isRecord(value)) return null;

  const expectedKeys = [
    'purpose',
    'channel',
    'decision',
    'policyVersionId',
    'noticeSha256',
    'idempotencyKey',
    'correlationId',
  ];
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !keys.every((key) => expectedKeys.includes(key))) return null;

  const { purpose, channel, decision, policyVersionId, noticeSha256, idempotencyKey, correlationId } = value;
  if (!isChannel(channel)
    || !isConsentPurposeForChannel(purpose, channel)
    || !isConsentDecision(decision)
    || !isUuid(policyVersionId)
    || typeof noticeSha256 !== 'string' || !SHA256_PATTERN.test(noticeSha256)
    || typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    || !isUuid(correlationId)) {
    return null;
  }

  return { purpose, channel, decision, policyVersionId, noticeSha256, idempotencyKey, correlationId };
}

export function normalizeConsentStateRows(value: unknown, userId: string): ConsentStates | null {
  if (!Array.isArray(value)) return null;

  const states = emptyConsentStates();
  const seen = new Set<string>();
  for (const row of value) {
    if (!isRecord(row) || row.user_id !== userId) return null;
    if (row.subject_kind !== 'self') continue;
    if (!isChannel(row.channel) || !isConsentPurposeForChannel(row.purpose, row.channel)) continue;
    if (!isConsentDecision(row.decision)) return null;

    const key = `${row.purpose}:${row.channel}`;
    if (seen.has(key)) return null;
    seen.add(key);

    if (row.purpose === 'night_marketing') {
      states.night[row.channel] = row.decision === 'granted';
    } else {
      states.ordinary[row.channel] = row.decision === 'granted';
    }
  }

  return states;
}