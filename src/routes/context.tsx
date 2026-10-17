import React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextDashboard } from "@/modules/context-telemetry/components/ContextDashboard";
import { AntigravityChatHealthSettings } from "@/modules/antigravity-runtime/components/AntigravityChatHealthSettings";

export type ChatTab = "context" | "manager";

export interface ContextRouteSearch {
  tab?: ChatTab;
}

export function parseChatTab(tab: unknown): ChatTab {
  return tab === "manager" ? "manager" : "context";
}

export function ChatRoutePage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const activeTab = parseChatTab(search?.tab);

  const handleTabChange = (value: string) => {
    const nextTab = parseChatTab(value);
    navigate({
      to: "/context",
      search: {
        tab: nextTab,
      },
      replace: true,
    });
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full space-y-6"
      >
        <div className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t("nav.chat")}
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              {t("context.subtitle")}
            </p>
          </div>

          <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
            <TabsTrigger
              value="context"
              className="gap-2 min-h-[36px] sm:min-h-[32px]"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              <span>{t("chat.tabs.context")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="manager"
              className="gap-2 min-h-[36px] sm:min-h-[32px]"
            >
              <HardDrive className="h-4 w-4" aria-hidden="true" />
              <span>{t("chat.tabs.manager")}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="context"
          className="mt-0 -mx-4 -my-4 sm:-mx-6 sm:-my-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in-50 duration-150"
        >
          <ContextDashboard />
        </TabsContent>

        <TabsContent
          value="manager"
          className="mt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in-50 duration-150"
        >
          <AntigravityChatHealthSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function validateContextSearch(
  search: Record<string, unknown>,
): ContextRouteSearch {
  return {
    tab: parseChatTab(search.tab),
  };
}

export const Route = createFileRoute("/context")({
  validateSearch: validateContextSearch,
  component: ChatRoutePage,
  errorComponent: RouteErrorFallback,
});
