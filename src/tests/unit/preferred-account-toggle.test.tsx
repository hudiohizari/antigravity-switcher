import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const hooks = vi.hoisted(() => ({
  preferredIds: [] as string[],
  mutate: vi.fn(),
}));

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  usePreferredAccountIds: () => ({ data: hooks.preferredIds }),
  useSetAccountPreferred: () => ({ mutate: hooks.mutate, isPending: false }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PreferredAccountToggle } from "@/modules/cloud-account/components/PreferredAccountToggle";

describe("PreferredAccountToggle", () => {
  beforeEach(() => {
    hooks.mutate.mockClear();
  });

  it("marks a regular account as preferred", () => {
    hooks.preferredIds = ["other"];
    render(<PreferredAccountToggle accountId="acc-1" />);

    const button = screen.getByRole("button", {
      name: "cloud.card.preferredAdd",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(hooks.mutate).toHaveBeenCalledWith({
      accountId: "acc-1",
      preferred: true,
    });
  });

  it("removes a preferred account", () => {
    hooks.preferredIds = ["acc-1"];
    render(<PreferredAccountToggle accountId="acc-1" />);

    const button = screen.getByRole("button", {
      name: "cloud.card.preferredRemove",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(hooks.mutate).toHaveBeenCalledWith({
      accountId: "acc-1",
      preferred: false,
    });
  });
});
