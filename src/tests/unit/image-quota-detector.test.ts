import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  state: {
    isPhysicallyUnified: true,
    activeAccountId: "acc-1",
    installedTargets: ["app"],
  },
  since: {} as Record<string, number>,
  marks: {} as Record<string, Record<string, number>>,
  brainDir: "",
}));

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getOperationalState: () => store.state,
      getActiveSince: (target: string) => store.since[target],
      setActiveSince: (target: string, ms: number) => {
        store.since[target] = ms;
      },
      getImageQuotaMarks: () => store.marks,
      setImageQuotaMarks: (marks: Record<string, Record<string, number>>) => {
        store.marks = marks;
      },
    },
  }),
);

vi.mock("@/modules/cloud-account/services/cloud-account-events", () => ({
  cloudAccountEvents: { emit: vi.fn() },
}));

vi.mock("@/shared/platform/paths", () => ({
  getAntigravityBrainDir: () => store.brainDir,
}));

import { ImageQuotaExhaustionDetector } from "@/modules/cloud-account/services/ImageQuotaExhaustionDetector";

const NOW = Date.parse("2026-11-11T01:00:00Z");
const RESET = "2026-11-11T05:21:00Z";

function errorLine(createdAt: string, reset = RESET): string {
  const body = {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "QUOTA_EXHAUSTED",
          domain: "cloudcode-pa.googleapis.com",
          metadata: {
            model: "gemini-3.1-flash-image",
            quotaResetTimeStamp: reset,
          },
        },
      ],
    },
  };
  return JSON.stringify({
    type: "GENERIC",
    status: "ERROR",
    error: `image failed to generate: failed to generate content: 429 Too Many Requests, body: ${JSON.stringify(body, null, 2)}`,
    created_at: createdAt,
  });
}

function writeTranscript(conversation: string, lines: string[]): void {
  const dir = path.join(
    store.brainDir,
    conversation,
    ".system_generated",
    "logs",
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "transcript.jsonl"), lines.join("\n"));
}

describe("ImageQuotaExhaustionDetector", () => {
  beforeEach(() => {
    store.brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-"));
    store.state = {
      isPhysicallyUnified: true,
      activeAccountId: "acc-1",
      installedTargets: ["app"],
    };
    store.since = { app: Date.parse("2026-11-11T00:00:00Z") };
    store.marks = {};
    ImageQuotaExhaustionDetector.resetStateForTesting();
  });

  afterEach(() => {
    fs.rmSync(store.brainDir, { recursive: true, force: true });
  });

  it("marks the active account from an error after activation", async () => {
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).not.toBeNull();
    expect(store.marks).toEqual({
      "acc-1": { "gemini-3.1-flash-image": Date.parse(RESET) },
    });
  });

  it("ignores errors from before the switch and within the grace window", async () => {
    writeTranscript("conv-1", [
      errorLine("2026-11-10T23:59:00Z"),
      errorLine("2026-11-11T00:00:02Z"),
    ]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();
    expect(store.marks).toEqual({});
  });

  it("counts an error a few seconds after the switch", async () => {
    writeTranscript("conv-1", [errorLine("2026-11-11T00:00:10Z")]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).not.toBeNull();
  });

  it("ignores errors whose reset already passed", async () => {
    writeTranscript("conv-1", [
      errorLine("2026-11-11T00:28:04Z", "2026-11-11T00:59:00Z"),
    ]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();
  });

  it("skips attribution when targets use different accounts", async () => {
    store.state = { ...store.state, isPhysicallyUnified: false };
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();
    expect(store.marks).toEqual({});
  });

  it("starts counting from now when the activation time is unknown", async () => {
    store.since = {};
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();
    expect(store.since.app).toBe(NOW);
    expect(store.marks).toEqual({});
  });

  it("reports each new 429 once, after it is acknowledged", async () => {
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);

    const first = await ImageQuotaExhaustionDetector.scan(NOW);
    expect(first).toEqual({
      accountId: "acc-1",
      eventMs: Date.parse("2026-11-11T00:28:04Z"),
    });
    ImageQuotaExhaustionDetector.acknowledge(first!.eventMs);
    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();

    writeTranscript("conv-2", [errorLine("2026-11-11T00:40:00Z")]);
    expect((await ImageQuotaExhaustionDetector.scan(NOW))?.eventMs).toBe(
      Date.parse("2026-11-11T00:40:00Z"),
    );
  });

  it("keeps reporting an unacknowledged 429 even though its file is unchanged", async () => {
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);

    expect(await ImageQuotaExhaustionDetector.scan(NOW)).not.toBeNull();
    expect(await ImageQuotaExhaustionDetector.scan(NOW)).not.toBeNull();
  });

  it("stops reporting once a different account is active", async () => {
    writeTranscript("conv-1", [errorLine("2026-11-11T00:28:04Z")]);
    expect(await ImageQuotaExhaustionDetector.scan(NOW)).not.toBeNull();

    store.state = { ...store.state, activeAccountId: "acc-2" };
    store.since = { app: Date.parse("2026-11-11T00:50:00Z") };
    expect(await ImageQuotaExhaustionDetector.scan(NOW)).toBeNull();
    expect(store.marks["acc-2"]).toBeUndefined();
  });
});
