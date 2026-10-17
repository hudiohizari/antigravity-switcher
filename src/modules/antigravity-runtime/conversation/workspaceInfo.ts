import { maskUserPath } from "@/shared/platform/paths";
import {
  CONVERSATION_CLEANER_CONSTANTS,
  type ParsedWorkspaceInfo,
} from "./types";

/**
 * Normalizes raw workspace URI strings from SQLite and derives a clean project name
 * and PII-masked path.
 */
export function parseWorkspaceInfo(
  rawWorkspaceUris: unknown,
): ParsedWorkspaceInfo {
  const fallback: ParsedWorkspaceInfo = {
    projectName: CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
    workspacePath: "",
  };

  if (!rawWorkspaceUris || typeof rawWorkspaceUris !== "string") {
    return fallback;
  }

  const trimmed = rawWorkspaceUris.trim();
  if (
    !trimmed ||
    trimmed === "[]" ||
    trimmed === "null" ||
    trimmed === "[null]"
  ) {
    return fallback;
  }

  let candidateUri = "";

  // 1. Safe JSON parsing with fallback to raw string
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstValid = parsed.find(
        (item) => typeof item === "string" && item.trim().length > 0,
      );
      if (firstValid) {
        candidateUri = String(firstValid).trim();
      }
    } else if (typeof parsed === "string") {
      candidateUri = parsed.trim();
    }
  } catch {
    // Legacy or unquoted URI
    candidateUri = trimmed;
  }

  if (!candidateUri) {
    return fallback;
  }

  // 2. Decode percent-encoding safely
  let decoded = candidateUri;
  try {
    decoded = decodeURIComponent(candidateUri);
  } catch {
    // If malformed percent encoding, keep raw candidateUri
  }

  // 3. Strip file:// scheme and normalize Windows drive letter
  let normalizedPath = decoded;
  if (normalizedPath.startsWith("file://localhost/")) {
    normalizedPath = normalizedPath.slice("file://localhost".length);
  } else if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.slice("file://".length);
  }

  // Handle Windows paths like /c:/Users/... or /C:/Users/...
  if (/^\/[a-zA-Z]:[\\/]/.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(1);
  }

  // Normalize drive letter to uppercase (e.g. c:/ -> C:/)
  if (/^[a-zA-Z]:[\\/]/.test(normalizedPath)) {
    normalizedPath =
      normalizedPath.charAt(0).toUpperCase() + normalizedPath.slice(1);
  }

  // Remove trailing slashes
  normalizedPath = normalizedPath.replace(/[/\\]+$/, "");

  // 4. Extract Project Name (terminal segment)
  const segments = normalizedPath.split(/[/\\]/).filter(Boolean);
  let projectName = segments.length > 0 ? segments[segments.length - 1] : "";

  // Guard against root drive letters (e.g. "C:") or meaningless single dots
  if (!projectName || projectName.endsWith(":") || projectName === ".") {
    projectName = CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;
  }

  // 5. PII Masking via maskUserPath()
  const maskedPath = maskUserPath(normalizedPath) ?? normalizedPath;

  return {
    projectName,
    workspacePath: maskedPath,
  };
}

/**
 * Parses timestamp value from last_modified_time column into ms since epoch.
 */
export function parseTimestamp(rawTime: unknown): number | undefined {
  if (typeof rawTime === "number" && !Number.isNaN(rawTime)) {
    return rawTime;
  }
  if (typeof rawTime === "string" && rawTime.trim().length > 0) {
    const parsed = Date.parse(rawTime);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}
