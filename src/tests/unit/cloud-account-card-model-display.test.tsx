// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CloudAccountCard,
  CompactCloudAccountCard,
} from "@/modules/cloud-account/components/CloudAccountCard";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock("@/modules/antigravity-runtime/actions/process", () => ({
  getProcessStatus: vi.fn().mockResolvedValue({
    isRunning: false,
    isBinaryInstalled: true,
  }),
}));

const mockSaveConfig = vi.fn();
let mockConfig = {
  model_visibility: {} as Record<string, boolean>,
};

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: mockConfig,
    saveConfig: mockSaveConfig,
  }),
}));

vi.mock("@/modules/cloud-account/hooks/useProviderGrouping", () => ({
  useProviderGrouping: () => ({
    enabled: false,
    getAccountStats: vi.fn(),
    isProviderCollapsed: vi.fn(),
    toggleProviderCollapse: vi.fn(),
  }),
}));

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  useSetAccountProxy: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "cloud.card.unknown") return "Unknown Account";
      if (key === "cloud.card.noQuota") return "No quota data";
      if (key === "cloud.card.resetPrefix") return "resets in";
      if (key === "cloud.card.resetUnknown") return "unknown";
      if (key === "cloud.card.resetTime") return "Reset time";
      if (key === "cloud.card.modelVisibility") return "Model Visibility";
      if (key === "cloud.card.groupGoogleGemini") return "Google Gemini";
      if (key === "cloud.card.groupAnthropicClaude") return "Anthropic Claude";
      if (key === "cloud.card.groupGpt") return "GPT";
      if (key === "cloud.card.groupOtherModels") return "Other Models";
      if (key === "cloud.target.classic") return "Antigravity App";
      if (key === "cloud.target.ide") return "Antigravity IDE";
      if (key === "cloud.target.cli") return "Antigravity CLI";
      if (key === "cloud.switch.targetAllShort") return "Switch All";
      if (key === "cloud.switch.activeAll") return "Active on All";
      return key;
    },
  }),
}));

