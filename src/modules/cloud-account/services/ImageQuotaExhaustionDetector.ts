import fs from "fs";
import path from "path";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import { cloudAccountEvents } from "./cloud-account-events";
import {
  type ImageQuotaExhaustionEvent,
  type ImageQuotaMarks,
  mergeImageQuotaMark,
  parseImageQuotaExhaustion,
} from "@/modules/cloud-account/utils/image-quota-exhaustion";
import { getAntigravityBrainDir } from "@/shared/platform/paths";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { logger } from "@/shared/logging/logger";

/**
 * Activation is recorded after Antigravity restarts on the new account, so later
 * errors belong to it; this only absorbs timestamp rounding between processes.
 */
const ACTIVATION_GRACE_MS = 5_000;
const MAX_TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_PATH = path.join(
  ".system_generated",
  "logs",
  "transcript.jsonl",
);
const BRAIN_TARGETS: AntigravityAppTarget[] = ["app", "ide"];

export interface NewImageExhaustion {
  accountId: string;
  eventMs: number;
}

interface FileStamp {
  mtimeMs: number;
  size: number;
}

/**
 * Reads Google's image-generation 429s from Antigravity transcripts and marks
 * the account that was active when they happened. Attribution is skipped
 * whenever it would be ambiguous.
 */
export class ImageQuotaExhaustionDetector {
  private static scanned = new Map<string, FileStamp>();
  /** Newest 429 already handled, so each failure triggers at most one switch. */
  private static lastHandledEventMs = 0;
  /** Newest 429 seen, kept because its transcript is not re-read once unchanged. */
  private static latest: NewImageExhaustion | null = null;
  private static inFlight: Promise<NewImageExhaustion | null> | null = null;

  static resetStateForTesting(): void {
    this.scanned.clear();
    this.lastHandledEventMs = 0;
    this.latest = null;
    this.inFlight = null;
  }

  /**
   * Records image-quota marks and returns the active account when a 429 newer
   * than the last handled one was found; call acknowledge() once it is handled.
   */
  static scan(nowMs = Date.now()): Promise<NewImageExhaustion | null> {
    this.inFlight ??= this.runScan(nowMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  static acknowledge(eventMs: number): void {
    this.lastHandledEventMs = Math.max(this.lastHandledEventMs, eventMs);
  }

  private static async runScan(
    nowMs: number,
  ): Promise<NewImageExhaustion | null> {
    const state = CloudAccountSettingsStore.getOperationalState();
    if (!state.isPhysicallyUnified || !state.activeAccountId) {
      return null;
    }

    const targets: AntigravityAppTarget[] =
      state.installedTargets.length > 0 ? state.installedTargets : ["app"];
    const countFromMs =
      this.resolveActiveSince(targets, nowMs) + ACTIVATION_GRACE_MS;
    if (countFromMs > nowMs) {
      return null;
    }

    const events: ImageQuotaExhaustionEvent[] = [];
    for (const target of BRAIN_TARGETS.filter((t) => targets.includes(t))) {
      const brainDir = getAntigravityBrainDir(target);
      if (brainDir) {
        events.push(...(await this.collectEvents(brainDir, countFromMs)));
      }
    }

    const fresh = events.filter(
      (event) => event.occurredAtMs >= countFromMs && event.resetAtMs > nowMs,
    );
    if (fresh.length > 0) {
      const newestMs = Math.max(...fresh.map((event) => event.occurredAtMs));
      if (newestMs > (this.latest?.eventMs ?? 0)) {
        this.latest = { accountId: state.activeAccountId, eventMs: newestMs };
      }
      this.recordMarks(state.activeAccountId, fresh, nowMs);
    }

    const latest = this.latest;
    return latest &&
      latest.accountId === state.activeAccountId &&
      latest.eventMs >= countFromMs &&
      latest.eventMs > this.lastHandledEventMs
      ? latest
      : null;
  }

  private static recordMarks(
    accountId: string,
    fresh: ImageQuotaExhaustionEvent[],
    nowMs: number,
  ): void {
    const before = CloudAccountSettingsStore.getImageQuotaMarks();
    let marks = before;
    for (const event of fresh) {
      marks = mergeImageQuotaMark(marks, accountId, event, nowMs);
    }
    const accountBefore = before[accountId] ?? {};
    const accountAfter = marks[accountId] ?? {};
    const changed = Object.entries(accountAfter).some(
      ([model, resetAtMs]) => accountBefore[model] !== resetAtMs,
    );
    if (changed) {
      this.saveMarks(accountId, marks, accountAfter);
    }
  }

  private static saveMarks(
    accountId: string,
    marks: ImageQuotaMarks,
    accountAfter: Record<string, number>,
  ): void {
    CloudAccountSettingsStore.setImageQuotaMarks(marks);
    // Lets the window and tray re-read the account so the image row turns red now.
    cloudAccountEvents.emit("account:quota_updated", { accountId });
    logger.warn(
      `ImageQuota: account ${accountId} exhausted ${Object.entries(accountAfter)
        .map(
          ([model, resetAtMs]) =>
            `${model} until ${new Date(resetAtMs).toISOString()}`,
        )
        .join(", ")}`,
    );
  }

  /** Latest activation across installed targets; unknown times start now so older errors never count. */
  private static resolveActiveSince(
    targets: AntigravityAppTarget[],
    nowMs: number,
  ): number {
    let since = 0;
    for (const target of targets) {
      let targetSince = CloudAccountSettingsStore.getActiveSince(target);
      if (targetSince === undefined) {
        targetSince = nowMs;
        CloudAccountSettingsStore.setActiveSince(target, nowMs);
      }
      since = Math.max(since, targetSince);
    }
    return since;
  }

  private static async collectEvents(
    brainDir: string,
    countFromMs: number,
  ): Promise<ImageQuotaExhaustionEvent[]> {
    let conversations: fs.Dirent[];
    try {
      conversations = await fs.promises.readdir(brainDir, {
        withFileTypes: true,
      });
    } catch {
      return [];
    }

    const events: ImageQuotaExhaustionEvent[] = [];
    for (const conversation of conversations) {
      if (!conversation.isDirectory()) continue;
      const filePath = path.join(brainDir, conversation.name, TRANSCRIPT_PATH);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        continue;
      }
      if (stat.mtimeMs < countFromMs) continue;

      const previous = this.scanned.get(filePath);
      if (previous?.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
        continue;
      }
      this.scanned.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });

      for (const line of await readTailLines(filePath, stat.size)) {
        const event = parseImageQuotaExhaustion(line);
        if (event) events.push(event);
      }
    }
    return events;
  }
}

async function readTailLines(
  filePath: string,
  size: number,
): Promise<string[]> {
  const length = Math.min(size, MAX_TRANSCRIPT_TAIL_BYTES);
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    // A partial first line from a truncated read is not valid JSON; drop it explicitly.
    return length < size ? lines.slice(1) : lines;
  } finally {
    await handle.close();
  }
}
