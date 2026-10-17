import { RotateCcw, ChevronDown, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/ui/utils";
import type { BackupSnapshot } from "@/modules/antigravity-runtime/backup/chatBackup";
import { formatBackupBytes } from "./ChatHealthTelemetryBar";

interface ChatHealthSnapshotRowProps {
  snapshot: BackupSnapshot;
  isExpanded: boolean;
  onToggle: () => void;
  onRestoreFull: () => void;
  onRestoreSingle: (cid: string) => void;
  onPruneSingle?: (cid: string) => void;
  brokenCids?: Set<string>;
  showAll?: boolean;
  disabled?: boolean;
}

export function ChatHealthSnapshotRow({
  snapshot,
  isExpanded,
  onToggle,
  onRestoreFull,
  onRestoreSingle,
  onPruneSingle,
  brokenCids,
  showAll = false,
  disabled = false,
}: ChatHealthSnapshotRowProps) {
  const { t } = useTranslation();

  const formattedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(snapshot.createdAt));

  const visibleChats = showAll
    ? snapshot.chats
    : snapshot.chats.filter((c) => brokenCids?.has(c.conversationId));

  const hiddenCount = snapshot.chats.length - visibleChats.length;

  return (
    <div
      data-testid={`snapshot-row-${snapshot.id}`}
      className="rounded-lg border border-border/60 bg-muted/20 dark:bg-muted/10 p-3 space-y-2"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {formattedDate}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatBackupBytes(snapshot.sizeBytes)}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 font-mono"
          >
            {snapshot.chatCount} chats
          </Badge>
        </div>
        <div className="flex items-center space-x-1.5 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onRestoreFull}
            className="h-8 text-xs min-h-[32px] sm:min-h-[32px]"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.chatHealth.restoreSnapshot")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={isExpanded}
            aria-controls={`snapshot-panel-${snapshot.id}`}
            aria-label={isExpanded ? "Collapse snapshot" : "Expand snapshot"}
            onClick={onToggle}
            className="h-8 w-8 p-0 min-h-[32px] min-w-[32px]"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
            />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div
          id={`snapshot-panel-${snapshot.id}`}
          className="divide-y divide-border/20 border-t border-border/40 pt-2 space-y-1.5"
        >
          {!showAll && hiddenCount > 0 && (
            <div
              data-testid={`hidden-indicator-${snapshot.id}`}
              className="text-[11px] text-muted-foreground bg-muted/40 px-2.5 py-1 rounded italic flex items-center justify-between"
            >
              <span>{hiddenCount} healthy conversations hidden by filter</span>
              <span className="font-mono text-[10px]">
                {visibleChats.length} / {snapshot.chatCount} shown
              </span>
            </div>
          )}

          {visibleChats.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1.5 px-1">
              {t("settings.chatHealth.filterStaleOnly")}
            </p>
          ) : (
            visibleChats.map((chat) => {
              const isBroken = brokenCids?.has(chat.conversationId);
              const maskedId =
                chat.conversationId.length > 8
                  ? `${chat.conversationId.slice(0, 8)}...`
                  : chat.conversationId;

              return (
                <div
                  key={chat.conversationId}
                  data-testid={`chat-row-${chat.conversationId}`}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 text-xs transition-colors"
                >
                  <div className="flex min-w-0 items-center space-x-2 pr-2">
                    <span
                      className="truncate max-w-[180px] sm:max-w-[320px] font-medium text-foreground"
                      title={chat.title}
                    >
                      {chat.title}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {maskedId}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onRestoreSingle(chat.conversationId)}
                      className="h-7 px-2 text-xs min-h-[32px]"
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      {t("settings.chatHealth.restoreChat")}
                    </Button>
                    {isBroken && onPruneSingle && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onPruneSingle(chat.conversationId)}
                        className="h-7 px-2 text-xs min-h-[32px] text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-destructive/10"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t("settings.chatHealth.pruneChat")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
