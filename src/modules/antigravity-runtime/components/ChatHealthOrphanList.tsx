import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Trash2,
  Sparkles,
  Search,
  X,
  SearchX,
  Folder,
  ChevronDown,
  ChevronsUpDown,
  RotateCcw,
  HelpCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/ui/utils";
import {
  CONVERSATION_CLEANER_CONSTANTS,
  type BrokenChatItem,
  type BrokenProjectGroup,
} from "@/modules/antigravity-runtime/conversation/types";
import { flattenBrokenChats } from "@/modules/antigravity-runtime/conversation/subagentTree";
import { ChatHealthOrphanRow } from "./ChatHealthOrphanRow";

interface ChatHealthOrphanListProps {
  projectGroups: BrokenProjectGroup[];
  onRestore: (snapshotId: string, cid: string) => void;
  onPruneSingle: (cid: string) => void;
  onPruneAll: () => void;
  onHealSingle?: (cid: string) => void;
  onHealAll?: () => void;
  disabled?: boolean;
}

function matchesChatOrSubagents(chat: BrokenChatItem, query: string): boolean {
  if (chat.title.toLowerCase().includes(query)) return true;
  if (chat.conversationId.toLowerCase().includes(query)) return true;
  if (chat.agentName?.toLowerCase().includes(query)) return true;
  if (chat.subagents && chat.subagents.length > 0) {
    return chat.subagents.some((sub) => matchesChatOrSubagents(sub, query));
  }
  return false;
}

