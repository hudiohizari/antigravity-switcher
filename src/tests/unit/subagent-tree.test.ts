import { describe, it, expect } from "vitest";
import {
  buildSubagentTree,
  flattenBrokenChats,
  DELETED_SESSION_PREFIX,
} from "@/modules/antigravity-runtime/conversation/subagentTree";
import type { BrokenChatItem } from "@/modules/antigravity-runtime/conversation/types";

describe("buildSubagentTree", () => {
  it("returns empty result when given empty items array", () => {
    const result = buildSubagentTree([]);
    expect(result.conversations).toEqual([]);
    expect(result.topLevelCount).toBe(0);
  });

  it("handles single top-level conversation without subagents", () => {
    const items: BrokenChatItem[] = [
      {
        conversationId: "root-1",
        title: "Root Conversation",
        updatedAt: 1000,
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBe(1);
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].conversationId).toBe("root-1");
    expect(result.conversations[0].subagents).toBeUndefined();
  });

  it("nests subagents under their parent in chronological ascending order", () => {
    const items: BrokenChatItem[] = [
      {
        conversationId: "parent-1",
        title: "Parent Cascade",
        updatedAt: 1000,
      },
      {
        conversationId: "sub-3",
        title: "Subagent Three",
        updatedAt: 1300,
        parentConversationId: "parent-1",
      },
      {
        conversationId: "sub-1",
        title: "Subagent One",
        updatedAt: 1100,
        parentConversationId: "parent-1",
      },
      {
        conversationId: "sub-2",
        title: "Subagent Two",
        updatedAt: 1200,
        parentConversationId: "parent-1",
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBe(1);
    expect(result.conversations.length).toBe(1);

    const parent = result.conversations[0];
    expect(parent.conversationId).toBe("parent-1");
    expect(parent.subagents?.map((s) => s.conversationId)).toEqual([
      "sub-1",
      "sub-2",
      "sub-3",
    ]);
  });

  it("sorts top-level items descending by updatedAt", () => {
    const items: BrokenChatItem[] = [
      { conversationId: "early", title: "Early", updatedAt: 100 },
      { conversationId: "late", title: "Late", updatedAt: 500 },
      { conversationId: "middle", title: "Middle", updatedAt: 300 },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBe(3);
    expect(result.conversations.map((c) => c.conversationId)).toEqual([
      "late",
      "middle",
      "early",
    ]);
  });

  it("resolves multi-level nesting recursively", () => {
    const items: BrokenChatItem[] = [
      { conversationId: "lvl-0", title: "Level 0", updatedAt: 1000 },
      {
        conversationId: "lvl-1",
        title: "Level 1",
        updatedAt: 1100,
        parentConversationId: "lvl-0",
      },
      {
        conversationId: "lvl-2",
        title: "Level 2",
        updatedAt: 1200,
        parentConversationId: "lvl-1",
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBe(1);
    expect(result.conversations[0].conversationId).toBe("lvl-0");

    const lvl1 = result.conversations[0].subagents?.[0];
    expect(lvl1?.conversationId).toBe("lvl-1");

    const lvl2 = lvl1?.subagents?.[0];
    expect(lvl2?.conversationId).toBe("lvl-2");
  });

  it("breaks ties with conversationId when timestamps are identical", () => {
    const items: BrokenChatItem[] = [
      { conversationId: "conv-b", title: "B", updatedAt: 100 },
      { conversationId: "conv-a", title: "A", updatedAt: 100 },
      {
        conversationId: "sub-z",
        title: "Z",
        updatedAt: 200,
        parentConversationId: "conv-a",
      },
      {
        conversationId: "sub-y",
        title: "Y",
        updatedAt: 200,
        parentConversationId: "conv-a",
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.conversations.map((c) => c.conversationId)).toEqual([
      "conv-a",
      "conv-b",
    ]);

    const subagents = result.conversations[0].subagents;
    expect(subagents?.map((s) => s.conversationId)).toEqual(["sub-y", "sub-z"]);
  });

  it("prevents self-referencing item from crashing or dropping", () => {
    const items: BrokenChatItem[] = [
      {
        conversationId: "self-ref",
        title: "Self",
        updatedAt: 100,
        parentConversationId: "self-ref",
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBe(1);
    expect(result.conversations[0].conversationId).toBe("self-ref");
    expect(result.conversations[0].subagents).toBeUndefined();
  });

  it("prevents circular references among three items without data loss", () => {
    const items: BrokenChatItem[] = [
      {
        conversationId: "cycle-1",
        title: "C1",
        updatedAt: 100,
        parentConversationId: "cycle-3",
      },
      {
        conversationId: "cycle-2",
        title: "C2",
        updatedAt: 200,
        parentConversationId: "cycle-1",
      },
      {
        conversationId: "cycle-3",
        title: "C3",
        updatedAt: 300,
        parentConversationId: "cycle-2",
      },
    ];

    const result = buildSubagentTree(items);
    expect(result.topLevelCount).toBeGreaterThanOrEqual(1);

    const allResolvedIds = new Set<string>();
    function collect(node: BrokenChatItem) {
      allResolvedIds.add(node.conversationId);
      for (const child of node.subagents ?? []) {
        collect(child);
      }
    }
    for (const c of result.conversations) {
      collect(c);
    }

    expect(allResolvedIds.size).toBe(3);
    expect(allResolvedIds.has("cycle-1")).toBe(true);
    expect(allResolvedIds.has("cycle-2")).toBe(true);
    expect(allResolvedIds.has("cycle-3")).toBe(true);
  });

  describe("intact parent grouping", () => {
    it("groups broken subagents under intact parent container with chronological order", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "sub-2",
          title: "Subagent Two",
          updatedAt: 1200,
          parentConversationId: "intact-p1",
        },
        {
          conversationId: "sub-1",
          title: "Subagent One",
          updatedAt: 1100,
          parentConversationId: "intact-p1",
        },
      ];

      const intactParents = new Map([
        [
          "intact-p1",
          {
            title: "Healthy Main Chat",
            updatedAt: 1000,
            workspaceUris: "file:///workspace",
          },
        ],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(1);
      expect(result.conversations.length).toBe(1);

      const parent = result.conversations[0];
      expect(parent.conversationId).toBe("intact-p1");
      expect(parent.title).toBe("Healthy Main Chat");
      expect(parent.updatedAt).toBe(1000);
      expect(parent.isIntactParent).toBe(true);
      expect(parent.hasBackup).toBe(false);
      expect(parent.subagents?.map((s) => s.conversationId)).toEqual([
        "sub-1",
        "sub-2",
      ]);
    });

    it("falls back to parentId when intact parent has empty or missing title", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "sub-1",
          title: "Sub One",
          updatedAt: 1100,
          parentConversationId: "intact-no-title",
        },
      ];

      const intactParents = new Map([
        ["intact-no-title", { title: "", updatedAt: 1000 }],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(1);
      expect(result.conversations[0].title).toBe("intact-no-title");
    });

    it("derives updatedAt from maximum subagent timestamp when intact parent timestamp is missing", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "sub-1",
          title: "Sub One",
          updatedAt: 1100,
          parentConversationId: "intact-p",
        },
        {
          conversationId: "sub-2",
          title: "Sub Two",
          updatedAt: 1500,
          parentConversationId: "intact-p",
        },
        {
          conversationId: "sub-3",
          title: "Sub Three",
          updatedAt: 1300,
          parentConversationId: "intact-p",
        },
      ];

      const intactParents = new Map([
        ["intact-p", { title: "Parent Without Timestamp" }],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(1);
      expect(result.conversations[0].updatedAt).toBe(1500);
    });

    it("nests grandchild subagents under a child subagent of an intact parent", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "grandchild",
          title: "Grandchild Subagent",
          updatedAt: 1300,
          parentConversationId: "child",
        },
        {
          conversationId: "child",
          title: "Child Subagent",
          updatedAt: 1200,
          parentConversationId: "intact-root",
        },
      ];

      const intactParents = new Map([
        ["intact-root", { title: "Intact Root", updatedAt: 1000 }],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(1);

      const root = result.conversations[0];
      expect(root.conversationId).toBe("intact-root");
      expect(root.isIntactParent).toBe(true);
      expect(root.subagents?.length).toBe(1);

      const child = root.subagents![0];
      expect(child.conversationId).toBe("child");
      expect(child.subagents?.length).toBe(1);
      expect(child.subagents![0].conversationId).toBe("grandchild");
    });

    it("sorts multiple intact parents and standalone items descending by updatedAt", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "sub-older",
          title: "Older Sub",
          updatedAt: 100,
          parentConversationId: "parent-old",
        },
        {
          conversationId: "sub-newer",
          title: "Newer Sub",
          updatedAt: 500,
          parentConversationId: "parent-new",
        },
        {
          conversationId: "standalone",
          title: "Standalone Broken",
          updatedAt: 300,
        },
      ];

      const intactParents = new Map([
        ["parent-old", { title: "Old Parent", updatedAt: 100 }],
        ["parent-new", { title: "New Parent", updatedAt: 500 }],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(3);
      expect(result.conversations.map((c) => c.conversationId)).toEqual([
        "parent-new",
        "standalone",
        "parent-old",
      ]);
    });

    it("groups subagents under synthesized deleted session container when parent is missing or deleted", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "orphan-sub",
          title: "Orphan Sub",
          updatedAt: 200,
          parentConversationId: "unknown-parent",
        },
      ];

      const intactParents = new Map([
        ["other-parent", { title: "Other Parent", updatedAt: 500 }],
      ]);

      const result = buildSubagentTree(items, intactParents);
      expect(result.topLevelCount).toBe(1);
      const container = result.conversations[0];
      expect(container.conversationId).toBe("deleted-session-unknown-parent");
      expect(container.title).toBe("Residual Subagents from Deleted Session");
      expect(container.isDeletedSessionContainer).toBe(true);
      expect(container.isIntactParent).toBeUndefined();
      expect(container.updatedAt).toBe(200);
      expect(container.subagents?.length).toBe(1);
      expect(container.subagents![0].conversationId).toBe("orphan-sub");
    });

    it("groups multiple descendant subagents from a deleted session preserving hierarchy", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "sub-child",
          title: "Sub Child",
          updatedAt: 1300,
          parentConversationId: "teamwork-preview",
        },
        {
          conversationId: "teamwork-preview",
          title: "Teamwork Preview",
          updatedAt: 1100,
          parentConversationId: "f7b51e44",
        },
        {
          conversationId: "orchestrator",
          title: "Orchestrator",
          updatedAt: 1200,
          parentConversationId: "f7b51e44",
        },
      ];

      const result = buildSubagentTree(items);
      expect(result.topLevelCount).toBe(1);

      const container = result.conversations[0];
      expect(container.conversationId).toBe("deleted-session-f7b51e44");
      expect(container.title).toBe("Residual Subagents from Deleted Session");
      expect(container.isDeletedSessionContainer).toBe(true);
      expect(container.updatedAt).toBe(1300);
      expect(container.subagents?.map((s) => s.conversationId)).toEqual([
        "teamwork-preview",
        "orchestrator",
      ]);

      const preview = container.subagents![0];
      expect(preview.conversationId).toBe("teamwork-preview");
      expect(preview.subagents?.map((s) => s.conversationId)).toEqual([
        "sub-child",
      ]);
    });

    it("traces ancestors through external parent lookup to an intact main chat", () => {
      const items: BrokenChatItem[] = [
        {
          conversationId: "leaf-broken",
          title: "Leaf Broken Subagent",
          updatedAt: 1200,
          parentConversationId: "intact-subagent",
        },
      ];

      const intactParents = new Map([
        ["intact-main-root", { title: "Intact Main Root", updatedAt: 1000 }],
      ]);

      const externalLookup = new Map([
        ["intact-subagent", "intact-main-root"],
      ]);

      const result = buildSubagentTree(items, intactParents, externalLookup);
      expect(result.topLevelCount).toBe(1);

      const container = result.conversations[0];
      expect(container.conversationId).toBe("intact-main-root");
      expect(container.isIntactParent).toBe(true);
      expect(container.subagents?.length).toBe(1);
      expect(container.subagents![0].conversationId).toBe("leaf-broken");
    });
  });
});

