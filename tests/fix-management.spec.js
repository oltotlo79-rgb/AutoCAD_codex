const fs = require("node:fs");
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

const blankPage = (id, name, elements, extra = {}) => ({ id, name, size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements, ...extra });
const install = (page, data) => page.evaluate(data => window.__edsTest.installProjectData(data), data);
const element = (page, id) => page.evaluate(id => {
  for (const sheet of window.__edsTest.state.pages) {
    const found = sheet.elements.find(item => item.id === id);
    if (found) return JSON.parse(JSON.stringify(found));
  }
  return null;
}, id);
const drawnStroke = (page, id) => page.evaluate(id => document.querySelector(`svg#canvas [data-id="${id}"]`).style.getPropertyValue("--element-stroke").trim(), id);

test("レイヤ管理の線色: 標準の黒の要素と図枠をレイヤの色で描き、個別の色と既定の見た目は変えない", async ({ page }) => {
  test.setTimeout(30_000);
  // 旧版の既定レイヤ(配置=灰#5b626b)のままのデータを読み込む。
  await install(page, {
    schemaVersion: 4, activePageId: "p1",
    layers: [
      { id: "frame", label: "図枠", visible: true, locked: true, color: "#141a20" },
      { id: "wires", label: "配線", visible: true, locked: false, color: "#111820" },
      { id: "symbols", label: "記号", visible: true, locked: false, color: "#111820" },
      { id: "notes", label: "注記", visible: true, locked: false, color: "#111820" },
      { id: "layout", label: "配置", visible: true, locked: false, color: "#5b626b" }
    ],
    pages: [blankPage("p1", "P1", [
      { id: "coil", type: "coil", x: 40, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", stroke: "#111820", layer: "symbols" },
      { id: "green", type: "contactNO", x: 80, y: 40, w: 14, h: 10, tag: "CR1", label: "CR1", stroke: "#0f6f63", layer: "symbols" },
      { id: "box", type: "rect", x: 40, y: 80, w: 40, h: 20, label: "盤", stroke: "#111820", layer: "layout" },
      { id: "w1", type: "wire", points: [[20, 60], [120, 60]], wireNo: "1-01", stroke: "#111820", wireType: "control", layer: "wires" }
    ], { frameVariant: "compact" })]
  });

  // 既定のままなら従来どおり標準の黒(配置レイヤの旧既定の灰は黒へ読み替え、矩形の色も変わらない)。
  expect(await drawnStroke(page, "coil")).toBe("#111820");
  expect(await drawnStroke(page, "box")).toBe("#111820");
  expect(await page.evaluate(() => window.__edsTest.state.layers.find(layer => layer.id === "layout").color)).toBe("#111820");
  const frameStrokeBefore = await page.evaluate(() => getComputedStyle(document.querySelector("svg#canvas .frame .frame-line")).stroke);
  expect(frameStrokeBefore).toBe("rgb(20, 26, 32)");

  await page.locator("#actionMenu").selectOption("layerManager");
  const dialog = page.locator("#dialogBody");
  await expect(dialog.locator("thead th").nth(3)).toHaveText("線色");
  await expect(dialog.locator('[data-layer-row="layout"] [data-layer-field="color"]')).toHaveValue("#111820");
  await dialog.locator('[data-layer-row="symbols"] [data-layer-field="color"]').fill("#1f5fbf");
  await dialog.locator('[data-layer-row="wires"] [data-layer-field="color"]').fill("#b42318");
  await dialog.locator('[data-layer-row="frame"] [data-layer-field="color"]').fill("#6f42c1");
  await page.locator("#applyLayerManagerBtn").click();

  // 標準の黒の要素はレイヤの線色、個別に緑を選んだ接点は緑のまま、配置レイヤ(既定のまま)の矩形は黒のまま。
  expect(await drawnStroke(page, "coil")).toBe("#1f5fbf");
  expect(await drawnStroke(page, "green")).toBe("#0f6f63");
  expect(await drawnStroke(page, "box")).toBe("#111820");
  expect(await page.evaluate(() => document.querySelector('svg#canvas [data-id="w1"] path.wire-line').getAttribute("stroke"))).toBe("#b42318");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("svg#canvas .frame .frame-line")).stroke)).toBe("rgb(111, 66, 193)");

  // 右パネルの線色欄に、レイヤの線色で描いていることを示す。
  await page.evaluate(() => window.__edsTest.selectElement("coil"));
  await expect(page.locator("[data-layer-color-note]")).toContainText("記号");
  await page.evaluate(() => window.__edsTest.selectElement("green"));
  await expect(page.locator("[data-layer-color-note]")).toHaveCount(0);

  // SVG出力にも同じ色が出る。線の見た目のCSSも同梱し、ページのCSSが無くても線が描かれる。
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportSvgBtn").evaluate(button => button.click());
  const svg = fs.readFileSync(await (await downloadPromise).path(), "utf8");
  expect(svg).toContain("<style>");
  expect(svg).toMatch(/\.symbol-line\s*\{[^}]*stroke: var\(--element-stroke/);
  expect(svg).toContain("--element-stroke: #1f5fbf");
  expect(svg).toContain("--frame-stroke: #6f42c1");
  expect(svg).toContain('stroke="#b42318"');
});

