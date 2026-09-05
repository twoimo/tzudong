import { describe, expect, test } from 'bun:test';

import {
  PrivacyUnsafeValueError,
  assertPrivacySafe,
  sanitizePrivacyValue,
} from '../lib/privacy/sanitize';

// Feature: platform-modernization, Property 28: 로그 레다크션 누출 부재
// Validates: Requirements 4.8, 8.4, 10.8, 11.10, 12.9, 13.5, 13.6, 13.9, 13.15,
// 15.7, 15.11
//
// Web mirror of the backend Redaction_Boundary leak property. For *every* value
// handed to the shared `apps/web/lib/privacy/sanitize.ts` boundary -- nested
// dict/array structures, cyclic references, non-serializable objects (functions,
// class instances, Errors, Dates, Maps), and empty/null leaves -- the value that
// reaches a text sink must not carry any Forbidden_Log_Field value. The twelve
// Forbidden_Log_Field classes are: passwords, credentials, cookies,
// session/onboarding tokens, emails, phone numbers, RRNs, precise location, raw
// OCR, arbitrary request bodies, provider diagnostics, and free-form errors.
//
// tests-unit carries no fast-check dependency (see image-tag-fixity.test.ts), so
// the property is driven by a deterministic seeded generator that builds well
// over 100 randomized structures. Each planted secret is carried in a form the
// boundary must remove -- under a sensitive key, or as a value matching a
// sensitive value pattern -- and every planted token uses an uppercase sentinel
// prefix that the benign generator (lowercase letters + digits + space only)
// cannot reproduce, so any match in the serialized output is an unambiguous leak.

// A seeded PRNG (mulberry32) keeps the generated corpus deterministic and
// reproducible across runs.
const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const SENTINEL_PREFIX = 'XSECRETLEAK';
const BENIGN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
// Fixed-shape secrets: their pattern is the identity, no token can be embedded.
const PLANTED_PHONE = '010-9876-5432';
const PLANTED_RRN = '880808-2345678';
const PLANTED_LAT = '37.987654';
const PLANTED_LNG = '126.987654';

class NonSerializable {
  // A secret on a non-plain-object node must never be reached or serialized.
  readonly secret = `${SENTINEL_PREFIX}ATTR`;
  toString() {
    return `secret=${SENTINEL_PREFIX}TOSTRING`;
  }
}

type Generated = { value: unknown; planted: string[]; secretCount: number };