export function ChatHealthOrphanList({
  projectGroups,
  onRestore,
  onPruneSingle,
  onPruneAll,
  onHealSingle,
  onHealAll,
  disabled = false,
}: ChatHealthOrphanListProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);

  const getGroupKey = (group: BrokenProjectGroup) =>
    `${group.projectName}-${group.workspacePath}`;

  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    () => {
      if (
        projectGroups.length <=
        CONVERSATION_CLEANER_CONSTANTS.ACCORDION_EXPAND_THRESHOLD
      ) {
        return new Set(projectGroups.map(getGroupKey));
      }
      return new Set();
    },
  );

  const totalBroken = projectGroups.reduce((acc, g) => acc + g.brokenCount, 0);

  const filteredGroups = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return projectGroups;

    return projectGroups
      .map((group) => {
        const groupNameMatches = group.projectName
          .toLowerCase()
          .includes(trimmed);
        if (groupNameMatches) {
          return group;
        }
        const matchingConversations = group.conversations.filter((chat) =>
          matchesChatOrSubagents(chat, trimmed),
        );
        if (matchingConversations.length === 0) return null;
        return {
          ...group,
          conversations: matchingConversations,
          brokenCount: flattenBrokenChats(matchingConversations).length,
        };
      })
      .filter((g): g is BrokenProjectGroup => g !== null);
  }, [projectGroups, searchQuery]);

  if (totalBroken === 0) {
    return null;
  }

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      const matchingKeys = projectGroups
        .filter((group) => {
          if (group.projectName.toLowerCase().includes(trimmed)) return true;
          return group.conversations.some((c) =>
            matchesChatOrSubagents(c, trimmed),
          );
        })
        .map(getGroupKey);
      setExpandedGroupKeys(new Set(matchingKeys));
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    if (
      projectGroups.length <=
      CONVERSATION_CLEANER_CONSTANTS.ACCORDION_EXPAND_THRESHOLD
    ) {
      setExpandedGroupKeys(new Set(projectGroups.map(getGroupKey)));
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allExpanded =
    filteredGroups.length > 0 &&
    filteredGroups.every((g) => expandedGroupKeys.has(getGroupKey(g)));

  const handleToggleAll = () => {
    if (allExpanded) {
      setExpandedGroupKeys(new Set());
    } else {
      setExpandedGroupKeys(new Set(filteredGroups.map(getGroupKey)));
    }
  };

  return (
    <div data-testid="chat-health-orphan-list" className="space-y-3">
      <div className="space-y-2.5 border-b border-border/40 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Badge
              variant="outline"
              className="border-rose-500/30 bg-destructive/10 text-rose-600 dark:text-rose-400 text-xs px-2 py-0.5"
            >
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              {t("settings.chatHealth.statusBroken", { count: totalBroken })}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="heal-vs-restore-help-btn"
              onClick={() => setShowGuidance((prev) => !prev)}
              aria-label={t("settings.chatHealth.healVsRestoreTitle")}
              title={t("settings.chatHealth.healVsRestoreDesc")}
              aria-expanded={showGuidance}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted/50 min-h-[24px]"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || filteredGroups.length === 0}
              onClick={handleToggleAll}
              aria-label={
                allExpanded
                  ? t("settings.chatHealth.collapseAll")
                  : t("settings.chatHealth.expandAll")
              }
              className="h-8 px-2.5 text-xs min-h-[32px] sm:min-h-[32px] border-border/60 hover:bg-muted/40 font-medium"
            >
              <ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />
              {allExpanded
                ? t("settings.chatHealth.collapseAll")
                : t("settings.chatHealth.expandAll")}
            </Button>
            {onHealAll && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={onHealAll}
                aria-label={t("settings.chatHealth.healAllBroken")}
                className="h-8 text-xs px-3 min-h-[32px] sm:min-h-[32px] border-teal-500/30 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 active:bg-teal-500/20 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t("settings.chatHealth.healAllBroken")}
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={disabled}
              onClick={onPruneAll}
              className="h-8 text-xs px-3 min-h-[32px] sm:min-h-[32px]"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.chatHealth.pruneAllBroken")}
            </Button>
          </div>
        </div>

        {showGuidance && (
          <div
            data-testid="heal-vs-restore-guidance"
            role="region"
            aria-label={t("settings.chatHealth.healVsRestoreTitle")}
            className="flex items-start justify-between gap-2 p-2.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-xs text-foreground"
          >
            <div className="flex items-start space-x-2 min-w-0">
              <HelpCircle
                className="h-4 w-4 text-sky-500 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div className="space-y-0.5 min-w-0">
                <span className="font-semibold text-sky-600 dark:text-sky-400 block">
                  {t("settings.chatHealth.healVsRestoreTitle")}
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  {t("settings.chatHealth.healVsRestoreDesc")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowGuidance(false)}
              aria-label={t("settings.chatHealth.cancel")}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            role="searchbox"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                handleClearSearch();
              }
            }}
            placeholder={t("settings.chatHealth.searchPlaceholder")}
            aria-label={t("settings.chatHealth.searchPlaceholder")}
            className="h-9 min-h-[36px] w-full pl-9 pr-8 text-xs bg-muted/20 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={t("settings.chatHealth.clearSearch")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary inline-flex items-center justify-center"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {filteredGroups.length === 0 && searchQuery.trim().length > 0 ? (
        <div
          data-testid="chat-health-search-empty"
          className="rounded-lg border border-dashed border-border/60 p-8 text-center space-y-3"
        >
          <SearchX className="h-7 w-7 text-muted-foreground/60 mx-auto" />
          <p className="text-xs font-semibold text-foreground">
            {t("settings.chatHealth.noSearchResults", { query: searchQuery })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearSearch}
            className="h-8 text-xs min-h-[32px] mx-auto border-border/60"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.chatHealth.clearSearch")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => {
            const key = getGroupKey(group);
            const isExpanded = expandedGroupKeys.has(key);
            const panelId = `group-panel-${encodeURIComponent(key)}`;
            const headerId = `group-header-${encodeURIComponent(key)}`;

            return (
              <div
                key={key}
                data-testid={`workspace-group-${group.projectName}`}
                className="border border-border/50 rounded-lg bg-card/40 overflow-hidden divide-y divide-border/20"
              >
                <button
                  type="button"
                  id={headerId}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center justify-between p-2.5 sm:px-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 select-none min-h-[44px] sm:min-h-[36px]"
                >
                  <div className="flex items-center space-x-2 min-w-0 pr-2">
                    <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground truncate max-w-[220px] sm:max-w-[320px]">
                      {group.projectName}
                    </span>
                    {group.workspacePath && (
                      <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[180px] sm:max-w-[280px]">
                        {group.workspacePath}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <Badge
                      variant="outline"
                      className="border-rose-500/30 bg-destructive/10 text-rose-600 dark:text-rose-400 text-[11px] font-mono px-1.5 py-0 h-4"
                    >
                      {group.brokenCount} broken
                    </Badge>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform duration-200",
                        !isExpanded && "-rotate-90",
                      )}
                      aria-hidden="true"
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={headerId}
                    className="space-y-1.5 p-2"
                  >
                    {group.conversations.map((chat) => (
                      <ChatHealthOrphanRow
                        key={chat.conversationId}
                        chat={chat}
                        projectName={group.projectName}
                        onRestore={onRestore}
                        onPrune={onPruneSingle}
                        onHeal={onHealSingle}
                        disabled={disabled}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
