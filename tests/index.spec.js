const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const runtimeIssues = new WeakMap();

test.beforeEach(async ({ page }) => {
  const issues = { consoleErrors: [], pageErrors: [] };
  runtimeIssues.set(page, issues);

  page.on("console", message => {
    if (message.type() === "error") issues.consoleErrors.push(message.text());
  });
  page.on("pageerror", error => {
    issues.pageErrors.push(error.message);
  });

  await page.goto(appUrl, { waitUntil: "load" });
  await expect(page.locator("svg#canvas")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const issues = runtimeIssues.get(page);
  expect(issues?.consoleErrors ?? [], "console errorが発生していないこと").toEqual([]);
  expect(issues?.pageErrors ?? [], "page errorが発生していないこと").toEqual([]);
});

test("初期画面にキャンバスと部品パレットが表示される", async ({ page }) => {
  await expect(page).toHaveTitle("Electrical Drawing Studio");
  await expect(page.locator("svg#canvas")).toHaveCount(1);

  const paletteItems = page.locator("#paletteGrid .palette-item");
  expect(await paletteItems.count()).toBeGreaterThan(0);
});

test("パレット内にscopeした部品を選択してキャンバスへ配置できる", async ({ page }) => {
  const filter = page.getByRole("searchbox", { name: "部品検索" });
  await filter.fill("coil");

  const palette = page.locator("#paletteGrid");
  const coil = palette.locator('.palette-item[data-type="coil"]');
  await expect(coil).toHaveCount(1);
  await expect(coil).toBeVisible();

  await coil.click();
  await expect(coil).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  const canvas = page.locator("svg#canvas");
  await canvas.click({ position: { x: 200, y: 200 } });
  await expect(canvas.locator('g[data-type="coil"]')).toHaveCount(1);
});

test("部品検索からEnterキーで候補を選択できる", async ({ page }) => {
  const filter = page.getByRole("searchbox", { name: "部品検索" });
  await filter.fill("contactNO");

  const candidate = page.locator('#paletteGrid .palette-item[data-type="contactNO"]');
  await expect(candidate).toHaveCount(1);
  await filter.press("Enter");

  await expect(candidate).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(page.locator("#status")).toContainText("a接点を配置できます");
});

test("ユーザー部品名をHTMLとして解釈せずパレットへ安全に表示する", async ({ page }) => {
  const unsafeLabel = '<img id="palette-injected" src=x onerror="window.paletteInjected=true">';
  await page.evaluate(({ label }) => window.__edsTest.installProjectData({
    schemaVersion: 3,
    activePageId: "p1",
    customSymbols: [{
      id: "unsafe-label",
      label,
      templates: [{ type: "rect", x: 0, y: 0, w: 10, h: 5 }]
    }],
    pages: [{ id: "p1", title: {}, elements: [] }]
  }), { label: unsafeLabel });

  const item = page.locator('#paletteGrid .palette-item[data-type="custom:unsafe-label"]');
  await expect(item.locator(".palette-label")).toHaveText(unsafeLabel);
  await expect(page.locator("#palette-injected")).toHaveCount(0);
  expect(await page.evaluate(() => window.paletteInjected)).toBeUndefined();
});

test("改訂履歴の任意行を削除して適用できる", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("revisionHistory");

  const dialog = page.locator("#dialogBackdrop");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#dialogTitle")).toHaveText("改訂履歴");

  await page.locator("#addRevisionBtn").click();
  await page.locator('[data-rev-row="0"] [data-rev-field="rev"]').fill("A");
  await page.locator('[data-rev-row="0"] [data-rev-field="date"]').fill("2026-01-01");
  await page.locator('[data-rev-row="0"] [data-rev-field="note"]').fill("first");

  await page.locator("#addRevisionBtn").click();
  await page.locator('[data-rev-row="1"] [data-rev-field="rev"]').fill("B");
  await page.locator('[data-rev-row="1"] [data-rev-field="date"]').fill("2026-02-02");
  await page.locator('[data-rev-row="1"] [data-rev-field="note"]').fill("second");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(2);

  await page.locator('[data-rev-delete="0"]').click();
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="note"]')).toHaveValue("second");

  await page.locator("#applyRevisionBtn").click();
  await expect(dialog).toBeHidden();

  await page.locator("#actionMenu").selectOption("revisionHistory");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");

  await page.locator('[data-rev-delete="0"]').click();
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(0);
  await page.locator("#dialogClose").click();
  await page.locator("#actionMenu").selectOption("revisionHistory");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");
});

