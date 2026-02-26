import { validatePlanReadyForDone, validatePlanReadyForReview } from "./quality";

export type VerifyTarget = "all" | "review" | "done";

export type VerifyResult = {
  ok: boolean;
  target: VerifyTarget;
  checks: {
    review: { ok: boolean; errors: string[] } | null;
    done: { ok: boolean; errors: string[] } | null;
  };
};

export async function verifyPlanQuality(
  planPath: string,
  target: VerifyTarget = "all",
): Promise<VerifyResult> {
  const checks: VerifyResult["checks"] = {
    review: null,
    done: null,
  };

  if (target === "all" || target === "review") {
    const reviewGate = await validatePlanReadyForReview(planPath);
    checks.review = {
      ok: reviewGate.ok,
      errors: reviewGate.errors,
    };
  }

  if (target === "all" || target === "done") {
    const doneGate = await validatePlanReadyForDone(planPath);
    checks.done = {
      ok: doneGate.ok,
      errors: doneGate.errors,
    };
  }

  const ok = [checks.review, checks.done]
    .filter((check): check is { ok: boolean; errors: string[] } => check !== null)
    .every((check) => check.ok);

  return {
    ok,
    target,
    checks,
  };
}
