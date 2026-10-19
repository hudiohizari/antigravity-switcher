import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/shared/ui/utils";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import type { InvalidChatsStats } from "@/modules/antigravity-runtime/conversation/types";
import type {
  BackupSnapshot,
  BackupStats,
} from "@/modules/antigravity-runtime/backup/chatBackup";
import { getChatHealthReport } from "@/modules/antigravity-runtime/actions/chatHealth";
import { flattenBrokenChats } from "@/modules/antigravity-runtime/conversation/subagentTree";
import { ChatHealthTelemetryBar } from "./ChatHealthTelemetryBar";
import { ChatHealthOrphanList } from "./ChatHealthOrphanList";
import { ChatHealthSnapshotList } from "./ChatHealthSnapshotList";
import { ChatHealthStorageWarningBanner } from "./ChatHealthStorageWarningBanner";
import { AntigravityChatHealthConfirmDialog } from "./AntigravityChatHealthConfirmDialog";
import { useChatHealthActions } from "./useChatHealthActions";

const TARGETS = [
  { id: "app" as const, labelKey: "settings.conversationCleaner.targetApp" },
  { id: "ide" as const, labelKey: "settings.conversationCleaner.targetIde" },
  { id: "cli" as const, labelKey: "settings.conversationCleaner.targetCli" },
];

