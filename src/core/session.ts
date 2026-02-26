import { join } from "path";
import type { Capability } from "./models";
import { exists, readJson, writeJson } from "./io";

export type SessionCommand =
  | "epic"
  | "plan"
  | "code"
  | "finish-code"
  | "verify"
  | "subagents"
  | "config"
  | "worker"
  | "workers"
  | "todo"
  | "context"
  | "review"
  | "fix"
  | "done"
  | "models"
  | "who-are-you"
  | "set-model"
  | "update-model";

export type SessionState = {
  model: string;
  capabilities: Capability[];
  locked: boolean;
  created_at: string;
  updated_at?: string;
};

export async function resolveStatePath(cwd: string): Promise<string> {
  const cursorStatePath = join(cwd, ".cursor", "session", "state.json");
  if (await exists(cursorStatePath)) return cursorStatePath;

  const opencodeStatePath = join(cwd, ".opencode", "session", "state.json");
  if (await exists(opencodeStatePath)) return opencodeStatePath;

  return cursorStatePath;
}

export async function initSession(statePath: string) {
  if (await exists(statePath)) return;

  const initialState: SessionState = {
    model: "unset",
    capabilities: [],
    locked: false,
    created_at: new Date().toISOString().slice(0, 10),
  };

  await writeJson(statePath, initialState);
}

export async function readSessionState(statePath: string): Promise<SessionState> {
  if (!(await exists(statePath))) {
    throw new Error("Session state not initialized.");
  }

  return readJson<SessionState>(statePath);
}

export async function applySessionUpdate(
  statePath: string,
  update: { model: string; capabilities: Capability[]; lock: boolean },
) {
  const prev = await readSessionState(statePath);
  const next: SessionState = {
    ...prev,
    model: update.model,
    capabilities: update.capabilities,
    locked: update.lock,
    updated_at: new Date().toISOString(),
  };

  await writeJson(statePath, next);
}

export function guardSession(
  state: SessionState,
  command: SessionCommand,
): { allowed: true } | { allowed: false; reason: string } {
  if (command === "who-are-you" || command === "set-model") return { allowed: true };

  if (state.model === "unset") {
    return {
      allowed: false,
      reason: "No model selected. Run /set-model <model> first.",
    };
  }

  if (state.locked && command === "update-model") {
    return {
      allowed: false,
      reason: "Model is locked for this session. Use /set-model <model>.",
    };
  }

  const capabilityMap: Record<string, Capability> = {
    epic: "planning",
    plan: "planning",
    code: "coding",
    "finish-code": "coding",
    review: "reviewing",
    fix: "fixing",
    done: "completing",
    worker: "coding",
  };

  const required = capabilityMap[command];
  if (!required) return { allowed: true };

  if (!state.capabilities.includes(required)) {
    return {
      allowed: false,
      reason: `Current model (${state.model}) cannot perform '${command}'.`,
    };
  }

  return { allowed: true };
}
