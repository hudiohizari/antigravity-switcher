import { z } from "zod";
import type { CloudQuotaData } from "@/modules/cloud-account/types";

/**
 * Google's quota endpoints do not expose the image-generation limit, so an
 * exhausted image model still reads ~100%. Antigravity records Google's raw
 * 429 body on the failed tool step; these helpers turn that into a per-account
 * mark that overrides the reported percentage until Google's own reset time.
 */

/** accountId -> normalized model id -> reset time (epoch ms). */
export type ImageQuotaMarks = Record<string, Record<string, number>>;

export const ImageQuotaMarksSchema: z.ZodType<ImageQuotaMarks> = z.record(
  z.string(),
  z.record(z.string(), z.number()),
);

export interface ImageQuotaExhaustionEvent {
  model: string;
  resetAtMs: number;
  occurredAtMs: number;
}

const TranscriptErrorStepSchema = z.object({
  status: z.literal("ERROR"),
  error: z.string(),
  created_at: z.string(),
});

const GoogleQuotaErrorBodySchema = z.object({
  error: z.object({
    code: z.literal(429),
    status: z.literal("RESOURCE_EXHAUSTED"),
    details: z.array(z.unknown()),
  }),
});

const QuotaErrorInfoSchema = z.object({
  "@type": z.literal("type.googleapis.com/google.rpc.ErrorInfo"),
  reason: z.literal("QUOTA_EXHAUSTED"),
  domain: z.string().endsWith(".googleapis.com"),
  metadata: z.object({
    model: z.string(),
    quotaResetTimeStamp: z.string(),
  }),
});

export function normalizeQuotaModelId(modelId: string): string {
  return modelId
    .replace(/^models\//i, "")
    .trim()
    .toLowerCase();
}

function parseTimestamp(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Accepts only a top-level transcript step that failed with Google's structured
 * QUOTA_EXHAUSTED error for an image model. Agent prose, quoted output and
 * non-image or non-quota errors return null.
 */
export function parseImageQuotaExhaustion(
  line: string,
): ImageQuotaExhaustionEvent | null {
  let step: unknown;
  try {
    step = JSON.parse(line);
  } catch {
    return null;
  }
  const parsedStep = TranscriptErrorStepSchema.safeParse(step);
  if (!parsedStep.success) return null;

  const { error, created_at } = parsedStep.data;
  const bodyStart = error.indexOf("body: ");
  if (bodyStart === -1) return null;

  let body: unknown;
  try {
    body = JSON.parse(error.slice(bodyStart + "body: ".length));
  } catch {
    return null;
  }
  const parsedBody = GoogleQuotaErrorBodySchema.safeParse(body);
  if (!parsedBody.success) return null;

  for (const detail of parsedBody.data.error.details) {
    const info = QuotaErrorInfoSchema.safeParse(detail);
    if (!info.success) continue;

    const model = normalizeQuotaModelId(info.data.metadata.model);
    const resetAtMs = parseTimestamp(info.data.metadata.quotaResetTimeStamp);
    const occurredAtMs = parseTimestamp(created_at);
    if (
      !model.includes("image") ||
      resetAtMs === null ||
      occurredAtMs === null
    ) {
      return null;
    }
    return { model, resetAtMs, occurredAtMs };
  }
  return null;
}

/** Adds a mark (keeping the later reset) and drops expired ones. */
export function mergeImageQuotaMark(
  marks: ImageQuotaMarks,
  accountId: string,
  event: Pick<ImageQuotaExhaustionEvent, "model" | "resetAtMs">,
  nowMs: number,
): ImageQuotaMarks {
  const next = pruneImageQuotaMarks(marks, nowMs);
  if (event.resetAtMs <= nowMs) return next;
  const accountMarks = { ...next[accountId] };
  accountMarks[event.model] = Math.max(
    accountMarks[event.model] ?? 0,
    event.resetAtMs,
  );
  return { ...next, [accountId]: accountMarks };
}

export function pruneImageQuotaMarks(
  marks: ImageQuotaMarks,
  nowMs: number,
): ImageQuotaMarks {
  const pruned: ImageQuotaMarks = {};
  for (const [accountId, models] of Object.entries(marks)) {
    const live = Object.fromEntries(
      Object.entries(models).filter(([, resetAtMs]) => resetAtMs > nowMs),
    );
    if (Object.keys(live).length > 0) pruned[accountId] = live;
  }
  return pruned;
}

/** Returns quota with marked image models at 0% and Google's reset time, until that time passes. */
export function applyImageQuotaMarks(
  quota: CloudQuotaData | undefined,
  accountMarks: Record<string, number> | undefined,
  nowMs: number,
): CloudQuotaData | undefined {
  if (!quota || !accountMarks) return quota;

  let models: CloudQuotaData["models"] | undefined;
  for (const [modelId, info] of Object.entries(quota.models)) {
    const resetAtMs = accountMarks[normalizeQuotaModelId(modelId)];
    if (resetAtMs === undefined || resetAtMs <= nowMs) continue;
    models ??= { ...quota.models };
    models[modelId] = {
      ...info,
      percentage: 0,
      resetTime: new Date(resetAtMs).toISOString(),
    };
  }
  return models ? { ...quota, models } : quota;
}
