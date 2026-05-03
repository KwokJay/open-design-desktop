import { access } from "node:fs/promises";
import { join } from "node:path";

import { type BrowserWindow, Menu, Tray, nativeImage } from "electron";

const PRODUCT_NAME = "Open Design";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTrayIconPath(): Promise<string | null> {
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    // Packaged mac app: electron-builder places the icon.icns in Contents/Resources
    candidates.push(join(process.resourcesPath, "icon.icns"));
    // extraResources copy
    candidates.push(join(process.resourcesPath, "open-design", "icon.png"));
    // Dev mode from workspace root
    candidates.push(join(process.cwd(), "tools", "pack", "resources", "mac", "icon.png"));
  } else if (process.platform === "win32") {
    // Packaged win app: electron-builder places the icon.ico in resources
    candidates.push(join(process.resourcesPath, "icon.ico"));
    // extraResources copy
    candidates.push(join(process.resourcesPath, "open-design", "icon.ico"));
    // Dev mode from workspace root
    candidates.push(join(process.cwd(), "tools", "pack", "resources", "win", "icon.ico"));
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export type DesktopTray = {
  destroy(): void;
};

export async function createDesktopTray(window: BrowserWindow): Promise<DesktopTray | null> {
  const iconPath = await resolveTrayIconPath();
  if (iconPath == null) {
    console.warn("desktop tray icon not found, skipping tray");
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath);
  // macOS tray icons should be template images when monochrome; our icon is colored so keep as-is.
  const tray = new Tray(icon.resize({ height: 18, width: 18 }));
  tray.setToolTip(PRODUCT_NAME);

  function updateContextMenu(): void {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: window.isVisible() && !window.isMinimized() ? "Hide" : "Show",
        click: () => {
          if (window.isVisible() && !window.isMinimized()) {
            window.hide();
          } else {
            window.show();
            window.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          window.close();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  }

  tray.on("click", () => {
    if (window.isVisible() && !window.isMinimized()) {
      window.hide();
    } else {
      window.show();
      window.focus();
    }
    updateContextMenu();
  });

  tray.on("right-click", () => {
    updateContextMenu();
    tray.popUpContextMenu();
  });

  window.on("show", updateContextMenu);
  window.on("hide", updateContextMenu);
  window.on("minimize", updateContextMenu);
  window.on("restore", updateContextMenu);

  updateContextMenu();

  return {
    destroy() {
      tray.destroy();
    },
  };
}
