import type { BrokenChatItem, IntactParentInfo } from "./types";

export type { IntactParentInfo };

/** ID prefix of the synthesized row that groups subagents of a deleted chat. */
export const DELETED_SESSION_PREFIX = "deleted-session-";

export interface BuildSubagentTreeResult {
  conversations: BrokenChatItem[];
  topLevelCount: number;
}

function wouldCreateCycle(
  childId: string,
  targetParentId: string,
  parentLookup: Map<string, string>,
): boolean {
  let curr: string | undefined = targetParentId;
  const visited = new Set<string>();
  while (curr && !visited.has(curr)) {
    if (curr === childId) return true;
    visited.add(curr);
    curr = parentLookup.get(curr);
  }
  return false;
}

interface AncestorTrace {
  rootId: string;
  kind: "intact" | "broken" | "deleted";
}

function traceRootAncestor(
  startId: string,
  itemMap: Map<string, BrokenChatItem>,
  intactParents?:
    Map<string, IntactParentInfo> | ReadonlyMap<string, IntactParentInfo>,
  externalParentLookup?: Map<string, string> | ReadonlyMap<string, string>,
  knownConversationIds?: Set<string> | ReadonlySet<string>,
): AncestorTrace {
  let curr = startId;
  const visited = new Set<string>();

  while (curr && !visited.has(curr)) {
    visited.add(curr);

    if (intactParents?.has(curr)) {
      return { rootId: curr, kind: "intact" };
    }

    let nextParent: string | undefined;
    if (itemMap.has(curr)) {
      const item = itemMap.get(curr)!;
      nextParent = item.parentConversationId?.trim();
    } else if (externalParentLookup?.has(curr)) {
      nextParent = externalParentLookup.get(curr)?.trim();
    }

    if (!nextParent || nextParent === curr || visited.has(nextParent)) {
      if (
        itemMap.has(curr) ||
        (knownConversationIds && knownConversationIds.has(curr))
      ) {
        return { rootId: curr, kind: "broken" };
      }
      return { rootId: curr, kind: "deleted" };
    }

    curr = nextParent;
  }

  if (
    itemMap.has(curr) ||
    (knownConversationIds && knownConversationIds.has(curr))
  ) {
    return { rootId: curr, kind: "broken" };
  }
  return { rootId: curr, kind: "deleted" };
}

function getMaxDescendantUpdatedAt(item: BrokenChatItem): number | undefined {
  let max = item.updatedAt;
  if (item.subagents && item.subagents.length > 0) {
    for (const sub of item.subagents) {
      const subMax = getMaxDescendantUpdatedAt(sub);
      if (subMax !== undefined) {
        max = max !== undefined ? Math.max(max, subMax) : subMax;
      }
    }
  }
  return max;
}

/**
 * Builds a hierarchical subagent tree from a list of broken chat items
 * belonging to the same project group.
 *
 * Ancestor Root Tracing:
 * - Case A: Root ancestor is an Intact Main Chat (depth 0, in intactParents):
 *   Synthesize an intact parent container (isIntactParent: true).
 * - Case B: Root ancestor is a Broken Main Chat (depth 0, in broken list):
 *   Nest under that broken main chat row.
 * - Case C: Root ancestor is Missing / Deleted:
 *   Group all descendant subagents under a synthesized deleted session container
 *   (isDeletedSessionContainer: true, title: "Residual Subagents from Deleted Session").
 *
 * Top-level items are sorted descending by updatedAt.
 * Nested subagents are sorted ascending by updatedAt (chronological progression).
 */
