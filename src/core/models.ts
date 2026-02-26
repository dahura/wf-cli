export type Provider = "openai" | "anthropic" | "google" | "xai" | "cursor";
export type ModelKind = "chat" | "code" | "image" | "hybrid";
export type Capability =
  | "planning"
  | "coding"
  | "reviewing"
  | "fixing"
  | "completing";

export type ModelId =
  | "claude-4-sonnet"
  | "claude-4-sonnet-1m"
  | "claude-4.5-haiku"
  | "claude-4.5-opus"
  | "claude-4.5-sonnet"
  | "claude-4.6-opus"
  | "claude-4.6-opus-fast"
  | "composer-1"
  | "composer-1.5"
  | "gemini-2.5-flash"
  | "gemini-3-flash"
  | "gemini-3-pro"
  | "gemini-3-pro-image"
  | "gpt-5"
  | "gpt-5-fast"
  | "gpt-5-mini"
  | "gpt-5-codex"
  | "gpt-5.1-codex"
  | "gpt-5.1-codex-max"
  | "gpt-5.1-codex-mini"
  | "gpt-5.2"
  | "gpt-5.2-codex"
  | "gpt-5.3-codex"
  | "grok-code";

type ModelSpec = {
  provider: Provider;
  label: string;
  kind: ModelKind;
  pricing: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
};