const generate = (rng: () => number): Generated => {
  const planted: string[] = [];
  let counter = 0;
  let secretCount = 0;

  const randInt = (bound: number) => Math.floor(rng() * bound);
  const nonce = () => {
    counter += 1;
    return `${SENTINEL_PREFIX}${counter}`;
  };
  const benignString = (maxLen: number) => {
    const length = randInt(maxLen) + 1;
    let out = '';
    for (let index = 0; index < length; index += 1) {
      out += BENIGN_ALPHABET[randInt(BENIGN_ALPHABET.length)];
    }
    return out;
  };

  const weird = (): unknown => {
    switch (randInt(6)) {
      case 0:
        return () => SENTINEL_PREFIX;
      case 1:
        return new NonSerializable();
      case 2:
        return new Error(`provider failure ${trackedNonce()}`);
      case 3:
        return new Date(0);
      case 4:
        return new Map([['k', `${SENTINEL_PREFIX}MAP`]]);
      default:
        return Symbol(`${SENTINEL_PREFIX}SYM`);
    }
  };

  // Some weird objects carry sentinels the boundary must never reach; track them
  // so a leak from an Error message or exotic node is caught too.
  function trackedNonce() {
    const token = nonce();
    planted.push(token);
    secretCount += 1;
    return token;
  }

  // One carrier per Forbidden_Log_Field class; every carrier is self-redacting.
  const planter = (): unknown => {
    secretCount += 1;
    switch (randInt(12)) {
      case 0: {
        // 1. passwords -- sensitive key
        const token = nonce();
        planted.push(token);
        return { password: token };
      }
      case 1: {
        // 2. credentials -- sensitive key
        const token = nonce();
        planted.push(token);
        const key = ['api_key', 'client_secret', 'service_role_key', 'private_key'][randInt(4)];
        return { [key]: token };
      }
      case 2: {
        // 3. cookies -- sensitive key or header value
        const token = nonce();
        planted.push(token);
        return randInt(2) === 0 ? { Cookie: token } : `Cookie: ${token}`;
      }
      case 3: {
        // 4. session / onboarding tokens -- sensitive key
        const token = nonce();
        planted.push(token);
        const key = ['session', 'session_token', 'onboarding_token', 'challenge'][randInt(4)];
        return { [key]: token };
      }
      case 4: {
        // 5. email addresses -- value pattern
        const token = nonce();
        planted.push(token);
        return `${token}@planted.example`;
      }
      case 5:
        // 6. phone numbers -- value pattern (fixed shape)
        planted.push(PLANTED_PHONE);
        return PLANTED_PHONE;
      case 6:
        // 7. RRNs -- value pattern (fixed shape)
        planted.push(PLANTED_RRN);
        return PLANTED_RRN;
      case 7:
        // 8. precise location -- labeled value (fixed shape)
        planted.push(PLANTED_LAT, PLANTED_LNG);
        return `lat: ${PLANTED_LAT}, lng: ${PLANTED_LNG}`;
      case 8: {
        // 9. raw OCR -- sensitive key
        const token = nonce();
        planted.push(token);
        const key = ['raw_ocr', 'ocrText', 'ocrResult'][randInt(3)];
        return { [key]: token };
      }
      case 9: {
        // 10. arbitrary request bodies -- value pattern
        const token = nonce();
        planted.push(token);
        return `password=${token}`;
      }
      case 10: {
        // 11. provider diagnostics -- sensitive key or bearer value
        const token = nonce();
        planted.push(token);
        return randInt(2) === 0
          ? { error: { message: token } }
          : `Bearer ${token}`;
      }
      default: {
        // 12. free-form errors -- Error object (only bounded, no message reaches sink)
        const token = nonce();
        planted.push(token);
        return new Error(`db failure ${token}`);
      }
    }
  };

  const leaf = (): unknown => {
    switch (randInt(5)) {
      case 0:
        switch (randInt(5)) {
          case 0:
            return null;
          case 1:
            return randInt(2) === 0;
          case 2:
            return randInt(1_000_000) - 500_000;
          case 3:
            return benignString(20);
          default:
            return undefined;
        }
      case 1:
      case 4:
        return planter();
      case 2:
        return weird();
      default:
        return benignString(12);
    }
  };

  const build = (depth: number): unknown => {
    if (depth <= 0) return leaf();
    const shape = randInt(4);
    if (shape === 0) return leaf();
    const size = randInt(5);
    if (shape === 1) {
      const arr: unknown[] = [];
      for (let index = 0; index < size; index += 1) arr.push(build(depth - 1));
      return arr;
    }
    const obj: Record<string, unknown> = {};
    for (let index = 0; index < size; index += 1) {
      obj[benignString(10)] = build(depth - 1);
    }
    return obj;
  };

  const generated = build(randInt(5) + 1);

  // Explicit cyclic dict and list, each holding a planted secret so the cycle
  // branch is proven to redact rather than merely survive.
  const cyclicDict: Record<string, unknown> = { planted: planter() };
  cyclicDict.self = cyclicDict;
  const cyclicList: unknown[] = [planter()];
  cyclicList.push(cyclicList);

  const value = {
    generated,
    alwaysPlanted: Array.from({ length: randInt(4) + 1 }, () => planter()),
    cyclicDict,
    cyclicList,
    weird: weird(),
    emptyObject: {},
    emptyArray: [],
    null: null,
  };

  return { value, planted, secretCount };
};

