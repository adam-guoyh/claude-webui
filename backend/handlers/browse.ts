import { Context } from "hono";
import { stat, readDir } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

/**
 * GET /api/fs/browse?path=/abs/path
 *
 * Lists the immediate children of a directory so the frontend's
 * DirectoryBrowser modal can show navigable file-tree contents. When `path`
 * is missing the listing falls back to the server user's home directory.
 *
 * Response shape:
 *   {
 *     path: string,                       // resolved absolute path
 *     parent: string | null,              // null when at filesystem root
 *     entries: [{ name, isDirectory }]    // sorted: dirs first, then files
 *   }
 *
 * The handler only returns the *names* of entries — no contents — and refuses
 * relative paths or anything containing "..". Hidden entries (leading `.`)
 * are filtered out by default to keep the picker readable; pass
 * `?showHidden=1` to include them. The backend already runs Claude under the
 * server's Unix user, so this exposes only what that user can already read.
 */
export async function handleBrowseRequest(c: Context) {
  try {
    const url = new URL(c.req.url);
    const rawPath = url.searchParams.get("path");
    const showHidden = url.searchParams.get("showHidden") === "1";

    const path =
      rawPath && rawPath.length > 0 ? rawPath : (getHomeDir() ?? "/");
    if (!path.startsWith("/")) {
      return c.json({ error: "Path must be absolute" }, 400);
    }
    if (path.includes("..")) {
      return c.json({ error: "Path may not contain .." }, 400);
    }

    try {
      const info = await stat(path);
      if (!info.isDirectory) {
        return c.json({ error: "Path is not a directory" }, 400);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("No such file")) {
        return c.json({ error: "Directory does not exist" }, 404);
      }
      throw e;
    }

    const entries: { name: string; isDirectory: boolean }[] = [];
    try {
      for await (const entry of readDir(path)) {
        if (!showHidden && entry.name.startsWith(".")) continue;
        entries.push({ name: entry.name, isDirectory: entry.isDirectory });
      }
    } catch (e) {
      if (
        e instanceof Error &&
        (e as NodeJS.ErrnoException).code === "EACCES"
      ) {
        return c.json({ error: "Permission denied" }, 403);
      }
      throw e;
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Compute parent: null when already at "/", otherwise everything before
    // the last "/" (or "/" itself when the path is one level deep).
    let parent: string | null = null;
    if (path !== "/") {
      const stripped = path.replace(/\/+$/, "");
      const idx = stripped.lastIndexOf("/");
      parent = idx === 0 ? "/" : stripped.slice(0, idx);
    }

    return c.json({ path, parent, entries });
  } catch (error) {
    logger.api.error("Error browsing filesystem: {error}", { error });
    return c.json({ error: "Failed to browse" }, 500);
  }
}
