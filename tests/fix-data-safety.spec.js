const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const runtimeIssues = new WeakMap();

const BACKUP_KEY = "electricalDrawingStudio.backup";
const BACKUP_GEN1_KEY = "electricalDrawingStudio.backupGen1";
const BACKUP_GEN_META_KEY = "electricalDrawingStudio.backupGenMeta";

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

// 右パネルの表題欄入力へ値を入れてchangeを発火する(既存テストと同じ操作)。
async function setPageField(page, id, value) {
  await page.evaluate(([id, value]) => {
    const input = document.querySelector("#" + id);
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [id, value]);
}

const readStorage = (page, key) => page.evaluate(key => localStorage.getItem(key), key);

async function reloadApp(page) {
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("svg#canvas")).toBeVisible();
}

async function restoreBackupRow(page, key) {
  await page.locator("#restoreBackupBtn").click();
  const button = page.locator(`[data-restore-backup="${key}"]`);
  await expect(button).toBeVisible();
  await button.click();
}

test("再読込しても前回の編集が「復元」の最新に残り、次の編集で世代1へ退避される", async ({ page }) => {
  // 新規・復元のconfirmと、未保存時の離脱確認(beforeunload)を受け入れる
  page.on("dialog", dialog => dialog.accept());

  // 起動直後の白紙は自動バックアップへ書かない
  expect(await readStorage(page, BACKUP_KEY)).toBeNull();

  await setPageField(page, "drawingTitle", "前回の図面");
  await page.locator("#addPageBtn").click();
  const edited = await readStorage(page, BACKUP_KEY);
  expect(edited).toContain("前回の図面");
  expect(JSON.parse(edited).pages).toHaveLength(2);

  // 編集せずに2回開き直しても、最新は前回の編集のまま・世代も消費しない
  const gen1BeforeReload = await readStorage(page, BACKUP_GEN1_KEY);
  const metaBeforeReload = await readStorage(page, BACKUP_GEN_META_KEY);
  await reloadApp(page);
  await reloadApp(page);
  expect(await page.evaluate(() => window.__edsTest.state.pages.length)).toBe(1);
  expect(await readStorage(page, BACKUP_KEY)).toBe(edited);
  expect(await readStorage(page, BACKUP_GEN1_KEY)).toBe(gen1BeforeReload);
  expect(await readStorage(page, BACKUP_GEN_META_KEY)).toBe(metaBeforeReload);

  // 「復元」の最新から前回の編集へ戻せる
  await restoreBackupRow(page, "latest");
  expect(await page.evaluate(() => ({
    pages: window.__edsTest.state.pages.length,
    title: window.__edsTest.state.pages[0].title.title
  }))).toEqual({ pages: 2, title: "前回の図面" });
  // 復元しただけでは最新を書き換えない
  expect(await readStorage(page, BACKUP_KEY)).toBe(edited);

  // 開き直した後の最初の編集は、5分以内でも前の最新を世代1へ退避してから保存する
  await reloadApp(page);
  await setPageField(page, "drawingTitle", "再起動後の図面");
  expect(await readStorage(page, BACKUP_KEY)).toContain("再起動後の図面");
  expect(await readStorage(page, BACKUP_GEN1_KEY)).toBe(edited);
  const metaAfterSession = JSON.parse(await readStorage(page, BACKUP_GEN_META_KEY));

  // 同じ図面内の続く編集は従来どおり5分間隔で間引く(世代を消費しない)
  await setPageField(page, "drawingNo", "A-1");
  expect(JSON.parse(await readStorage(page, BACKUP_GEN_META_KEY))).toEqual(metaAfterSession);
  expect(await readStorage(page, BACKUP_GEN1_KEY)).toBe(edited);

  await restoreBackupRow(page, "1");
  expect(await page.evaluate(() => ({
    pages: window.__edsTest.state.pages.length,
    title: window.__edsTest.state.pages[0].title.title
  }))).toEqual({ pages: 2, title: "前回の図面" });
});