test("フットプリント検索DB: 回路図種別はパレットの部品名から選び、旧版の手入力値も引ける", async ({ page }) => {
  test.setTimeout(30_000);
  await install(page, {
    schemaVersion: 4, activePageId: "layout",
    // 1行目は内部名、2行目は旧版で表示名を手入力した行。
    footprintDb: [
      { manufacturer: "", catalog: "", type: "plcBlock", label: "", w: 60, h: 40 },
      { manufacturer: "", catalog: "", type: "コイル", label: "", w: 31, h: 41 }
    ],
    pages: [
      blankPage("layout", "盤", []),
      blankPage("p1", "回路", [
        { id: "coil", type: "coil", x: 60, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", layer: "symbols" }
      ])
    ]
  });

  await page.locator("#actionMenu").selectOption("footprintDb");
  const rows = page.locator("[data-footprint-row]");
  const firstType = rows.nth(0).locator('select[data-fp="type"]');
  await expect(firstType).toHaveValue("plcBlock");
  await expect(firstType.locator("option:checked")).toHaveText("PLC/I-O");
  await expect(firstType.locator("option").first()).toHaveText("(すべて)");
  await expect(firstType.locator("option").first()).toHaveAttribute("value", "");
  // 旧版の「コイル」は内部名coilとして表示名で選ばれた状態になる。
  await expect(rows.nth(1).locator('select[data-fp="type"]')).toHaveValue("coil");
  await expect(rows.nth(1).locator('select[data-fp="type"] option:checked')).toHaveText("コイル");

  // 新しい行は部品名で選ぶ。保存値は内部の種別名。
  await page.locator("#footprintAdd").click();
  const added = rows.last();
  await added.locator('[data-fp="catalog"]').fill("SD-T12");
  await added.locator('select[data-fp="type"]').selectOption({ label: "電磁接触器" });
  await page.locator("#dialogClose").click();

  // 旧版の手入力行(コイル)は、適用前の保存値のままでも挿入時の寸法に使われる。
  await page.locator("#actionMenu").selectOption("panelLink");
  await page.locator("#panelInsertBtn").click();
  const footprint = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.panelRef === "CR1"));
  expect([footprint.w, footprint.h]).toEqual([31, 41]);

  await page.locator("#actionMenu").selectOption("footprintDb");
  await page.locator("#footprintAdd").click();
  await rows.last().locator('[data-fp="catalog"]').fill("SD-T12");
  await rows.last().locator('select[data-fp="type"]').selectOption({ label: "電磁接触器" });
  await page.locator("#footprintApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.footprintDb.map(item => item.type))).toEqual(["plcBlock", "coil", "contactor"]);
});

