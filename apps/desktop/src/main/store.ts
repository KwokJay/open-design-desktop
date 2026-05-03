import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

export type WindowState = {
  height: number;
  width: number;
  x?: number;
  y?: number;
};

export type DesktopStore = {
  windowMaximized?: boolean;
  windowState?: WindowState;
};

function storePath(): string {
  return join(app.getPath("userData"), "desktop-store.json");
}

export async function readStore(): Promise<DesktopStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DesktopStore;
    }
  } catch {
    // ignore read/parse errors
  }
  return {};
}

export async function writeStore(store: DesktopStore): Promise<void> {
  await writeFile(storePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
