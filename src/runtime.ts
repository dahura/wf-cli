import { join } from "path";
import { availablePlanIds, getAllowedNextCommands, parseContextArgs, resolvePlan } from "./core/context";
import { listEnabledModels, getEnabledModel, type Capability } from "./core/models";
import {
  completePlan,
  createPlan,
  finishCode,
  startCoding,
  startFix,
  startReview,
} from "./core/plans";
import { validatePlanReadyForDone, validatePlanReadyForReview } from "./core/quality";
import {
  availableEpicIds,
  createEpic,
  getEpicStatus,
  linkPlanToEpic,
  readEpicContext,
  resumeEpicOrchestration,
  runEpicOrchestration,
  resolveEpic,
  stopEpicOrchestration,
} from "./core/epics";
import {
  applySessionUpdate,
  guardSession,
  initSession,
  readSessionState,
  resolveStatePath,
  type SessionCommand,
} from "./core/session";
import { exists, readJson, readText } from "./core/io";
import { verifyPlanQuality, type VerifyTarget } from "./core/verify";
import {
  applySubagentModelConfig,
  getSubagentCatalogPath,
  getSubagentConfigPath,
  initSubagentModelCatalog,
  initSubagentModelConfig,
  listSupportedSubagentModels,
  readSubagentModelCatalog,
  readSubagentModelConfig,
  runSubagentPreflight,
  validateSubagentModelConfig,
} from "./core/subagents";
import { deriveTodoLifecycle } from "./core/todo-lifecycle";
import { enqueuePlanCommand, publishPlanPhaseJobs } from "./core/dispatcher";
import { runWorkerLoop } from "./core/worker";
import { WORKER_ROLE_COMMAND_FILTERS, type WorkerRole } from "./core/distributed";
import { resolveExecutorRuntime } from "./core/routing";
import { getTodoLifecycle, markTodoAccepted, markTodoImplemented, rejectTodo } from "./core/todo";
import {
  getRuntimeConfigPath,
  isDistributedEnabled,
  readRuntimeConfig,
  shouldAutoStartWorkers,
  writeRuntimeConfig,
} from "./core/runtime-config";
import { ensureAutoWorkers } from "./core/auto-workers";

function parseVerifyArgs(values: string[]) {
  let planRef: string | undefined;
  let asJson = false;
  let target: VerifyTarget = "all";

  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];

    if (token === "--json") {
      asJson = true;
      continue;
    }

    if (token === "--target") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) {
        return { error: "Option '--target' requires value: all|review|done.", asJson };
      }
      if (value !== "all" && value !== "review" && value !== "done") {
        return { error: `Unknown target '${value}'. Allowed: all,review,done.`, asJson };
      }
      target = value as VerifyTarget;
      i += 1;
      continue;
    }

    if (token.startsWith("--target=")) {
      const value = token.slice("--target=".length);
      if (value !== "all" && value !== "review" && value !== "done") {
        return { error: `Unknown target '${value}'. Allowed: all,review,done.`, asJson };
      }
      target = value as VerifyTarget;
      continue;
    }

    if (token.startsWith("--")) {
      return { error: `Unknown option '${token}'.`, asJson };
    }

    if (planRef) {
      return {
        error: `Unexpected extra argument '${token}'. Provide only one plan reference.`,
        asJson,
      };
    }

    planRef = token;
  }

  return { planRef, asJson, target };
}

function parsePlanArgs(values: string[]) {
  let name: string | undefined;
  let epicRef: string | undefined;

  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];

    if (token === "--epic") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) {
        return { error: "Option '--epic' requires an epic id or slug." };
      }
      epicRef = value;
      i += 1;
      continue;
    }

    if (token.startsWith("--epic=")) {
      epicRef = token.slice("--epic=".length);
      continue;
    }

    if (token.startsWith("--")) {
      return { error: `Unknown option '${token}'.` };
    }

    if (name) {
      return { error: `Unexpected extra argument '${token}'.` };
    }
    name = token;
  }

  return { name, epicRef };
}

function parseEpicArgs(values: string[]) {
  const first = values[0];
  if (!first) {
    return { action: "invalid" as const, error: "Epic command requires an action or epic name." };
  }

  if (first === "context") {
    const epicRef = values[1];
    const asJson = values.includes("--json");
    if (!epicRef) {
      return { action: "invalid" as const, error: "Usage: wf epic context <id|slug> [--json]" };
    }
    return { action: "context" as const, epicRef, asJson };
  }

  if (first === "attach") {
    const epicRef = values[1];
    const planRef = values[2];
    if (!epicRef || !planRef) {
      return { action: "invalid" as const, error: "Usage: wf epic attach <epic-id> <plan-id>" };
    }
    return { action: "attach" as const, epicRef, planRef };
  }

  if (first === "list") {
    const asJson = values.includes("--json");
    return { action: "list" as const, asJson };
  }

  if (first === "run" || first === "status" || first === "resume" || first === "stop" || first === "watch") {
    let epicRef: string | undefined;
    let asJson = false;
    let autoWorkers: boolean | undefined;
    for (let i = 1; i < values.length; i += 1) {
      const token = values[i];
      if (!token) continue;
      if (token === "--json") {
        asJson = true;
        continue;
      }
      if (token === "--auto-workers") {
        autoWorkers = true;
        continue;
      }
      if (token === "--no-auto-workers") {
        autoWorkers = false;
        continue;
      }
      if (token.startsWith("--")) {
        return {
          action: "invalid" as const,
          error: `Unknown option '${token}'.`,
        };
      }
      if (epicRef) {
        return {
          action: "invalid" as const,
          error: `Unexpected extra argument '${token}'.`,
        };
      }
      epicRef = token;
    }
    if (!epicRef) {
      return {
        action: "invalid" as const,
        error: `Usage: wf epic ${first} <id|slug> [--json]`,
      };
    }
    return { action: first, epicRef, asJson, autoWorkers } as const;
  }

  if (first === "create") {
    const name = values[1];
    if (!name) {
      return { action: "invalid" as const, error: "Usage: wf epic create \"<name>\"" };
    }
    return { action: "create" as const, name };
  }

  if (first.startsWith("--")) {
    return {
      action: "invalid" as const,
      error: `Unknown flag '${first}'. Usage: wf epic <run|resume|status|stop|list|context|attach|"<name>">`,
    };
  }
  return { action: "create" as const, name: first };
}

