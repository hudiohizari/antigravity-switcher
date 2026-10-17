export interface ConversationTitleRow {
  conversation_id: string;
  title?: string | null;
  agent_name?: string | null;
  parent_conversation_id?: string | null;
  nesting_depth?: number | null;
  preview?: string | null;
}

export function humanizeAgentName(raw?: string | null): string {
  if (!raw?.trim()) return "Subagent";
  let s = raw.trim();
  if (s.startsWith("teamwork_preview_document_")) s = s.slice(26);
  else if (s.startsWith("teamwork_preview_")) s = s.slice(17);
  else if (s === "teamwork_preview") return "Teamwork Preview";
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Subagent";
}

export function resolveConversationTitle(
  row: ConversationTitleRow,
  parentMap?: Map<string, string>,
  titleMap?: Map<string, string>,
  fallbackProjectName?: string | null,
): string {
  const direct = row.title?.trim();
  if (direct) return direct;

  const isSubagent = (row.nesting_depth != null && row.nesting_depth > 0) || Boolean(row.parent_conversation_id?.trim());
  const isGeneric = !fallbackProjectName?.trim() || fallbackProjectName.trim() === "Unknown Project" || fallbackProjectName.trim() === "Global / No Workspace";
  const projectPrefix = !isGeneric ? `[${fallbackProjectName!.trim()}] ` : "";

  if (isSubagent) {
    const agentName = humanizeAgentName(row.agent_name);
    let ancestorTitle: string | undefined;
    if (parentMap && titleMap) {
      let currentId: string | undefined = row.parent_conversation_id?.trim() || parentMap.get(row.conversation_id);
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId) && visited.size < 20) {
        visited.add(currentId);
        const t = titleMap.get(currentId)?.trim();
        if (t) { ancestorTitle = t; break; }
        currentId = parentMap.get(currentId);
      }
    }
    return ancestorTitle ? `${ancestorTitle} › ${agentName}` : `${projectPrefix}${agentName}`;
  }

  const snippet = row.preview?.trim().replace(/\r?\n/g, " ");
  if (snippet) return `${snippet.slice(0, 45)}...`;

  return `${projectPrefix}Untitled Conversation`;
}
