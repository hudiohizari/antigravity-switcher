import { AlertTriangle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BrokenProjectGroup } from "@/modules/antigravity-runtime/conversation/types";
import { ChatHealthOrphanRow } from "./ChatHealthOrphanRow";

interface ChatHealthOrphanListProps {
  projectGroups: BrokenProjectGroup[];
  onRestore: (snapshotId: string, cid: string) => void;
  onPruneSingle: (cid: string) => void;
  onPruneAll: () => void;
  disabled?: boolean;
}

export function ChatHealthOrphanList({
  projectGroups,
  onRestore,
  onPruneSingle,
  onPruneAll,
  disabled = false,
}: ChatHealthOrphanListProps) {
  const { t } = useTranslation();

  const totalBroken = projectGroups.reduce((acc, g) => acc + g.brokenCount, 0);

  if (totalBroken === 0) {
    return null;
  }

  return (
    <div data-testid="chat-health-orphan-list" className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center space-x-2">
          <Badge
            variant="outline"
            className="border-rose-500/30 bg-destructive/10 text-rose-600 dark:text-rose-400 text-xs px-2 py-0.5"
          >
            <AlertTriangle className="mr-1 h-3.5 w-3.5" />
            {t("settings.chatHealth.statusBroken", { count: totalBroken })}
          </Badge>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={onPruneAll}
          className="h-8 text-xs px-3 min-h-[32px] sm:min-h-[32px] self-start sm:self-auto"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.chatHealth.pruneAllBroken")}
        </Button>
      </div>

      <div className="space-y-3">
        {projectGroups.map((group) => (
          <div
            key={`${group.projectName}-${group.workspacePath}`}
            className="space-y-1.5"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span className="font-semibold text-foreground">
                {group.projectName}
              </span>
              <span className="text-[11px] font-mono">
                {group.brokenCount} broken
              </span>
            </div>
            <div className="space-y-1.5">
              {group.conversations.map((chat) => (
                <ChatHealthOrphanRow
                  key={chat.conversationId}
                  chat={chat}
                  projectName={group.projectName}
                  onRestore={onRestore}
                  onPrune={onPruneSingle}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
