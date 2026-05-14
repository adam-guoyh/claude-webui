#!/usr/bin/env node
// Tiny user-management CLI for claude-code-webui's multi-user mode.
//
// Usage:
//   node backend/scripts/manage-users.mjs add <username> [--file path]
//   node backend/scripts/manage-users.mjs remove <username> [--file path]
//   node backend/scripts/manage-users.mjs list [--file path]
//
// `add` prompts for a password (hidden), then hashes with scrypt and writes
// `{ users: [...] }` to the file. Default file path is
// $WEBUI_USERS_FILE, else $HOME/.claude-code-webui/users.json.

import { promises as fs, existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import process from "node:process";

const scrypt = promisify(scryptCb);

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function hashPassword(password) {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  // Match the backend's higher maxmem so we don't trip Node's 32 MiB default.
  const derived = await scrypt(password, salt, 64, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${N}$${r}$${p}$${b64url(salt)}$${b64url(derived)}`;
}

function defaultPath() {
  return (
    process.env.WEBUI_USERS_FILE ||
    `${homedir()}/.claude-code-webui/users.json`
  );
}

async function readUsers(path) {
  if (!existsSync(path)) return [];
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : (parsed?.users ?? []);
  return Array.isArray(arr) ? arr : [];
}

async function writeUsers(path, users) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ users }, null, 2));
  await fs.rename(tmp, path);
}

// Read a password from stdin without echoing it. POSIX terminal only;
// non-TTY input (e.g. piped) reads one line as-is.
function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const isTTY = Boolean(stdin.isTTY);
    const wasRaw = isTTY ? stdin.isRaw : false;
    if (isTTY) stdin.setRawMode(true);
    let buf = "";

    const finish = (value, error) => {
      stdin.removeListener("data", onData);
      if (isTTY) stdin.setRawMode(wasRaw);
      process.stdout.write("\n");
      stdin.pause();
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (ch === "\r" || ch === "\n") {
          finish(buf);
          return;
        }
        if (code === 3) {
          // Ctrl-C
          finish(null, new Error("cancelled"));
          return;
        }
        if (code === 127 || code === 8) {
          // Backspace
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      }
    };

    stdin.resume();
    stdin.on("data", onData);
  });
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") {
      flags.file = argv[++i];
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, username] = positional;
  const path = flags.file || defaultPath();

  if (!command) {
    console.error(
      "Usage: manage-users.mjs <add|remove|list> [username] [--file path]",
    );
    process.exit(2);
  }

  const users = await readUsers(path);

  if (command === "list") {
    if (users.length === 0) {
      console.log(`(no users in ${path})`);
    } else {
      console.log(`Users in ${path}:`);
      for (const u of users) console.log(`  - ${u.username}`);
    }
    return;
  }

  if (!username) {
    console.error(`Username required for "${command}"`);
    process.exit(2);
  }

  if (command === "add") {
    const password = await promptPassword(`Password for ${username}: `);
    const confirm = await promptPassword(`Confirm password: `);
    if (
      password.length === 0 ||
      Buffer.byteLength(password) !== Buffer.byteLength(confirm) ||
      !timingSafeEqual(Buffer.from(password), Buffer.from(confirm))
    ) {
      console.error("Passwords do not match or are empty");
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    const next = users.filter((u) => u.username !== username);
    next.push({ username, passwordHash });
    await writeUsers(path, next);
    console.log(`✓ Saved ${username} to ${path}`);
    return;
  }

  if (command === "remove") {
    const next = users.filter((u) => u.username !== username);
    if (next.length === users.length) {
      console.error(`No such user: ${username}`);
      process.exit(1);
    }
    await writeUsers(path, next);
    console.log(`✓ Removed ${username} from ${path}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