export function AntigravityChatHealthSettings() {
  const { t } = useTranslation();
  const [selectedTarget, setSelectedTarget] =
    useState<AntigravityAppTarget>("app");
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [cleanerStats, setCleanerStats] = useState<InvalidChatsStats | null>(
    null,
  );
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const scanSequenceRef = useRef(0);

  const loadData = useCallback(
    async (target: AntigravityAppTarget, isFullDisclosure: boolean) => {
      const seq = ++scanSequenceRef.current;
      setStatus("loading");
      try {
        const report = await getChatHealthReport(target, !isFullDisclosure);
        if (scanSequenceRef.current !== seq) return;
        if (report.cleanerStats.error) {
          setStatus("error");
          return;
        }
        setCleanerStats(report.cleanerStats);
        setBackupStats(report.backupStats);
        setSnapshots(report.snapshots);
        setStatus("loaded");
      } catch {
        if (scanSequenceRef.current !== seq) return;
        setStatus("error");
      }
    },
    [],
  );

  useEffect(() => {
    loadData(selectedTarget, showAll);
  }, [loadData, selectedTarget, showAll]);

  const handleTargetChange = (target: AntigravityAppTarget) => {
    setSelectedTarget(target);
    loadData(target, showAll);
  };

  const {
    confirmAction,
    setConfirmAction,
    isProcessing,
    requestPrune,
    handleConfirmAction,
    handlePruneBackups,
  } = useChatHealthActions({
    target: selectedTarget,
    projectGroups: cleanerStats?.projectGroups,
    reload: () => loadData(selectedTarget, showAll),
  });

  const brokenChats = useMemo(
    () =>
      (cleanerStats?.projectGroups ?? []).flatMap((group) =>
        flattenBrokenChats(group.conversations),
      ),
    [cleanerStats],
  );
  const brokenCidSet = useMemo(
    () => new Set(brokenChats.map((chat) => chat.conversationId)),
    [brokenChats],
  );
  // Heal all leaves chats that have a backup for Restore.
  const healableCount = brokenChats.filter((chat) => !chat.hasBackup).length;

  const toggleAccordion = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isStorageWarning =
    (backupStats?.totalSizeBytes ?? 0) > 1024 * 1024 * 1024 ||
    Boolean(backupStats?.exceedsStorageLimit);

  const brokenCount = cleanerStats?.invalidChats ?? 0;
  const isHealthy = brokenCount === 0;
  const isEmpty = isHealthy && snapshots.length === 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              {t("settings.chatHealth.title")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("settings.chatHealth.description")}
            </CardDescription>
          </div>
          <div
            role="tablist"
            aria-label="Antigravity App Target"
            className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-xs text-muted-foreground self-start sm:self-auto"
          >
            {TARGETS.map((target) => (
              <button
                key={target.id}
                role="tab"
                type="button"
                aria-selected={selectedTarget === target.id}
                onClick={() => handleTargetChange(target.id)}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 min-h-[32px]",
                  selectedTarget === target.id
                    ? "bg-background font-semibold text-foreground shadow-xs"
                    : "hover:text-foreground",
                )}
              >
                {t(target.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {status === "loaded" && (
          <ChatHealthTelemetryBar
            cleanerStats={cleanerStats}
            backupStats={backupStats}
          />
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {status === "loading" && (
          <div data-testid="chat-health-loading" className="space-y-3 py-4">
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{t("settings.chatHealth.loading")}</span>
            </div>
            <div className="h-16 rounded-lg bg-muted/60 animate-pulse" />
            <div className="h-20 rounded-lg bg-muted/60 animate-pulse" />
          </div>
        )}

        {status === "error" && (
          <div
            data-testid="chat-health-error"
            className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs"
          >
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
              <div>
                <p className="font-semibold text-foreground">
                  {t("settings.chatHealth.errorTitle")}
                </p>
                <p className="text-muted-foreground">
                  {t("settings.chatHealth.errorDesc")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadData(selectedTarget, showAll)}
              className="h-8 min-h-[32px] text-xs"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.chatHealth.retry")}
            </Button>
          </div>
        )}

        {status === "loaded" && (
          <>
            {isStorageWarning && (
              <ChatHealthStorageWarningBanner
                totalSizeBytes={backupStats?.totalSizeBytes ?? 0}
                onPruneBackups={handlePruneBackups}
                disabled={isProcessing}
              />
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              <div className="flex items-center space-x-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs px-2 py-0.5",
                    isHealthy
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-rose-500/30 bg-destructive/10 text-rose-600 dark:text-rose-400",
                  )}
                >
                  {isHealthy ? (
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                  )}
                  {isHealthy
                    ? t("settings.chatHealth.statusHealthy")
                    : t("settings.chatHealth.statusBroken", {
                        count: brokenCount,
                      })}
                </Badge>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="show-all-chats-toggle"
                  checked={showAll}
                  onCheckedChange={setShowAll}
                  aria-label={t("settings.chatHealth.filterShowAll")}
                />
                <label
                  htmlFor="show-all-chats-toggle"
                  className="text-xs font-medium text-foreground cursor-pointer select-none"
                >
                  {t("settings.chatHealth.filterShowAll")}
                </label>
              </div>
            </div>

            {!showAll && (
              <p className="text-[11px] text-muted-foreground italic">
                {t("settings.chatHealth.filterStaleOnly")}
              </p>
            )}

            {brokenCount > 0 && cleanerStats?.projectGroups && (
              <ChatHealthOrphanList
                projectGroups={cleanerStats.projectGroups}
                onRestore={(snapshotId, cid) =>
                  setConfirmAction({ type: "restoreSingle", snapshotId, cid })
                }
                onPruneSingle={requestPrune}
                onPruneAll={() => setConfirmAction({ type: "pruneAll" })}
                onHealSingle={(cid) =>
                  setConfirmAction({ type: "healSingle", cid })
                }
                onHealAll={
                  healableCount > 0
                    ? () =>
                        setConfirmAction({ type: "healAll", count: healableCount })
                    : undefined
                }
                disabled={isProcessing}
              />
            )}

            {isEmpty ? (
              <div
                data-testid="chat-health-empty"
                className="rounded-lg border border-dashed border-border/60 p-6 text-center space-y-1"
              >
                <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
                <p className="text-xs font-semibold text-foreground">
                  {t("settings.chatHealth.emptyTitle")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.chatHealth.emptyDesc")}
                </p>
              </div>
            ) : (
              <ChatHealthSnapshotList
                snapshots={snapshots}
                expandedIds={expandedIds}
                onToggleAccordion={toggleAccordion}
                onRestoreFull={(snapshotId) =>
                  setConfirmAction({ type: "restoreFull", snapshotId })
                }
                onRestoreSingle={(snapshotId, cid) =>
                  setConfirmAction({ type: "restoreSingle", snapshotId, cid })
                }
                onPruneSingle={requestPrune}
                brokenCids={brokenCidSet}
                showAll={showAll}
                onToggleShowAll={() => setShowAll(true)}
                disabled={isProcessing}
              />
            )}
          </>
        )}
      </CardContent>

      <AntigravityChatHealthConfirmDialog
        action={confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        isProcessing={isProcessing}
        brokenCount={brokenCount}
      />
    </Card>
  );
}