test("SVG内のidが文書内で重複しない", async ({ page }) => {
  const duplicateIds = await page.locator("svg[id], svg [id]").evaluateAll(nodes => {
    const counts = new Map();
    for (const node of nodes) {
      if (node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  });

  expect(duplicateIds).toEqual([]);
});

test("リサイズ中のUndoでドラッグを中断し、その後のpointermoveで再変更しない", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 3,
    activePageId: "p1",
    pages: [{
      id: "p1",
      title: {},
      elements: [{ id: "rect1", type: "rect", x: 20, y: 20, w: 20, h: 10, rotation: 0, layer: "symbols" }]
    }]
  }));

  await page.locator('svg#canvas [data-id="rect1"]').first().click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].x)).toBe(21);

  const handle = page.locator('svg#canvas [data-resize-handle="se"]');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20);
  await page.keyboard.press("Control+z");
  await page.mouse.move(start.x + 60, start.y + 40);
  await page.mouse.up();

  expect(await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { x: element.x, y: element.y, w: element.w, h: element.h, history: window.__edsTest.historyDiagnostics() };
  })).toMatchObject({ x: 20, y: 20, w: 20, h: 10, history: { index: 0 } });
});

test("破損JSON・空ページ・将来版を拒否して現在図面を保持する", async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.__edsTest.state));
  const invalidFiles = [
    {
      name: "empty-pages.json",
      body: { schemaVersion: 3, pages: [] },
      expected: "pages"
    },
    {
      name: "future.json",
      body: { schemaVersion: 4, pages: [{ id: "p1", title: {}, elements: [] }] },
      expected: "新しい形式"
    },
    {
      name: "null-element.json",
      body: { schemaVersion: 3, pages: [{ id: "p1", title: {}, elements: [null] }] },
      expected: "elements"
    },
    {
      name: "fractional-schema.json",
      body: { schemaVersion: 2.5, pages: [{ id: "p1", title: {}, elements: [] }] },
      expected: "schemaVersion"
    },
    {
      name: "unsafe-key.json",
      raw: '{"schemaVersion":3,"pages":[{"id":"p1","title":{},"elements":[]}],"__proto__":{"polluted":true}}',
      expected: "使用できないキー"
    }
  ];

  for (const item of invalidFiles) {
    await page.locator("#fileInput").setInputFiles({
      name: item.name,
      mimeType: "application/json",
      buffer: Buffer.from(item.raw ?? JSON.stringify(item.body))
    });
    await expect(page.locator("#status")).toContainText(item.expected);
    expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
  }

  const backupResult = await page.evaluate(snapshot => window.__edsTest.applyBackupSnapshot(snapshot), JSON.stringify({ schemaVersion: 3, pages: [] }));
  expect(backupResult).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
  expect(await page.evaluate(() => ({
    normalPrototype: Object.getPrototypeOf(window.__edsTest.state) === Object.prototype,
    polluted: window.__edsTest.state.polluted
  }))).toEqual({ normalPrototype: true, polluted: undefined });
});

test("部分JSONは現在図面を継承せず既定値で補完し、staleなページIDを修復する", async ({ page }) => {
  const normalized = await page.evaluate(() => {
    window.__edsTest.state.settings.grid = 9;
    window.__edsTest.state.catalog = [{ catalog: "CURRENT" }];
    return window.__edsTest.normalizeProjectData({
      schemaVersion: 3,
      activePageId: "missing-page",
      pages: [{ id: "loaded-page", title: {}, elements: [] }]
    });
  });

  expect(normalized.settings.grid).toBe(2.5);
  expect(normalized.catalog).toEqual([]);
  expect(normalized.activePageId).toBe("loaded-page");
  expect(normalized.pages).toHaveLength(1);

  const legacy = await page.evaluate(() => window.__edsTest.normalizeProjectData({
    pages: [{ id: "legacy-page" }]
  }));
  expect(legacy.schemaVersion).toBe(3);
  expect(legacy.pages[0].title).toBeTruthy();
  expect(legacy.pages[0].elements).toEqual([]);
});