test("新規の前の図面は、新規後に編集しても「復元」の世代1から戻せる", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());

  await setPageField(page, "drawingTitle", "図面A");
  await setPageField(page, "drawingNo", "A-100");
  // 追加ページは図名・図番を引き継ぐ
  await page.locator("#addPageBtn").click();
  const drawingA = await readStorage(page, BACKUP_KEY);
  expect(JSON.parse(drawingA).pages).toHaveLength(2);

  await page.locator("#newProjectBtn").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages.length)).toBe(1);
  // 新規直後の白紙では最新を上書きしない
  expect(await readStorage(page, BACKUP_KEY)).toBe(drawingA);

  await setPageField(page, "drawingTitle", "図面B");
  expect(await readStorage(page, BACKUP_KEY)).toContain("図面B");
  expect(await readStorage(page, BACKUP_GEN1_KEY)).toBe(drawingA);

  await restoreBackupRow(page, "1");
  expect(await page.evaluate(() => {
    const state = window.__edsTest.state;
    return { pages: state.pages.length, title: state.pages[0].title.title, drawingNo: state.pages[1].title.drawingNo };
  })).toEqual({ pages: 2, title: "図面A", drawingNo: "A-100" });
});

test("新規は図面固有データ(プロジェクト情報・改訂履歴・ケーブル表)を初期化し、ライブラリと設定は残す", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.evaluate(() => {
    const api = window.__edsTest;
    const base = api.state;
    api.installProjectData({
      schemaVersion: base.schemaVersion,
      activePageId: "p1",
      settings: { ...base.settings, componentTagFormat: "%F-%N", wireNumberFormat: "W%N" },
      layers: [...base.layers, { id: "extra", label: "追加レイヤ", visible: true, locked: false, color: "#111820" }],
      wireTypes: [...base.wireTypes, { id: "special", label: "特殊線", color: "#123456", width: .4, dash: "", noNumber: false }],
      customSymbols: [{ id: "usr1", label: "ユーザー部品", templates: [{ type: "rect", x: 0, y: 0, w: 10, h: 10 }] }],
      userCircuits: [{ id: "uc1", name: "自己保持回路", w: 20, h: 20, elements: [] }],
      catalog: [{ manufacturer: "メーカーA", catalog: "CAT-1" }],
      plcModules: [{ label: "入力16点", start: "X000", count: 16 }],
      standardPacks: [{ packVersion: 1, id: "pack1", name: "社内標準" }],
      footprintDb: [{ manufacturer: "メーカーA", catalog: "CAT-1", type: "contactor", w: 20, h: 30 }],
      cables: [{ tag: "CBL1", core: "1", color: "黒", gauge: "1.25", status: "used", from: "", to: "", shielded: false }],
      project: {
        title: "旧案件", drawingNo: "D-100", revision: "C", designer: "佐藤", date: "2020-01-01", facility: "1号ライン",
        revisions: [{ rev: "A", date: "2020-01-01", note: "初版" }],
        titleMap: { designer: "keep" }
      },
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", title: { title: "旧案件" }, elements: [] }]
    });
  });

  await page.locator("#newProjectBtn").click();

  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const state = api.state;
    return {
      today: api.formatLocalDate(),
      project: { ...state.project, titleMap: undefined },
      titleMap: state.project.titleMap,
      cables: state.cables,
      pages: state.pages.map(page => ({ name: page.name, title: page.title.title })),
      kept: {
        componentTagFormat: state.settings.componentTagFormat,
        wireNumberFormat: state.settings.wireNumberFormat,
        layer: state.layers.some(layer => layer.id === "extra"),
        wireType: state.wireTypes.some(type => type.id === "special"),
        customSymbols: state.customSymbols.map(item => item.id),
        userCircuits: state.userCircuits.map(item => item.id),
        catalog: state.catalog.map(item => item.catalog),
        plcModules: state.plcModules.map(item => item.label),
        standardPacks: state.standardPacks.map(item => item.id),
        footprintDb: state.footprintDb.map(item => item.catalog)
      },
      saved: JSON.stringify(state)
    };
  });

  expect(result.project).toEqual({
    title: "電気図面", drawingNo: "", revision: "", designer: "", date: result.today, facility: "",
    revisions: [], titleMap: undefined
  });
  // 表題欄マッピングは図面をまたぐ設定として残す
  expect(result.titleMap.designer).toBe("keep");
  expect(result.titleMap.title).toBe("project.title");
  expect(result.cables).toEqual([]);
  expect(result.pages).toEqual([{ name: "P1", title: "電気図面" }]);
  expect(result.kept).toEqual({
    componentTagFormat: "%F-%N",
    wireNumberFormat: "W%N",
    layer: true,
    wireType: true,
    customSymbols: ["usr1"],
    userCircuits: ["uc1"],
    catalog: ["CAT-1"],
    plcModules: ["入力16点"],
    standardPacks: ["pack1"],
    footprintDb: ["CAT-1"]
  });
  // 保存されるJSONへ前の図面の情報が紛れ込まない
  for (const leftover of ["旧案件", "D-100", "佐藤", "1号ライン", "初版", "CBL1"]) {
    expect(result.saved, leftover).not.toContain(leftover);
  }
});

