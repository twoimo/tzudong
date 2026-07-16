export type StoryboardAgentTestCommandCapability = () => unknown;

export type StoryboardAgentTestFixtureBinding = {
  executable: string;
  args: readonly string[];
  fixture: string;
};

const capabilityBindingsKey = Symbol.for(
  "tzudong.storyboard-agent.test-command-capability.bindings",
);
const capabilityBindings = (
  globalThis as {
    [key: symbol]:
      | WeakMap<
          StoryboardAgentTestCommandCapability,
          Readonly<StoryboardAgentTestFixtureBinding>
        >
      | undefined;
  }
)[capabilityBindingsKey] ??= new WeakMap<
  StoryboardAgentTestCommandCapability,
  Readonly<StoryboardAgentTestFixtureBinding>
>();

export function createBoundStoryboardAgentTestCommandCapability(
  binding: StoryboardAgentTestFixtureBinding,
): StoryboardAgentTestCommandCapability {
  const frozen = Object.freeze({ ...binding, args: Object.freeze([...binding.args]) });
  const capability = () => frozen;
  Object.defineProperty(capability, capabilityBindingsKey, {
    value: frozen,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(capability);
  capabilityBindings.set(capability, frozen);
  return capability;
}

export function getStoryboardAgentTestCommandBinding(
  capability: StoryboardAgentTestCommandCapability,
) {
  if (typeof capability !== "function" || !Object.isFrozen(capability)) return undefined;
  const registered = capabilityBindings.get(capability);
  if (registered) return registered;
  const attachedKey = Object.getOwnPropertySymbols(capability).find(
    (key) =>
      Symbol.keyFor(key) ===
      "tzudong.storyboard-agent.test-command-capability.bindings",
  );
  const attached = attachedKey
    ? (
        capability as StoryboardAgentTestCommandCapability & {
          [key: symbol]: unknown;
        }
      )[attachedKey]
    : undefined;
  const binding = attached ?? capability();
  if (!binding || typeof binding !== "object" || !Object.isFrozen(binding)) {
    return undefined;
  }
  const candidate = binding as Record<string, unknown>;
  if (
    typeof candidate.executable !== "string" ||
    !Array.isArray(candidate.args) ||
    !Object.isFrozen(candidate.args) ||
    candidate.args.some((arg: unknown) => typeof arg !== "string") ||
    typeof candidate.fixture !== "string"
  ) {
    return undefined;
  }
  return candidate as Readonly<StoryboardAgentTestFixtureBinding>;
}
