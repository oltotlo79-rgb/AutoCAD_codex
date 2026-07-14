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

test("AC受電・分岐は100V単相の既定値と接地省略を矛盾なく反映する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acVolt").selectOption("100");
  await expect(page.locator("#acInRails")).toHaveValue("R,N");
  await expect(page.locator("#acOutRails")).toHaveValue("R01,N01");
  await expect(page.locator("#acElbModel")).toHaveValue("NV63-CVF 2P 20A");
  await expect(page.locator("#acTr")).toHaveValue("off");
  await expect(page.locator("#acTr")).toBeDisabled();

  await page.locator("#acVolt").selectOption("200");
  await expect(page.locator("#acInRails")).toHaveValue("R,S,T");
  await expect(page.locator("#acOutRails")).toHaveValue("R01,S01,T01");
  await expect(page.locator("#acElbModel")).toHaveValue("NV63-CVF 3P 20A");
  await expect(page.locator("#acTr")).toHaveValue("100VA");
  await expect(page.locator("#acTr")).toBeEnabled();

  await page.locator("#acVolt").selectOption("100");
  await page.locator("#acBuildBtn").click();
  const singlePhase = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const table = current.elements.find(element => element.type === "table");
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail).sort(),
      transformerCount: current.elements.filter(element => element.type === "transformer").length,
      verticalElbPoles: current.elements.filter(element => element.type === "breaker" && element.orientation === "vertical").length,
      tableText: table?.cellText || ""
    };
  });
  expect(singlePhase.rails).toEqual(["G", "N01", "R01"]);
  expect(singlePhase.transformerCount).toBe(0);
  expect(singlePhase.verticalElbPoles).toBe(2);
  expect(singlePhase.tableText).toContain("R N\t6.0mm2");
  expect(singlePhase.tableText).not.toContain("R S T\t");

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acGround").fill("");
  await page.locator("#acBuildBtn").click();
  const noGround = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const table = current.elements.find(element => element.type === "table");
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail),
      tableText: table?.cellText || ""
    };
  });
  expect(noGround.rails).not.toContain("G");
  expect(noGround.tableText.split("\n").some(line => line.startsWith("G\t"))).toBe(false);
});

test("ACモータは駆動方式の既定値を同期し1軸とモータタグを正しく反映する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acMotor");
  await expect(page.locator('#acDrive option[value="servo"]')).toHaveText("サーボアンプ");
  await page.locator("#acDrive").selectOption("inverter");
  await expect(page.locator("#acRails")).toHaveValue("R01,S01,T01");
  await expect(page.locator("#acContactTag")).toHaveValue("MC2M1");
  await expect(page.locator("#acMotorTag")).toHaveValue("M1");
  await page.locator("#acDrive").selectOption("servo");
  await expect(page.locator("#acRails")).toHaveValue("R1,S1,T1");
  await expect(page.locator("#acContactTag")).toHaveValue("MS1M");
  await expect(page.locator("#acMotorTag")).toHaveValue("SM1");

  await page.locator("#acAxes").selectOption("1");
  await page.locator("#acMotorTag").fill("AX9");
  await page.locator("#acMotorBuildBtn").click();
  const servo = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      motors: current.elements.filter(element => element.type === "motor").map(element => element.tag),
      brakeRelayCoils: current.elements.filter(element => element.type === "coil" && String(element.tag || "").startsWith("CRMBR")).map(element => element.tag),
      brakeRelayContacts: current.elements.filter(element => element.type === "contactNO" && String(element.tag || "").startsWith("CRMBR")).map(element => element.tag),
      signalLabels: current.elements.filter(element => element.type === "arrow").map(element => element.label)
    };
  });
  expect(servo.motors).toEqual(["AX9"]);
  expect(servo.brakeRelayCoils).toEqual(["CRMBR1"]);
  expect(new Set(servo.brakeRelayContacts)).toEqual(new Set(["CRMBR1"]));
  expect(servo.signalLabels).toContain("AX9エンコーダ");
  expect(servo.signalLabels).not.toContain("AX10エンコーダ");
  await page.locator("#auditBtn").click();
  await expect(page.locator("#dialogBody")).not.toContainText("CRMBR2");
  await expect(page.locator("#dialogBody tr").filter({ hasText: "同一部品種別で部品タグが重複" }).filter({ hasText: "CRMBR1" })).toHaveCount(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("acMotor");
  await page.locator("#acDrive").selectOption("inverter");
  await page.locator("#acMotorBuildBtn").click();
  const inverter = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail).sort(),
      motors: current.elements.filter(element => element.type === "motor").map(element => element.tag),
      contactTags: [...new Set(current.elements.filter(element => element.type === "contactNO").map(element => element.tag).filter(Boolean))]
    };
  });
  expect(inverter.rails).toEqual(["G", "R01", "S01", "T01"]);
  expect(inverter.motors).toEqual(["M1"]);
  expect(inverter.contactTags).toContain("MC2M1");
});