describe("CloudAccountCard Dynamic Model Display & Accessibility", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { model_visibility: {} };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
  };

  const createAccountWithModels = (
    models: NonNullable<CloudAccount["quota"]>["models"],
  ): CloudAccount => ({
    id: "acc-model-display-1",
    provider: "google",
    name: "Dynamic Claude Tester",
    email: "claude@test.com",
    status: "active",
    is_active: true,
    created_at: Date.now(),
    last_used: Math.floor(Date.now() / 1000),
    token: {
      access_token: "fake",
      refresh_token: "fake",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    quota: {
      models,
    },
  });

  it("renders dynamic Claude model names, title tooltips, and WCAG progressbar aria-labels in standard card", () => {
    const account = createAccountWithModels({
      "claude-opus-4-6": {
        percentage: 85,
        resetTime: "2026-10-05T20:00:00Z",
      },
      "claude-sonnet-4-5-thinking": {
        percentage: 60,
        resetTime: "2026-10-05T22:00:00Z",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    // Verify dynamic model display names appear in UI
    expect(screen.getByText("Claude 4.6 Opus")).toBeInTheDocument();
    expect(screen.getByText("Claude 4.5 Sonnet")).toBeInTheDocument();

    // Verify progressbar accessibility attributes and aria-label formatting
    const opusProgress = screen.getByRole("progressbar", {
      name: /Claude 4\.6 Opus quota remaining: 85%, resets in/,
    });
    expect(opusProgress).toBeInTheDocument();
    expect(opusProgress).toHaveAttribute("aria-valuenow", "85");
    expect(opusProgress).toHaveAttribute("aria-valuemin", "0");
    expect(opusProgress).toHaveAttribute("aria-valuemax", "100");

    const sonnetProgress = screen.getByRole("progressbar", {
      name: /Claude 4\.5 Sonnet quota remaining: 60%, resets in/,
    });
    expect(sonnetProgress).toBeInTheDocument();
    expect(sonnetProgress).toHaveAttribute("aria-valuenow", "60");

    // Verify native title tooltip on model rows
    const opusRow = opusProgress.closest(".group\\/item");
    expect(opusRow).toHaveAttribute(
      "title",
      expect.stringContaining("Claude 4.6 Opus"),
    );
  });

  it("honors upstream display_name when provided by API over regex fallback", () => {
    const account = createAccountWithModels({
      "custom-claude-model": {
        percentage: 95,
        resetTime: "2026-10-05T20:00:00Z",
        display_name: "Claude 4.6 Opus Upstream Flagship",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    // Verify upstream display_name takes precedence
    expect(
      screen.getByText("Claude 4.6 Opus Upstream Flagship"),
    ).toBeInTheDocument();

    const progress = screen.getByRole("progressbar", {
      name: /Claude 4\.6 Opus Upstream Flagship quota remaining: 95%/,
    });
    expect(progress).toBeInTheDocument();
  });

  it("renders dynamic model names and progress bar in CompactCloudAccountCard", () => {
    const account = createAccountWithModels({
      "claude-opus-4-6": {
        percentage: 75,
        resetTime: "2026-10-05T20:00:00Z",
      },
    });

    renderWithClient(
      <CompactCloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    const compactProgress = screen.getByRole("progressbar", {
      name: "Claude 4.6 Opus quota remaining",
    });
    expect(compactProgress).toBeInTheDocument();
    expect(compactProgress).toHaveAttribute("aria-valuenow", "75");
    expect(compactProgress).toHaveAttribute("aria-valuemin", "0");
    expect(compactProgress).toHaveAttribute("aria-valuemax", "100");
  });

  it("renders dynamic model names in model visibility dropdown with truncation and native title tooltip", async () => {
    const account = createAccountWithModels({
      "claude-opus-4-6-thinking": {
        percentage: 50,
        resetTime: "2026-10-05T20:00:00Z",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    // Open model visibility dropdown
    const visibilityButton = screen.getByRole("button", {
      name: "Model Visibility",
    });
    fireEvent.pointerDown(visibilityButton, { button: 0, ctrlKey: false });
    fireEvent.click(visibilityButton);

    // Inside dropdown menu
    const dropdownItem = await screen.findByText("Claude 4.6 Opus (Thinking)");
    expect(dropdownItem).toBeInTheDocument();
    expect(dropdownItem).toHaveAttribute("title", "Claude 4.6 Opus (Thinking)");
    expect(dropdownItem).toHaveClass("truncate");
  });

  it("renders GPT model group and does not show empty quota state when account only has GPT models", () => {
    const account = createAccountWithModels({
      "gpt-oss-120b": {
        percentage: 85,
        resetTime: "2026-10-05T20:00:00Z",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.queryByText("No quota data")).not.toBeInTheDocument();
    expect(screen.getByText("GPT")).toBeInTheDocument();
    expect(screen.getByText("GPT OSS 120B")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();

    const gptProgress = screen.getByRole("progressbar", {
      name: /GPT OSS 120B quota remaining: 85%, resets in/,
    });
    expect(gptProgress).toBeInTheDocument();
    expect(gptProgress).toHaveAttribute("aria-valuenow", "85");
  });

  it("renders all four model groups sequentially without static pt-1 spacer", () => {
    const account = createAccountWithModels({
      "gemini-3.8-flash": {
        percentage: 90,
        resetTime: "2026-10-05T20:00:00Z",
      },
      "claude-sonnet-4-6": {
        percentage: 75,
        resetTime: "2026-10-05T21:00:00Z",
      },
      "gpt-oss-120b": {
        percentage: 60,
        resetTime: "2026-10-05T22:00:00Z",
      },
      "custom-transformer-v1": {
        percentage: 45,
        resetTime: "2026-10-05T23:00:00Z",
      },
    });

    const { container } = renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    const groupHeaders = screen.getAllByText(
      /^(Google Gemini|Anthropic Claude|GPT|Other Models)$/,
    );
    expect(groupHeaders).toHaveLength(4);
    expect(groupHeaders[0]).toHaveTextContent("Google Gemini");
    expect(groupHeaders[1]).toHaveTextContent("Anthropic Claude");
    expect(groupHeaders[2]).toHaveTextContent("GPT");
    expect(groupHeaders[3]).toHaveTextContent("Other Models");

    expect(container.querySelector(".pt-1")).toBeNull();
  });

  it("renders other models group when account contains unclassified models", () => {
    const account = createAccountWithModels({
      "mistral-large-2": {
        percentage: 70,
        resetTime: "2026-10-05T20:00:00Z",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.queryByText("No quota data")).not.toBeInTheDocument();
    expect(screen.getByText("Other Models")).toBeInTheDocument();
    expect(screen.getByText("Mistral Large 2")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("enforces strict mutually exclusive partitioning so gemini or claude models with gpt substring are not duplicated into GPT group", () => {
    const account = createAccountWithModels({
      "gemini-gpt-eval-v1": {
        percentage: 80,
        resetTime: "2026-10-05T20:00:00Z",
      },
    });

    renderWithClient(
      <CloudAccountCard
        account={account}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    expect(screen.queryByText("GPT")).not.toBeInTheDocument();
  });
});
