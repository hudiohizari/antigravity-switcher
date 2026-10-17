import { useState } from "react";
import { Archive, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { BackupSnapshot } from "@/modules/antigravity-runtime/backup/chatBackup";
import { ChatHealthSnapshotRow } from "./ChatHealthSnapshotRow";

interface ChatHealthSnapshotListProps {
  snapshots: BackupSnapshot[];
  expandedIds: Set<string>;
  onToggleAccordion: (id: string) => void;
  onRestoreFull: (snapshotId: string) => void;
  onRestoreSingle: (snapshotId: string, cid: string) => void;
  onPruneSingle?: (cid: string) => void;
  brokenCids: Set<string>;
  showAll: boolean;
  onToggleShowAll?: () => void;
  disabled?: boolean;
}

export function ChatHealthSnapshotList({
  snapshots,
  expandedIds,
  onToggleAccordion,
  onRestoreFull,
  onRestoreSingle,
  onPruneSingle,
  brokenCids,
  showAll,
  onToggleShowAll,
  disabled = false,
}: ChatHealthSnapshotListProps) {
  const { t } = useTranslation();
  const [isExpandedList, setIsExpandedList] = useState(false);

  if (snapshots.length === 0) {
    return null;
  }

  const qualifyingSnapshots = showAll
    ? snapshots
    : snapshots.filter((snap) => (snap.chatCount ?? 0) > 0);

  if (!showAll && qualifyingSnapshots.length === 0) {
    return (
      <div
        data-testid="chat-health-synced-card"
        className="rounded-lg border border-border/60 bg-muted/20 p-4 text-center space-y-2"
      >
        <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          <h4 className="font-semibold text-sm text-foreground">
            {t("settings.chatHealth.allSyncedTitle")}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          {t("settings.chatHealth.allSyncedDesc")}
        </p>
        {onToggleShowAll && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleShowAll}
            className="text-xs text-muted-foreground hover:text-foreground h-8 min-h-[32px] cursor-pointer"
          >
            {t("settings.chatHealth.inspectFullHistory")}
          </Button>
        )}
      </div>
    );
  }

  const displayedSnapshots = isExpandedList
    ? qualifyingSnapshots
    : qualifyingSnapshots.slice(0, 5);
  const hasMore = qualifyingSnapshots.length > 5;
  const olderCount = qualifyingSnapshots.length - 5;

  return (
    <div data-testid="chat-health-snapshot-list" className="space-y-2 pt-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1 border-b border-border/40 pb-1">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          Backups
        </span>
        <span className="font-mono text-[11px] tabular-nums">
          {qualifyingSnapshots.length} snapshots
        </span>
      </div>

      <div
        id={isExpandedList ? "older-snapshots-panel" : undefined}
        className="space-y-2"
      >
        {displayedSnapshots.map((snap) => (
          <ChatHealthSnapshotRow
            key={snap.id}
            snapshot={snap}
            isExpanded={expandedIds.has(snap.id)}
            onToggle={() => onToggleAccordion(snap.id)}
            onRestoreFull={() => onRestoreFull(snap.id)}
            onRestoreSingle={(cid) => onRestoreSingle(snap.id, cid)}
            onPruneSingle={onPruneSingle}
            brokenCids={brokenCids}
            showAll={showAll}
            disabled={disabled}
          />
        ))}
      </div>

      {hasMore && (
        <div className="pt-1 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpandedList(!isExpandedList)}
            aria-expanded={isExpandedList}
            aria-controls="older-snapshots-panel"
            className="w-full sm:w-auto min-h-[36px] sm:min-h-[32px] text-xs font-medium text-muted-foreground hover:text-foreground gap-1.5 cursor-pointer"
          >
            {isExpandedList ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t("settings.chatHealth.showFewerSnapshots")}</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {t("settings.chatHealth.showOlderSnapshots", {
                    count: olderCount,
                  })}
                </span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