test("新テンプレート全バリエーションの接続点はグリッド上にありIDも重複しない", async ({ page }) => {
  test.setTimeout(30_000);
  const cases = [
    { name: "ac200", option: "acPower", button: "#acBuildBtn", setup: [], expected: { breaker: 19, transformer: 1 } },
    { name: "ac100", option: "acPower", button: "#acBuildBtn", setup: [["#acVolt", "100"]], expected: { breaker: 18, transformer: 0 } },
    { name: "servo2", option: "acMotor", button: "#acMotorBuildBtn", setup: [], expected: { motor: 2, resistor: 2 } },
    { name: "servo1", option: "acMotor", button: "#acMotorBuildBtn", setup: [["#acAxes", "1"]], expected: { motor: 1, resistor: 1 } },
    { name: "inverter", option: "acMotor", button: "#acMotorBuildBtn", setup: [["#acDrive", "inverter"]], expected: { motor: 1, thermalElement: 2 } },
    { name: "dc", option: "dcPower", button: "#dcBuildBtn", setup: [], expected: { breaker: 4, ground: 2 } },
    { name: "plc", option: "plcPower", button: "#plcpBuildBtn", setup: [], expected: { breaker: 4, contactNO: 4 } },
    { name: "safety", option: "safetyRelay", button: "#sfBuildBtn", setup: [], expected: { pushButton: 2, contactNO: 2, contactNC: 1 } }
  ];

  for (const item of cases) {
    await page.goto(appUrl, { waitUntil: "load" });
    await page.locator("#templateMenu").selectOption(item.option);
    for (const [selector, value] of item.setup) await page.locator(selector).selectOption(value);
    await page.locator(item.button).click();
    const result = await page.evaluate(() => {
      const current = window.__edsTest.state.pages.find(entry => entry.id === window.__edsTest.state.activePageId);
      const onGridX = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < 0.001;
      const onGridY = value => onGridX(value) || Array.from({ length: 21 }, (_, index) => 27 + 9.5 * index).some(row => Math.abs(row - value) < 0.001);
      const violations = [];
      const counts = {};
      for (const element of current.elements) {
        counts[element.type] = (counts[element.type] || 0) + 1;
        const points = Array.isArray(element.points)
          ? element.points.map(point => ({ x: Number(point[0]), y: Number(point[1]) }))
          : window.__edsTest.elementConnectionAnchors(element);
        points.forEach(point => {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !onGridX(point.x) || !onGridY(point.y)) {
            violations.push({ type: element.type, x: point.x, y: point.y });
          }
        });
      }
      const ids = current.elements.map(element => element.id);
      return { counts, violations, duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index) };
    });
    expect(result.violations, `${item.name}の接続点`).toEqual([]);
    expect(result.duplicateIds, `${item.name}の要素ID`).toEqual([]);
    for (const [type, count] of Object.entries(item.expected)) expect(result.counts[type] || 0, `${item.name}:${type}`).toBe(count);
  }
});

