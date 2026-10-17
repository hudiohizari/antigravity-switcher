import { describe, it, expect } from "vitest";
import {
  humanizeAgentName,
  resolveConversationTitle,
} from "@/modules/antigravity-runtime/conversation/conversationTitles";

describe("Conversation Title Resolver", () => {
  describe("humanizeAgentName", () => {
    it("humanizes known subagent role formats correctly", () => {
      expect(humanizeAgentName("teamwork_preview_document_victory_auditor")).toBe("Victory Auditor");
      expect(humanizeAgentName("teamwork_preview_synthesizer")).toBe("Synthesizer");
      expect(humanizeAgentName("teamwork_preview_orchestrator")).toBe("Orchestrator");
      expect(humanizeAgentName("teamwork_preview")).toBe("Teamwork Preview");
      expect(humanizeAgentName("mamen_devops")).toBe("Mamen Devops");
      expect(humanizeAgentName("image-generator")).toBe("Image Generator");
      expect(humanizeAgentName("DeepInvestigator")).toBe("Deep Investigator");
    });

    it("falls back to Subagent on empty, null, or undefined values", () => {
      expect(humanizeAgentName("")).toBe("Subagent");
      expect(humanizeAgentName(null)).toBe("Subagent");
      expect(humanizeAgentName(undefined)).toBe("Subagent");
      expect(humanizeAgentName("   ")).toBe("Subagent");
    });
  });

  describe("resolveConversationTitle", () => {
    it("returns direct title immediately if title is non-empty", () => {
      const res = resolveConversationTitle({
        conversation_id: "c-1",
        title: "Reviewing User Guide Scope",
        agent_name: "teamwork_preview_synthesizer",
        nesting_depth: 1,
      });
      expect(res).toBe("Reviewing User Guide Scope");
    });

    it("resolves subagent title with ancestor root title", () => {
      const titleMap = new Map<string, string>([
        ["root-1", "Reviewing User Guide Scope"],
      ]);
      const parentMap = new Map<string, string>([
        ["sub-1", "root-1"],
      ]);

      const res = resolveConversationTitle(
        {
          conversation_id: "sub-1",
          title: "",
          agent_name: "teamwork_preview_synthesizer",
          parent_conversation_id: "root-1",
          nesting_depth: 1,
        },
        parentMap,
        titleMap,
        "antigravity-switcher",
      );

      expect(res).toBe("Reviewing User Guide Scope › Synthesizer");
    });

    it("traverses multi-hop ancestry to resolve root title", () => {
      const titleMap = new Map<string, string>([
        ["root-1", "Project Architecture Planning"],
      ]);
      const parentMap = new Map<string, string>([
        ["sub-2", "sub-1"],
        ["sub-1", "root-1"],
      ]);

      const res = resolveConversationTitle(
        {
          conversation_id: "sub-2",
          title: "",
          agent_name: "teamwork_preview_document_victory_auditor",
          parent_conversation_id: "sub-1",
          nesting_depth: 2,
        },
        parentMap,
        titleMap,
        "backend-api",
      );

      expect(res).toBe("Project Architecture Planning › Victory Auditor");
    });

    it("formats subagent title with project prefix when ancestor title is absent", () => {
      const res = resolveConversationTitle(
        {
          conversation_id: "sub-orphan",
          title: "",
          agent_name: "teamwork_preview_synthesizer",
          nesting_depth: 1,
        },
        new Map(),
        new Map(),
        "my-service",
      );

      expect(res).toBe("[my-service] Synthesizer");
    });

    it("formats subagent title without brackets when project is missing or unknown", () => {
      const res = resolveConversationTitle(
        {
          conversation_id: "sub-orphan",
          title: "",
          agent_name: "teamwork_preview_synthesizer",
          nesting_depth: 1,
        },
        new Map(),
        new Map(),
        "Unknown Project",
      );

      expect(res).toBe("Synthesizer");
    });

    it("returns truncated preview snippet for untitled root session", () => {
      const res = resolveConversationTitle(
        {
          conversation_id: "root-untitled",
          title: "",
          preview: "How do I configure automatic database backups on the system?",
          nesting_depth: 0,
        },
        new Map(),
        new Map(),
        "demo-project",
      );

      expect(res).toBe("How do I configure automatic database backups...");
    });

    it("returns project-prefixed Untitled Conversation for blank root session", () => {
      const res = resolveConversationTitle(
        {
          conversation_id: "root-untitled-blank",
          title: "",
          preview: "",
          nesting_depth: 0,
        },
        new Map(),
        new Map(),
        "demo-project",
      );

      expect(res).toBe("[demo-project] Untitled Conversation");
    });

    it("handles cyclic parentMap gracefully without crashing or looping", () => {
      const parentMap = new Map<string, string>([
        ["c-1", "c-2"],
        ["c-2", "c-1"],
      ]);

      const res = resolveConversationTitle(
        {
          conversation_id: "c-1",
          title: "",
          agent_name: "teamwork_preview_worker",
          parent_conversation_id: "c-2",
          nesting_depth: 1,
        },
        parentMap,
        new Map(),
        "my-project",
      );

      expect(res).toBe("[my-project] Worker");
    });
  });
});
