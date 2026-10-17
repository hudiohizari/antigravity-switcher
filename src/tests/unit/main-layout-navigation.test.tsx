// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MainLayout } from "@/components/layout/MainLayout";

let mockPathname = "/context";
let shouldThrowInOutlet = false;
const mockToast = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className} data-to={to} {...props}>
      {children}
    </a>
  ),
  Outlet: () => {
    if (shouldThrowInOutlet) {
      throw new Error("Test route render error");
    }
    return <div data-testid="outlet">Page Content</div>;
  },
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/layout/StatusBar", () => ({
  StatusBar: () => <div data-testid="status-bar">Status Bar</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "nav.accounts": "Accounts",
        "nav.relay": "Remote Relay",
        "nav.chat": "Chat",
        "nav.context": "Chat Context",
        "nav.settings": "Settings",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("MainLayout Navigation", () => {
  beforeEach(() => {
    mockPathname = "/context";
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {},
    });
  });

  it("renders /context navigation item with localized label 'Chat'", () => {
    render(<MainLayout />);

    const chatLink = screen.getByRole("link", { name: /Chat/i });
    expect(chatLink).toBeDefined();
    expect(chatLink.getAttribute("data-to")).toBe("/context");
    expect(screen.getByText("Chat")).toBeDefined();
  });

  it("highlights /context link as active when current pathname is /context", () => {
    mockPathname = "/context";
    render(<MainLayout />);

    const chatLink = screen.getByRole("link", { name: /Chat/i });
    expect(chatLink.className).toContain("bg-primary/10 text-primary");
  });

  it("renders non-active styling when location is not /context", () => {
    mockPathname = "/";
    render(<MainLayout />);

    const chatLink = screen.getByRole("link", { name: /Chat/i });
    expect(chatLink.className).toContain("text-muted-foreground");
    expect(chatLink.className).not.toContain(
      "bg-primary text-primary-foreground",
    );
  });

  it("toggles sidebar collapsed state on chevron button click and persists to localStorage", () => {
    render(<MainLayout />);

    const toggleButton = screen.getAllByRole("button")[0];
    expect(screen.getByText("Antigravity")).toBeDefined();

    // Collapse
    fireEvent.click(toggleButton);
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");

    // Expand
    fireEvent.click(toggleButton);
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
  });

  it("initializes with collapsed state when saved in localStorage", () => {
    localStorage.setItem("sidebar-collapsed", "true");
    render(<MainLayout />);

    // In collapsed mode, link uses sr-only for text
    const chatLink = screen.getByRole("link", { name: /Chat/i });
    expect(chatLink).toBeDefined();
    expect(chatLink.getAttribute("data-to")).toBe("/context");
  });

  it("renders ErrorBoundary fallback and triggers toast when child route throws", () => {
    mockToast.mockClear();
    shouldThrowInOutlet = true;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { rerender } = render(<MainLayout />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(mockToast).toHaveBeenCalledTimes(1);

    // Re-rendering with error without pathname change keeps toast deduplicated
    rerender(<MainLayout />);
    expect(mockToast).toHaveBeenCalledTimes(1);

    // Recover on navigation reset
    shouldThrowInOutlet = false;
    mockPathname = "/settings";
    rerender(<MainLayout />);
    expect(screen.getByTestId("outlet")).toBeDefined();

    consoleError.mockRestore();
  });
});
