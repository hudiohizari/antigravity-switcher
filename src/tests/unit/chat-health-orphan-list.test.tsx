// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHealthOrphanList } from "@/modules/antigravity-runtime/components/ChatHealthOrphanList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settings.chatHealth.heal": "Heal",
        "settings.chatHealth.healAllBroken": "Heal All Broken",
        "settings.chatHealth.pruneAllBroken": "Prune All Broken",
        "settings.chatHealth.restoreChat": "Restore Chat",
        "settings.chatHealth.pruneChat": "Prune",
        "settings.chatHealth.statusBroken": `${options?.count ?? 0} broken sessions`,
        "settings.chatHealth.searchPlaceholder": "Search broken chats...",
        "settings.chatHealth.noSearchResults": `No broken chats matching "${options?.query ?? ""}"`,
        "settings.chatHealth.clearSearch": "Clear Search",
        "settings.chatHealth.expandAll": "Expand All",
        "settings.chatHealth.collapseAll": "Collapse All",
        "settings.chatHealth.subagentsCount": `${options?.count ?? 0} subagents`,
        "settings.chatHealth.subagentBadge": "Subagent",
        "settings.chatHealth.parentChat": `Parent: ${options?.title ?? ""}`,
        "settings.chatHealth.healVsRestoreTitle": "Heal vs Restore",
        "settings.chatHealth.healVsRestoreDesc":
          "Restore recovers complete message history from a saved backup snapshot. Heal rebuilds the database shell so Antigravity opens without crashing when no backup exists.",
        "settings.chatHealth.healTooltip":
          "Rebuilds database shell so chat opens without crashing (no backup snapshot available)",
        "settings.chatHealth.restoreTooltip":
          "Restores complete conversation history from backup snapshot",
        "settings.chatHealth.cancel": "Cancel",
      };
      return translations[key] || key;
    },
  }),
}));

