import { type BrowserWindow, Menu, app, shell } from "electron";

const PRODUCT_NAME = "Open Design";

export function createApplicationMenu(window: BrowserWindow | null): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [];

  const isMac = process.platform === "darwin";

  // App / File menu
  if (isMac) {
    template.push({
      label: PRODUCT_NAME,
      role: "appMenu",
      submenu: [
        { label: `About ${PRODUCT_NAME}`, role: "about" },
        { type: "separator" },
        { label: `Hide ${PRODUCT_NAME}`, role: "hide" },
        { label: "Hide Others", role: "hideOthers" },
        { label: "Show All", role: "unhide" },
        { type: "separator" },
        { label: `Quit ${PRODUCT_NAME}`, role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        { label: "Close Window", role: "close" },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ],
    });
  }

  // Edit
  template.push({
    label: "Edit",
    role: "editMenu",
    submenu: [
      { label: "Undo", role: "undo" },
      { label: "Redo", role: "redo" },
      { type: "separator" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      ...(isMac
        ? [
            { label: "Paste and Match Style", role: "pasteAndMatchStyle" } as Electron.MenuItemConstructorOptions,
            { label: "Delete", role: "delete" } as Electron.MenuItemConstructorOptions,
            { label: "Select All", role: "selectAll" } as Electron.MenuItemConstructorOptions,
          ]
        : [{ label: "Select All", role: "selectAll" } as Electron.MenuItemConstructorOptions]),
    ],
  });

  // View
  template.push({
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: (_item, focusedWindow) => {
          (focusedWindow as BrowserWindow | undefined)?.webContents.reload();
        },
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: (_item, focusedWindow) => {
          (focusedWindow as BrowserWindow | undefined)?.webContents.reloadIgnoringCache();
        },
      },
      { type: "separator" },
      { label: "Actual Size", role: "resetZoom" },
      { label: "Zoom In", role: "zoomIn" },
      { label: "Zoom Out", role: "zoomOut" },
      { type: "separator" },
      { label: "Toggle Full Screen", role: "togglefullscreen" },
      ...(isMac ? [] : [{ label: "Toggle Developer Tools", role: "toggleDevTools" } as Electron.MenuItemConstructorOptions]),
    ],
  });

  // Window
  template.push({
    label: "Window",
    role: "windowMenu",
    submenu: [
      { label: "Minimize", role: "minimize" },
      ...(isMac
        ? [
            { label: "Zoom", role: "zoom" } as Electron.MenuItemConstructorOptions,
            { type: "separator" } as Electron.MenuItemConstructorOptions,
            { label: "Bring All to Front", role: "front" } as Electron.MenuItemConstructorOptions,
          ]
        : [{ label: "Close", role: "close" } as Electron.MenuItemConstructorOptions]),
    ],
  });

  // Help
  template.push({
    label: "Help",
    role: "help",
    submenu: [
      {
        label: `Learn more about ${PRODUCT_NAME}`,
        click: async () => {
          await shell.openExternal("https://github.com/open-design/desktop");
        },
      },
    ],
  });

  // macOS devtools hidden shortcut (shown in View on non-mac)
  if (isMac) {
    template.push({
      label: "Developer",
      submenu: [
        { label: "Toggle Developer Tools", role: "toggleDevTools" },
      ],
      visible: false,
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

export function hideApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}