test("フットプリント検索DBの盤図形名を、挿入した盤フットプリントのタグの下に表示する", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "layout",
    footprintDb: [{ manufacturer: "OMRON", catalog: "MY2N", type: "coil", label: "リレー MY2N", w: 24, h: 20 }],
    pages: [
      blankPage("layout", "盤", []),
      blankPage("p1", "回路", [
        { id: "coil", type: "coil", x: 60, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", manufacturer: "OMRON", catalog: "MY2N", layer: "symbols" },
        { id: "coil2", type: "coil", x: 90, y: 40, w: 10, h: 7, tag: "CR2", label: "CR2", layer: "symbols" }
      ])
    ]
  });

  await page.locator("#actionMenu").selectOption("panelLink");
  await page.locator("#panelInsertBtn").click();
  const footprints = await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.panelRef));
  const matched = footprints.find(item => item.panelRef === "CR1");
  const other = footprints.find(item => item.panelRef === "CR2");
  expect(matched).toMatchObject({ w: 24, h: 20, label: "CR1", footprintName: "リレー MY2N" });
  expect(other.footprintName).toBeUndefined();

  // 画面ではタグ(1行目)の下に盤図形名(2行目)を描く。
  const texts = await page.evaluate(id => Array.from(document.querySelectorAll(`svg#canvas [data-id="${id}"] text`))
    .map(node => ({ text: node.textContent, y: Number(node.getAttribute("y")) })), matched.id);
  const tag = texts.find(item => item.text === "CR1");
  const name = texts.find(item => item.text === "リレー MY2N");
  expect(tag).toBeTruthy();
  expect(name).toBeTruthy();
  expect(name.y).toBeGreaterThan(tag.y);
  // DXFにも同じ2行目を出す。
  expect(await page.evaluate(() => window.__edsTest.buildDxf(window.__edsTest.state.pages[0]))).toContain("リレー MY2N");

  // 右パネルの「盤フットプリント」欄で盤図形名を編集できる。
  await page.evaluate(id => window.__edsTest.selectElement(id), matched.id);
  const nameInput = page.locator('#selectionPanel [data-bind="footprintName"]');
  await expect(nameInput).toHaveValue("リレー MY2N");
  await nameInput.fill("補助リレー");
  await nameInput.blur();
  expect((await element(page, matched.id)).footprintName).toBe("補助リレー");
});

test("盤フットプリントの右パネルで設備・場所を編集し、「盤→回路図」で回路図部品へ反映できる", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "layout",
    pages: [
      blankPage("layout", "盤", [
        { id: "foot", type: "rect", x: 40, y: 40, w: 20, h: 14, label: "CR1", panelRef: "CR1", stroke: "#111820", layer: "layout" }
      ]),
      blankPage("p1", "回路", [
        { id: "coil", type: "coil", x: 60, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", installation: "旧盤", location: "旧段", layer: "symbols" }
      ])
    ]
  });

  await page.evaluate(() => window.__edsTest.selectElement("foot"));
  const panel = page.locator("#selectionPanel details", { hasText: "盤フットプリント" });
  const installation = panel.locator('[data-bind="installation"]');
  const location = panel.locator('[data-bind="location"]');
  await expect(installation).toHaveValue("");
  await installation.fill("盤B");
  await installation.blur();
  await page.locator("#selectionPanel details", { hasText: "盤フットプリント" }).locator('[data-bind="location"]').fill("下段");
  await page.locator("#selectionPanel details", { hasText: "盤フットプリント" }).locator('[data-bind="location"]').blur();
  expect(await element(page, "foot")).toMatchObject({ installation: "盤B", location: "下段" });

  await page.locator("#actionMenu").selectOption("panelLink");
  await page.locator("#panelPullBtn").click();
  expect(await element(page, "coil")).toMatchObject({ installation: "盤B", location: "下段" });

  // 「回路図→盤」で回路図側の値が入れば、右パネルの設備・場所欄にも出る。
  await page.evaluate(() => {
    const coil = window.__edsTest.state.pages[1].elements.find(item => item.id === "coil");
    coil.installation = "制御盤";
    coil.location = "扉";
    window.__edsTest.syncPanelFootprints("toPanel");
    window.__edsTest.selectElement("foot");
  });
  await expect(page.locator("#selectionPanel details", { hasText: "盤フットプリント" }).locator('[data-bind="installation"]')).toHaveValue("制御盤");
  await expect(location).toHaveValue("扉");
});

