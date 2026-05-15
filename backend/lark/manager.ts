/**
 * Orchestrator for hot-managed Feishu apps.
 *
 * Keeps the persisted `lark-apps.json` in sync with a Map of running
 * `LarkBotHandle`s. Admin add/remove operations from the HTTP API go
 * through here so the websocket lifecycle stays consistent.
 */

import { logger } from "../utils/logger.ts";
import {
  addApp,
  listApps,
  removeApp,
  type LarkAppRecord,
  type AddAppInput,
} from "./appStore.ts";
import { startLarkBot, type LarkBotHandle } from "./index.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

export interface LarkBotManagerDeps {
  appsFilePath: string;
  bindingPath: string;
  cliPath: string;
  usersFile: string;
  defaultCwd: string;
  linkCodes?: LinkCodeStore;
}

interface Running {
  record: LarkAppRecord;
  handle: LarkBotHandle;
}

export class LarkBotManager {
  private running = new Map<string, Running>();

  constructor(private readonly deps: LarkBotManagerDeps) {}

  /** Start all apps currently persisted on disk. Idempotent. */
  async startAll(): Promise<void> {
    const records = await listApps(this.deps.appsFilePath);
    for (const r of records) {
      this.startOne(r);
    }
  }

  async list(): Promise<LarkAppRecord[]> {
    return listApps(this.deps.appsFilePath);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Persist + spin up. Used by the HTTP admin endpoint.
   */
  async add(input: AddAppInput): Promise<LarkAppRecord> {
    const record = await addApp(this.deps.appsFilePath, input);
    this.startOne(record);
    return record;
  }

  /** Persist removal + stop the websocket. */
  async remove(id: string): Promise<void> {
    const current = this.running.get(id);
    if (current) {
      this.running.delete(id);
      try {
        await current.handle.stop();
      } catch (e) {
        logger.cli.warn("Lark stop failed during remove: {error}", {
          error: e,
        });
      }
    }
    await removeApp(this.deps.appsFilePath, id);
  }

  /**
   * Idempotent "make sure this app config is registered AND running" used
   * by CLI bootstrap when --lark-app-id is supplied for backward compat.
   */
  async ensureFromCli(input: AddAppInput): Promise<void> {
    const records = await listApps(this.deps.appsFilePath);
    const match = records.find((r) => r.appId === input.appId.trim());
    if (match) {
      // Update secret if rotated.
      if (match.appSecret !== input.appSecret.trim()) {
        await this.remove(match.id);
        await this.add({ ...input, displayName: match.displayName });
      } else if (!this.running.has(match.id)) {
        this.startOne(match);
      }
      return;
    }
    await this.add(input);
  }

  private startOne(record: LarkAppRecord): void {
    if (this.running.has(record.id)) return;
    const handle = startLarkBot({
      recordId: record.id,
      appId: record.appId,
      appSecret: record.appSecret,
      domain: record.domain,
      cliPath: this.deps.cliPath,
      usersFile: this.deps.usersFile,
      defaultCwd: this.deps.defaultCwd,
      bindingPath: this.deps.bindingPath,
      linkCodes: this.deps.linkCodes,
    });
    this.running.set(record.id, { record, handle });
  }
}