// 複製対象ページ: 末尾番号の加算規則を確認する値を各フィールドへ入れる。
async function installOffsetSamplePage(page) {
  await page.evaluate(() => {
    const api = window.__edsTest;
    let n = 0;
    // checkFieldは検証で読むフィールド名(複製でもそのまま残る)
    const el = (type, extra) => ({
      ...api.defaultElement(type, 20, 20 + n * 12.5), id: "e" + (n++), ...extra, checkField: Object.keys(extra)[0]
    });
    api.installProjectData({
      schemaVersion: api.state.schemaVersion,
      activePageId: "p1",
      pages: [{
        id: "p1", name: "P1", size: "A4", orientation: "portrait", title: { title: "電源 DC" },
        elements: [
          el("pushButton", { tag: "PB1" }),
          el("pushButton", { tag: "PB9" }),
          el("coil", { tag: "MC1" }),
          el("coil", { tag: "CR1" }),
          el("terminalStrip", { label: "TB1" }),
          el("breaker", { tag: "CB1" }),
          el("breaker", { tag: "ELB1" }),
          el("rect", { label: "MC" }),
          el("rect", { label: "電源 DC" }),
          el("rect", { label: "入力X060" }),
          el("wire", { wireNo: "X060" }),
          el("wire", { wireNo: "W09" }),
          el("wire", { wireNo: "1-9" }),
          el("plcBlock", { pinText: "X060\nX06F\nX009\nY07F\nRX0F\nW0A\nW01\nD100\nCOM" })
        ]
      }]
    });
  });
}

async function duplicateCurrentPage(page, count, offset) {
  await page.locator("#duplicatePageBtn").click();
  await page.locator("#dupCount").fill(String(count));
  await page.locator("#dupOffset").fill(String(offset));
  await page.locator("#dupRunBtn").click();
}

const pickOffsetFields = page => page.evaluate(() => window.__edsTest.state.pages.map(item => ({
  name: item.name,
  title: item.title.title,
  values: item.elements.map(element => element[element.checkField])
})));

test("ページ複製のオフセットは部品タグを16進で壊さず、PLCアドレスだけ16進で加算する", async ({ page }) => {
  await installOffsetSamplePage(page);
  await duplicateCurrentPage(page, 1, 16);
  const pages = await pickOffsetFields(page);
  expect(pages).toHaveLength(2);
  expect(pages[1].name).toBe("P17");
  // 末尾に数字の無い図名は変えない
  expect(pages[1].title).toBe("電源 DC");
  expect(pages[1].values).toEqual([
    "PB17", "PB25", "MC17", "CR17", "TB17", "CB17", "ELB17",
    "MC", "電源 DC", "入力X070",
    "X070", "W25", "1-25",
    "X070\nX07F\nX019\nY08F\nRX1F\nW1A\nW17\nD116\nCOM"
  ]);
  // 複製元は変わらない
  expect(pages[0].values[0]).toBe("PB1");
});

test("ページ複製のオフセット1でも、英字だけの文字は変えず桁数を保って加算する", async ({ page }) => {
  await installOffsetSamplePage(page);
  await duplicateCurrentPage(page, 2, 1);
  const pages = await pickOffsetFields(page);
  expect(pages.map(item => item.name)).toEqual(["P1", "P2", "P3"]);
  expect(pages.map(item => item.title)).toEqual(["電源 DC", "電源 DC", "電源 DC"]);
  expect(pages[1].values).toEqual([
    "PB2", "PB10", "MC2", "CR2", "TB2", "CB2", "ELB2",
    "MC", "電源 DC", "入力X061",
    "X061", "W10", "1-10",
    "X061\nX070\nX00A\nY080\nRX10\nW0B\nW02\nD101\nCOM"
  ]);
  expect(pages[2].values.slice(0, 2)).toEqual(["PB3", "PB11"]);
  expect(pages[2].values.at(-1)).toBe("X062\nX071\nX00B\nY081\nRX11\nW0C\nW03\nD102\nCOM");
});

