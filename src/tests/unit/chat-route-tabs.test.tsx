// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ChatRoutePage,
  Route,
  parseChatTab,
  validateContextSearch,
  type ChatTab,
} from "@/routes/context";
import { SettingsPage } from "@/routes/settings";

const mockNavigate = vi.fn();
let currentSearch: { tab?: ChatTab } = { tab: "context" };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/modules/context-telemetry/components/ContextDashboard", () => ({
  ContextDashboard: () => (
    <div data-testid="context-dashboard">Mock Context Dashboard</div>
  ),
}));

vi.mock(
  "@/modules/antigravity-runtime/components/AntigravityChatHealthSettings",
  () => ({
    AntigravityChatHealthSettings: () => (
      <div data-testid="chat-health-settings">Mock Chat Health Settings</div>
    ),
  }),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "nav.chat": "Chat",
        "chat.tabs.context": "Chat Context",
        "chat.tabs.manager": "Chat Manager",
        "context.subtitle":
          "Real-time context window usage, memory pressure, and compaction monitoring",
        "settings.title": "Settings",
        "settings.description": "Manage application preferences.",
        "settings.general": "General",
        "settings.models": "Models",
        "settings.appearance.title": "Appearance",
        "settings.appearance.description": "Customize interface theme.",
        "settings.darkMode": "Dark Mode",
        "settings.darkModeDescription": "Toggle dark theme.",
        "settings.language.title": "Language",
        "settings.language.description": "Select language.",
        "settings.language.english": "English",
        "settings.account.title": "Account Settings",
        "settings.account.description": "Manage account synchronization.",
        "settings.account.auto_refresh": "Auto Refresh Quota",
        "settings.account.auto_refresh_desc": "Automatically refresh quota.",
        "settings.account.auto_sync": "Auto Sync Account",
        "settings.account.auto_sync_desc": "Automatically sync accounts.",
        "settings.automation.title": "Automation & Switching",
        "settings.automation.description": "Configure automated behaviors.",
        "settings.automation.autoResumeChat.title": "Auto-Resume Active Chat",
        "settings.automation.autoResumeChat.cliExcludedBadge":
          "Desktop & IDE Only",
        "settings.automation.autoResumeChat.description":
          "Auto resume active chat.",
        "settings.about.title": "About",
        "settings.about.description": "About Antigravity Switcher.",
        "settings.version": "Version",
        "settings.platform": "Platform",
        "settings.license": "License",
        "settings.openLogDir": "Open Logs",
        "settings.notifications.title": "Notifications",
        "settings.notifications.description": "Configure alerts.",
        "settings.notifications.quotaAlert": "Quota Alert",
        "settings.notifications.quotaAlertDesc": "Alert when quota is low.",
        "settings.notifications.quotaThreshold": "Quota Threshold",
        "settings.notifications.aiCreditsAlert": "Credits Alert",
        "settings.notifications.aiCreditsAlertDesc": "Alert on low credits.",
        "settings.notifications.aiCreditsThreshold": "Credits Threshold",
      };
      return dict[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/shared/theme-provider", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: {
      auto_refresh: false,
      auto_sync: false,
      auto_resume_active_chat: true,
      auto_startup: false,
      start_in_tray: false,
      quota_alert_enabled: false,
      quota_alert_threshold: 20,
      ai_credits_alert_enabled: false,
      ai_credits_alert_threshold: 5000,
    },
    isLoading: false,
    isSaving: false,
    saveConfig: vi.fn(),
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[1] === "version") return { data: "1.0.0" };
    if (queryKey[1] === "platform") return { data: "darwin" };
    return { data: null };
  },
}));

vi.mock("@/modules/config/components/ModelVisibilitySettings", () => ({
  ModelVisibilitySettings: () => <div>Model Visibility</div>,
}));

vi.mock("@/modules/cloud-account/components/AutoSwitchModelSettings", () => ({
  AutoSwitchModelSettings: () => <div>Auto Switch</div>,
}));

vi.mock("@/modules/cloud-account/components/WeeklyWarmupSettings", () => ({
  WeeklyWarmupSettings: () => <div>Weekly Warmup</div>,
}));

