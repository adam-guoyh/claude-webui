/**
 * Path utilities for conversation history functionality
 * Handles conversion between project paths and Claude history directory names
 */

import { readDir } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

/**
 * Get the encoded directory name for a project path by checking what actually exists
 * Example: "/Users/sugyan/tmp/" → "-Users-sugyan-tmp"
 */
export async function getEncodedProjectName(
  projectPath: string,
): Promise<string | null> {
  const homeDir = getHomeDir();
  if (!homeDir) {
    return null;
  }

  const projectsDir = `${homeDir}/.claude/projects`;

  try {
    // Read all directories in .claude/projects
    const entries = [];
    for await (const entry of readDir(projectsDir)) {
      if (entry.isDirectory) {
        entries.push(entry.name);
      }
    }

    // Convert project path to expected encoded format for comparison
    const normalizedPath = projectPath.replace(/\/$/, "");
    // Claude converts '/', '\', ':', '.', and '_' to '-'
    const expectedEncoded = normalizedPath.replace(/[/\\:._]/g, "-");

    // Find exact match - if not found, return null
    if (entries.includes(expectedEncoded)) {
      return expectedEncoded;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Compute the encoded directory name Claude would use for the given absolute
 * project path (without checking whether it exists).
 *
 * Mirrors the same character substitution as `getEncodedProjectName`:
 * `/ \ : . _` → `-`. Used by the create-project endpoint where the directory
 * doesn't exist yet.
 */
export function encodeProjectPath(projectPath: string): string {
  const normalized = projectPath.replace(/\/$/, "");
  return normalized.replace(/[/\\:._]/g, "-");
}

/**
 * Validate that an encoded project name is safe
 */
export function validateEncodedProjectName(encodedName: string): boolean {
  // Should not be empty
  if (!encodedName) {
    return false;
  }

  // Should not contain dangerous characters for directory names
  // deno-lint-ignore no-control-regex
  const dangerousChars = /[<>:"|?*\x00-\x1f\/\\]/;
  if (dangerousChars.test(encodedName)) {
    return false;
  }

  return true;
}
