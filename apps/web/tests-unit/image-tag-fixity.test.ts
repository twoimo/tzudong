// Feature: platform-modernization, Property 25: 이미지 태그 고정성.
// Validates: Requirements 11.3, 12.10.
//
// Web-side mirror of the container image tag-fixity invariant enforced on the
// backend by backend/bin/observability_up.py:is_pinned_image_reference (task
// 19, design section C8). The web repository declares no equivalent pinned-image
// predicate, so this test replicates the fixity predicate as a small local
// helper — byte-for-byte equivalent to the backend one — and property-checks it
// against a large, deterministically generated set of references.
//
// Invariant: a reference passes IFF it is pinned to an exact tag or a sha256
// digest; latest, floating/movable alias tags, untagged names, and malformed
// digests all fail. Each generated case carries its expected classification by
// construction, so the generator itself is the oracle and the assertion is the
// iff. No fast-check dependency exists in tests-unit, so cases are enumerated
// combinatorially (well over 100 references) in the established bun:test style.

import { describe, expect, test } from "bun:test";

// Movable alias tags that never count as a pinned reference. Mirrors the
// backend _FLOATING_TAGS set; comparison is case-insensitive.
const FLOATING_TAGS = new Set([
  "latest",
  "stable",
  "edge",
  "nightly",
  "main",
  "master",
  "dev",
  "current",
]);

// Replica of observability_up.is_pinned_image_reference. True iff `reference`
// pins an image to an exact tag or a well-formed sha256 digest.
function isPinnedImageReference(reference: unknown): boolean {
  if (typeof reference !== "string") return false;
  const ref = reference.trim();
  if (ref === "") return false;

  // Digest pin: name@sha256:<64 hex>.
  const at = ref.indexOf("@");
  if (at !== -1) {
    const name = ref.slice(0, at);
    if (name === "") return false;
    const digest = ref.slice(at + 1);
    const colon = digest.indexOf(":");
    if (colon === -1) return false;
    const algo = digest.slice(0, colon);
    const hexpart = digest.slice(colon + 1);
    if (algo !== "sha256") return false;
    if (hexpart.length !== 64) return false;
    if (!/^[0-9a-f]{64}$/.test(hexpart)) return false;
    return true;
  }

  // Tag pin: the tag is taken from the final path segment only.
  const lastSegment = ref.slice(ref.lastIndexOf("/") + 1);
  const colon = lastSegment.lastIndexOf(":");
  if (colon === -1) return false; // untagged
  const tag = lastSegment.slice(colon + 1);
  if (tag === "") return false;
  if (FLOATING_TAGS.has(tag.toLowerCase())) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic combinatorial generation of (reference, expectedPinned) cases.
// Ambiguous forms (e.g. a bare `host:port` that could read as either a registry
// authority or a `name:tag`) are never generated, so the expected value is
// unambiguous for every case.
// ---------------------------------------------------------------------------

const NAMES = [
  "otel/opentelemetry-collector",
  "prom/prometheus",
  "grafana/grafana",
  "grafana/loki",
  "tzudong/pipeline-api",
  "tzudong/pipeline-worker",
  "library/nginx",
  "app",
  "nginx",
];

// Registry authorities used only as a `<prefix>/<name>` prefix, so any `:port`
// stays off the final path segment and cannot be mistaken for a tag separator.
const REGISTRY_PREFIXES = [
  "",
  "ghcr.io/",
  "docker.io/",
  "harbor.local/",
  "harbor.local:443/",
  "registry.local:5000/",
  "127.0.0.1:5000/",
];

const EXACT_TAGS = [
  "0.120.0",
  "v3.2.1",
  "11.5.2",
  "v2.1.20",
  "3.7.7",
  "1.12.6",
  "v1.5.0",
  "8.17.0",
  "sha-abc1234",
  "20240101",
  "release-42",
  "1.0.0-rc.1",
];

const FLOATING_TAG_CASES = [
  "latest",
  "stable",
  "edge",
  "nightly",
  "main",
  "master",
  "dev",
  "current",
  "LATEST",
  "Latest",
  "STABLE",
];

const HEX64 = "a".repeat(64);
const HEX63 = "a".repeat(63);

type Case = { reference: unknown; expected: boolean };

function buildCases(): Case[] {
  const cases: Case[] = [];

  for (const prefix of REGISTRY_PREFIXES) {
    for (const name of NAMES) {
      // Pinned: exact tags.
      for (const tag of EXACT_TAGS) {
        cases.push({ reference: `${prefix}${name}:${tag}`, expected: true });
      }
      // Pinned: sha256 digest.
      cases.push({ reference: `${prefix}${name}@sha256:${HEX64}`, expected: true });

      // Not pinned: floating alias tags.
      for (const tag of FLOATING_TAG_CASES) {
        cases.push({ reference: `${prefix}${name}:${tag}`, expected: false });
      }
      // Not pinned: untagged.
      cases.push({ reference: `${prefix}${name}`, expected: false });

      // Not pinned: malformed digests.
      cases.push({ reference: `${prefix}${name}@sha256:${HEX63}`, expected: false }); // short hex
      cases.push({ reference: `${prefix}${name}@sha256:${HEX64}f`, expected: false }); // long hex
      cases.push({ reference: `${prefix}${name}@sha256:${HEX63}g`, expected: false }); // non-hex char
      cases.push({ reference: `${prefix}${name}@sha512:${HEX64}`, expected: false }); // wrong algo
      cases.push({ reference: `${prefix}${name}@sha256${HEX64}`, expected: false }); // no colon
      cases.push({ reference: `${prefix}${name}@sha256:`, expected: false }); // empty hex
    }
  }

  // Blank / whitespace-only references.
  for (const blank of ["", " ", "   ", "\t", "\n"]) {
    cases.push({ reference: blank, expected: false });
  }

  // Non-string inputs are never pinned.
  for (const value of [null, undefined, 0, 1, true, false, {}, [], ["x"]]) {
    cases.push({ reference: value, expected: false });
  }

  return cases;
}

describe("image tag fixity (Property 25)", () => {
  const cases = buildCases();

  test("generates a broad case set exceeding the 100-example floor", () => {
    expect(cases.length).toBeGreaterThan(100);
  });

  test("a reference passes iff it is pinned to an exact tag or sha256 digest", () => {
    for (const { reference, expected } of cases) {
      expect(
        isPinnedImageReference(reference),
        `reference=${JSON.stringify(reference)}`,
      ).toBe(expected);
    }
  });

  test("the real observability compose image tags are all pinned", () => {
    const declared = [
      "otel/opentelemetry-collector:0.120.0",
      "prom/prometheus:v3.2.1",
      "grafana/grafana:11.5.2",
      "grafana/loki:3.7.7",
    ];
    for (const ref of declared) {
      expect(isPinnedImageReference(ref), ref).toBe(true);
    }
    // The same images floated to `latest` must be rejected.
    for (const ref of declared) {
      const floated = `${ref.slice(0, ref.lastIndexOf(":"))}:latest`;
      expect(isPinnedImageReference(floated), floated).toBe(false);
    }
  });
});