describe('privacy sanitizer leak absence (Property 28)', () => {
  test('never leaks a planted Forbidden_Log_Field value into the sink serialization', () => {
    let examples = 0;
    let sawSecret = false;

    for (let seed = 1; seed <= 250; seed += 1) {
      examples += 1;
      const { value, planted, secretCount } = generate(makeRng(seed));
      if (secretCount > 0) sawSecret = true;

      // The boundary must not throw on cyclic / non-serializable / exotic input.
      const result = sanitizePrivacyValue(value);

      // The redacted output plus findings reach a text sink as JSON; neither may
      // carry any planted secret. Findings expose only kind/path/count.
      const rendered = JSON.stringify(result);
      for (const secret of planted) {
        expect(rendered).not.toContain(secret);
      }

      // Findings never retain a raw matched value.
      for (const finding of result.findings) {
        expect(typeof finding.kind).toBe('string');
        expect(typeof finding.path).toBe('string');
        expect(Number.isInteger(finding.count)).toBe(true);
        for (const secret of planted) {
          expect(finding.path).not.toContain(secret);
        }
      }

      // Any structure carrying a secret must fail closed at a sink boundary,
      // and the thrown error must not expose a planted value.
      if (planted.length > 0) {
        let thrown: unknown;
        try {
          assertPrivacySafe(value);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(PrivacyUnsafeValueError);
        const rejection = JSON.stringify({
          code: (thrown as PrivacyUnsafeValueError).code,
          findings: (thrown as PrivacyUnsafeValueError).findings,
          message: (thrown as PrivacyUnsafeValueError).message,
        });
        for (const secret of planted) {
          expect(rejection).not.toContain(secret);
        }
      }
    }

    expect(examples).toBe(250);
    expect(sawSecret).toBe(true);
  });

  test('redacts one carrier from every Forbidden_Log_Field class in a single nested record', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic.Cookie = 'XSECRETLEAKcookie';

    const record = {
      creds: {
        password: 'XSECRETLEAKpw',
        api_key: 'XSECRETLEAKcred',
        session_token: 'XSECRETLEAKsess',
        onboarding_token: 'XSECRETLEAKonb',
        ocrText: 'XSECRETLEAKocr',
      },
      values: {
        emailValue: 'XSECRETLEAKmail@planted.example',
        phoneValue: PLANTED_PHONE,
        rrnValue: PLANTED_RRN,
        coordsValue: `lat: ${PLANTED_LAT}, lng: ${PLANTED_LNG}`,
        bodyValue: 'password=XSECRETLEAKbody',
        bearerValue: 'Bearer XSECRETLEAKdiag',
      },
      diagnostic: { error: { message: 'XSECRETLEAKmsg' } },
      freeFormError: new Error('provider failure XSECRETLEAKerr'),
      weird: new NonSerializable(),
      cyclic,
    };
    const planted = [
      'XSECRETLEAKpw',
      'XSECRETLEAKcred',
      'XSECRETLEAKsess',
      'XSECRETLEAKonb',
      'XSECRETLEAKocr',
      'XSECRETLEAKmail',
      PLANTED_PHONE,
      PLANTED_RRN,
      PLANTED_LAT,
      PLANTED_LNG,
      'XSECRETLEAKbody',
      'XSECRETLEAKdiag',
      'XSECRETLEAKmsg',
      'XSECRETLEAKerr',
      'XSECRETLEAKcookie',
      'XSECRETLEAKATTR',
    ];

    const result = sanitizePrivacyValue(record);
    const rendered = JSON.stringify(result);
    for (const secret of planted) {
      expect(rendered).not.toContain(secret);
    }
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'credential',
        'session',
        'raw_ocr',
        'email',
        'phone',
        'rrn',
        'precise_location',
        'cookie',
        'diagnostic',
        'bounded_value',
      ]),
    );
    expect(() => assertPrivacySafe(record)).toThrow(PrivacyUnsafeValueError);
  });
});