function parseSubagentsArgs(values: string[]) {
  const action = values[0] ?? "show-models";
  const asJson = values.includes("--json");
  const allowed = new Set([
    "init-models",
    "init-model-catalog",
    "validate-models",
    "show-models",
    "apply-models",
    "list-models",
  ]);
  if (!allowed.has(action)) {
    return { error: `Unknown subagents action '${action}'.` };
  }
  return { action, asJson };
}

function parseWorkerArgs(values: string[]) {
  let role: keyof typeof WORKER_ROLE_COMMAND_FILTERS | undefined;
  let runtime = "cursor";
  let workerId = `worker-${process.pid}`;
  let pollMs = 1500;
  let leaseMs = 5 * 60 * 1000;
  let maxJobs: number | undefined;

  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];
    if (!token) continue;

    if (!role && !token.startsWith("--")) {
      if (!(token in WORKER_ROLE_COMMAND_FILTERS)) {
        return {
          error: `Unknown worker role '${token}'. Allowed: ${Object.keys(WORKER_ROLE_COMMAND_FILTERS).join(", ")}`,
        };
      }
      role = token as keyof typeof WORKER_ROLE_COMMAND_FILTERS;
      continue;
    }

    if (token === "--runtime") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) return { error: "Option '--runtime' requires value." };
      runtime = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--runtime=")) {
      runtime = token.slice("--runtime=".length);
      continue;
    }

    if (token === "--id") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) return { error: "Option '--id' requires value." };
      workerId = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--id=")) {
      workerId = token.slice("--id=".length);
      continue;
    }

    if (token === "--poll-ms") {
      const value = Number(values[i + 1]);
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--poll-ms' requires positive integer value." };
      pollMs = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--poll-ms=")) {
      const value = Number(token.slice("--poll-ms=".length));
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--poll-ms' requires positive integer value." };
      pollMs = value;
      continue;
    }

    if (token === "--lease-ms") {
      const value = Number(values[i + 1]);
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--lease-ms' requires positive integer value." };
      leaseMs = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--lease-ms=")) {
      const value = Number(token.slice("--lease-ms=".length));
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--lease-ms' requires positive integer value." };
      leaseMs = value;
      continue;
    }

    if (token === "--max-jobs") {
      const value = Number(values[i + 1]);
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--max-jobs' requires positive integer value." };
      maxJobs = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--max-jobs=")) {
      const value = Number(token.slice("--max-jobs=".length));
      if (!Number.isFinite(value) || value <= 0) return { error: "Option '--max-jobs' requires positive integer value." };
      maxJobs = value;
      continue;
    }

    return { error: `Unknown option '${token}'.` };
  }

  if (!role) {
    return {
      error: `Worker role is required. Usage: wf worker <${Object.keys(WORKER_ROLE_COMMAND_FILTERS).join("|")}> [--max-jobs N]`,
    };
  }

  return { role, runtime, workerId, pollMs, leaseMs, maxJobs };
}

function parseBooleanToken(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return null;
}

function parseConfigArgs(values: string[]) {
  const action = values[0] ?? "show";
  const asJson = values.includes("--json");
  if (action !== "show" && action !== "init" && action !== "set") {
    return { error: `Unknown config action '${action}'.` };
  }
  if (action !== "set") {
    return { action, asJson } as const;
  }
  const key = values[1];
  const rawValue = values[2];
  if (!key || !rawValue) {
    return { error: "Usage: wf config set <distributed|auto-workers> <true|false> [--json]" };
  }
  if (key !== "distributed" && key !== "auto-workers") {
    return { error: `Unknown config key '${key}'. Allowed: distributed, auto-workers.` };
  }
  const parsed = parseBooleanToken(rawValue);
  if (parsed === null) {
    return { error: `Invalid boolean value '${rawValue}'. Use true|false.` };
  }
  return { action, asJson, key, value: parsed } as const;
}

function parseTodoArgs(values: string[]) {
  const action = values[0];
  if (!action || (action !== "list" && action !== "implemented" && action !== "accept" && action !== "reject")) {
    return { error: "Usage: wf todo <list|implemented|accept|reject> ..." };
  }

  let asJson = false;
  let planRef: string | undefined;
  let todoId: string | undefined;
  let test = "";
  let output = "";
  let note = "";

  for (let i = 1; i < values.length; i += 1) {
    const token = values[i];

    if (token === "--json") {
      asJson = true;
      continue;
    }
    if (token === "--test") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) return { error: "Option '--test' requires value." };
      test = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--test=")) {
      test = token.slice("--test=".length);
      continue;
    }
    if (token === "--output") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) return { error: "Option '--output' requires value." };
      output = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--output=")) {
      output = token.slice("--output=".length);
      continue;
    }
    if (token === "--note" || token === "--reason") {
      const value = values[i + 1];
      if (!value || value.startsWith("--")) return { error: `Option '${token}' requires value.` };
      note = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--note=")) {
      note = token.slice("--note=".length);
      continue;
    }
    if (token.startsWith("--reason=")) {
      note = token.slice("--reason=".length);
      continue;
    }

    if (token.startsWith("--")) {
      return { error: `Unknown option '${token}'.` };
    }

    if (!planRef) {
      planRef = token;
      continue;
    }
    if (!todoId) {
      todoId = token;
      continue;
    }
    return { error: `Unexpected extra argument '${token}'.` };
  }

  if (!planRef) {
    return { error: `Plan reference is required. Usage: wf todo ${action} <plan> [todo-id]` };
  }
  if ((action === "implemented" || action === "accept" || action === "reject") && !todoId) {
    return { error: `TODO ID is required. Usage: wf todo ${action} <plan> <todo-id>` };
  }
  if (action === "implemented" && (!test || !output)) {
    return {
      error:
        "wf todo implemented requires --test and --output. Example: wf todo implemented 12 T1 --test \"bun test ...\" --output \"1 pass\"",
    };
  }

  return { action, asJson, planRef, todoId, test, output, note } as const;
}

