import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatBackupBytes } from "./ChatHealthTelemetryBar";

interface ChatHealthStorageWarningBannerProps {
  totalSizeBytes: number;
  onPruneBackups: () => void;
  disabled?: boolean;
}

export function ChatHealthStorageWarningBanner({
  totalSizeBytes,
  onPruneBackups,
  disabled = false,
}: ChatHealthStorageWarningBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="storage-warning-banner"
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
    >
      <div className="flex items-center space-x-2">
        <HardDrive className="h-4 w-4 shrink-0" />
        <span>
          {t("settings.chatHealth.storageWarning", {
            size: formatBackupBytes(totalSizeBytes),
          })}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={onPruneBackups}
        className="h-7 text-xs border-amber-500/40 hover:bg-amber-500/20 self-start sm:self-auto min-h-[32px]"
      >
        {t("settings.chatHealth.pruneBackups")}
      </Button>
    </div>
  );
}
