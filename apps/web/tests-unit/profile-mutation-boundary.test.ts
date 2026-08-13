import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearCurrentProfileAvatar,
  isSignupProfileStateReady,
  PROFILE_AVATAR_COMPARE_AND_SET_RPC,
  PROFILE_MUTATION_ERROR_CODE,
  PROFILE_NICKNAME_UPDATE_RPC,
  ProfileMutationError,
  readSignupProfileState,
  SIGNUP_PROFILE_READBACK_RPC,
  updateCurrentProfileNickname,
  uploadCurrentProfileAvatar,
} from "@/lib/profile-mutation";
import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";

const USER_ID = "08a8662c-6de8-4d4f-b54d-01d385451b42";
const OLD_OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const OLD_REFERENCE = `profile-avatar://${USER_ID}/avatar-${OLD_OPERATION_ID}.jpg`;
const OLD_STORAGE_KEY = `${USER_ID}/avatar-${OLD_OPERATION_ID}.jpg`;
const UNTRUSTED_LEGACY_REFERENCE = "https://legacy.invalid/private/avatar.jpg";
const NICKNAME = "테스트사용자";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

function profileState(avatarReference: string | null, nickname = NICKNAME) {
  return {
    userId: USER_ID,
    nickname,
    avatarReference,
  };
}

function avatarReceipt(
  avatarReference: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    status: "applied",
    reasonCode: "PROFILE_AVATAR_UPDATED",
    profile: profileState(avatarReference),
    changes: { avatar: true },
    readback: { passed: true },
    ...overrides,
  };
}

function signupState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    complete: true,
    reasonCode: "SIGNUP_PROFILE_READY",
    nicknameMatches: true,
    counts: {
      profile: 1,
      ordinaryRole: 1,
      adminRole: 0,
      stats: 1,
      activeStatus: 1,
    },
    ...overrides,
  };
}

function avatarClient(
  onRpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
) {
  const events: string[] = [];
  const client = {
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      events.push(`rpc:${functionName}`);
      return onRpc(functionName, args);
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("profile-avatars");
        return {
          upload: async (
            path: string,
            content: ArrayBuffer,
            options: Record<string, unknown>,
          ) => {
            events.push(`upload:${path}`);
            expect(content).toBeInstanceOf(ArrayBuffer);
            expect(options).toEqual({
              upsert: false,
              contentType: "image/jpeg",
              cacheControl: "3600",
            });
            return {
              data: {
                id: "22222222-2222-4222-8222-222222222222",
                path,
                fullPath: `profile-avatars/${path}`,
              },
              error: null,
            };
          },
          remove: async (paths: string[]) => {
            events.push(`remove:${paths.join(",")}`);
            return { data: paths, error: null };
          },
          exists: async (path: string) => {
            events.push(`exists:${path}`);
            return { data: false, error: { message: "not found" } };
          },
        };
      },
    },
  };

  return { client, events };
}