test("2面下絵ページを作成: 分割のしかたを選んでから画像を選び、各ページの用紙の向きを合わせる", async ({ page }) => {
  test.setTimeout(30_000);
  await install(page, { schemaVersion: 4, activePageId: "p1", pages: [blankPage("p1", "P1", [])] });
  // 2色に塗り分けた画像を作る(縦長=上赤・下青、横長=左赤・右青)。
  const makeImage = (w, h, split) => page.evaluate(({ w, h, split }) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#0000ff";
    if (split === "vertical") ctx.fillRect(0, h / 2, w, h / 2);
    else ctx.fillRect(w / 2, 0, w / 2, h);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { w, h, split });
  const tall = Buffer.from(await makeImage(28, 40, "vertical"), "base64");
  const wide = Buffer.from(await makeImage(40, 28, "horizontal"), "base64");
  // 追加されたページの名前・向き・下絵画像の大きさと中央の色を読む。
  const createdPages = from => page.evaluate(async from => {
    const result = [];
    for (const sheet of window.__edsTest.state.pages.slice(from)) {
      const underlay = sheet.elements.find(item => item.type === "underlayImage");
      const image = new Image();
      await new Promise(resolve => { image.onload = resolve; image.src = underlay.imageData; });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const [r, , b] = ctx.getImageData(Math.floor(image.naturalWidth / 2), Math.floor(image.naturalHeight / 2), 1, 1).data;
      result.push({ name: sheet.name, orientation: sheet.orientation, size: [image.naturalWidth, image.naturalHeight], color: r > b ? "red" : "blue" });
    }
    return result;
  }, from);
  // 下絵の作成後は下絵が選択され右パネルが「選択部品」になるので、「ページ設定」タブから開く。
  const openTwoUpDialog = async () => {
    await page.locator("#inspectorTabPage").click();
    await page.locator("#underlayMenu").selectOption("twoUp");
  };
  const runTwoUp = async (label, file) => {
    await openTwoUpDialog();
    await expect(page.locator("#dialogTitle")).toHaveText("2面下絵ページを作成");
    await page.locator("#dialogBody label", { hasText: label }).locator('input[type="radio"]').check();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#twoUpChooseBtn").click()]);
    const before = await page.evaluate(() => window.__edsTest.state.pages.length);
    await chooser.setFiles({ name: "scan.png", mimeType: "image/png", buffer: file });
    await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.length)).toBe(before + 2);
    return createdPages(before);
  };

  await openTwoUpDialog();
  const options = page.locator('#dialogBody input[name="twoUpLayout"]');
  await expect(options).toHaveCount(4);
  for (const label of ["横長のスキャンを左右に分割（A4縦×2）", "縦長のスキャンを上下に分割（A4横×2）", "90°右に回して左右に分割（従来の向き）"]) {
    await expect(page.locator("#dialogBody label", { hasText: label })).toHaveCount(1);
  }
  await page.locator("#dialogClose").click();

  // A3縦に上下に並んだA4横2枚: 上=-1、下=-2。どちらもA4横。
  expect(await runTwoUp("縦長のスキャンを上下に分割", tall)).toEqual([
    { name: "P2-1", orientation: "landscape", size: [28, 20], color: "red" },
    { name: "P2-2", orientation: "landscape", size: [28, 20], color: "blue" }
  ]);
  // 次に開いたときは直前の選択が既定。
  await openTwoUpDialog();
  await expect(page.locator("#dialogBody label", { hasText: "縦長のスキャンを上下に分割" }).locator("input")).toBeChecked();
  await page.locator("#dialogClose").click();

  // 頁名の基準番号は「ページ数+1」(P1,P2-1,P2-2の次はP4)。
  // 従来の向き: 右へ90度回すと元の上(赤)が右になるので、-1は青、-2は赤。A4縦。
  expect(await runTwoUp("90°右に回して左右に分割", tall)).toEqual([
    { name: "P4-1", orientation: "portrait", size: [20, 28], color: "blue" },
    { name: "P4-2", orientation: "portrait", size: [20, 28], color: "red" }
  ]);
  // A3横に左右に並んだA4縦2枚: 左=-1、右=-2。
  expect(await runTwoUp("横長のスキャンを左右に分割", wide)).toEqual([
    { name: "P6-1", orientation: "portrait", size: [20, 28], color: "red" },
    { name: "P6-2", orientation: "portrait", size: [20, 28], color: "blue" }
  ]);
  // 自動: 縦長の画像は上下に分割する。
  expect(await runTwoUp("自動", tall)).toEqual([
    { name: "P8-1", orientation: "landscape", size: [28, 20], color: "red" },
    { name: "P8-2", orientation: "landscape", size: [28, 20], color: "blue" }
  ]);
});
