/**
 * Hot-managed QQ bot lifecycle, mirroring `backend/lark/manager.ts`.
 */

import { logger } from "../utils/logger.ts";
import {
  addApp,
  listApps,
  removeApp,
  type AddQqAppInput,
  type QqAppRecord,
} from "./appStore.ts";
import { startQqBot, type QqBotHandle } from "./index.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

export interface QqBotManagerDeps {
  appsFilePath: string;
  bindingPath: string;
  cliPath: string;
  usersFile: string;
  defaultCwd: string;
  linkCodes?: LinkCodeStore;
}

interface Running {
  record: QqAppRecord;
  handle: QqBotHandle;
}

export class QqBotManager {
  private running = new Map<string, Running>();

  constructor(private readonly deps: QqBotManagerDeps) {}

  async startAll(): Promise<void> {
    const records = await listApps(this.deps.appsFilePath);
    for (const r of records) this.startOne(r);
  }

  async list(): Promise<QqAppRecord[]> {
    return listApps(this.deps.appsFilePath);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async add(input: AddQqAppInput): Promise<QqAppRecord> {
    const record = await addApp(this.deps.appsFilePath, input);
    this.startOne(record);
    return record;
  }

  async remove(id: string): Promise<void> {
    const current = this.running.get(id);
    if (current) {
      this.running.delete(id);
      try {
        await current.handle.stop();
      } catch (e) {
        logger.cli.warn("QQ stop failed during remove: {error}", { error: e });
      }
    }
    await removeApp(this.deps.appsFilePath, id);
  }

  private startOne(record: QqAppRecord): void {
    if (this.running.has(record.id)) return;
    const handle = startQqBot({
      recordId: record.id,
      appId: record.appId,
      appSecret: record.appSecret,
      sandbox: !!record.sandbox,
      cliPath: this.deps.cliPath,
      usersFile: this.deps.usersFile,
      defaultCwd: this.deps.defaultCwd,
      bindingPath: this.deps.bindingPath,
      linkCodes: this.deps.linkCodes,
    });
    this.running.set(record.id, { record, handle });
  }
}