describe("current profile mutation receipt boundary", () => {
  test("accepts only an exact nickname receipt bound to the authenticated subject and input", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = [];
    const client = {
      rpc: async (functionName: string, args: unknown) => {
        calls.push({ functionName, args });
        return {
          data: {
            schemaVersion: 1,
            status: "applied",
            reasonCode: "PROFILE_NICKNAME_UPDATED",
            profile: profileState(null, "새닉네임"),
            changes: { nickname: true },
            readback: { passed: true },
          },
          error: null,
        };
      },
    };

    await expect(
      updateCurrentProfileNickname(client, USER_ID, "새닉네임"),
    ).resolves.toMatchObject({
      status: "applied",
      profile: { userId: USER_ID, nickname: "새닉네임", avatarReference: null },
    });
    expect(calls).toEqual([{
      functionName: PROFILE_NICKNAME_UPDATE_RPC,
      args: { p_nickname: "새닉네임" },
    }]);

    const malformedClient = {
      rpc: async () => ({
        data: {
          schemaVersion: 1,
          status: "applied",
          reasonCode: "PROFILE_NICKNAME_UPDATED",
          profile: profileState(null, "새닉네임"),
          changes: { nickname: true },
          readback: { passed: true },
          providerMessage: "must not escape",
        },
        error: null,
      }),
    };
    await expect(
      updateCurrentProfileNickname(malformedClient, USER_ID, "새닉네임"),
    ).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.invalidResponse });
  });

  test("collapses provider errors into a fixed local code without carrying provider detail", async () => {
    const providerError = {
      code: "23505",
      message: "sensitive database details",
      details: "profile row",
    };
    const client = {
      rpc: async () => ({ data: null, error: providerError }),
    };

    try {
      await updateCurrentProfileNickname(client, USER_ID, "새닉네임");
      throw new Error("expected mutation rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileMutationError);
      expect(error).toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
      expect(String(error)).not.toContain(providerError.message);
      expect(error).not.toHaveProperty("cause");
    }
  });

  test("accepts an opaque bounded legacy avatar readback so nickname repair is not blocked", async () => {
    for (const avatarReference of [
      UNTRUSTED_LEGACY_REFERENCE,
      "",
      "legacy\nreference",
      "legacy\u007freference",
    ]) {
      const client = {
        rpc: async () => ({
          data: {
            schemaVersion: 1,
            status: "applied",
            reasonCode: "PROFILE_NICKNAME_UPDATED",
            profile: profileState(avatarReference, "복구닉네임"),
            changes: { nickname: true },
            readback: { passed: true },
          },
          error: null,
        }),
      };

      await expect(
        updateCurrentProfileNickname(client, USER_ID, "복구닉네임"),
      ).resolves.toMatchObject({ profile: { avatarReference } });
    }
  });

  test("requires the exact complete signup profile state including absence of admin role", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = [];
    const client = {
      rpc: async (functionName: string, args: unknown) => {
        calls.push({ functionName, args });
        return { data: signupState(), error: null };
      },
    };

    const receipt = await readSignupProfileState(client, USER_ID, NICKNAME);
    expect(isSignupProfileStateReady(receipt)).toBe(true);
    expect(calls).toEqual([{
      functionName: SIGNUP_PROFILE_READBACK_RPC,
      args: { p_user_id: USER_ID, p_expected_nickname: NICKNAME },
    }]);

    const adminRoleClient = {
      rpc: async () => ({
        data: signupState({
          counts: { ...signupState().counts, adminRole: 1 },
        }),
        error: null,
      }),
    };
    expect(
      isSignupProfileStateReady(
        await readSignupProfileState(adminRoleClient, USER_ID, NICKNAME),
      ),
    ).toBe(false);

    for (const data of [
      signupState({ counts: { ...signupState().counts, profile: 2 } }),
      signupState({ nicknameMatches: false }),
      signupState({ complete: false, reasonCode: "SIGNUP_PROFILE_INCOMPLETE" }),
    ]) {
      const nonReadyClient = { rpc: async () => ({ data, error: null }) };
      expect(
        isSignupProfileStateReady(
          await readSignupProfileState(nonReadyClient, USER_ID, NICKNAME),
        ),
      ).toBe(false);
    }

    const contradictoryClient = {
      rpc: async () => ({
        data: signupState({ complete: true, reasonCode: "SIGNUP_PROFILE_INCOMPLETE" }),
        error: null,
      }),
    };
    await expect(
      readSignupProfileState(contradictoryClient, USER_ID, NICKNAME),
    ).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.invalidResponse });
  });
});

