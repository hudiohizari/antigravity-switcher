// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHealthOrphanRow } from "@/modules/antigravity-runtime/components/ChatHealthOrphanRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settings.chatHealth.heal": "Heal",
        "settings.chatHealth.restoreChat": "Restore Chat",
        "settings.chatHealth.pruneChat": "Prune",
        "settings.chatHealth.subagentsCount": `${options?.count ?? 0} subagents`,
        "settings.chatHealth.subagentBadge": "Subagent",
        "settings.chatHealth.parentChat": `Parent: ${options?.title ?? ""}`,
        "settings.chatHealth.healTooltip":
          "Rebuilds database shell so chat opens without crashing (no backup snapshot available)",
        "settings.chatHealth.restoreTooltip":
          "Restores complete conversation history from backup snapshot",
        "settings.chatHealth.intactParentBadge": "Main Chat",
        "settings.chatHealth.intactParentTooltip":
          "Main conversation is healthy on disk; only its subagents are broken",
        "settings.chatHealth.deletedSessionTitle":
          "Residual Subagents from Deleted Session",
        "settings.chatHealth.deletedSessionBadge": "Deleted Session",
        "settings.chatHealth.deletedSessionTooltip":
          "The main chat was deleted in Antigravity; these subagents were left stranded.",
        "settings.chatHealth.pruneDeletedSession": "Prune All Residuals",
      };
      return translations[key] || key;
    },
  }),
}));