export function buildSubagentTree(
  groupItems: BrokenChatItem[],
  intactParents?:
    Map<string, IntactParentInfo> | ReadonlyMap<string, IntactParentInfo>,
  externalParentLookup?: Map<string, string> | ReadonlyMap<string, string>,
  knownConversationIds?: Set<string> | ReadonlySet<string>,
): BuildSubagentTreeResult {
  if (groupItems.length === 0) {
    return { conversations: [], topLevelCount: 0 };
  }

  const itemMap = new Map<string, BrokenChatItem>();
  for (const item of groupItems) {
    item.subagents = undefined;
    itemMap.set(item.conversationId, item);
  }

  const topLevel: BrokenChatItem[] = [];
  const parentLookup = new Map<string, string>();
  const nestedChildIds = new Set<string>();

  // Pass 1: nest items whose parent is another broken chat in the same group
  for (const item of groupItems) {
    const parentId = item.parentConversationId?.trim();
    if (
      parentId &&
      itemMap.has(parentId) &&
      parentId !== item.conversationId &&
      !wouldCreateCycle(item.conversationId, parentId, parentLookup)
    ) {
      const parent = itemMap.get(parentId)!;
      if (!parent.subagents) {
        parent.subagents = [];
      }
      parent.subagents.push(item);
      parentLookup.set(item.conversationId, parentId);
      nestedChildIds.add(item.conversationId);
    }
  }

  // Pass 2: group heads under intact parent containers or deleted session containers
  const intactContainers = new Map<string, BrokenChatItem>();
  const deletedContainers = new Map<string, BrokenChatItem>();

  for (const item of groupItems) {
    if (nestedChildIds.has(item.conversationId)) {
      continue;
    }

    const parentId = item.parentConversationId?.trim();
    if (!parentId || parentId === item.conversationId) {
      topLevel.push(item);
      continue;
    }

    const trace = traceRootAncestor(
      item.conversationId,
      itemMap,
      intactParents,
      externalParentLookup,
      knownConversationIds,
    );

    if (trace.kind === "intact") {
      let container = intactContainers.get(trace.rootId);
      if (!container) {
        const intactParent = intactParents?.get(trace.rootId);
        container = {
          conversationId: trace.rootId,
          title: intactParent?.title || trace.rootId,
          updatedAt: intactParent?.updatedAt,
          isIntactParent: true,
          hasBackup: false,
          subagents: [],
        };
        intactContainers.set(trace.rootId, container);
      }
      container.subagents!.push(item);
    } else if (trace.kind === "deleted") {
      let container = deletedContainers.get(trace.rootId);
      if (!container) {
        container = {
          conversationId: `${DELETED_SESSION_PREFIX}${trace.rootId}`,
          title: "Residual Subagents from Deleted Session",
          isDeletedSessionContainer: true,
          hasBackup: false,
          subagents: [],
        };
        deletedContainers.set(trace.rootId, container);
      }
      container.subagents!.push(item);
    } else {
      topLevel.push(item);
    }
  }

  // Finalize intact parent containers
  for (const [parentId, container] of intactContainers) {
    const subagents = container.subagents ?? [];
    const intactParent = intactParents?.get(parentId);
    let maxSubUpdatedAt: number | undefined;
    for (const sub of subagents) {
      const subMax = getMaxDescendantUpdatedAt(sub);
      if (subMax !== undefined) {
        maxSubUpdatedAt =
          maxSubUpdatedAt !== undefined
            ? Math.max(maxSubUpdatedAt, subMax)
            : subMax;
      }
    }
    container.updatedAt = intactParent?.updatedAt ?? maxSubUpdatedAt;
    topLevel.push(container);
  }

  // Finalize deleted session containers
  for (const [, container] of deletedContainers) {
    const subagents = container.subagents ?? [];
    let maxSubUpdatedAt: number | undefined;
    for (const sub of subagents) {
      const subMax = getMaxDescendantUpdatedAt(sub);
      if (subMax !== undefined) {
        maxSubUpdatedAt =
          maxSubUpdatedAt !== undefined
            ? Math.max(maxSubUpdatedAt, subMax)
            : subMax;
      }
    }
    container.updatedAt = maxSubUpdatedAt;
    topLevel.push(container);
  }

  // Sort top-level items descending by updatedAt (most recent first)
  topLevel.sort((a, b) => {
    const diff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    return diff !== 0 ? diff : a.conversationId.localeCompare(b.conversationId);
  });

  // Sort each parent's subagents ascending by updatedAt (chronological progression)
  const visitedSort = new Set<string>();
  function sortSubagents(node: BrokenChatItem) {
    if (visitedSort.has(node.conversationId)) return;
    visitedSort.add(node.conversationId);
    if (node.subagents && node.subagents.length > 0) {
      node.subagents.sort((a, b) => {
        const diff = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
        return diff !== 0
          ? diff
          : a.conversationId.localeCompare(b.conversationId);
      });
      for (const child of node.subagents) {
        sortSubagents(child);
      }
    }
  }

  for (const root of topLevel) {
    sortSubagents(root);
  }

  return {
    conversations: topLevel,
    topLevelCount: topLevel.length,
  };
}

/**
 * Every real broken chat in a tree, nested subagents included. Synthesized
 * container rows (intact parents, deleted sessions) are skipped because they
 * are not broken chats themselves.
 */
export function flattenBrokenChats(items: BrokenChatItem[]): BrokenChatItem[] {
  return items.flatMap((item) => [
    ...(item.isIntactParent || item.isDeletedSessionContainer ? [] : [item]),
    ...flattenBrokenChats(item.subagents ?? []),
  ]);
}

/**
 * Recursively collects all descendant subagent conversation IDs under a given container CID.
 * Does not include the container CID itself.
 */
export function collectDescendantCids(
  groups: { conversations: BrokenChatItem[] }[] | undefined,
  containerCid: string,
): string[] {
  if (!groups || !containerCid) return [];
  const cids: string[] = [];

  function collect(item: BrokenChatItem) {
    cids.push(item.conversationId);
    if (item.subagents) {
      for (const child of item.subagents) {
        collect(child);
      }
    }
  }

  function search(items: BrokenChatItem[]): boolean {
    for (const item of items) {
      if (item.conversationId === containerCid) {
        if (item.subagents) {
          for (const sub of item.subagents) {
            collect(sub);
          }
        }
        return true;
      }
      if (item.subagents && search(item.subagents)) {
        return true;
      }
    }
    return false;
  }

  for (const group of groups) {
    if (search(group.conversations)) break;
  }

  return cids;
}