describe("versioned profile avatar saga", () => {
  test("rejects receipts that contradict the exact expected/next SQL invariants", async () => {
    const impossibleReceipts = [
      (nextReference: string) => avatarReceipt(nextReference, {
        status: "unchanged",
        reasonCode: "PROFILE_AVATAR_UNCHANGED",
        changes: { avatar: false },
      }),
      () => avatarReceipt(OLD_REFERENCE, {
        status: "conflict",
        reasonCode: "PROFILE_VERSION_CONFLICT",
        changes: { avatar: false },
      }),
    ];

    for (const buildReceipt of impossibleReceipts) {
      let nextReference = "";
      let rpcCalls = 0;
      const { client, events } = avatarClient(async (_functionName, args) => {
        rpcCalls += 1;
        nextReference = `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
        if (rpcCalls === 1) {
          return { data: buildReceipt(nextReference), error: null };
        }
        return { data: null, error: { message: "replay unavailable" } };
      });

      await expect(uploadCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
        new Blob(["image"], { type: "image/jpeg" }),
      )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
      expect(events.some((event) => event.startsWith("remove:"))).toBe(false);
    }

    let clearCalls = 0;
    const impossibleClear = avatarClient(async () => {
      clearCalls += 1;
      if (clearCalls === 1) {
        return {
          data: avatarReceipt(null, {
            status: "unchanged",
            reasonCode: "PROFILE_AVATAR_UNCHANGED",
            changes: { avatar: false },
          }),
          error: null,
        };
      }
      return { data: null, error: { message: "replay unavailable" } };
    });
    await expect(clearCurrentProfileAvatar(
      impossibleClear.client,
      USER_ID,
      OLD_REFERENCE,
    )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
    expect(impossibleClear.events.some((event) => event.startsWith("remove:"))).toBe(false);
  });

  test("uploads a unique immutable object, CASes the raw reference, then removes the prior owned object", async () => {
    let nextReference: string | null = null;
    const { client, events } = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      expect(args.p_expected_avatar_reference).toBe(OLD_REFERENCE);
      expect(typeof args.p_next_avatar_operation_id).toBe("string");
      nextReference = `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
      return { data: avatarReceipt(nextReference), error: null };
    });

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );

    expect(result).toMatchObject({
      receipt: { profile: { avatarReference: nextReference } },
      cleanup: { status: "verified" },
    });
    expect(events).toHaveLength(4);
    expect(events[0]).toMatch(/^upload:.*\/avatar-[0-9a-f-]{36}\.jpg$/);
    expect(events[1]).toBe(`rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`);
    expect(events[2]).toBe(`remove:${OLD_STORAGE_KEY}`);
    expect(events[3]).toBe(`exists:${OLD_STORAGE_KEY}`);
  });

  test("recovers an ambiguous CAS as applied and never deletes the newly-current object", async () => {
    let nextReference = "";
    let stagedStorageKey = "";
    let operationId = "";
    let attempt = 0;
    const { client, events } = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      attempt += 1;
      if (attempt === 1) {
        operationId = String(args.p_next_avatar_operation_id);
        stagedStorageKey = `${USER_ID}/avatar-${operationId}.jpg`;
        nextReference = `profile-avatar://${stagedStorageKey}`;
        return { data: null, error: { message: "transport lost" } };
      }
      expect(args.p_next_avatar_operation_id).toBe(operationId);
      return { data: avatarReceipt(nextReference), error: null };
    });

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    expect(result).toMatchObject({
      receipt: {
        status: "applied",
        profile: { avatarReference: nextReference },
      },
      cleanup: { status: "verified" },
    });

    expect(events).toEqual([
      `upload:${stagedStorageKey}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `remove:${OLD_STORAGE_KEY}`,
      `exists:${OLD_STORAGE_KEY}`,
    ]);
    expect(events).not.toContain(`remove:${stagedStorageKey}`);
  });

  test("same-operation replay serializes with a delayed first commit without deleting the staged object", async () => {
    let currentReference = OLD_REFERENCE;
    let nextReference = "";
    let operationId = "";
    let attempt = 0;
    let resolveDelayedCommit: (() => void) | undefined;
    const delayedCommit = new Promise<void>((resolve) => {
      resolveDelayedCommit = resolve;
    });
    const { client, events } = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      attempt += 1;
      const currentOperationId = String(args.p_next_avatar_operation_id);
      if (attempt === 1) {
        operationId = currentOperationId;
        nextReference = `profile-avatar://${USER_ID}/avatar-${operationId}.jpg`;
        setTimeout(() => {
          if (currentReference === OLD_REFERENCE) currentReference = nextReference;
          resolveDelayedCommit?.();
        }, 0);
        return { data: null, error: { message: "response lost before commit" } };
      }

      expect(currentOperationId).toBe(operationId);
      if (currentReference === OLD_REFERENCE) {
        currentReference = nextReference;
        return { data: avatarReceipt(nextReference), error: null };
      }
      return {
        data: avatarReceipt(currentReference, {
          status: "conflict",
          reasonCode: "PROFILE_VERSION_CONFLICT",
          changes: { avatar: false },
        }),
        error: null,
      };
    });

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    await delayedCommit;

    expect(currentReference).toBe(nextReference);
    expect(result.receipt.profile.avatarReference).toBe(nextReference);
    expect(events.filter((event) => event === `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`))
      .toHaveLength(2);
    expect(events).not.toContain(
      `remove:${USER_ID}/avatar-${operationId}.jpg`,
    );
  });

  test("cleans a staged object only when the same-operation replay proves CAS did not apply", async () => {
    let stagedStorageKey = "";
    let attempt = 0;
    const { client, events } = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      attempt += 1;
      if (attempt === 1) {
        stagedStorageKey = `${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
        return { data: null, error: { message: "transport lost" } };
      }
      return {
        data: avatarReceipt("https://legacy.invalid/other.jpg", {
          status: "conflict",
          reasonCode: "PROFILE_VERSION_CONFLICT",
          changes: { avatar: false },
        }),
        error: null,
      };
    });

    await expect(uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.conflict });

    expect(events).toEqual([
      `upload:${stagedStorageKey}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `remove:${stagedStorageKey}`,
      `exists:${stagedStorageKey}`,
    ]);
  });

  test("recovers double ambiguity only when bounded readback proves the new marker is current", async () => {
    let stagedStorageKey = "";
    let nextReference = "";
    const { client, events } = avatarClient(async (functionName, args) => {
      if (functionName === PROFILE_AVATAR_COMPARE_AND_SET_RPC) {
        if (!stagedStorageKey) {
          stagedStorageKey = `${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
          nextReference = `profile-avatar://${stagedStorageKey}`;
        }
        return { data: null, error: { message: "transport lost" } };
      }
      expect(functionName).toBe("read_public_profile_summaries");
      return {
        data: [{ user_id: USER_ID, nickname: NICKNAME, avatar_url: nextReference }],
        error: null,
      };
    });

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    expect(result).toMatchObject({
      receipt: { profile: { avatarReference: nextReference } },
      cleanup: { status: "verified" },
    });
    expect(events).toEqual([
      `upload:${stagedStorageKey}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      "rpc:read_public_profile_summaries",
      `remove:${OLD_STORAGE_KEY}`,
      `exists:${OLD_STORAGE_KEY}`,
    ]);
    expect(events).not.toContain(`remove:${stagedStorageKey}`);
  });

  test("leaves both staged and old objects when double ambiguity cannot prove commit", async () => {
    for (const readbackAvatarReference of [
      OLD_REFERENCE,
      "https://legacy.invalid/third.jpg",
      undefined,
    ]) {
      let stagedStorageKey = "";
      const { client, events } = avatarClient(async (functionName, args) => {
        if (functionName === PROFILE_AVATAR_COMPARE_AND_SET_RPC) {
          if (!stagedStorageKey) {
            stagedStorageKey = `${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
          }
          return { data: null, error: { message: "transport lost" } };
        }
        if (readbackAvatarReference === undefined) {
          return { data: null, error: { message: "readback unavailable" } };
        }
        return {
          data: [{
            user_id: USER_ID,
            nickname: NICKNAME,
            avatar_url: readbackAvatarReference,
          }],
          error: null,
        };
      });

      await expect(uploadCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
        new Blob(["image"], { type: "image/jpeg" }),
      )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
      expect(events).toEqual([
        `upload:${stagedStorageKey}`,
        `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
        `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
        "rpc:read_public_profile_summaries",
      ]);
      expect(events.some((event) => event.startsWith("remove:"))).toBe(false);
    }
  });

  test("cleans malformed or wrong-path Storage success responses before any CAS", async () => {
    for (const uploadData of [
      null,
      {
        id: "22222222-2222-4222-8222-222222222222",
        path: `${USER_ID}/wrong.jpg`,
        fullPath: `profile-avatars/${USER_ID}/wrong.jpg`,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        path: "placeholder",
        fullPath: "placeholder",
        unexpected: true,
      },
    ]) {
      const events: string[] = [];
      let stagedKey = "";
      const client = {
        rpc: async () => {
          events.push("rpc");
          return { data: null, error: null };
        },
        storage: {
          from: () => ({
            upload: async (path: string) => {
              stagedKey = path;
              events.push(`upload:${path}`);
              const data = uploadData && "path" in uploadData && uploadData.path === "placeholder"
                ? { ...uploadData, path, fullPath: `profile-avatars/${path}` }
                : uploadData;
              return { data, error: null };
            },
            remove: async (paths: string[]) => {
              events.push(`remove:${paths.join(",")}`);
              return { data: paths, error: null };
            },
            exists: async (path: string) => {
              events.push(`exists:${path}`);
              return { data: false, error: { message: "not found" } };
            },
          }),
        },
      };

      await expect(uploadCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
        new Blob(["image"], { type: "image/jpeg" }),
      )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
      expect(events).toEqual([
        `upload:${stagedKey}`,
        `remove:${stagedKey}`,
        `exists:${stagedKey}`,
      ]);
    }
  });

  test("returns committed state with pending cleanup after bounded remove/readback uncertainty", async () => {
    const events: string[] = [];
    const client = {
      rpc: async (_functionName: string, args: Record<string, unknown>) => ({
        data: avatarReceipt(
          `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`,
        ),
        error: null,
      }),
      storage: {
        from: () => ({
          upload: async (path: string, body: ArrayBuffer) => {
            events.push(`upload:${path}`);
            expect(body).toBeInstanceOf(ArrayBuffer);
            return {
              data: {
                id: "22222222-2222-4222-8222-222222222222",
                path,
                fullPath: `profile-avatars/${path}`,
              },
              error: null,
            };
          },
          remove: async (paths: string[]) => {
            events.push(`remove:${paths.join(",")}`);
            throw new Error("private cleanup diagnostic");
          },
          exists: async (path: string) => {
            events.push(`exists:${path}`);
            return { data: true, error: null };
          },
        }),
      },
    };

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );

    expect(result.cleanup).toEqual({ status: "pending" });
    expect(events.filter((event) => event === `remove:${OLD_STORAGE_KEY}`)).toHaveLength(2);
    expect(events.filter((event) => event === `exists:${OLD_STORAGE_KEY}`)).toHaveLength(2);
    expect(String(result)).not.toContain("private cleanup diagnostic");
  });

  test("accepts only an exact absence readback after an explicit remove error", async () => {
    const events: string[] = [];
    const client = {
      rpc: async (_functionName: string, args: Record<string, unknown>) => ({
        data: avatarReceipt(
          `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`,
        ),
        error: null,
      }),
      storage: {
        from: () => ({
          upload: async (path: string) => ({
            data: {
              id: "22222222-2222-4222-8222-222222222222",
              path,
              fullPath: `profile-avatars/${path}`,
            },
            error: null,
          }),
          remove: async () => ({ data: null, error: { message: "remove failed" } }),
          exists: async (path: string) => {
            events.push(`exists:${path}`);
            return { data: false, error: { message: "not found" } };
          },
        }),
      },
    };

    const result = await uploadCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    expect(result.cleanup).toEqual({ status: "verified" });
    expect(events).toEqual([`exists:${OLD_STORAGE_KEY}`]);
  });

  test("keeps cleanup pending for malformed or contradictory existence responses", async () => {
    for (const existsResponse of [
      { data: false, error: null },
      { data: false, error: undefined },
      { data: false },
      { data: true, error: { message: "contradictory" } },
      { data: null, error: { message: "unknown" } },
      { data: false, error: { message: "not found" }, extra: true },
    ]) {
      let existsCalls = 0;
      const client = {
        rpc: async (_functionName: string, args: Record<string, unknown>) => ({
          data: avatarReceipt(
            `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`,
          ),
          error: null,
        }),
        storage: {
          from: () => ({
            upload: async (path: string) => ({
              data: {
                id: "22222222-2222-4222-8222-222222222222",
                path,
                fullPath: `profile-avatars/${path}`,
              },
              error: null,
            }),
            remove: async () => ({ data: [], error: null }),
            exists: async () => {
              existsCalls += 1;
              return existsResponse;
            },
          }),
        },
      };

      const result = await uploadCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
        new Blob(["image"], { type: "image/jpeg" }),
      );
      expect(result.cleanup, JSON.stringify(existsResponse)).toEqual({ status: "pending" });
      expect(existsCalls, JSON.stringify(existsResponse)).toBe(2);
    }
  });

  test("rejects empty, non-JPEG, and oversized avatar blobs before Storage", async () => {
    const events: string[] = [];
    const client = {
      rpc: async () => {
        events.push("rpc");
        return { data: null, error: null };
      },
      storage: {
        from: () => {
          events.push("storage");
          return {
            upload: async () => ({ data: null, error: null }),
            remove: async () => ({ data: null, error: null }),
            exists: async () => ({ data: false, error: null }),
          };
        },
      },
    };

    for (const content of [
      new Blob([], { type: "image/jpeg" }),
      new Blob(["not-jpeg"], { type: "image/png" }),
      new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
    ]) {
      await expect(uploadCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
        content,
      )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.invalidInput });
    }
    expect(events).toEqual([]);
  });

  test("clears the database reference before removing the old object, including ambiguous applied readback", async () => {
    let attempt = 0;
    const { client, events } = avatarClient(async (functionName) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      attempt += 1;
      if (attempt === 1) {
        return { data: null, error: { message: "transport lost" } };
      }
      return {
        data: avatarReceipt(null, {
          status: "conflict",
          reasonCode: "PROFILE_VERSION_CONFLICT",
          changes: { avatar: false },
        }),
        error: null,
      };
    });

    await expect(
      clearCurrentProfileAvatar(client, USER_ID, OLD_REFERENCE),
    ).resolves.toMatchObject({
      receipt: { profile: { avatarReference: null } },
      cleanup: { status: "verified" },
    });
    expect(events).toEqual([
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `remove:${OLD_STORAGE_KEY}`,
      `exists:${OLD_STORAGE_KEY}`,
    ]);
  });

  test("recovers a double-ambiguous clear only when bounded readback proves null", async () => {
    const { client, events } = avatarClient(async (functionName) => {
      if (functionName === PROFILE_AVATAR_COMPARE_AND_SET_RPC) {
        return { data: null, error: { message: "transport lost" } };
      }
      expect(functionName).toBe("read_public_profile_summaries");
      return {
        data: [{ user_id: USER_ID, nickname: NICKNAME, avatar_url: null }],
        error: null,
      };
    });

    await expect(clearCurrentProfileAvatar(
      client,
      USER_ID,
      OLD_REFERENCE,
    )).resolves.toMatchObject({
      receipt: { profile: { avatarReference: null } },
      cleanup: { status: "verified" },
    });
    expect(events).toEqual([
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      `rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`,
      "rpc:read_public_profile_summaries",
      `remove:${OLD_STORAGE_KEY}`,
      `exists:${OLD_STORAGE_KEY}`,
    ]);
  });

  test("does not clean the old object when a double-ambiguous clear readback is not null", async () => {
    for (const avatarReference of [OLD_REFERENCE, "https://legacy.invalid/third.jpg"]) {
      const { client, events } = avatarClient(async (functionName) => {
        if (functionName === PROFILE_AVATAR_COMPARE_AND_SET_RPC) {
          return { data: null, error: { message: "transport lost" } };
        }
        return {
          data: [{ user_id: USER_ID, nickname: NICKNAME, avatar_url: avatarReference }],
          error: null,
        };
      });
      await expect(clearCurrentProfileAvatar(
        client,
        USER_ID,
        OLD_REFERENCE,
      )).rejects.toMatchObject({ code: PROFILE_MUTATION_ERROR_CODE.unavailable });
      expect(events.some((event) => event.startsWith("remove:"))).toBe(false);
    }
  });

  test("replaces and clears an opaque legacy reference without treating it as an owned object", async () => {
    let replacementReference = "";
    const replacing = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      expect(args.p_expected_avatar_reference).toBe(UNTRUSTED_LEGACY_REFERENCE);
      replacementReference = `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
      return { data: avatarReceipt(replacementReference), error: null };
    });

    const replacementReceipt = await uploadCurrentProfileAvatar(
      replacing.client,
      USER_ID,
      UNTRUSTED_LEGACY_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    expect(replacementReceipt).toMatchObject({
      receipt: { profile: { avatarReference: replacementReference } },
      cleanup: { status: "not_required" },
    });
    expect(replacing.events).toHaveLength(2);
    expect(replacing.events.some((event) => event.startsWith("remove:"))).toBe(false);

    const clearing = avatarClient(async (functionName, args) => {
      expect(functionName).toBe(PROFILE_AVATAR_COMPARE_AND_SET_RPC);
      expect(args).toEqual({
        p_expected_avatar_reference: UNTRUSTED_LEGACY_REFERENCE,
        p_next_avatar_operation_id: null,
      });
      return { data: avatarReceipt(null), error: null };
    });
    await expect(clearCurrentProfileAvatar(
      clearing.client,
      USER_ID,
      UNTRUSTED_LEGACY_REFERENCE,
    )).resolves.toMatchObject({
      receipt: { profile: { avatarReference: null } },
      cleanup: { status: "not_required" },
    });
    expect(clearing.events).toEqual([`rpc:${PROFILE_AVATAR_COMPARE_AND_SET_RPC}`]);

    for (const repairableReference of ["", "legacy\nreference", "legacy\u007freference"]) {
      const repairable = avatarClient(async (_functionName, args) => {
        expect(args.p_expected_avatar_reference).toBe(repairableReference);
        return { data: avatarReceipt(null), error: null };
      });
      await expect(
        clearCurrentProfileAvatar(repairable.client, USER_ID, repairableReference),
      ).resolves.toMatchObject({
        receipt: { profile: { avatarReference: null } },
        cleanup: { status: "not_required" },
      });
    }
  });

  test("replaces and clears avatars even when the stored nickname is legacy noncanonical", async () => {
    const legacyNickname = "\u00a0legacy\nnickname\u00a0";
    let replacementReference = "";
    const replacing = avatarClient(async (_functionName, args) => {
      replacementReference = `profile-avatar://${USER_ID}/avatar-${args.p_next_avatar_operation_id}.jpg`;
      return {
        data: avatarReceipt(replacementReference, {
          profile: profileState(replacementReference, legacyNickname),
        }),
        error: null,
      };
    });
    const replacementResult = await uploadCurrentProfileAvatar(
      replacing.client,
      USER_ID,
      UNTRUSTED_LEGACY_REFERENCE,
      new Blob(["image"], { type: "image/jpeg" }),
    );
    expect(replacementResult).toMatchObject({
      receipt: {
        profile: {
          nickname: legacyNickname,
          avatarReference: replacementReference,
        },
      },
    });

    const clearing = avatarClient(async () => ({
      data: avatarReceipt(null, {
        profile: profileState(null, legacyNickname),
      }),
      error: null,
    }));
    await expect(clearCurrentProfileAvatar(
      clearing.client,
      USER_ID,
      UNTRUSTED_LEGACY_REFERENCE,
    )).resolves.toMatchObject({
      receipt: {
        profile: { nickname: legacyNickname, avatarReference: null },
      },
    });
  });
});