vi.mock(
  "@/modules/antigravity-runtime/components/AntigravityClientCacheSettings",
  () => ({
    AntigravityClientCacheSettings: () => <div>Client Cache Settings</div>,
  }),
);

vi.mock(
  "@/modules/antigravity-runtime/components/RuntimeTargetSettings",
  () => ({
    RuntimeTargetSettings: () => <div>Runtime Target Settings</div>,
  }),
);

describe("ChatRoutePage Tabs & Routing", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    currentSearch = { tab: "context" };
    vi.spyOn(Route, "useSearch").mockImplementation(
      () => currentSearch as never,
    );
  });

  it("renders both tabs with localized labels and default context active", () => {
    render(<ChatRoutePage />);

    const contextTab = screen.getByRole("tab", { name: /Chat Context/i });
    const managerTab = screen.getByRole("tab", { name: /Chat Manager/i });

    expect(contextTab).toBeDefined();
    expect(managerTab).toBeDefined();
    expect(contextTab.getAttribute("data-state")).toBe("active");
    expect(managerTab.getAttribute("data-state")).toBe("inactive");

    expect(screen.getByTestId("context-dashboard")).toBeDefined();
    expect(screen.queryByTestId("chat-health-settings")).toBeNull();
  });

  it("switches tab to manager on click and calls navigate with search param", () => {
    render(<ChatRoutePage />);

    const managerTab = screen.getByRole("tab", { name: /Chat Manager/i });
    fireEvent.mouseDown(managerTab, { button: 0, ctrlKey: false });
    fireEvent.click(managerTab);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/context",
      search: { tab: "manager" },
      replace: true,
    });
  });

  it("initializes with manager tab active on deep link ?tab=manager", () => {
    currentSearch = { tab: "manager" };
    render(<ChatRoutePage />);

    const contextTab = screen.getByRole("tab", { name: /Chat Context/i });
    const managerTab = screen.getByRole("tab", { name: /Chat Manager/i });

    expect(managerTab.getAttribute("data-state")).toBe("active");
    expect(contextTab.getAttribute("data-state")).toBe("inactive");

    expect(screen.getByTestId("chat-health-settings")).toBeDefined();
    expect(screen.queryByTestId("context-dashboard")).toBeNull();
  });

  it("supports keyboard navigation across tab triggers", () => {
    render(<ChatRoutePage />);

    const contextTab = screen.getByRole("tab", { name: /Chat Context/i });
    const managerTab = screen.getByRole("tab", { name: /Chat Manager/i });

    act(() => {
      contextTab.focus();
    });
    expect(document.activeElement).toBe(contextTab);

    // Arrow right moves focus/selection to manager
    act(() => {
      fireEvent.keyDown(contextTab, { key: "ArrowRight", code: "ArrowRight" });
      managerTab.focus();
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/context",
      search: { tab: "manager" },
      replace: true,
    });
  });

  it("parseChatTab correctly parses tab values", () => {
    expect(parseChatTab("manager")).toBe("manager");
    expect(parseChatTab("context")).toBe("context");
    expect(parseChatTab("invalid")).toBe("context");
    expect(parseChatTab(undefined)).toBe("context");
    expect(parseChatTab(null)).toBe("context");
    expect(parseChatTab(123)).toBe("context");
  });

  it("validates search parameters via validateContextSearch", () => {
    expect(validateContextSearch({ tab: "manager" })).toEqual({
      tab: "manager",
    });
    expect(validateContextSearch({ tab: "context" })).toEqual({
      tab: "context",
    });
    expect(validateContextSearch({})).toEqual({
      tab: "context",
    });
    expect(validateContextSearch({ tab: "other" })).toEqual({
      tab: "context",
    });
  });

  it("verifies SettingsPage no longer renders AntigravityChatHealthSettings", () => {
    render(<SettingsPage />);

    expect(screen.queryByTestId("chat-health-settings")).toBeNull();
    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByText("Client Cache Settings")).toBeDefined();
  });
});