describe("flattenBrokenChats", () => {
  it("returns every real broken chat at any depth and skips container rows", () => {
    const tree: BrokenChatItem[] = [
      {
        conversationId: "broken-main",
        title: "Broken main",
        subagents: [
          {
            conversationId: "sub-1",
            title: "Sub 1",
            subagents: [{ conversationId: "sub-1-1", title: "Sub 1.1" }],
          },
        ],
      },
      {
        conversationId: "intact-main",
        title: "Intact main",
        isIntactParent: true,
        subagents: [{ conversationId: "under-intact", title: "Under intact" }],
      },
      {
        conversationId: `${DELETED_SESSION_PREFIX}gone`,
        title: "Residual",
        isDeletedSessionContainer: true,
        subagents: [{ conversationId: "orphan", title: "Orphan" }],
      },
    ];

    expect(flattenBrokenChats(tree).map((c) => c.conversationId)).toEqual([
      "broken-main",
      "sub-1",
      "sub-1-1",
      "under-intact",
      "orphan",
    ]);
  });

  it("names deleted-session containers with the shared prefix", () => {
    const result = buildSubagentTree(
      [{ conversationId: "orphan", title: "Orphan", parentConversationId: "gone" }],
      new Map(),
      new Map(),
      new Set(),
    );
    expect(result.conversations[0].conversationId).toBe(`${DELETED_SESSION_PREFIX}gone`);
  });
});
