# Claude WebUI

A self-hosted web frontend for the [`claude` CLI](https://github.com/anthropics/claude-code) with first-class multi-user support, project management, and per-user session ownership. Runs on your own machine or LAN; talks to your Anthropic credentials through the local Claude binary.

---

## Highlights

- **Multi-user login** — file-backed accounts with scrypt-hashed passwords. Auto-bootstrapped admin on first start. Each session is owned by the user who started it.
- **In-UI project management** — browse the filesystem, create, switch and delete projects without leaving the chat. Sessions hang under their project; switching projects re-scopes the sidebar.
- **Sidebar that scales** — always-visible session list, inline rename, delete, owner badges (admins see everyone's, grouped by owner with collapsible sections).
- **Admin tooling** — dedicated `/admin/users` page for adding / removing accounts; admin-only "move session" dialog that searches the real user list.
- **i18n** — English + 简体中文 out of the box. Detect from browser, override in Settings.
- **Backward-compatible auth fallback** — single shared bearer token via `--auth-token` for hobby setups.
- **No telemetry, no external services** — your data stays in `~/.claude/projects/` next to the Claude CLI's own.

---

## Quick start

### Prerequisites

- Node.js 20+ (or Deno) — backend runtime
- The `claude` CLI installed and signed in (`claude login` once in a terminal)
- A modern browser

### Run in development

```bash
git clone https://github.com/adam-guoyh/claude-webui.git
cd claude-webui

# 1) Install deps (each side once)
npm --prefix frontend install
npm --prefix backend install

# 2) Start the backend
cd backend
PORT=8081 \
  WEBUI_ADMIN_PASSWORD=changeme \
  npm run dev -- \
    --claude-path "$(which claude)" \
    --users-file ~/.claude-webui/users.json

# 3) In another terminal, the frontend
cd frontend
PORT=8081 npm run dev
```

Open <http://localhost:3000/>, sign in as `admin` with the password you set, and start chatting.

The first time the backend sees an empty `users.json` it creates an admin account using `WEBUI_ADMIN_USERNAME` (default `admin`) + `WEBUI_ADMIN_PASSWORD`. If you omit the password env var, the server generates a random one and prints it to stderr **once** — copy it before the next restart.

### Production build

```bash
# Bundle the frontend into backend/dist/static
make build

# Then run the same backend command without --debug
PORT=8081 \
  WEBUI_ADMIN_PASSWORD=secret \
  node backend/dist/cli/node.js \
    --claude-path "$(which claude)" \
    --users-file ~/.claude-webui/users.json
```

The backend serves the static SPA itself in production — you only need one process and one port.

---

## CLI options

| Option                  | Description                                                                              | Default     |
| ----------------------- | ---------------------------------------------------------------------------------------- | ----------- |
| `-p, --port <port>`     | Port to listen on                                                                        | `8080`      |
| `--host <host>`         | Host address to bind (`0.0.0.0` exposes to LAN)                                          | `127.0.0.1` |
| `--claude-path <path>`  | Path to the `claude` executable (overrides auto-detection)                               | Auto-detect |
| `--auth-token <token>`  | Shared bearer token required on `/api/*` (single-tenant mode)                            | _disabled_  |
| `--users-file <path>`   | JSON file with hashed credentials — enables multi-user login                             | _disabled_  |
| `--lark-app-id <id>`    | Feishu / Lark app id — turns on the chat bot (needs `--users-file`)                      | _disabled_  |
| `--lark-app-secret <s>` | Feishu / Lark app secret                                                                 | _disabled_  |
| `--lark-domain <name>`  | `feishu` (China, default) or `lark` (international)                                      | `feishu`    |
| `--lark-default-cwd <p>`| Working directory the bot hands to Claude before `/cd`                                   | `$HOME`     |
| `-d, --debug`           | Verbose logging                                                                          | `false`     |
| `-h, --help`            | Show help                                                                                | —           |
| `-v, --version`         | Show version                                                                             | —           |

Environment variables (CLI flag wins if both are set):

- `PORT` / `DEBUG` — mirrors of the flags above
- `WEBUI_AUTH_TOKEN` — same as `--auth-token`
- `WEBUI_USERS_FILE` — same as `--users-file`
- `WEBUI_LARK_APP_ID` / `WEBUI_LARK_APP_SECRET` / `WEBUI_LARK_DOMAIN` / `WEBUI_LARK_DEFAULT_CWD` — mirrors of the `--lark-*` flags
- `WEBUI_ADMIN_USERNAME` (default `admin`) and `WEBUI_ADMIN_PASSWORD` — used by the first-run admin bootstrap
- `VITE_ALLOWED_HOSTS` (dev only) — comma-separated hostnames for Vite's host check, or `*` to disable. Useful when accessing the dev server through a tunnel/custom domain.

---

## Authentication modes

The server has **three** modes, picked by what you configure:

| Configured flags                | Mode             | Login UI                          |
| ------------------------------- | ---------------- | --------------------------------- |
| _(none)_                        | Open             | No login; anyone on the host can use it |
| `--auth-token <T>`              | Shared token     | Single password field on `/login` |
| `--users-file <path>`           | Multi-user       | Username + password on `/login`   |

You can run both `--auth-token` and `--users-file` together — the token works as a legacy bypass for scripts / CI; humans use real accounts.

### Managing users (CLI)

A bundled script provides offline account management:

```bash
# Add or replace a user (prompts for password)
node backend/scripts/manage-users.mjs add alice

# Remove
node backend/scripts/manage-users.mjs remove alice

# List
node backend/scripts/manage-users.mjs list

# Custom file path (defaults to $WEBUI_USERS_FILE or ~/.claude-webui/users.json)
node backend/scripts/manage-users.mjs list --file /path/to/users.json
```

### Managing users (web UI)

Signed-in admins also see **Manage users** in the avatar menu, which opens `/admin/users` — a full page with add / search / remove.

---

## How sessions work

- Every chat reply from Claude is streamed back as NDJSON; the frontend renders messages as they arrive.
- Each session's JSONL transcript lives where the Claude CLI puts it: `~/.claude/projects/<encoded>/<sessionId>.jsonl`.
- We add a sidecar `~/.claude/projects/<encoded>/.webui-titles.json` for user-friendly titles and `.webui-ownership.json` for per-user ownership.
- Regular users see only sessions they own. Admins see everyone's, grouped by owner with collapsible sections.
- Admins can **move** any session to another user (metadata-only — the JSONL is unchanged so Claude can still resume by id).
- Anyone with an active session can **rename** or **delete** it from the sidebar; deleting drops the JSONL and clears the title/ownership entries.

The `claude` CLI itself runs as the server's Unix user with that user's Anthropic credentials. Multi-user here means "multiple identities can log in to the UI", **not** "each user has separate Claude billing/quota".

---

## Feishu / Lark bot

The backend can also serve as a Feishu (China) or Lark (international) chat bot, so people on your team can talk to Claude from the same IM they already use. Each Feishu account binds to one webui user — sessions, ownership, and project working directory follow that user.

### Set up the app

1. Create a "Custom App" in the [Feishu Open Platform](https://open.feishu.cn/app) or [Lark Developer Console](https://open.larksuite.com/app). Copy the **App ID** and **App Secret**.
2. Under **Features → Bot**, enable the bot capability.
3. Under **Events & Callbacks**, choose **Use long-connection mode** (no public callback URL needed) and subscribe to **`im.message.receive_v1`** (receive messages).
4. Permissions: grant **`im:message`** (receive messages) and **`im:message:send_as_bot`** (send messages).
5. Publish a version of the app and wait for it to be approved by your tenant admin.

### Run the backend with the bot

```bash
PORT=8081 \
  WEBUI_ADMIN_PASSWORD=changeme \
  npm --prefix backend run dev -- \
    --claude-path "$(which claude)" \
    --users-file ~/.claude-webui/users.json \
    --lark-app-id cli_abcdef \
    --lark-app-secret xxxxxxxxxxxxxxxx \
    --lark-domain feishu \
    --lark-default-cwd "$HOME/work"
```

Multi-user mode (`--users-file`) is required: the bot uses webui accounts to authenticate `/bind`. The bot opens a websocket to Feishu, so the backend host needs outbound HTTPS but no inbound port.

### Talk to the bot

DM the bot, or @-mention it in a group. Commands:

| Command                          | Effect                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `/bind <username> <password>`    | Link this Feishu account to a webui user                     |
| `/unbind`                        | Forget the link                                              |
| `/status`                        | Show the current binding (user / cwd / session id)           |
| `/cd <absolute path>`            | Change the working directory (also starts a fresh session)   |
| `/new`                           | Start a fresh Claude session under the same directory       |
| `/help`                          | List commands                                                |

Any plain message is forwarded to Claude under the bound webui account. The bot collects Claude's complete response and posts it as a single Feishu message ("best reply" mode) so multi-paragraph answers and code blocks stay intact. Sessions persist across bot restarts — the bound `sessionId` is stored at `~/.claude-webui/lark-bindings.json`.

Sessions created via the bot show up in the webui sidebar under the bound user, so an admin can move them, rename them, or pick up the conversation in the browser.

---

## API reference

Auth (public unless noted):

```
GET    /api/auth/status         → { authRequired, multiUser }
POST   /api/auth/login          { username, password }   → { token, username }   (multi-user only)
POST   /api/auth/logout         revoke caller's session
GET    /api/auth/check          gated; returns { user, role }
```

Users (admin only, multi-user mode):

```
GET    /api/users                                        → { users: [{ username, role }] }
POST   /api/users               { username, password, role? }
DELETE /api/users/:username
PUT    /api/users/:username/password    { password }     (admin OR self)
```

Projects:

```
GET    /api/projects                                     → { projects: [{ path, encodedName }] }
POST   /api/projects            { path }                 → { path, encodedName }
DELETE /api/projects/:encodedProjectName                 (admin only)
```

Sessions (under a project):

```
GET    /api/projects/:enc/histories                      → { conversations: [...] }
GET    /api/projects/:enc/histories/:sessionId           full JSONL
PUT    /api/projects/:enc/sessions/:sessionId/title      { title: string | null }
PUT    /api/projects/:enc/sessions/:sessionId/owner      { owner: string | null }    (admin only)
DELETE /api/projects/:enc/sessions/:sessionId            owner or admin
```

Chat / abort / filesystem:

```
POST   /api/chat                streaming NDJSON; body { message, sessionId?, requestId, allowedTools?, workingDirectory?, permissionMode? }
POST   /api/abort/:requestId    cancel an in-flight chat
GET    /api/fs/browse?path=...&showHidden=0|1            → { path, parent, entries: [{ name, isDirectory }] }
```

All `/api/*` requests (except `/api/auth/status` and `/api/auth/login` in multi-user mode) require `Authorization: Bearer <session-or-shared-token>`.

---

## Architecture

```
├── backend/                        # TypeScript + Hono
│   ├── app.ts                      # Hono app composition + routes
│   ├── cli/                        # Entry points (node.ts, deno.ts) + args + validation
│   ├── auth/                       # User store (scrypt), session store, bootstrap
│   ├── middleware/                 # auth + config context
│   ├── handlers/                   # projects, browse, histories, chat, abort
│   ├── history/                    # JSONL parse / group, title + ownership sidecars
│   ├── runtime/                    # Minimal Node/Deno runtime abstraction
│   └── scripts/manage-users.mjs    # Offline user admin
│
├── frontend/                       # Vite + React + Tailwind
│   └── src/
│       ├── components/             # ChatPage, SessionSidebar, ProjectSwitcher, AdminUsersPage, …
│       ├── contexts/AuthContext    # auth status, mode, login, role
│       ├── hooks/                  # streaming, chat state, permissions
│       ├── i18n/                   # i18next + en/zh JSON resources
│       └── utils/authFetch.ts      # fetch wrapper that injects the bearer
│
└── shared/types.ts                 # Types shared between frontend and backend
```

Key design points:

- **Runtime abstraction** — `Runtime` is a tiny interface (`runCommand`, `findExecutable`, `serve`, …). Business logic doesn't know whether Node or Deno is hosting it.
- **Raw JSON streaming** — `/api/chat` forwards `claude-code` SDK messages verbatim; the frontend interprets them. New SDK message types light up automatically.
- **Universal CLI detection** — `backend/cli/validation.ts` traces `claude --version` through a temporary `node` shim to find the underlying script path, so npm / pnpm / asdf / Volta / native binary all work.
- **No DB** — users, sessions, ownership, titles all live as JSON files under `~/.claude/` and `~/.claude-webui/`.
- **In-memory session tokens** — `Authorization: Bearer <opaque32>` mapped server-side; restart invalidates everyone. Fine for local/LAN tools and avoids persisting secrets.

---

## Development

```bash
# One-time
npm --prefix frontend install
npm --prefix backend install
node backend/scripts/generate-version.js    # backend reads cli/version.ts

# Run tests / checks
npm --prefix backend run typecheck
npm --prefix backend run test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test:run
npm --prefix frontend run build

# Or the unified Makefile target (requires Deno installed too)
make check
```

`backend/handlers/*.test.ts` and `frontend/src/**/*.test.{ts,tsx}` cover the contracts and React behaviour. Quality gates run on every push via GitHub Actions.

---

## Security notes

- The server runs `claude` as the host Unix user. **Anyone who reaches `/api/chat` with a valid token has the same filesystem reach as that user.** Don't expose to the public internet without auth.
- Multi-user mode does **not** isolate Claude credentials, quota, or working directories — it isolates UI sessions and ownership labels. Treat it as "multiple identities sharing one Claude account".
- Session tokens live in `localStorage`. Susceptible to XSS the same way any token-in-localStorage app is. The repo has no third-party trackers, but if you embed external scripts, take that into account.
- The directory browser (`/api/fs/browse`) only enumerates directory **names** the server user can read. It doesn't expose file contents. Still, it tells callers about your filesystem layout — keep auth enabled if that matters.

---

## License

MIT — see [LICENSE](LICENSE).
