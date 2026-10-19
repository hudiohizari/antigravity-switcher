// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AntigravityChatHealthConfirmDialog,
  type HealthConfirmAction,
} from "@/modules/antigravity-runtime/components/AntigravityChatHealthConfirmDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settings.chatHealth.heal": "Heal",
        "settings.chatHealth.healAllBroken": "Heal All Broken",
        "settings.chatHealth.healConfirmTitle": "Heal Chat Session",
        "settings.chatHealth.healConfirmDesc":
          "Synthesizes a compliant database shell so Antigravity can open this conversation cleanly without crashing.",
        "settings.chatHealth.healAllConfirmTitle":
          "Heal All Broken Chat Sessions",
        "settings.chatHealth.healAllConfirmDesc": `Synthesizes compliant database shells for all ${options?.count ?? 0} broken conversations so Antigravity can open them without errors.`,
        "settings.chatHealth.cancel": "Cancel",
        "settings.chatHealth.confirmPruneTitle": "Prune Broken Chat?",
        "settings.chatHealth.confirmPruneDesc":
          "Permanently removes this broken chat reference from Antigravity. Other conversations will not be affected.",
        "settings.chatHealth.confirmPruneAllTitle": "Prune All Broken Chats?",
        "settings.chatHealth.confirmPruneAllDesc":
          "Permanently removes broken chat records whose trajectory files were deleted.",
        "settings.chatHealth.pruneChat": "Prune",
        "settings.chatHealth.restoreChat": "Restore Chat",
        "settings.chatHealth.pruneDeletedSession": "Prune All Residuals",
        "settings.chatHealth.deletedSessionTooltip":
          "The main chat was deleted in Antigravity; these subagents were left stranded.",
      };
      return translations[key] || key;
    },
  }),
}));

describe("AntigravityChatHealthConfirmDialog - Healing Variants", () => {
  it("renders non-destructive confirmation dialog for healSingle action", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const action: HealthConfirmAction = {
      type: "healSingle",
      cid: "broken-conv-123",
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={onClose}
        onConfirm={onConfirm}
        isProcessing={false}
      />,
    );

    expect(screen.getByText("Heal Chat Session")).toBeDefined();
    expect(
      screen.getByText(
        "Synthesizes a compliant database shell so Antigravity can open this conversation cleanly without crashing.",
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Heal" });
    expect(confirmBtn.className).toContain("bg-teal-600");
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders bulk confirmation dialog for healAll action with dynamic broken count", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const action: HealthConfirmAction = {
      type: "healAll",
      count: 5,
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={onClose}
        onConfirm={onConfirm}
        isProcessing={false}
        brokenCount={5}
      />,
    );

    expect(screen.getByText("Heal All Broken Chat Sessions")).toBeDefined();
    expect(
      screen.getByText(
        "Synthesizes compliant database shells for all 5 broken conversations so Antigravity can open them without errors.",
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Heal All Broken" });
    expect(confirmBtn.className).toContain("bg-teal-600");
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables buttons and shows loader spinner during in-flight processing", () => {
    const action: HealthConfirmAction = {
      type: "healSingle",
      cid: "broken-conv-123",
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isProcessing={true}
      />,
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    const confirmBtn = screen.getByRole("button", { name: "Heal" });
    expect(cancelBtn.hasAttribute("disabled")).toBe(true);
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });

  it("renders single-chat pruning confirmation for pruneSingle action", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const action: HealthConfirmAction = {
      type: "pruneSingle",
      cid: "broken-single-456",
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={onClose}
        onConfirm={onConfirm}
        isProcessing={false}
      />,
    );

    expect(screen.getByText("Prune Broken Chat?")).toBeDefined();
    expect(
      screen.getByText(
        "Permanently removes this broken chat reference from Antigravity. Other conversations will not be affected.",
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Prune" });
    expect(confirmBtn.className).not.toContain("bg-teal-600");
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders bulk pruning confirmation for pruneAll action", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const action: HealthConfirmAction = {
      type: "pruneAll",
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={onClose}
        onConfirm={onConfirm}
        isProcessing={false}
      />,
    );

    expect(screen.getByText("Prune All Broken Chats?")).toBeDefined();
    expect(
      screen.getByText(
        "Permanently removes broken chat records whose trajectory files were deleted.",
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Prune" });
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders deleted session container residual pruning confirmation for pruneSingle action when cid starts with deleted-session-", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const action: HealthConfirmAction = {
      type: "pruneSingle",
      cid: "deleted-session-parent-1234",
    };

    render(
      <AntigravityChatHealthConfirmDialog
        action={action}
        onClose={onClose}
        onConfirm={onConfirm}
        isProcessing={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Prune All Residuals" }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The main chat was deleted in Antigravity; these subagents were left stranded.",
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", {
      name: "Prune All Residuals",
    });
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