test("schema v2の回転部品と機器箱・端子箱を配線ごとv3へ移行する", async ({ page }) => {
  const migrated = await page.evaluate(() => window.__edsTest.migrateProjectData({
    schemaVersion: 2,
    customSymbols: [{
      id: "legacy-custom",
      templates: [
        { type: "contactNO", x: 0, y: 0, w: 8, h: 4.4, orientation: "horizontal" },
        { type: "wire", points: [[8, 2.2], [12, 2.2]] }
      ]
    }, {
      id: "legacy-single-template",
      template: { type: "contactNO", x: 20, y: 0, w: 8, h: 4.4, orientation: "horizontal" }
    }],
    standardPacks: [{
      customSymbols: [{
        id: "embedded-custom",
        templates: [
          { type: "contactNO", x: 30, y: 0, w: 8, h: 4.4, orientation: "horizontal" },
          { type: "wire", points: [[38, 2.2], [42, 2.2]] }
        ]
      }]
    }],
    pages: [{
      id: "p1",
      title: {},
      elements: [
        { id: "contact", type: "contactNO", x: 50, y: 50, w: 8, h: 4.4, orientation: "horizontal", rotation: 90 },
        { id: "wire-left", type: "wire", points: [[47.8, 48], [47.8, 50]] },
        { id: "wire-right", type: "wire", points: [[47.8, 58], [47.8, 60]] },
        { id: "device", type: "deviceBox", x: 20, y: 30, w: 28, h: 16, pins: 4, rotation: 90 },
        { id: "wire-device", type: "wire", points: [[13.6, 30], [10, 30]] },
        { id: "terminal-box", type: "terminalBox", x: 80, y: 20, w: 22, h: 18, rows: 3, rotation: 90 },
        { id: "wire-terminal", type: "wire", points: [[71, 20], [68, 20]] }
      ]
    }]
  }));

  const elements = Object.fromEntries(migrated.pages[0].elements.map(element => [element.id, element]));
  expect(migrated.schemaVersion).toBe(3);
  expect(elements.contact).toMatchObject({ x: 50, y: 49, w: 10, rotation: 90 });
  expect(elements["wire-left"].points[1][0]).toBeCloseTo(47.8, 6);
  expect(elements["wire-left"].points[1][1]).toBeCloseTo(49, 6);
  expect(elements["wire-right"].points[0][0]).toBeCloseTo(47.8, 6);
  expect(elements["wire-right"].points[0][1]).toBeCloseTo(59, 6);

  expect(elements.device).toMatchObject({ x: 21.8, y: 30, w: 30, h: 25 });
  expect(elements["wire-device"].points[0][0]).toBeCloseTo(11.8, 6);
  expect(elements["wire-device"].points[0][1]).toBeCloseTo(30, 6);

  expect(elements["terminal-box"]).toMatchObject({ x: 79.5, y: 20, w: 22.5, h: 15 });
  expect(elements["wire-terminal"].points[0][0]).toBeCloseTo(72, 6);
  expect(elements["wire-terminal"].points[0][1]).toBeCloseTo(20, 6);

  expect(migrated.customSymbols[0].templates[0]).toMatchObject({ x: -1, w: 10 });
  expect(migrated.customSymbols[0].templates[1].points[0][0]).toBe(9);
  expect(migrated.customSymbols[1].template).toMatchObject({ x: 19, w: 10 });
  expect(migrated.standardPacks[0].customSymbols[0].templates[0]).toMatchObject({ x: 29, w: 10 });
  expect(migrated.standardPacks[0].customSymbols[0].templates[1].points[0][0]).toBe(39);
});

test("不正な表題欄レイアウトを拒否してダイアログと履歴を壊さない", async ({ page }) => {
  const before = await page.evaluate(() => ({
    state: JSON.stringify(window.__edsTest.state),
    history: window.__edsTest.historyDiagnostics()
  }));

  await page.locator("#actionMenu").selectOption("titleLayout");
  await expect(page.locator("#dialogTitle")).toContainText("表題欄レイアウト編集");
  await page.locator("#titleLayoutJson").fill(JSON.stringify({ compact: { cells: [null] } }));
  await page.locator("#titleLayoutApplyBtn").click();

  await expect(page.locator("#status")).toContainText("適用に失敗");
  await expect(page.locator("#dialogBackdrop")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before.state);
  expect(await page.evaluate(() => window.__edsTest.historyDiagnostics().count)).toBe(before.history.count);
});