const MODEL_CATALOG: Record<ModelId, ModelSpec> = {
  "claude-4.6-opus-fast": {
    provider: "anthropic",
    label: "Claude 4.6 Opus (Fast mode)",
    kind: "chat",
    pricing: { input: 15, output: 18.75, cacheWrite: 1.5, cacheRead: 75 },
  },
  "claude-4.6-opus": {
    provider: "anthropic",
    label: "Claude 4.6 Opus",
    kind: "chat",
    pricing: { input: 5, output: 6.25, cacheWrite: 0.5, cacheRead: 25 },
  },
  "claude-4.5-opus": {
    provider: "anthropic",
    label: "Claude 4.5 Opus",
    kind: "chat",
    pricing: { input: 5, output: 6.25, cacheWrite: 0.5, cacheRead: 25 },
  },
  "claude-4.5-sonnet": {
    provider: "anthropic",
    label: "Claude 4.5 Sonnet",
    kind: "chat",
    pricing: { input: 3, output: 3.75, cacheWrite: 0.3, cacheRead: 15 },
  },
  "claude-4-sonnet": {
    provider: "anthropic",
    label: "Claude 4 Sonnet",
    kind: "chat",
    pricing: { input: 3, output: 3.75, cacheWrite: 0.3, cacheRead: 15 },
  },
  "claude-4-sonnet-1m": {
    provider: "anthropic",
    label: "Claude 4 Sonnet 1M",
    kind: "chat",
    pricing: { input: 6, output: 7.5, cacheWrite: 0.6, cacheRead: 22.5 },
  },
  "claude-4.5-haiku": {
    provider: "anthropic",
    label: "Claude 4.5 Haiku",
    kind: "chat",
    pricing: { input: 1, output: 1.25, cacheWrite: 0.1, cacheRead: 5 },
  },
  "composer-1.5": {
    provider: "cursor",
    label: "Composer 1.5",
    kind: "code",
    pricing: { input: 3.5, output: 17.5, cacheWrite: 0, cacheRead: 0.35 },
  },
  "composer-1": {
    provider: "cursor",
    label: "Composer 1",
    kind: "code",
    pricing: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  },
  "gemini-3-pro-image": {
    provider: "google",
    label: "Gemini 3 Pro Image Preview",
    kind: "image",
    pricing: { input: 2, output: 12, cacheWrite: 0, cacheRead: 0.2 },
  },
  "gemini-3-pro": {
    provider: "google",
    label: "Gemini 3 Pro",
    kind: "chat",
    pricing: { input: 2, output: 12, cacheWrite: 0, cacheRead: 0.2 },
  },
  "gemini-3-flash": {
    provider: "google",
    label: "Gemini 3 Flash",
    kind: "chat",
    pricing: { input: 0.5, output: 3, cacheWrite: 0, cacheRead: 0.05 },
  },
  "gemini-2.5-flash": {
    provider: "google",
    label: "Gemini 2.5 Flash",
    kind: "chat",
    pricing: { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.03 },
  },
  "gpt-5.2": {
    provider: "openai",
    label: "GPT-5.2",
    kind: "hybrid",
    pricing: { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  },
  "gpt-5.2-codex": {
    provider: "openai",
    label: "GPT-5.2 Codex",
    kind: "code",
    pricing: { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  },
  "gpt-5.3-codex": {
    provider: "openai",
    label: "GPT-5.3 Codex",
    kind: "code",
    pricing: { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  },
  "gpt-5-fast": {
    provider: "openai",
    label: "GPT-5 Fast",
    kind: "hybrid",
    pricing: { input: 2.5, output: 20, cacheWrite: 0, cacheRead: 0.25 },
  },
  "gpt-5": {
    provider: "openai",
    label: "GPT-5",
    kind: "hybrid",
    pricing: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  },
  "gpt-5-codex": {
    provider: "openai",
    label: "GPT-5 Codex",
    kind: "code",
    pricing: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  },
  "gpt-5.1-codex": {
    provider: "openai",
    label: "GPT-5.1 Codex",
    kind: "code",
    pricing: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  },
  "gpt-5.1-codex-max": {
    provider: "openai",
    label: "GPT-5.1 Codex Max",
    kind: "code",
    pricing: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  },
  "gpt-5-mini": {
    provider: "openai",
    label: "GPT-5 Mini",
    kind: "hybrid",
    pricing: { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 },
  },
  "gpt-5.1-codex-mini": {
    provider: "openai",
    label: "GPT-5.1 Codex Mini",
    kind: "code",
    pricing: { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 },
  },
  "grok-code": {
    provider: "xai",
    label: "Grok Code",
    kind: "code",
    pricing: { input: 0.2, output: 1.5, cacheWrite: 0, cacheRead: 0.02 },
  },
};

type EnabledModels = Pick<
  typeof MODEL_CATALOG,
  | "claude-4.5-opus"
  | "claude-4.5-sonnet"
  | "claude-4.5-haiku"
  | "gpt-5.2"
  | "gpt-5.3-codex"
  | "composer-1"
>;

type EnabledModelId = keyof EnabledModels;

const MODEL_CAPABILITIES: Record<EnabledModelId, Capability[]> = {
  "claude-4.5-opus": ["planning", "reviewing", "completing"],
  "gpt-5.2": ["planning", "coding", "reviewing", "fixing", "completing"],
  "gpt-5.3-codex": ["planning", "coding", "reviewing", "fixing", "completing"],
  "claude-4.5-sonnet": ["coding", "fixing"],
  "composer-1": ["coding", "fixing"],
  "claude-4.5-haiku": ["coding", "fixing"],
};

export type EnabledModel = {
  id: EnabledModelId;
  capabilities: Capability[];
};

export function getEnabledModel(id: string): EnabledModel | null {
  if (!(id in MODEL_CATALOG)) return null;

  const typedId = id as EnabledModelId;
  if (!(typedId in MODEL_CAPABILITIES)) {
    throw new Error(`Model '${id}' is enabled but has no capabilities mapping.`);
  }

  return {
    id: typedId,
    capabilities: MODEL_CAPABILITIES[typedId],
  };
}

export function listEnabledModels(): EnabledModel[] {
  return (Object.keys(MODEL_CAPABILITIES) as EnabledModelId[]).map((id) => ({
    id,
    capabilities: MODEL_CAPABILITIES[id],
  }));
}

export function listEnabledModelIds(): EnabledModelId[] {
  return Object.keys(MODEL_CAPABILITIES) as EnabledModelId[];
}