function hasAnyCapability(current: Capability[], required: Capability[]): boolean {
  return required.some((capability) => current.includes(capability));
}

export async function runRuntime(rawArgs: string[]) {
  const cwd = process.cwd();
  const statePath = await resolveStatePath(cwd);
  await initSession(statePath);

  const command = rawArgs[0] as SessionCommand;
  const commandArgs = rawArgs.slice(1);
  const arg = commandArgs[0];

  if (command === "who-are-you") {
    const state = await readSessionState(statePath);
    console.log(`Model: ${state.model}`);
    console.log(`Capabilities: ${state.capabilities.join(", ")}`);
    process.exit(0);
  }

  if (command === "models") {
    const state = await readSessionState(statePath);
    const action =
      !state.model || state.model === "unset" || state.locked
        ? "set-model"
        : "update-model";

    const models = listEnabledModels();
    console.log("## Available models\n");
    console.log(`Current model: ${state.model || "unset"}\n`);
    for (const model of models) {
      console.log(`${model.id}`);
      console.log(`Capabilities: ${model.capabilities.join(", ")}`);
      console.log(`Action: /${action} ${model.id}\n`);
    }
    process.exit(0);
  }

  if (command === "context") {
    const parsed = parseContextArgs(commandArgs);
    if ("error" in parsed) {
      const payload = { ok: false, error: "INVALID_ARGS", message: parsed.error };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ ${parsed.error}`);
      }
      process.exit(1);
    }

    if (!parsed.planRef) {
      const payload = {
        ok: false,
        error: "INVALID_ARGS",
        message:
          "Plan reference is required. Usage: wf context <id|slug> [--json] [--include=plan,todo,review,evidence,state,epic]",
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ ${payload.message}`);
      }
      process.exit(1);
    }

    const resolved = await resolvePlan(cwd, parsed.planRef);
    if (!resolved) {
      const payload = {
        ok: false,
        error: "PLAN_NOT_FOUND",
        input: parsed.planRef,
        available_ids: await availablePlanIds(cwd),
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ Plan '${parsed.planRef}' not found.`);
      }
      process.exit(1);
    }

    const files = {
      plan: join("plans", resolved.dirName, "plan.md"),
      todo: join("plans", resolved.dirName, "todo.md"),
      review: join("plans", resolved.dirName, "review.md"),
      evidence: join("plans", resolved.dirName, "evidence.md"),
      state: join("plans", resolved.dirName, "state.json"),
    };

    const state = (await exists(files.state))
      ? (await readJson<{ phase?: string; epic_id?: string }>(files.state))
      : {};

    const phase = state.phase ?? "unknown";
    const epicId = state.epic_id;
    const content: Partial<
      Record<
        "plan" | "todo" | "review" | "evidence" | "state" | "epic" | "todo_lifecycle",
        string | object | null
      >
    > = {};

    if (parsed.include.has("plan")) {
      content.plan = (await exists(files.plan)) ? await readText(files.plan) : null;
    }
    if (parsed.include.has("todo")) {
      content.todo = (await exists(files.todo)) ? await readText(files.todo) : null;
    }
    if (parsed.include.has("review")) {
      content.review = (await exists(files.review))
        ? await readText(files.review)
        : null;
    }
    if (parsed.include.has("evidence")) {
      content.evidence = (await exists(files.evidence))
        ? await readText(files.evidence)
        : null;
    }
    if (parsed.include.has("state")) {
      content.state = (await exists(files.state))
        ? ((await readJson(files.state)) as object)
        : null;
    }
    if (parsed.include.has("epic")) {
      if (!epicId) {
        content.epic = null;
      } else {
        const epic = await resolveEpic(cwd, epicId);
        content.epic = epic ? join("epics", epic.dirName) : epicId;
      }
    }

    if (typeof content.todo === "string") {
      const reviewContent = typeof content.review === "string" ? content.review : "";
      content.todo_lifecycle = deriveTodoLifecycle(content.todo, reviewContent);
    }

    const payload = {
      ok: true,
      input: parsed.planRef,
      id: resolved.id,
      resolved_plan_dir: join("plans", resolved.dirName),
      phase,
      ...(epicId ? { epic_id: epicId } : {}),
      allowed_next_commands: getAllowedNextCommands(phase),
      files,
      ...(Object.keys(content).length > 0 ? { content } : {}),
    };

    if (parsed.asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Plan: ${payload.resolved_plan_dir}`);
      console.log(`Phase: ${phase}`);
      console.log(
        `Allowed next commands: ${payload.allowed_next_commands.join(", ") || "none"}`,
      );
    }
    process.exit(0);
  }

  if (command === "verify") {
    const parsed = parseVerifyArgs(commandArgs);
    if ("error" in parsed) {
      const payload = { ok: false, error: "INVALID_ARGS", message: parsed.error };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ ${parsed.error}`);
      }
      process.exit(1);
    }

    if (!parsed.planRef) {
      const payload = {
        ok: false,
        error: "INVALID_ARGS",
        message:
          "Plan reference is required. Usage: wf verify <id|slug> [--target=all|review|done] [--json]",
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ ${payload.message}`);
      }
      process.exit(1);
    }

    const plan = await resolvePlan(cwd, parsed.planRef);
    if (!plan) {
      const payload = {
        ok: false,
        error: "PLAN_NOT_FOUND",
        input: parsed.planRef,
        available_ids: await availablePlanIds(cwd),
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ Plan '${parsed.planRef}' not found.`);
      }
      process.exit(1);
    }

    const verification = await verifyPlanQuality(plan.dirPath, parsed.target);
    const payload = {
      ok: verification.ok,
      input: parsed.planRef,
      id: plan.id,
      resolved_plan_dir: join("plans", plan.dirName),
      target: parsed.target,
      checks: verification.checks,
    };

    if (parsed.asJson) {
      if (verification.ok) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.error(JSON.stringify(payload, null, 2));
      }
    } else {
      console.log(`Plan: ${payload.resolved_plan_dir}`);
      console.log(`Target: ${parsed.target}`);
      const review = verification.checks.review;
      if (review) {
        console.log(`- review gate: ${review.ok ? "pass" : "fail"}`);
        for (const error of review.errors) {
          console.log(`  - ${error}`);
        }
      }
      const done = verification.checks.done;
      if (done) {
        console.log(`- done gate: ${done.ok ? "pass" : "fail"}`);
        for (const error of done.errors) {
          console.log(`  - ${error}`);
        }
      }
    }

    process.exit(verification.ok ? 0 : 1);
  }

  if (command === "config") {
    const parsed = parseConfigArgs(commandArgs);
    if ("error" in parsed) {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }

    if (parsed.action === "init") {
      const config = await writeRuntimeConfig(cwd, {});
      if (parsed.asJson) {
        console.log(
          JSON.stringify({ ok: true, path: getRuntimeConfigPath(cwd), config, created: true }, null, 2),
        );
      } else {
        console.log(`✅ Runtime config initialized at ${getRuntimeConfigPath(cwd)}.`);
      }
      process.exit(0);
    }

    if (parsed.action === "show") {
      const config = await readRuntimeConfig(cwd);
      if (parsed.asJson) {
        console.log(JSON.stringify({ ok: true, path: getRuntimeConfigPath(cwd), config }, null, 2));
      } else {
        console.log(`Config: ${getRuntimeConfigPath(cwd)}`);
        console.log(JSON.stringify(config, null, 2));
      }
      process.exit(0);
    }

    const patch =
      parsed.key === "distributed"
        ? { distributed: parsed.value }
        : { auto_start_workers: parsed.value };
    const config = await writeRuntimeConfig(cwd, patch);
    if (parsed.asJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: "set",
            key: parsed.key,
            value: parsed.value,
            path: getRuntimeConfigPath(cwd),
            config,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`✅ Updated ${parsed.key}=${String(parsed.value)} in ${getRuntimeConfigPath(cwd)}.`);
    }
    process.exit(0);
  }

  if (command === "epic") {
    const parsed = parseEpicArgs(commandArgs);
    if (parsed.action === "invalid") {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }

    if (parsed.action === "create") {
      const state = await readSessionState(statePath);
      const permission = guardSession(state, "epic");
      if (!permission.allowed) {
        console.error(`❌ ${permission.reason}`);
        process.exit(1);
      }
      try {
        const epic = await createEpic(parsed.name);
        console.log(`✅ Epic ${epic.number} created (${epic.slug}).`);
        process.exit(0);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }

    if (parsed.action === "list") {
      const ids = await availableEpicIds(cwd);
      if (parsed.asJson) {
        console.log(JSON.stringify({ ok: true, epic_ids: ids }, null, 2));
      } else {
        console.log(ids.length > 0 ? ids.join("\n") : "No epics found.");
      }
      process.exit(0);
    }

    if (parsed.action === "run") {
      const state = await readSessionState(statePath);
      const permission = guardSession(state, "epic");
      if (!permission.allowed) {
        console.error(`❌ ${permission.reason}`);
        process.exit(1);
      }
      const preflight = await runSubagentPreflight(cwd);
      if (!preflight.ok) {
        const message =
          "Subagent preflight failed. Fix agent templates/models before running epic orchestration.";
        if (parsed.asJson) {
          console.error(
            JSON.stringify(
              {
                ok: false,
                error: "SUBAGENT_PREFLIGHT_FAILED",
                message,
                errors: preflight.errors,
                warnings: preflight.warnings,
                roles: preflight.roles,
              },
              null,
              2,
            ),
          );
        } else {
          console.error(`❌ ${message}`);
          for (const error of preflight.errors) {
            console.error(`  - ${error}`);
          }
          for (const warning of preflight.warnings) {
            console.error(`  - WARN: ${warning}`);
          }
          console.error(
            "  Suggested fix: bun run wf sync --reseed && bun run wf sync && bun run wf subagents validate-models --json",
          );
        }
        process.exit(1);
      }
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      try {
        let autoWorkersSummary:
          | {
              started: Array<{ role: string; runtime: string; pid: number }>;
              already_running: Array<{ role: string; runtime: string; pid: number }>;
              failed: Array<{ role: string; runtime: string; error: string }>;
              skipped: Array<{ role: string; runtime: string; reason: string }>;
            }
          | undefined;
        const enableAutoWorkers = await shouldAutoStartWorkers(cwd, parsed.autoWorkers);
        if (enableAutoWorkers) {
          autoWorkersSummary = await ensureAutoWorkers(cwd);
        }
        const run = await runEpicOrchestration(epic);
        if (parsed.asJson) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                action: "run",
                epic_id: epic.id,
                created_plans: run.created_plans,
                total_plans: run.total_plans,
                status: run.status,
                summary: run.summary,
                plans: run.plans,
                ...(autoWorkersSummary ? { auto_workers: autoWorkersSummary } : {}),
              },
              null,
              2,
            ),
          );
        } else {
          console.log(`✅ Epic ${epic.id} orchestration started.`);
          console.log(`- ${run.summary}`);
          if (autoWorkersSummary) {
            console.log(
              `- Auto workers: started=${autoWorkersSummary.started.length}, already_running=${autoWorkersSummary.already_running.length}, failed=${autoWorkersSummary.failed.length}, skipped=${autoWorkersSummary.skipped.length}`,
            );
          }
          if (run.plans.length > 0) {
            console.log("\nPlans to execute:");
            run.plans.forEach((p) => console.log(`  [${p.id}] ${p.dir} — phase: ${p.phase}`));
          }
        }
        process.exit(0);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }

    if (parsed.action === "status") {
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      const status = await getEpicStatus(epic);
      if (parsed.asJson) {
        console.log(JSON.stringify({ ok: true, ...status }, null, 2));
      } else {
        console.log(`Epic: ${status.dir}`);
        console.log(`Phase: ${status.epic_phase}`);
        console.log(`Orchestration: ${status.orchestration.status}`);
        console.log(`Plans total: ${status.total_plans}`);
      }
      process.exit(0);
    }

    if (parsed.action === "resume") {
      const state = await readSessionState(statePath);
      const permission = guardSession(state, "epic");
      if (!permission.allowed) {
        console.error(`❌ ${permission.reason}`);
        process.exit(1);
      }
      const preflight = await runSubagentPreflight(cwd);
      if (!preflight.ok) {
        const message =
          "Subagent preflight failed. Fix agent templates/models before resuming orchestration.";
        if (parsed.asJson) {
          console.error(
            JSON.stringify(
              {
                ok: false,
                error: "SUBAGENT_PREFLIGHT_FAILED",
                message,
                errors: preflight.errors,
                warnings: preflight.warnings,
                roles: preflight.roles,
              },
              null,
              2,
            ),
          );
        } else {
          console.error(`❌ ${message}`);
          for (const error of preflight.errors) {
            console.error(`  - ${error}`);
          }
          for (const warning of preflight.warnings) {
            console.error(`  - WARN: ${warning}`);
          }
          console.error(
            "  Suggested fix: bun run wf sync --reseed && bun run wf sync && bun run wf subagents validate-models --json",
          );
        }
        process.exit(1);
      }
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      let autoWorkersSummary:
        | {
            started: Array<{ role: string; runtime: string; pid: number }>;
            already_running: Array<{ role: string; runtime: string; pid: number }>;
            failed: Array<{ role: string; runtime: string; error: string }>;
            skipped: Array<{ role: string; runtime: string; reason: string }>;
          }
        | undefined;
      const enableAutoWorkers = await shouldAutoStartWorkers(cwd, parsed.autoWorkers);
      if (enableAutoWorkers) {
        autoWorkersSummary = await ensureAutoWorkers(cwd);
      }
      const resumed = await resumeEpicOrchestration(epic);
      if (parsed.asJson) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              action: "resume",
              epic_id: epic.id,
              ...resumed,
              ...(autoWorkersSummary ? { auto_workers: autoWorkersSummary } : {}),
            },
            null,
            2,
          ),
        );
      } else {
        console.log(resumed.resumed ? `✅ ${resumed.message}` : `ℹ️ ${resumed.message}`);
        if (autoWorkersSummary) {
          console.log(
            `- Auto workers: started=${autoWorkersSummary.started.length}, already_running=${autoWorkersSummary.already_running.length}, failed=${autoWorkersSummary.failed.length}, skipped=${autoWorkersSummary.skipped.length}`,
          );
        }
      }
      process.exit(0);
    }

    if (parsed.action === "stop") {
      const state = await readSessionState(statePath);
      const permission = guardSession(state, "epic");
      if (!permission.allowed) {
        console.error(`❌ ${permission.reason}`);
        process.exit(1);
      }
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      try {
        await stopEpicOrchestration(epic);
        if (parsed.asJson) {
          console.log(JSON.stringify({ ok: true, action: "stop", epic_id: epic.id }, null, 2));
        } else {
          console.log(`✅ Epic ${epic.id} orchestration paused.`);
        }
        process.exit(0);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }

    if (parsed.action === "context") {
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        const payload = {
          ok: false,
          error: "EPIC_NOT_FOUND",
          input: parsed.epicRef,
          available_ids: await availableEpicIds(cwd),
        };
        if (parsed.asJson) {
          console.error(JSON.stringify(payload, null, 2));
        } else {
          console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        }
        process.exit(1);
      }

      const data = await readEpicContext(epic.dirPath);
      const payload = {
        ok: true,
        input: parsed.epicRef,
        id: epic.id,
        resolved_epic_dir: join("epics", epic.dirName),
        files: {
          epic: join("epics", epic.dirName, "epic.md"),
          plans_map: join("epics", epic.dirName, "plans-map.yaml"),
          state: join("epics", epic.dirName, "state.json"),
          report: join("epics", epic.dirName, "report.md"),
        },
        content: data,
      };
      if (parsed.asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Epic: ${payload.resolved_epic_dir}`);
        console.log(`Plans: ${data.state.plan_ids.length}`);
      }
      process.exit(0);
    }

    if (parsed.action === "attach") {
      const state = await readSessionState(statePath);
      const permission = guardSession(state, "epic");
      if (!permission.allowed) {
        console.error(`❌ ${permission.reason}`);
        process.exit(1);
      }
      const epic = await resolveEpic(cwd, parsed.epicRef);
      const plan = await resolvePlan(cwd, parsed.planRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      if (!plan) {
        console.error(`❌ Plan '${parsed.planRef}' not found.`);
        process.exit(1);
      }
      await linkPlanToEpic(epic.dirPath, plan.dirName);
      console.log(`✅ Linked plan ${plan.id} to epic ${epic.id}.`);
      process.exit(0);
    }

    if (parsed.action === "watch") {
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      const context = await readEpicContext(epic.dirPath);
      const planDirNames = context.state.plan_ids;

      const phases: Record<string, string> = {};
      for (const dirName of planDirNames) {
        const planStatePath = join(cwd, "plans", dirName, "state.json");
        if (await exists(planStatePath)) {
          const s = await readJson<{ phase?: string }>(planStatePath);
          phases[dirName] = s.phase ?? "unknown";
        }
      }

      console.log(`Watching epic ${epic.id} (${planDirNames.length} plan(s)). Press Ctrl-C to stop.\n`);
      for (const [dirName, phase] of Object.entries(phases)) {
        console.log(`  [init] plan ${dirName.slice(0, 2)} → ${phase}`);
      }
      console.log();

      process.on("SIGINT", () => {
        console.log("\nWatch stopped.");
        process.exit(0);
      });

      while (true) {
        await Bun.sleep(3000);
        for (const dirName of planDirNames) {
          const planStatePath = join(cwd, "plans", dirName, "state.json");
          if (!(await exists(planStatePath))) continue;
          const s = await readJson<{ phase?: string }>(planStatePath);
          const newPhase = s.phase ?? "unknown";
          if (newPhase !== (phases[dirName] ?? "unknown")) {
            phases[dirName] = newPhase;
            const ts = new Date().toTimeString().slice(0, 8);
            console.log(`[${ts}] plan ${dirName.slice(0, 2)} → ${newPhase}`);
          }
        }
      }
    }
  }

  if (command === "subagents") {
    const parsed = parseSubagentsArgs(commandArgs);
    if ("error" in parsed) {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }

    if (parsed.action === "init-models") {
      const result = await initSubagentModelConfig(cwd);
      await initSubagentModelCatalog(cwd);
      const message = result.created
        ? `✅ Created ${getSubagentConfigPath(cwd)}`
        : `ℹ️ Config already exists: ${getSubagentConfigPath(cwd)}`;
      console.log(message);
      process.exit(0);
    }

    if (parsed.action === "init-model-catalog") {
      const result = await initSubagentModelCatalog(cwd);
      const message = result.created
        ? `✅ Created ${getSubagentCatalogPath(cwd)}`
        : `ℹ️ Catalog already exists: ${getSubagentCatalogPath(cwd)}`;
      console.log(message);
      process.exit(0);
    }

    const config = await readSubagentModelConfig(cwd);
    const catalog = await readSubagentModelCatalog(cwd);
    const validation = validateSubagentModelConfig(config, catalog);

    if (parsed.action === "validate-models") {
      if (parsed.asJson) {
        const payload = {
          ok: validation.ok,
          path: getSubagentConfigPath(cwd),
          catalog_path: getSubagentCatalogPath(cwd),
          errors: validation.errors,
          warnings: validation.warnings,
        };
        if (validation.ok) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.error(JSON.stringify(payload, null, 2));
        }
      } else if (validation.ok) {
        console.log("✅ Subagent model config is valid.");
        for (const warning of validation.warnings) {
          console.log(`⚠️ ${warning}`);
        }
      } else {
        console.error("❌ Subagent model config is invalid:");
        for (const error of validation.errors) {
          console.error(`  - ${error}`);
        }
        for (const warning of validation.warnings) {
          console.error(`  - WARN: ${warning}`);
        }
      }
      process.exit(validation.ok ? 0 : 1);
    }

    if (parsed.action === "show-models") {
      if (parsed.asJson) {
        console.log(JSON.stringify({ ok: true, path: getSubagentConfigPath(cwd), config }, null, 2));
      } else {
        console.log(`Config: ${getSubagentConfigPath(cwd)}`);
        console.log(JSON.stringify(config, null, 2));
      }
      process.exit(0);
    }

    if (parsed.action === "list-models") {
      const models = listSupportedSubagentModels(catalog);
      if (parsed.asJson) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              catalog_path: getSubagentCatalogPath(cwd),
              recommended: catalog.recommended,
              custom: catalog.custom,
              models,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`Catalog: ${getSubagentCatalogPath(cwd)}`);
        console.log("Recommended models:");
        for (const model of catalog.recommended) {
          console.log(`- ${model}`);
        }
        if (catalog.custom.length > 0) {
          console.log("\nCustom models:");
          for (const model of catalog.custom) {
            console.log(`- ${model}`);
          }
        } else {
          console.log("\nCustom models: none");
        }
        console.log("\nAll available model ids:");
        for (const model of models) {
          console.log(`- ${model}`);
        }
      }
      process.exit(0);
    }

    if (parsed.action === "apply-models") {
      if (!validation.ok) {
        console.error("❌ Subagent model config is invalid:");
        for (const error of validation.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }
      const result = await applySubagentModelConfig(cwd, config, catalog);
      if (parsed.asJson) {
        console.log(
          JSON.stringify({ ok: true, applied: result.applied, warnings: validation.warnings }, null, 2),
        );
      } else {
        console.log("✅ Applied subagent models:");
        for (const [role, model] of Object.entries(result.applied)) {
          console.log(`- ${role}: ${model}`);
        }
        for (const warning of validation.warnings) {
          console.log(`⚠️ ${warning}`);
        }
      }
      process.exit(0);
    }
  }

  if (command === "todo") {
    const parsed = parseTodoArgs(commandArgs);
    if ("error" in parsed) {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }

    const plan = await resolvePlan(cwd, parsed.planRef);
    if (!plan) {
      const payload = {
        ok: false,
        error: "PLAN_NOT_FOUND",
        input: parsed.planRef,
        available_ids: await availablePlanIds(cwd),
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ Plan '${parsed.planRef}' not found.`);
      }
      process.exit(1);
    }

    const state = await readSessionState(statePath);

    try {
      if (parsed.action === "list") {
        const result = await getTodoLifecycle(plan.dirPath);
        const payload = {
          ok: true,
          action: "list",
          input: parsed.planRef,
          id: plan.id,
          resolved_plan_dir: join("plans", plan.dirName),
          phase: result.phase,
          lifecycle: result.lifecycle,
        };
        if (parsed.asJson) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`Plan: ${payload.resolved_plan_dir}`);
          console.log(`Phase: ${payload.phase}`);
          for (const item of payload.lifecycle) {
            console.log(`- [${item.id}] ${item.status} (${item.owner}) — ${item.text}`);
          }
        }
        process.exit(0);
      }

      if (parsed.action === "implemented") {
        if (!hasAnyCapability(state.capabilities, ["coding", "fixing"])) {
          console.error(
            `❌ Current model (${state.model}) cannot mark TODO implemented. Requires coding or fixing capability.`,
          );
          process.exit(1);
        }
        const todoId = parsed.todoId as string;
        const result = await markTodoImplemented(plan.dirPath, todoId, {
          command: parsed.test,
          output: parsed.output,
          ...(parsed.note ? { notes: parsed.note } : {}),
        });
        const payload = {
          ok: true,
          action: "implemented",
          input: parsed.planRef,
          id: plan.id,
          todo_id: todoId,
          phase: result.phase,
          lifecycle: result.lifecycle,
        };
        if (parsed.asJson) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`✅ TODO ${todoId} marked implemented for plan ${plan.id}.`);
        }
        process.exit(0);
      }

      if (parsed.action === "accept") {
        if (!hasAnyCapability(state.capabilities, ["reviewing"])) {
          console.error(
            `❌ Current model (${state.model}) cannot accept TODOs. Requires reviewing capability.`,
          );
          process.exit(1);
        }
        const todoId = parsed.todoId as string;
        const result = await markTodoAccepted(plan.dirPath, todoId, parsed.note);
        const payload = {
          ok: true,
          action: "accept",
          input: parsed.planRef,
          id: plan.id,
          todo_id: todoId,
          phase: result.phase,
          lifecycle: result.lifecycle,
        };
        if (parsed.asJson) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(`✅ TODO ${todoId} accepted for plan ${plan.id}.`);
        }
        process.exit(0);
      }

      if (!hasAnyCapability(state.capabilities, ["reviewing"])) {
        console.error(
          `❌ Current model (${state.model}) cannot reject TODOs. Requires reviewing capability.`,
        );
        process.exit(1);
      }
      const todoId = parsed.todoId as string;
      const result = await rejectTodo(plan.dirPath, todoId, parsed.note);
      const payload = {
        ok: true,
        action: "reject",
        input: parsed.planRef,
        id: plan.id,
        todo_id: todoId,
        phase: result.phase,
        lifecycle: result.lifecycle,
      };
      if (parsed.asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`✅ TODO ${todoId} rejected for plan ${plan.id}.`);
      }
      process.exit(0);
    } catch (err: any) {
      const payload = {
        ok: false,
        error: "TODO_COMMAND_FAILED",
        message: err?.message ?? "Unknown todo command error.",
      };
      if (parsed.asJson) {
        console.error(JSON.stringify(payload, null, 2));
      } else {
        console.error(`❌ ${payload.message}`);
      }
      process.exit(1);
    }
  }

  const sessionState = await readSessionState(statePath);
  const sessionResult = guardSession(sessionState, command);
  if (!sessionResult.allowed) {
    console.error(`❌ ${sessionResult.reason}`);
    process.exit(1);
  }

  if (command === "set-model" || command === "update-model") {
    if (!arg) {
      console.error("❌ Model name is required.");
      process.exit(1);
    }

    const model = getEnabledModel(arg);
    if (!model) {
      console.error(`❌ Unknown or disabled model '${arg}'.`);
      process.exit(1);
    }

    await applySessionUpdate(statePath, {
      model: model.id,
      capabilities: model.capabilities,
      lock: command === "update-model",
    });
    console.log(`✅ Model set to '${model.id}'.`);
    process.exit(0);
  }

  if (command === "worker") {
    const parsed = parseWorkerArgs(commandArgs);
    if ("error" in parsed) {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }
    const result = await runWorkerLoop({
      cwd,
      role: parsed.role,
      worker: { worker_id: parsed.workerId, runtime: parsed.runtime },
      lease_ms: parsed.leaseMs,
      poll_ms: parsed.pollMs,
      ...(parsed.maxJobs ? { max_jobs: parsed.maxJobs } : {}),
    });
    console.log(`✅ Worker processed ${result.processed} job(s).`);
    process.exit(0);
  }

  if (command === "workers") {
    const action = commandArgs[0];
    if (action !== "start") {
      console.error(`❌ Unknown workers action '${action ?? ""}'. Usage: wf workers start`);
      process.exit(1);
    }

    const roles = Object.keys(WORKER_ROLE_COMMAND_FILTERS) as WorkerRole[];
    const cursorRoles: string[] = [];
    const opencodeRoles: string[] = [];

    for (const role of roles) {
      const runtime = await resolveExecutorRuntime(cwd, role);
      if (runtime === "opencode") {
        opencodeRoles.push(role);
      } else {
        cursorRoles.push(role);
      }
    }

    console.log("Worker bootstrap status:\n");

    if (cursorRoles.length > 0) {
      console.log("[Cursor runtime — handled by chat orchestrator]");
      for (const role of cursorRoles) {
        console.log(`  ${role}: Cursor chat invokes @${role} subagent directly`);
      }
      console.log();
    }

    if (opencodeRoles.length > 0) {
      console.log("[OpenCode runtime — one session handles all roles]");
      console.log(`  Roles: ${opencodeRoles.join(", ")}`);
      console.log();
      console.log("  Steps to start:");
      console.log("    1. Open OpenCode in a terminal:  $ opencode");
      console.log("    2. Run the worker slash command:  /worker");
      console.log("    3. The combined worker agent handles both coding and fixing jobs.");
      console.log();
    }

    console.log("[Monitoring]");
    console.log("  Run in a separate terminal: bun run wf epic watch <epic-id>");
    process.exit(0);
  }

  if (command === "plan") {
    const parsed = parsePlanArgs(commandArgs);
    if ("error" in parsed) {
      console.error(`❌ ${parsed.error}`);
      process.exit(1);
    }

    if (!parsed.name) {
      console.error("❌ Plan name is required. Usage: wf plan \"<name>\" [--epic <id|slug>]");
      process.exit(1);
    }

    let epicId: string | undefined;
    if (parsed.epicRef) {
      const epic = await resolveEpic(cwd, parsed.epicRef);
      if (!epic) {
        console.error(`❌ Epic '${parsed.epicRef}' not found.`);
        process.exit(1);
      }
      epicId = epic.id;
    }

    try {
      const plan = await createPlan(parsed.name, { epicId });
      if (parsed.epicRef) {
        const epic = await resolveEpic(cwd, parsed.epicRef);
        if (epic) {
          await linkPlanToEpic(epic.dirPath, `${plan.number}-${plan.slug}`);
        }
      }
      console.log(
        `✅ Plan ${plan.number} created (${plan.slug})${epicId ? ` and linked to epic ${epicId}` : ""}.`,
      );
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "code" && arg) {
    const plan = await resolvePlan(cwd, arg);
    if (!plan) {
      console.error(`❌ Plan ${arg} not found.`);
      process.exit(1);
    }

    try {
      if (await isDistributedEnabled(cwd)) {
        const queued = await enqueuePlanCommand(cwd, plan.dirName, "code");
        if (queued.skipped) {
          console.error(
            "❌ Unable to enqueue coding job. Ensure plan is in planning phase and plan.md is populated.",
          );
          process.exit(1);
        }
        if (queued.deduped > 0) {
          console.log(`ℹ️ Coding job for plan ${plan.id} is already queued/running.`);
        } else {
          console.log(`✅ Coding job queued for plan ${plan.id}.`);
        }
      } else {
        await startCoding(plan.dirPath);
        await publishPlanPhaseJobs(cwd, plan.dirName);
        console.log(`✅ Plan ${plan.id} entered coding phase.`);
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "finish-code" && arg) {
    const plan = await resolvePlan(cwd, arg);
    if (!plan) {
      console.error(`❌ Plan ${arg} not found.`);
      process.exit(1);
    }
    try {
      const quality = await validatePlanReadyForReview(plan.dirPath);
      if (!quality.ok) {
        console.error("❌ Cannot run finish-code due to quality gate failures:");
        for (const error of quality.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }
      await finishCode(plan.dirPath);
      await publishPlanPhaseJobs(cwd, plan.dirName);
      console.log(`✅ Plan ${plan.id} is ready for review.`);
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "review" && arg) {
    const plan = await resolvePlan(cwd, arg);
    if (!plan) {
      console.error(`❌ Plan ${arg} not found.`);
      process.exit(1);
    }
    try {
      await startReview(plan.dirPath);
      await publishPlanPhaseJobs(cwd, plan.dirName);
      console.log(`✅ Plan ${plan.id} entered reviewing phase.`);
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "fix" && arg) {
    const plan = await resolvePlan(cwd, arg);
    if (!plan) {
      console.error(`❌ Plan ${arg} not found.`);
      process.exit(1);
    }
    try {
      if (await isDistributedEnabled(cwd)) {
        const queued = await enqueuePlanCommand(cwd, plan.dirName, "fix");
        if (queued.skipped) {
          console.error("❌ Unable to enqueue fixing job. Ensure plan is in reviewing or blocked phase.");
          process.exit(1);
        }
        if (queued.deduped > 0) {
          console.log(`ℹ️ Fixing job for plan ${plan.id} is already queued/running.`);
        } else {
          console.log(`✅ Fixing job queued for plan ${plan.id}.`);
        }
      } else {
        await startFix(plan.dirPath);
        await publishPlanPhaseJobs(cwd, plan.dirName);
        console.log(`✅ Plan ${plan.id} entered fixing phase.`);
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "done" && arg) {
    const plan = await resolvePlan(cwd, arg);
    if (!plan) {
      console.error(`❌ Plan ${arg} not found.`);
      process.exit(1);
    }
    try {
      const quality = await validatePlanReadyForDone(plan.dirPath);
      if (!quality.ok) {
        console.error("❌ Cannot run done due to review gate failures:");
        for (const error of quality.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }
      await completePlan(plan.dirPath);
      await publishPlanPhaseJobs(cwd, plan.dirName);
      console.log(`✅ Plan ${plan.id} marked as completed.`);
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  }

  console.error(`❌ Unknown or incomplete command '${command}'.`);
  process.exit(1);
}