test("標準パックの不正なユーザー部品・表題欄を入口で拒否する", async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.__edsTest.state));
  const pack = {
    packVersion: 1,
    id: "broken-pack",
    customSymbols: [{ id: "broken-symbol", templates: {} }],
    titleLayouts: { compact: { cells: [null] } }
  };

  await page.locator("#packImportInput").setInputFiles({
    name: "broken-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack))
  });
  await expect(page.locator("#status")).toContainText("取込を中止");
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);

  await page.locator("#packImportInput").setInputFiles({
    name: "unsafe-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"packVersion":1,"id":"unsafe-pack","catalog":[{"catalog":"X","__proto__":{"polluted":true}}]}')
  });
  await expect(page.locator("#status")).toContainText("使用できないキー");
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
});

test("下絵画像を履歴内で重複保持せずUndo/Redoで完全復元する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const imageData = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "underlay-page",
      pages: [{
        id: "underlay-page",
        title: {},
        elements: [{
          id: "underlay",
          type: "underlayImage",
          x: 10,
          y: 10,
          w: 100,
          h: 80,
          rotation: 0,
          imageData,
          opacity: 0.35,
          cropPreset: "full",
          locked: true,
          layer: "layout"
        }]
      }]
    });
    const element = window.__edsTest.state.pages[0].elements[0];
    for (let index = 1; index <= 8; index++) {
      element.opacity = 0.35 + index / 100;
      window.__edsTest.commitHistory("opacity " + index);
    }
    const afterCommits = window.__edsTest.historyDiagnostics();
    const lastIndex = afterCommits.index;
    window.__edsTest.restoreHistory(0);
    const undone = window.__edsTest.state.pages[0].elements[0];
    const undoOk = undone.imageData === imageData && undone.opacity === 0.35;
    window.__edsTest.restoreHistory(lastIndex);
    const redone = window.__edsTest.state.pages[0].elements[0];
    return {
      afterCommits,
      undoOk,
      redoOk: redone.imageData === imageData && Math.abs(redone.opacity - 0.43) < 0.0001
    };
  });

  expect(result.afterCommits.count).toBe(9);
  expect(result.afterCommits.imageAssetCount).toBe(1);
  expect(result.afterCommits.snapshotsContainImageData).toBe(false);
  expect(result.afterCommits.totalChars).toBeLessThan(200_000);
  expect(result.undoOk).toBe(true);
  expect(result.redoOk).toBe(true);
});

test("現在の大きな下絵を容量超過扱いせずUndo履歴を維持する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const imageData = "data:image/png;base64," + "Z".repeat(17 * 1024 * 1024);
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "large-current-page",
      pages: [{
        id: "large-current-page",
        title: {},
        elements: [{
          id: "large-current",
          type: "underlayImage",
          x: 10,
          y: 10,
          w: 100,
          h: 80,
          rotation: 0,
          imageData,
          opacity: 0.35,
          cropPreset: "full",
          locked: true,
          layer: "layout"
        }]
      }]
    });
    window.__edsTest.state.pages[0].elements[0].opacity = 0.4;
    window.__edsTest.commitHistory("opacity 0.4");
    window.__edsTest.state.pages[0].elements[0].opacity = 0.45;
    window.__edsTest.commitHistory("opacity 0.45");
    return window.__edsTest.historyDiagnostics();
  });

  expect(result.count).toBe(3);
  expect(result.imageAssetCount).toBe(1);
  expect(result.historicalImageAssetChars).toBe(0);
});

