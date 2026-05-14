import { promises as fs } from "node:fs";
import { Context } from "hono";
import type { ProjectInfo, ProjectsResponse } from "../../shared/types.ts";
import {
  encodeProjectPath,
  getEncodedProjectName,
  validateEncodedProjectName,
} from "../history/pathUtils.ts";
import { getUserRole } from "../auth/userStore.ts";
import { logger } from "../utils/logger.ts";
import { exists, readTextFile, stat } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

/**
 * Handles GET /api/projects requests
 * Retrieves list of available project directories from Claude configuration
 * @param c - Hono context object
 * @returns JSON response with projects array
 */
export async function handleProjectsRequest(c: Context) {
  try {
    const homeDir = getHomeDir();
    if (!homeDir) {
      return c.json({ error: "Home directory not found" }, 500);
    }

    const claudeConfigPath = `${homeDir}/.claude.json`;

    try {
      const configContent = await readTextFile(claudeConfigPath);
      const config = JSON.parse(configContent);

      if (config.projects && typeof config.projects === "object") {
        const projectPaths = Object.keys(config.projects);

        // Get encoded names for each project, only include projects with history
        const projects: ProjectInfo[] = [];
        for (const path of projectPaths) {
          const encodedName = await getEncodedProjectName(path);
          // Only include projects that have history directories
          if (encodedName) {
            projects.push({
              path,
              encodedName,
            });
          }
        }

        const response: ProjectsResponse = { projects };
        return c.json(response);
      } else {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
    } catch (error) {
      // Handle file not found errors in a cross-platform way
      if (error instanceof Error && error.message.includes("No such file")) {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
      throw error;
    }
  } catch (error) {
    logger.api.error("Error reading projects: {error}", { error });
    return c.json({ error: "Failed to read projects" }, 500);
  }
}

/**
 * POST /api/projects — register a project so it shows up in the switcher.
 *
 * Body: `{ path: string }` — an absolute directory path that exists. We
 * compute Claude's encoded directory name and ensure
 *   ~/.claude/projects/<encoded>/
 * exists. Claude itself adds the entry to ~/.claude.json on the first chat,
 * so we don't touch that file.
 */
export async function handleCreateProjectRequest(c: Context) {
  try {
    const homeDir = getHomeDir();
    if (!homeDir) return c.json({ error: "Home directory not found" }, 500);

    let body: { path?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const projectPath = typeof body.path === "string" ? body.path.trim() : "";
    if (!projectPath) {
      return c.json({ error: "Path is required" }, 400);
    }
    if (!projectPath.startsWith("/")) {
      return c.json({ error: "Path must be absolute (start with /)" }, 400);
    }
    // Refuse traversal-style paths up front.
    if (projectPath.includes("..")) {
      return c.json({ error: "Path may not contain ..", code: "invalid" }, 400);
    }

    try {
      const info = await stat(projectPath);
      if (!info.isDirectory) {
        return c.json({ error: "Path exists but is not a directory" }, 400);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("No such file")) {
        return c.json({ error: "Directory does not exist" }, 400);
      }
      throw e;
    }

    const encodedName = encodeProjectPath(projectPath);
    const projectDir = `${homeDir}/.claude/projects/${encodedName}`;
    await fs.mkdir(projectDir, { recursive: true });

    // Register in ~/.claude.json so the project shows up in the switcher
    // immediately. Claude's own CLI adds the entry on first chat in a
    // directory; we do it eagerly here. Atomic via tmp+rename so a crash
    // mid-write can't corrupt the config.
    const claudeConfigPath = `${homeDir}/.claude.json`;
    try {
      let config: { projects?: Record<string, unknown> } = {};
      if (await exists(claudeConfigPath)) {
        const raw = await readTextFile(claudeConfigPath);
        try {
          config = JSON.parse(raw);
        } catch {
          // Don't clobber an unreadable config — surface but keep going,
          // the project dir we created is what makes the project visible.
          logger.api.warn(
            "Failed to parse {path}; not registering project entry",
            { path: claudeConfigPath },
          );
          return c.json({ path: projectPath, encodedName }, 201);
        }
      }
      config.projects = config.projects ?? {};
      if (!(projectPath in config.projects)) {
        config.projects[projectPath] = {};
        const tmp = `${claudeConfigPath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(config, null, 2));
        await fs.rename(tmp, claudeConfigPath);
      }
    } catch (writeError) {
      logger.api.warn("Failed to update {path}: {error}", {
        path: claudeConfigPath,
        error: writeError,
      });
      // Non-fatal; project dir creation already succeeded.
    }

    return c.json({ path: projectPath, encodedName }, 201);
  } catch (error) {
    logger.api.error("Error creating project: {error}", { error });
    return c.json({ error: "Failed to create project" }, 500);
  }
}

/**
 * DELETE /api/projects/:encodedProjectName — destructive; removes the whole
 * encoded project directory (all sessions + titles + ownership). Admin only.
 *
 * Does not touch ~/.claude.json — Claude will re-add the entry on next chat
 * if the user returns to that directory.
 */
export async function handleDeleteProjectRequest(c: Context) {
  try {
    const homeDir = getHomeDir();
    if (!homeDir) return c.json({ error: "Home directory not found" }, 500);

    const usersFile = (c.var.config as { usersFile?: string } | undefined)
      ?.usersFile;
    const caller = c.var.authUser as string | null;
    // In multi-user mode require admin; in open / shared-token mode this is
    // already implicitly a privileged caller.
    if (usersFile) {
      if (!caller) return c.json({ error: "Unauthorized" }, 401);
      const role = await getUserRole(usersFile, caller);
      if (role !== "admin") return c.json({ error: "Admin only" }, 403);
    }

    const encodedProjectName = c.req.param("encodedProjectName");
    if (
      !encodedProjectName ||
      !validateEncodedProjectName(encodedProjectName)
    ) {
      return c.json({ error: "Invalid encoded project name" }, 400);
    }

    const projectDir = `${homeDir}/.claude/projects/${encodedProjectName}`;
    if (!(await exists(projectDir))) {
      return c.json({ error: "Project not found" }, 404);
    }

    await fs.rm(projectDir, { recursive: true, force: true });
    return c.json({ ok: true });
  } catch (error) {
    logger.api.error("Error deleting project: {error}", { error });
    return c.json({ error: "Failed to delete project" }, 500);
  }
}