describe("ChatHealthOrphanList", () => {
  const mockGroups = [
    {
      projectName: "Project Gamma",
      workspacePath: "/path/to/gamma",
      brokenCount: 2,
      conversations: [
        {
          conversationId: "conv-1",
          title: "Broken Alpha Chat",
          hasBackup: false,
        },
        {
          conversationId: "conv-2",
          title: "Broken Beta Session",
          hasBackup: false,
          subagents: [
            {
              conversationId: "conv-sub-1",
              title: "Subagent Task Runner",
              agentName: "Task Agent",
              hasBackup: false,
            },
          ],
        },
      ],
    },
    {
      projectName: "Project Delta",
      workspacePath: "/path/to/delta",
      brokenCount: 1,
      conversations: [
        {
          conversationId: "conv-3",
          title: "Delta Unique Workflow",
          hasBackup: false,
        },
      ],
    },
  ];

  it("renders Heal All Broken button and dispatches onHealAll", () => {
    const onHealAll = vi.fn();
    const onHealSingle = vi.fn();
    render(
      <ChatHealthOrphanList
        projectGroups={mockGroups}
        onRestore={vi.fn()}
        onPruneSingle={vi.fn()}
        onPruneAll={vi.fn()}
        onHealSingle={onHealSingle}
        onHealAll={onHealAll}
      />,
    );

    const healAllBtn = screen.getByRole("button", { name: "Heal All Broken" });
    expect(healAllBtn).toBeDefined();
    expect(healAllBtn.className).toContain("text-teal-600");
    expect(healAllBtn.className).toContain("border-teal-500/30");

    fireEvent.click(healAllBtn);
    expect(onHealAll).toHaveBeenCalledTimes(1);

    const rowHealBtns = screen.getAllByRole("button", { name: /^Heal: / });
    expect(rowHealBtns.length).toBe(3);
    fireEvent.click(rowHealBtns[0]);
    expect(onHealSingle).toHaveBeenCalledWith("conv-1");
  });

  it("disables both bulk buttons when disabled is true", () => {
    render(
      <ChatHealthOrphanList
        projectGroups={mockGroups}
        onRestore={vi.fn()}
        onPruneSingle={vi.fn()}
        onPruneAll={vi.fn()}
        onHealSingle={vi.fn()}
        onHealAll={vi.fn()}
        disabled={true}
      />,
    );

    const healAllBtn = screen.getByRole("button", { name: "Heal All Broken" });
    const pruneAllBtn = screen.getByRole("button", {
      name: "Prune All Broken",
    });
    expect(healAllBtn.hasAttribute("disabled")).toBe(true);
    expect(pruneAllBtn.hasAttribute("disabled")).toBe(true);
  });

  it("returns null when totalBroken is 0", () => {
    const { container } = render(
      <ChatHealthOrphanList
        projectGroups={[]}
        onRestore={vi.fn()}
        onPruneSingle={vi.fn()}
        onPruneAll={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("Real-time search filtering", () => {
    it("filters conversations dynamically by title", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();

      fireEvent.change(searchInput, { target: { value: "Alpha" } });

      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
      expect(screen.queryByText("Project Delta")).toBeNull();
    });

    it("filters conversations by conversation ID", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      fireEvent.change(searchInput, { target: { value: "conv-3" } });

      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();
      expect(screen.queryByText("Broken Alpha Chat")).toBeNull();
    });

    it("filters by nested subagent agentName or title", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      fireEvent.change(searchInput, { target: { value: "Task Agent" } });

      expect(screen.getByText("Broken Beta Session")).toBeDefined();
      expect(screen.queryByText("Broken Alpha Chat")).toBeNull();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
    });

    it("filters by workspace projectName matching all its items", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      fireEvent.change(searchInput, { target: { value: "Gamma" } });

      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.getByText("Broken Beta Session")).toBeDefined();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
    });

    it("clears search query via Clear X button and Escape key", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      expect(searchInput.getAttribute("type")).toBe("text");
      expect(screen.queryByRole("button", { name: "Clear Search" })).toBeNull();

      fireEvent.change(searchInput, { target: { value: "Alpha" } });
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();

      const clearBtns = screen.getAllByRole("button", { name: "Clear Search" });
      expect(clearBtns.length).toBe(1);
      fireEvent.click(clearBtns[0]);

      expect(searchInput.getAttribute("value")).toBe("");
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Clear Search" })).toBeNull();

      // Test Escape key
      fireEvent.change(searchInput, { target: { value: "Alpha" } });
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
      fireEvent.keyDown(searchInput, { key: "Escape" });
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Clear Search" })).toBeNull();
    });

    it("renders empty search state when no chats match, and resets via Clear CTA", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const searchInput = screen.getByRole("searchbox");
      fireEvent.change(searchInput, { target: { value: "nonexistent-query" } });

      expect(screen.getByTestId("chat-health-search-empty")).toBeDefined();
      expect(
        screen.getByText('No broken chats matching "nonexistent-query"'),
      ).toBeDefined();

      const clearCta = screen
        .getByTestId("chat-health-search-empty")
        .querySelector("button")!;
      fireEvent.click(clearCta);

      expect(screen.queryByTestId("chat-health-search-empty")).toBeNull();
      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
    });
  });

  describe("Workspace Project Accordions & Bulk Toggle", () => {
    it("expands all groups by default when total groups <= 2", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      // Both groups should be expanded
      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();

      // Click to collapse Project Gamma
      const gammaGroup = screen.getByTestId("workspace-group-Project Gamma");
      const gammaHeader = gammaGroup.querySelector("button")!;
      fireEvent.click(gammaHeader);
      expect(screen.queryByText("Broken Alpha Chat")).toBeNull();
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();
    });

    it("collapses all groups by default when total groups > 2", () => {
      const threeGroups = [
        ...mockGroups,
        {
          projectName: "Project Epsilon",
          workspacePath: "/path/to/epsilon",
          brokenCount: 1,
          conversations: [
            {
              conversationId: "conv-4",
              title: "Epsilon Task",
              hasBackup: false,
            },
          ],
        },
      ];

      render(
        <ChatHealthOrphanList
          projectGroups={threeGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      // Should be collapsed by default
      expect(screen.queryByText("Broken Alpha Chat")).toBeNull();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
      expect(screen.queryByText("Epsilon Task")).toBeNull();

      // Click to expand Project Gamma
      const gammaGroup = screen.getByTestId("workspace-group-Project Gamma");
      const gammaHeader = gammaGroup.querySelector("button")!;
      fireEvent.click(gammaHeader);

      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
    });

    it("toggles all groups via bulk expand/collapse button", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      // Initially both expanded (<= 2 groups), so bulk button says "Collapse All"
      const bulkToggle = screen.getByRole("button", { name: "Collapse All" });
      expect(bulkToggle).toBeDefined();

      // Click bulk toggle -> all collapse
      fireEvent.click(bulkToggle);
      expect(screen.queryByText("Broken Alpha Chat")).toBeNull();
      expect(screen.queryByText("Delta Unique Workflow")).toBeNull();
      expect(screen.getByRole("button", { name: "Expand All" })).toBeDefined();

      // Click again -> all expand
      fireEvent.click(screen.getByRole("button", { name: "Expand All" }));
      expect(screen.getByText("Broken Alpha Chat")).toBeDefined();
      expect(screen.getByText("Delta Unique Workflow")).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Collapse All" }),
      ).toBeDefined();
    });
  });

  describe("Heal vs Restore guidance", () => {
    it("renders Help button and toggles inline dismissible guidance banner", () => {
      render(
        <ChatHealthOrphanList
          projectGroups={mockGroups}
          onRestore={vi.fn()}
          onPruneSingle={vi.fn()}
          onPruneAll={vi.fn()}
        />,
      );

      const helpBtn = screen.getByRole("button", { name: "Heal vs Restore" });
      expect(helpBtn).toBeDefined();
      expect(helpBtn.getAttribute("title")).toBe(
        "Restore recovers complete message history from a saved backup snapshot. Heal rebuilds the database shell so Antigravity opens without crashing when no backup exists.",
      );
      expect(helpBtn.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("heal-vs-restore-guidance")).toBeNull();

      // Click to open banner
      fireEvent.click(helpBtn);
      expect(helpBtn.getAttribute("aria-expanded")).toBe("true");
      const banner = screen.getByTestId("heal-vs-restore-guidance");
      expect(banner).toBeDefined();
      expect(
        screen.getByText(
          "Restore recovers complete message history from a saved backup snapshot. Heal rebuilds the database shell so Antigravity opens without crashing when no backup exists.",
        ),
      ).toBeDefined();

      // Dismiss via banner close button
      const dismissBtn = banner.querySelector("button")!;
      expect(dismissBtn.getAttribute("aria-label")).toBe("Cancel");
      fireEvent.click(dismissBtn);
      expect(screen.queryByTestId("heal-vs-restore-guidance")).toBeNull();
      expect(helpBtn.getAttribute("aria-expanded")).toBe("false");

      // Click help button again to open then toggle close via help button
      fireEvent.click(helpBtn);
      expect(screen.getByTestId("heal-vs-restore-guidance")).toBeDefined();
      fireEvent.click(helpBtn);
      expect(screen.queryByTestId("heal-vs-restore-guidance")).toBeNull();
    });
  });
});