describe("ChatHealthOrphanRow", () => {
  const defaultChat = {
    conversationId: "conv-12345678-abcd-ef01",
    title: "Orphan Session Alpha",
    hasBackup: false,
  };

  it("renders non-destructive Heal button when !hasBackup and onHeal is provided", () => {
    const onHeal = vi.fn();
    render(
      <ChatHealthOrphanRow
        chat={defaultChat}
        onRestore={vi.fn()}
        onPrune={vi.fn()}
        onHeal={onHeal}
      />,
    );

    const healBtn = screen.getByRole("button", {
      name: "Heal: Orphan Session Alpha",
    });
    expect(healBtn).toBeDefined();
    expect(healBtn.className).toContain("text-teal-600");
    expect(healBtn.className).toContain("border-teal-500/30");
    expect(healBtn.getAttribute("title")).toBe(
      "Rebuilds database shell so chat opens without crashing (no backup snapshot available)",
    );

    fireEvent.click(healBtn);
    expect(onHeal).toHaveBeenCalledWith(defaultChat.conversationId);
  });

  it("does not render Heal button when chat has backup or onHeal omitted", () => {
    const { rerender } = render(
      <ChatHealthOrphanRow
        chat={{ ...defaultChat, hasBackup: true, matchingSnapshotId: "snap-1" }}
        onRestore={vi.fn()}
        onPrune={vi.fn()}
        onHeal={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Heal/ })).toBeNull();
    const restoreBtn = screen.getByRole("button", { name: "Restore Chat" });
    expect(restoreBtn).toBeDefined();
    expect(restoreBtn.getAttribute("title")).toBe(
      "Restores complete conversation history from backup snapshot",
    );

    rerender(
      <ChatHealthOrphanRow
        chat={defaultChat}
        onRestore={vi.fn()}
        onPrune={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Heal/ })).toBeNull();
  });

  it("disables Heal button when disabled is true", () => {
    render(
      <ChatHealthOrphanRow
        chat={defaultChat}
        onRestore={vi.fn()}
        onPrune={vi.fn()}
        onHeal={vi.fn()}
        disabled={true}
      />,
    );

    const healBtn = screen.getByRole("button", {
      name: "Heal: Orphan Session Alpha",
    });
    expect(healBtn.hasAttribute("disabled")).toBe(true);
  });

  describe("Subagent hierarchy disclosure", () => {
    const parentChatWithSubagents = {
      conversationId: "parent-conv-12345678",
      title: "Parent Cascade Chat",
      hasBackup: false,
      subagents: [
        {
          conversationId: "subagent-child-1111",
          title: "Code Review Subagent",
          agentName: "Code Reviewer",
          updatedAt: 1729200000000,
          hasBackup: false,
        },
        {
          conversationId: "subagent-child-2222",
          title: "Refactor Subagent",
          agentName: "Refactor Specialist",
          hasBackup: true,
          matchingSnapshotId: "snap-sub-2",
        },
      ],
    };

    it("renders disclosure button with count and toggles nested subagents", () => {
      const onHeal = vi.fn();
      const onPrune = vi.fn();
      const onRestore = vi.fn();

      render(
        <ChatHealthOrphanRow
          chat={parentChatWithSubagents}
          onRestore={onRestore}
          onPrune={onPrune}
          onHeal={onHeal}
        />,
      );

      const disclosureBtn = screen.getByRole("button", {
        name: "2 subagents",
      });
      expect(disclosureBtn).toBeDefined();
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("false");
      expect(
        screen.queryByTestId("subagent-row-subagent-child-1111"),
      ).toBeNull();

      // Expand disclosure
      fireEvent.click(disclosureBtn);
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("true");

      // Verify child rows rendered
      expect(
        screen.getByTestId("subagent-row-subagent-child-1111"),
      ).toBeDefined();
      expect(
        screen.getByTestId("subagent-row-subagent-child-2222"),
      ).toBeDefined();

      // Verify child agent badge and title
      expect(screen.getByText("Code Reviewer")).toBeDefined();
      expect(screen.getByText("Refactor Specialist")).toBeDefined();
      expect(screen.getByText("Code Review Subagent")).toBeDefined();

      // Verify child row actions
      const childHealBtn = screen.getByRole("button", {
        name: "Heal: Code Review Subagent",
      });
      expect(childHealBtn.getAttribute("title")).toBe(
        "Rebuilds database shell so chat opens without crashing (no backup snapshot available)",
      );
      fireEvent.click(childHealBtn);
      expect(onHeal).toHaveBeenCalledWith("subagent-child-1111");

      const childRestoreBtns = screen.getAllByRole("button", {
        name: "Restore Chat",
      });
      // The second child has a backup
      expect(childRestoreBtns[0].getAttribute("title")).toBe(
        "Restores complete conversation history from backup snapshot",
      );
      fireEvent.click(childRestoreBtns[0]);
      expect(onRestore).toHaveBeenCalledWith(
        "snap-sub-2",
        "subagent-child-2222",
      );

      // Collapse disclosure
      fireEvent.click(disclosureBtn);
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("false");
      expect(
        screen.queryByTestId("subagent-row-subagent-child-1111"),
      ).toBeNull();
    });
  });

  describe("Standalone subagent presentation", () => {
    it("renders Subagent badge and parent attribution for orphaned subagent", () => {
      const standaloneChat = {
        conversationId: "standalone-subagent-9999",
        title: "Orphaned Reviewer Agent",
        agentName: "Review Bot",
        parentTitle: "Main Feature Discussion",
        parentConversationId: "parent-root-1234-5678",
        hasBackup: false,
      };

      render(
        <ChatHealthOrphanRow
          chat={standaloneChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      expect(screen.getByText("Subagent")).toBeDefined();
      expect(screen.getByText("Parent: Main Feature Discussion")).toBeDefined();
      expect(screen.getByText("Review Bot")).toBeDefined();
    });

    it("falls back to masked parent ID when parentTitle is missing", () => {
      const standaloneNoTitle = {
        conversationId: "standalone-subagent-8888",
        title: "Orphaned Agent Without Title",
        parentConversationId: "parent-long-identifier-1234",
        hasBackup: false,
      };

      render(
        <ChatHealthOrphanRow
          chat={standaloneNoTitle}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      expect(screen.getByText("Subagent")).toBeDefined();
      expect(screen.getByText("Parent: parent-l...")).toBeDefined();
    });

    it("displays unmasked parent ID when length is 8 characters or fewer", () => {
      const standaloneShortParent = {
        conversationId: "standalone-subagent-7777",
        title: "Short Parent Subagent",
        parentConversationId: "par-123",
        hasBackup: false,
      };

      render(
        <ChatHealthOrphanRow
          chat={standaloneShortParent}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      expect(screen.getByText("Parent: par-123")).toBeDefined();
    });

    it("triggers onPrune when prune button is clicked on parent row", () => {
      const onPrune = vi.fn();
      render(
        <ChatHealthOrphanRow
          chat={defaultChat}
          onRestore={vi.fn()}
          onPrune={onPrune}
        />,
      );

      const pruneBtn = screen.getByRole("button", { name: "Prune" });
      fireEvent.click(pruneBtn);
      expect(onPrune).toHaveBeenCalledWith(defaultChat.conversationId);
    });

    it("triggers onRestore when restore button is clicked on parent row", () => {
      const onRestore = vi.fn();
      render(
        <ChatHealthOrphanRow
          chat={{
            ...defaultChat,
            hasBackup: true,
            matchingSnapshotId: "snap-99",
          }}
          onRestore={onRestore}
          onPrune={vi.fn()}
        />,
      );

      const restoreBtn = screen.getByRole("button", { name: "Restore Chat" });
      fireEvent.click(restoreBtn);
      expect(onRestore).toHaveBeenCalledWith(
        "snap-99",
        defaultChat.conversationId,
      );
    });

    it("renders formatted date when chat.updatedAt is provided", () => {
      render(
        <ChatHealthOrphanRow
          chat={{ ...defaultChat, updatedAt: 1729200000000 }}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
        />,
      );

      // Intl formatted month/day should be present
      const formatted = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(1729200000000));
      expect(screen.getByText(formatted)).toBeDefined();
    });

    it("renders unmasked conversationId when 8 characters or fewer", () => {
      render(
        <ChatHealthOrphanRow
          chat={{ ...defaultChat, conversationId: "short-id" }}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
        />,
      );

      expect(screen.getByText("short-id")).toBeDefined();
    });

    it("renders projectName when provided for top-level non-standalone chat", () => {
      render(
        <ChatHealthOrphanRow
          chat={defaultChat}
          projectName="Project Aurora"
          onRestore={vi.fn()}
          onPrune={vi.fn()}
        />,
      );

      expect(screen.getByText("Project Aurora")).toBeDefined();
    });
  });

  describe("Intact parent container presentation", () => {
    const intactParentChat = {
      conversationId: "intact-parent-12345678",
      title: "Healthy Parent Conversation",
      isIntactParent: true,
      hasBackup: false,
      subagents: [
        {
          conversationId: "broken-child-1111",
          title: "Broken Review Subagent",
          agentName: "Code Reviewer",
          hasBackup: false,
        },
      ],
    };

    it("renders Main Chat badge with tooltip when chat.isIntactParent === true", () => {
      render(
        <ChatHealthOrphanRow
          chat={intactParentChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      const badge = screen.getByText("Main Chat");
      expect(badge).toBeDefined();
      expect(badge.getAttribute("title")).toBe(
        "Main conversation is healthy on disk; only its subagents are broken",
      );
      expect(badge.className).toContain("text-emerald-600");
      expect(badge.className).toContain("border-emerald-500/30");
      expect(badge.className).toContain("bg-emerald-500/10");
    });

    it("suppresses individual Heal and Prune action buttons on the intact parent row", () => {
      render(
        <ChatHealthOrphanRow
          chat={intactParentChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: /^Heal/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Prune" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Restore Chat" })).toBeNull();
    });

    it("retains subagents disclosure pill and expands nested broken subagents with action buttons", () => {
      const onHeal = vi.fn();
      render(
        <ChatHealthOrphanRow
          chat={intactParentChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={onHeal}
        />,
      );

      const disclosureBtn = screen.getByRole("button", {
        name: "1 subagents",
      });
      expect(disclosureBtn).toBeDefined();
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(disclosureBtn);
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("true");

      const childRow = screen.getByTestId("subagent-row-broken-child-1111");
      expect(childRow).toBeDefined();

      const childHealBtn = screen.getByRole("button", {
        name: "Heal: Broken Review Subagent",
      });
      expect(childHealBtn).toBeDefined();
      fireEvent.click(childHealBtn);
      expect(onHeal).toHaveBeenCalledWith("broken-child-1111");
    });
  });

  describe("Deleted session container presentation", () => {
    const deletedSessionContainerChat = {
      conversationId: "deleted-session-parent-1234",
      title: "Raw Stored Title",
      isDeletedSessionContainer: true,
      hasBackup: true,
      matchingSnapshotId: "snap-123",
      subagents: [
        {
          conversationId: "stranded-subagent-1111",
          title: "Stranded Review Subagent",
          agentName: "Code Reviewer",
          hasBackup: false,
        },
      ],
    };

    it("renders localized deletedSessionTitle and title attribute for deleted session container", () => {
      render(
        <ChatHealthOrphanRow
          chat={deletedSessionContainerChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
        />,
      );

      const titleEl = screen.getByText(
        "Residual Subagents from Deleted Session",
      );
      expect(titleEl).toBeDefined();
      expect(titleEl.getAttribute("title")).toBe(
        "Residual Subagents from Deleted Session",
      );
    });

    it("renders Deleted Session badge with tooltip and amber styling", () => {
      render(
        <ChatHealthOrphanRow
          chat={deletedSessionContainerChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      const badge = screen.getByText("Deleted Session");
      expect(badge).toBeDefined();
      expect(badge.getAttribute("title")).toBe(
        "The main chat was deleted in Antigravity; these subagents were left stranded.",
      );
      expect(badge.className).toContain("text-amber-600");
      expect(badge.className).toContain("border-amber-500/30");
      expect(badge.className).toContain("bg-amber-500/10");
    });

    it("suppresses Heal and Restore buttons on the deleted session container even if backup or onHeal exists", () => {
      render(
        <ChatHealthOrphanRow
          chat={deletedSessionContainerChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: /^Heal/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Restore Chat" })).toBeNull();
    });

    it("renders Prune button with pruneDeletedSession label and triggers onPrune", () => {
      const onPrune = vi.fn();
      render(
        <ChatHealthOrphanRow
          chat={deletedSessionContainerChat}
          onRestore={vi.fn()}
          onPrune={onPrune}
          onHeal={vi.fn()}
        />,
      );

      const pruneBtn = screen.getByRole("button", {
        name: "Prune All Residuals",
      });
      expect(pruneBtn).toBeDefined();
      fireEvent.click(pruneBtn);
      expect(onPrune).toHaveBeenCalledWith("deleted-session-parent-1234");
    });

    it("retains subagents disclosure button and expands stranded subagents with their own actions", () => {
      const onHeal = vi.fn();
      render(
        <ChatHealthOrphanRow
          chat={deletedSessionContainerChat}
          onRestore={vi.fn()}
          onPrune={vi.fn()}
          onHeal={onHeal}
        />,
      );

      const disclosureBtn = screen.getByRole("button", {
        name: "1 subagents",
      });
      expect(disclosureBtn).toBeDefined();
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(disclosureBtn);
      expect(disclosureBtn.getAttribute("aria-expanded")).toBe("true");

      const childRow = screen.getByTestId(
        "subagent-row-stranded-subagent-1111",
      );
      expect(childRow).toBeDefined();

      const childHealBtn = screen.getByRole("button", {
        name: "Heal: Stranded Review Subagent",
      });
      expect(childHealBtn).toBeDefined();
      fireEvent.click(childHealBtn);
      expect(onHeal).toHaveBeenCalledWith("stranded-subagent-1111");
    });
  });
});