describe("profile caller source contracts", () => {
  test("invalidates every real profile display query prefix after a mutation", async () => {
    const invalidated: unknown[][] = [];
    const queryClient = {
      invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
        invalidated.push(queryKey);
      },
    } as unknown as Parameters<typeof invalidateProfileDisplayQueries>[0];

    await invalidateProfileDisplayQueries(queryClient, USER_ID);

    expect(invalidated).toEqual([
      ["user-profile", USER_ID],
      ["user-profile-identity", USER_ID],
      ["home-map-user-menu-avatar", USER_ID],
      ["review-feed"],
      ["review-feed-overlay"],
      ["restaurant-reviews"],
      ["leaderboard-users"],
    ]);
  });

  test("cache invalidation keys match their runtime query producers", () => {
    const cacheBoundary = source("lib/profile-display-cache.ts");
    const feedProducer = source("components/feed/FeedContent.tsx");
    const reviewProducer = source("components/restaurant/RestaurantDetailPanel.tsx");
    const leaderboardProducer = source("hooks/useLeaderboard.ts");

    expect(cacheBoundary).toContain('queryKey: ["review-feed"]');
    expect(cacheBoundary).toContain('queryKey: ["review-feed-overlay"]');
    expect(feedProducer).toContain("isOverlay ? 'review-feed-overlay' : 'review-feed'");
    expect(cacheBoundary).toContain('queryKey: ["restaurant-reviews"]');
    expect(reviewProducer).toContain("queryKey: ['restaurant-reviews', restaurant?.id, user?.id]");
    expect(cacheBoundary).toContain('queryKey: ["leaderboard-users"]');
    expect(leaderboardProducer).toContain("queryKey: ['leaderboard-users', period]");
    expect(cacheBoundary).not.toContain("review-feed-panel");
    expect(cacheBoundary).not.toContain("leaderboard-all-users");
  });

  test("runtime profile mutation callers use RPC helpers and never direct profiles CRUD", () => {
    const callerPaths = [
      "components/profile/NicknameSetupModal.tsx",
      "components/profile/ProfileModal.tsx",
      "components/mypage/MyPageSidebar.tsx",
      "app/mypage/profile/page.tsx",
    ];

    for (const path of callerPaths) {
      const caller = source(path);
      expect(caller, path).not.toMatch(/\.from\(["']profiles["']/);
      expect(caller, path).not.toContain(".update({ avatar_url:");
      expect(caller, path).not.toContain(".update({ nickname:");
    }

    expect(source("components/profile/NicknameSetupModal.tsx")).toContain(
      "updateCurrentProfileNickname(supabase, user.id, nickname.trim())",
    );
    expect(source("components/profile/ProfileModal.tsx")).toContain(
      "updateCurrentProfileNickname(",
    );
    for (const path of [
      "components/mypage/MyPageSidebar.tsx",
      "app/mypage/profile/page.tsx",
    ]) {
      const caller = source(path);
      expect(caller, path).toContain("uploadCurrentProfileAvatar(");
      expect(caller, path).toContain("clearCurrentProfileAvatar(");
    }

    for (const path of [
      "components/profile/NicknameSetupModal.tsx",
      "components/profile/ProfileModal.tsx",
      "components/mypage/MyPageSidebar.tsx",
      "app/mypage/profile/page.tsx",
    ]) {
      const caller = source(path);
      expect(caller, path).toContain(
        'import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";',
      );
      expect(caller, path).toContain(
        "invalidateProfileDisplayQueries(queryClient, user.id)",
      );
      expect(caller, path).not.toContain("review-feed-panel");
      expect(caller, path).not.toContain("leaderboard-all-users");
    }
  });

  test("password signup performs exact profile readback before privacy confirmation", () => {
    const onboarding = source("app/api/privacy/onboarding/route.ts");
    const signup = onboarding.slice(
      onboarding.indexOf("async function createPasswordAccount"),
      onboarding.indexOf("export async function GET"),
    );
    const readbackIndex = signup.indexOf("readSignupProfileState(");
    const readyIndex = signup.indexOf("isSignupProfileStateReady(signupProfileState)");
    const confirmIndex = signup.indexOf("confirmChallenge(");

    expect(readbackIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(readbackIndex);
    expect(confirmIndex).toBeGreaterThan(readyIndex);
    expect(signup.slice(readyIndex, confirmIndex)).toContain(
      "compensateFreshPasswordAccount(creationProvenance, signupClient)",
    );
    expect(source("components/auth/AuthModal.tsx")).not.toMatch(
      /\.from\(["']profiles["']\)[\s\S]{0,160}\.select\(["']nickname["']\)/,
    );
  });
});
