import { useState } from "react";
import {
  RotateCcw,
  Trash2,
  Archive,
  Sparkles,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/ui/utils";
import type { BrokenChatItem } from "@/modules/antigravity-runtime/conversation/types";

interface ChatHealthOrphanRowProps {
  chat: BrokenChatItem;
  projectName?: string;
  onRestore: (snapshotId: string, cid: string) => void;
  onPrune: (cid: string) => void;
  onHeal?: (cid: string) => void;
  disabled?: boolean;
  isNested?: boolean;
}

export function ChatHealthOrphanRow({
  chat,
  projectName,
  onRestore,
  onPrune,
  onHeal,
  disabled = false,
  isNested = false,
}: ChatHealthOrphanRowProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const maskedId =
    chat.conversationId.length > 8
      ? `${chat.conversationId.slice(0, 8)}...`
      : chat.conversationId;

  const hasSubagents = Boolean(chat.subagents && chat.subagents.length > 0);
  const isStandaloneSubagent = Boolean(
    !isNested &&
    !chat.isDeletedSessionContainer &&
    (chat.parentConversationId || chat.parentTitle) &&
    !hasSubagents,
  );

  const parentDisplayTitle =
    chat.parentTitle ||
    (chat.parentConversationId
      ? chat.parentConversationId.length > 8
        ? `${chat.parentConversationId.slice(0, 8)}...`
        : chat.parentConversationId
      : "");

  const displayTitle = chat.isDeletedSessionContainer
    ? t("settings.chatHealth.deletedSessionTitle")
    : chat.title;

  const formattedDate = chat.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(chat.updatedAt))
    : null;

  const buttonSizeClass = isNested
    ? "h-7 px-2 text-[11px] min-h-[30px]"
    : "h-8 px-2.5 text-xs min-h-[32px] sm:min-h-[32px]";
  const iconSizeClass = isNested ? "mr-1 h-3 w-3" : "mr-1.5 h-3.5 w-3.5";

  return (
    <div
      data-testid={
        isNested
          ? `subagent-row-${chat.conversationId}`
          : `orphan-row-group-${chat.conversationId}`
      }
      className="space-y-1"
    >
      <div
        data-testid={`orphan-row-${chat.conversationId}`}
        className={cn(
          "flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-md border border-border/40 transition-colors text-xs",
          isNested
            ? "bg-muted/10 hover:bg-muted/25"
            : "bg-muted/20 hover:bg-muted/40",
        )}
      >
        <div className="flex flex-col min-w-0 pr-2">
          <div className="flex items-center space-x-2">
            {isNested && (
              <Bot
                className="h-3.5 w-3.5 text-purple-400 shrink-0"
                aria-hidden="true"
              />
            )}
            {chat.agentName && (
              <Badge
                variant="outline"
                className="inline-flex items-center gap-1 px-1.5 py-0 h-4 text-[10px] font-mono border-sky-500/30 bg-sky-500/10 text-sky-400 rounded shrink-0"
              >
                {chat.agentName}
              </Badge>
            )}
            <span
              className="truncate max-w-[220px] sm:max-w-[340px] font-medium text-foreground"
              title={displayTitle}
            >
              {displayTitle}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">
              {maskedId}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {chat.isIntactParent && (
              <Badge
                variant="outline"
                title={t("settings.chatHealth.intactParentTooltip")}
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] px-1.5 py-0"
              >
                {t("settings.chatHealth.intactParentBadge")}
              </Badge>
            )}

            {chat.isDeletedSessionContainer && (
              <Badge
                variant="outline"
                title={t("settings.chatHealth.deletedSessionTooltip")}
                className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-[10px] px-1.5 py-0"
              >
                {t("settings.chatHealth.deletedSessionBadge")}
              </Badge>
            )}

            {isStandaloneSubagent && (
              <>
                <Badge
                  variant="outline"
                  aria-label={t("settings.chatHealth.subagentBadge")}
                  className="inline-flex items-center gap-1 px-1.5 py-0 h-4 text-[10px] font-medium border-purple-500/30 bg-purple-500/10 text-purple-400 rounded shrink-0"
                >
                  <Bot className="h-2.5 w-2.5" />
                  {t("settings.chatHealth.subagentBadge")}
                </Badge>
                {parentDisplayTitle && (
                  <span
                    className="text-[10px] text-muted-foreground truncate max-w-[180px] sm:max-w-[240px]"
                    title={parentDisplayTitle}
                  >
                    {t("settings.chatHealth.parentChat", {
                      title: parentDisplayTitle,
                    })}
                  </span>
                )}
              </>
            )}

            {!isNested && !isStandaloneSubagent && projectName && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                {projectName}
              </span>
            )}

            {formattedDate && (
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {formattedDate}
              </span>
            )}

            {chat.hasBackup && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 h-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono"
              >
                <Archive className="mr-0.5 h-2.5 w-2.5 inline" />
                Restorable
              </Badge>
            )}

            {hasSubagents && (
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={`subagents-${chat.conversationId}`}
                onClick={() => setIsExpanded((prev) => !prev)}
                className="h-5 px-2 text-[10px] font-mono rounded bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 border border-border/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                    isExpanded && "rotate-90",
                  )}
                  aria-hidden="true"
                />
                <span>
                  {t("settings.chatHealth.subagentsCount", {
                    count: chat.subagents!.length,
                  })}
                </span>
              </button>
            )}
          </div>
        </div>

        {!chat.isIntactParent && (
          <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
            {!chat.isDeletedSessionContainer && !chat.hasBackup && onHeal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onHeal(chat.conversationId)}
                className={cn(
                  buttonSizeClass,
                  "border-teal-500/30 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 active:bg-teal-500/20 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1",
                )}
                aria-label={`${t("settings.chatHealth.heal")}: ${chat.title}`}
                title={t("settings.chatHealth.healTooltip")}
              >
                <Sparkles className={iconSizeClass} />
                {t("settings.chatHealth.heal")}
              </Button>
            )}
            {!chat.isDeletedSessionContainer &&
              chat.hasBackup &&
              chat.matchingSnapshotId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    onRestore(chat.matchingSnapshotId!, chat.conversationId)
                  }
                  className={buttonSizeClass}
                  title={t("settings.chatHealth.restoreTooltip")}
                >
                  <RotateCcw className={iconSizeClass} />
                  {t("settings.chatHealth.restoreChat")}
                </Button>
              )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onPrune(chat.conversationId)}
              className={cn(
                buttonSizeClass,
                "text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-destructive/10",
              )}
            >
              <Trash2 className={iconSizeClass} />
              {chat.isDeletedSessionContainer
                ? t("settings.chatHealth.pruneDeletedSession")
                : t("settings.chatHealth.pruneChat")}
            </Button>
          </div>
        )}
      </div>

      {hasSubagents && isExpanded && (
        <div
          id={`subagents-${chat.conversationId}`}
          role="region"
          aria-label={t("settings.chatHealth.subagentsCount", {
            count: chat.subagents!.length,
          })}
          className="pl-4 sm:pl-6 ml-2 sm:ml-3 mt-1.5 border-l-2 border-border/40 space-y-1.5 py-1"
        >
          {chat.subagents!.map((subagent) => (
            <ChatHealthOrphanRow
              key={subagent.conversationId}
              chat={subagent}
              projectName={projectName}
              onRestore={onRestore}
              onPrune={onPrune}
              onHeal={onHeal}
              disabled={disabled}
              isNested
            />
          ))}
        </div>
      )}
    </div>
  );
}