test("図名を入力したまま「ページ追加」しても、値を引き継いだ新ページについて反映確認を出さない", async ({ page }) => {
  await page.locator("#drawingTitle").click();
  await page.locator("#drawingTitle").fill("");
  await page.locator("#drawingTitle").pressSequentially("一号機 制御盤");
  // Enterを押さずにページ追加を押す(blurのchangeで1ページ目へ確定→追加ページが引き継ぐ)
  await page.locator("#addPageBtn").click();
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    dialogHidden: document.querySelector("#dialogBackdrop").classList.contains("hidden"),
    titles: window.__edsTest.state.pages.map(item => item.title.title)
  }));
  expect(result.titles).toEqual(["一号機 制御盤", "一号機 制御盤"]);
  expect(result.dialogHidden).toBe(true);
});

test("表題欄の反映確認は値が異なるページだけを数える", async ({ page }) => {
  await page.evaluate(() => {
    const page = (id, title) => ({ id, name: id.toUpperCase(), size: "A4", orientation: "portrait", title: { title }, elements: [] });
    window.__edsTest.installProjectData({
      schemaVersion: window.__edsTest.state.schemaVersion,
      activePageId: "p1",
      pages: [page("p1", "旧図名"), page("p2", "新図名"), page("p3", "旧図名")]
    });
  });
  await setPageField(page, "drawingTitle", "新図名");
  await page.waitForFunction(() =>
    !document.querySelector("#dialogBackdrop").classList.contains("hidden")
    && document.querySelector("#dialogTitle").textContent.includes("他のページへ反映"));
  await expect(page.locator("#dialogBody")).toContainText("他の 1 ページ");
  await page.click("#titlePropAllBtn");
  expect(await page.evaluate(() => window.__edsTest.state.pages.map(item => item.title.title)))
    .toEqual(["新図名", "新図名", "新図名"]);
});

test("新しいページの日付は起動時ではなく作成時点の日付になる", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  const result = await page.evaluate(() => {
    const RealDate = Date;
    // 起動後に日付が変わった状況(2031-01-02 00:05 ローカル時刻)を再現する
    const fixed = new RealDate(2031, 0, 2, 0, 5).getTime();
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
    try {
      const created = window.__edsTest.createPage({}).title.date;
      document.querySelector("#newProjectBtn").click();
      const state = window.__edsTest.state;
      return { created, newPage: state.pages[0].title.date, project: state.project.date };
    } finally {
      window.Date = RealDate;
    }
  });
  expect(result).toEqual({ created: "2031-01-02", newPage: "2031-01-02", project: "2031-01-02" });
});

test("2面下絵で複数画像を選ぶと、画像1枚ごとに1つの基準番号で頁名を付ける", async ({ page }) => {
  await page.evaluate(() => {
    const page = id => ({ id, name: id.toUpperCase(), size: "A4", orientation: "portrait", title: {}, elements: [] });
    window.__edsTest.installProjectData({
      schemaVersion: window.__edsTest.state.schemaVersion,
      activePageId: "p1",
      pages: [page("p1"), page("p2"), page("p3")]
    });
  });
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 28;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#cccccc";
    ctx.fillRect(0, 0, 40, 28);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const buffer = Buffer.from(base64, "base64");
  await page.locator("#underlayTwoUpInput").setInputFiles([
    { name: "scan1.png", mimeType: "image/png", buffer },
    { name: "scan2.png", mimeType: "image/png", buffer }
  ]);
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.map(item => item.name)))
    .toEqual(["P1", "P2", "P3", "P4-1", "P4-2", "P5-1", "P5-2"]);
  const underlays = await page.evaluate(() => window.__edsTest.state.pages.slice(3)
    .map(item => item.elements.filter(element => element.type === "underlayImage").length));
  expect(underlays).toEqual([1, 1, 1, 1]);
});