test("異なる下絵画像を繰り返し差し替えても履歴アセット総量を上限内に保つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "asset-page",
      pages: [{ id: "asset-page", title: {}, elements: [] }]
    });
    const pageState = window.__edsTest.state.pages[0];
    ["A", "B", "C", "D"].forEach((fill, index) => {
      pageState.elements = [{
        id: "underlay-" + index,
        type: "underlayImage",
        x: 10,
        y: 10,
        w: 100,
        h: 80,
        rotation: 0,
        imageData: "data:image/png;base64," + fill.repeat(17 * 1024 * 1024),
        opacity: 0.35,
        cropPreset: "full",
        locked: true,
        layer: "layout"
      }];
      window.__edsTest.commitHistory("image " + fill);
      pageState.elements = [];
      window.__edsTest.commitHistory("remove " + fill);
    });
    const limited = window.__edsTest.historyDiagnostics();
    window.__edsTest.restoreHistory(limited.count - 2);
    const latestUndo = window.__edsTest.state.pages[0].elements[0]?.imageData.startsWith("data:image/png;base64,D");
    window.__edsTest.restoreHistory(limited.count - 1);
    return {
      limited,
      latestUndo,
      latestRedo: window.__edsTest.state.pages[0].elements.length === 0
    };
  });

  expect(result.limited.historicalImageAssetChars).toBeLessThanOrEqual(result.limited.maxHistoricalImageAssetChars);
  expect(result.limited.imageAssetCount).toBeLessThanOrEqual(3);
  expect(result.latestUndo).toBe(true);
  expect(result.latestRedo).toBe(true);
});

test("通常データ内の履歴参照名と下絵アセット参照を混同しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const markerLikeData = { __edsHistoryImageRef: "not-an-underlay-asset" };
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "marker-page",
      pages: [{
        id: "marker-page",
        name: "before",
        title: { custom: markerLikeData },
        elements: []
      }]
    });
    window.__edsTest.state.pages[0].name = "after";
    window.__edsTest.commitHistory("rename");
    window.__edsTest.restoreHistory(0);
    return {
      name: window.__edsTest.state.pages[0].name,
      custom: window.__edsTest.state.pages[0].title.custom,
      index: window.__edsTest.historyDiagnostics().index
    };
  });

  expect(result).toEqual({
    name: "before",
    custom: { __edsHistoryImageRef: "not-an-underlay-asset" },
    index: 0
  });
});

test("Undo/Redoは削除済みの任意トップレベルキーも正確に復元する", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__edsTest.state.titleLayouts = {
      compact: { w: 40, h: 20, cells: [] },
      detailed: { w: 40, h: 20, cells: [] }
    };
    window.__edsTest.commitHistory("layout added");
    const addedIndex = window.__edsTest.historyDiagnostics().index;
    delete window.__edsTest.state.titleLayouts;
    window.__edsTest.commitHistory("layout removed");
    const removedIndex = window.__edsTest.historyDiagnostics().index;
    window.__edsTest.restoreHistory(addedIndex);
    const restored = Object.prototype.hasOwnProperty.call(window.__edsTest.state, "titleLayouts");
    window.__edsTest.restoreHistory(removedIndex);
    const removedAgain = !Object.prototype.hasOwnProperty.call(window.__edsTest.state, "titleLayouts");
    return { restored, removedAgain };
  });

  expect(result).toEqual({ restored: true, removedAgain: true });
});

test("ブラウザ内プロジェクト保管庫の配列・null項目を無視する", async ({ page }) => {
  const result = await page.evaluate(() => {
    localStorage.setItem("electricalDrawingStudio.projects", JSON.stringify([null, { snapshot: null }]));
    const arrayStore = window.__edsTest.readProjectStore();
    localStorage.setItem("electricalDrawingStudio.projects", JSON.stringify({ bad: null, alsoBad: { snapshot: 42 } }));
    const objectStore = window.__edsTest.readProjectStore();
    localStorage.setItem(
      "electricalDrawingStudio.projects",
      '{"__proto__":{"id":"__proto__","label":"safe","snapshot":"{}"}}'
    );
    const specialKeyStore = window.__edsTest.readProjectStore();
    return {
      arrayStore,
      objectStore,
      specialKeyStore: {
        nullPrototype: Object.getPrototypeOf(specialKeyStore) === null,
        hasOwnEntry: Object.prototype.hasOwnProperty.call(specialKeyStore, "__proto__"),
        label: specialKeyStore["__proto__"]?.label,
        polluted: specialKeyStore.polluted
      }
    };
  });

  expect(result).toEqual({
    arrayStore: {},
    objectStore: {},
    specialKeyStore: {
      nullPrototype: true,
      hasOwnEntry: true,
      label: "safe",
      polluted: undefined
    }
  });
});