test("針付き計器は標準計器ではなく目盛弧と針を描画する", async ({ page }) => {
  const anchors = await page.evaluate(() => {
    const standard = { ...window.__edsTest.defaultElement("meter", 30, 40), id: "meter-standard", symbolVariant: "standard" };
    const needle = { ...window.__edsTest.defaultElement("meter", 50, 40), id: "meter-needle", symbolVariant: "needle" };
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "p1",
      pages: [{ id: "p1", title: {}, elements: [standard, needle] }]
    });
    return {
      standard: window.__edsTest.elementConnectionAnchors(standard),
      needle: window.__edsTest.elementConnectionAnchors(needle)
    };
  });
  await expect(page.locator('svg#canvas g[data-id="meter-standard"] path')).toHaveCount(0);
  await expect(page.locator('svg#canvas g[data-id="meter-needle"] path')).toHaveCount(1);
  expect(anchors.needle.map(point => [point.x - 20, point.y])).toEqual(anchors.standard.map(point => [point.x, point.y]));
});

test("既存schema v3の変圧器上タップ配線を新しい行位置へ冪等に追従させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const source = {
      schemaVersion: 3,
      activePageId: "p1",
      pages: [{
        id: "p1",
        title: {},
        elements: [
          { id: "tr", type: "transformer", x: 100, y: 100, w: 15, h: 17, rotation: 0 },
          { id: "left", type: "wire", points: [[90, 100.5], [105, 100.5]] },
          { id: "right", type: "wire", points: [[110, 100.5], [120, 100.5]] },
          { id: "junction", type: "junction", x: 105, y: 100.5 }
        ]
      }]
    };
    const first = window.__edsTest.migrateProjectData(source);
    const second = window.__edsTest.migrateProjectData(first);
    const byId = Object.fromEntries(second.pages[0].elements.map(element => [element.id, element]));
    return {
      left: byId.left.points,
      right: byId.right.points,
      junction: [byId.junction.x, byId.junction.y],
      anchors: window.__edsTest.elementConnectionAnchors(byId.tr)
    };
  });
  expect(result.left[1]).toEqual([105, 96]);
  expect(result.right[0]).toEqual([110, 96]);
  expect(result.junction).toEqual([105, 96]);
  expect(result.anchors).toEqual(expect.arrayContaining([{ x: 105, y: 96 }, { x: 110, y: 96 }]));
});

test("DC電源のN1・P0・P24・N24・G送り矢印は配線ネットへ接続される", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("dcPower");
  await page.locator("#dcBuildBtn").click();
  const connections = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const wires = current.elements.filter(element => element.type === "wire");
    const same = (a, b) => Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
    return Object.fromEntries(["N1", "P0", "P24", "N24", "G"].map(label => {
      const arrow = current.elements.find(element => element.type === "arrow" && element.label === label && element.signalRole === "source");
      const start = arrow?.points?.[0];
      const connected = Boolean(start && wires.some(wire => {
        const points = wire.points || [];
        return points.length > 0 && (same(points[0], start) || same(points[points.length - 1], start));
      }));
      return [label, connected];
    }));
  });
  expect(connections).toEqual({ N1: true, P0: true, P24: true, N24: true, G: true });
  await page.locator("#auditBtn").click();
  const unnumberedComponentRows = page.locator("#dialogBody tr").filter({ hasText: "部品タグが未採番" });
  await expect(unnumberedComponentRows.filter({ hasText: "P24" })).toHaveCount(0);
  await expect(unnumberedComponentRows.filter({ hasText: "N24" })).toHaveCount(0);
  await expect(unnumberedComponentRows.filter({ hasText: "G" })).toHaveCount(0);
});

test("PLC接点タグの空項目は余分な接点として生成しない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("plcPower");
  await page.locator("#plcpPcr1").fill("PCR1M,");
  await page.locator("#plcpPcr2").fill("");
  await page.locator("#plcpBuildBtn").click();
  const tags = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return current.elements.filter(element => element.type === "contactNO").map(element => element.tag);
  });
  expect(tags).toEqual(["PCR1M"]);
});
