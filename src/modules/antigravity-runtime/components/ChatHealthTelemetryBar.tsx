import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import type { InvalidChatsStats } from "@/modules/antigravity-runtime/conversation/types";
import type { BackupStats } from "@/modules/antigravity-runtime/backup/chatBackup";

export function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface ChatHealthTelemetryBarProps {
  cleanerStats: InvalidChatsStats | null;
  backupStats: BackupStats | null;
}

export function ChatHealthTelemetryBar({
  cleanerStats,
  backupStats,
}: ChatHealthTelemetryBarProps) {
  const { t } = useTranslation();

  const totalChats = cleanerStats?.totalChats ?? 0;
  const validChats = cleanerStats?.validChats ?? 0;
  const invalidChats = cleanerStats?.invalidChats ?? 0;
  const totalSizeBytes = backupStats?.totalSizeBytes ?? 0;

  const metrics = [
    {
      label: t("settings.conversationCleaner.totalLabel"),
      value: totalChats,
      tone: "text-foreground",
      testId: "telemetry-total-chats",
    },
    {
      label: t("settings.conversationCleaner.validLabel"),
      value: validChats,
      tone: "text-emerald-600 dark:text-emerald-400",
      testId: "telemetry-valid-chats",
    },
    {
      label: t("settings.conversationCleaner.invalidLabel"),
      value: invalidChats,
      tone:
        invalidChats > 0
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400",
      testId: "telemetry-invalid-chats",
    },
    {
      label: t("settings.chatHealth.title"),
      value: formatBackupBytes(totalSizeBytes),
      tone: "text-foreground",
      testId: "telemetry-storage-size",
    },
  ];

  return (
    <div
      data-testid="chat-health-telemetry-bar"
      className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-center dark:bg-muted/20"
    >
      {metrics.map((metric) => (
        <div key={metric.label}>
          <div className="text-[11px] text-muted-foreground truncate">
            {metric.label}
          </div>
          <div
            data-testid={metric.testId}
            className={cn("text-base font-semibold tabular-nums", metric.tone)}
          >
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}
