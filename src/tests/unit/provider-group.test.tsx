import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderGroup } from "@/modules/cloud-account/components/ProviderGroup";
import type { ProviderStats } from "@/modules/cloud-account/utils/provider-grouping";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === "settings.providerGroupings.models") {
        return `${options?.count ?? 0} models`;
      }
      if (key === "settings.providerGroupings.avgLabel") {
        return "avg";
      }
      return key;
    },
  }),
}));

describe("ProviderGroup", () => {
  const baseStats: ProviderStats = {
    providerKey: "claude-",
    providerInfo: {
      name: "Claude",
      company: "Anthropic",
      color: "#D97757",
    },
    models: [
      {
        id: "claude-opus-4-6",
        percentage: 85,
        resetTime: "2026-10-05T16:00:00Z",
        displayName: "Claude 4.6 Opus Upstream",
      },
      {
        id: "claude-sonnet-4-5-thinking",
        percentage: 0,
        resetTime: "2026-10-05T18:00:00Z",
      },
    ],
    visibleModels: [
      {
        id: "claude-opus-4-6",
        percentage: 85,
        resetTime: "2026-10-05T16:00:00Z",
        displayName: "Claude 4.6 Opus Upstream",
      },
      {
        id: "claude-sonnet-4-5-thinking",
        percentage: 0,
        resetTime: "2026-10-05T18:00:00Z",
      },
    ],
    avgPercentage: 42.5,
    earliestReset: "2026-10-05T16:00:00Z",
  };

  const defaultProps = {
    stats: baseStats,
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
    getQuotaTextColorClass: (p: number) =>
      p > 50 ? "text-emerald-500" : "text-rose-500",
    getQuotaBarColorClass: (p: number) =>
      p > 50 ? "bg-emerald-500" : "bg-rose-500",
    formatQuotaLabel: (p: number) => `${p}%`,
    formatResetTimeLabel: (rt?: string) => (rt ? "in 4h" : "unknown"),
    formatResetTimeTitle: (rt?: string) => (rt ? `Reset: ${rt}` : undefined),
    leftLabel: "remaining",
  };

  it("renders null when visibleModels is empty", () => {
    const { container } = render(
      <ProviderGroup
        {...defaultProps}
        stats={{
          ...baseStats,
          visibleModels: [],
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders provider header, progressbar accessibility attributes, and triggers toggle", () => {
    const onToggle = vi.fn();
    render(
      <ProviderGroup
        {...defaultProps}
        isCollapsed={true}
        onToggleCollapse={onToggle}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("2 models")).toBeInTheDocument();
    expect(screen.getByText("42.5%")).toBeInTheDocument();
    expect(screen.getByText("avg")).toBeInTheDocument();

    const headerProgress = screen.getByRole("progressbar", {
      name: "Claude average quota remaining",
    });
    expect(headerProgress).toBeInTheDocument();
    expect(headerProgress).toHaveAttribute("aria-valuenow", "42.5");
    expect(headerProgress).toHaveAttribute("aria-valuemin", "0");
    expect(headerProgress).toHaveAttribute("aria-valuemax", "100");

    // Child rows not rendered when collapsed
    expect(
      screen.queryByText("Claude 4.6 Opus Upstream"),
    ).not.toBeInTheDocument();

    // Toggle button clicked
    const toggleButton = screen.getByRole("button");
    fireEvent.click(toggleButton);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders child model rows with formatted display names and accessibility attributes when expanded", () => {
    render(<ProviderGroup {...defaultProps} isCollapsed={false} />);

    // First model uses explicit displayName
    expect(screen.getByText("Claude 4.6 Opus Upstream")).toBeInTheDocument();
    const firstSpan = screen.getByText("Claude 4.6 Opus Upstream");
    expect(firstSpan).toHaveAttribute("title", "Claude 4.6 Opus Upstream");

    // Second model dynamically formats slug claude-sonnet-4-5-thinking
    expect(
      screen.getByText("Claude 4.5 Sonnet (Thinking)"),
    ).toBeInTheDocument();
    const secondSpan = screen.getByText("Claude 4.5 Sonnet (Thinking)");
    expect(secondSpan).toHaveAttribute("title", "Claude 4.5 Sonnet (Thinking)");

    // Model progress bars
    const modelProgress1 = screen.getByRole("progressbar", {
      name: "Claude 4.6 Opus Upstream quota remaining",
    });
    expect(modelProgress1).toBeInTheDocument();
    expect(modelProgress1).toHaveAttribute("aria-valuenow", "85");

    const modelProgress2 = screen.getByRole("progressbar", {
      name: "Claude 4.5 Sonnet (Thinking) quota remaining",
    });
    expect(modelProgress2).toBeInTheDocument();
    expect(modelProgress2).toHaveAttribute("aria-valuenow", "0");

    // Left label rendered for >0% model, not for 0%
    const remainingLabels = screen.getAllByText("remaining");
    expect(remainingLabels).toHaveLength(1);
  });

  it("handles zero or non-finite average percentage gracefully without avgLabel", () => {
    render(
      <ProviderGroup
        {...defaultProps}
        stats={{
          ...baseStats,
          avgPercentage: 0,
          earliestReset: null,
        }}
      />,
    );

    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(screen.queryByText("avg")).not.toBeInTheDocument();
  });
});
