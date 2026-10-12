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

// confirm/promptへ順に答える。true/false=confirmのOK/キャンセル、文字列=promptの入力。
function answerDialogs(page, answers) {
  const queue = [...answers];
  const handler = async dialog => {
    const answer = queue.shift();
    if (!queue.length) page.off("dialog", handler);
    if (dialog.type() === "prompt") await dialog.accept(String(answer));
    else if (answer) await dialog.accept();
    else await dialog.dismiss();
  };
  page.on("dialog", handler);
}

// 部品タグ採番を実行する(全ページ?/上書き?/開始番号)。
async function runAutoTag(page, { allPages = true, overwrite = false, start = "1" } = {}) {
  answerDialogs(page, [allPages, overwrite, start]);
  await page.locator("#actionMenu").selectOption("tagComponents");
}

function project(pages, extra = {}) {
  return { schemaVersion: 10, activePageId: pages[0].id, pages, ...extra };
}

function sheet(id, elements, extra = {}) {
  return { id, name: id.toUpperCase(), size: "A4", orientation: "portrait", frameVariant: "blank", title: { title: "T" }, elements, ...extra };
}

const byId = async (page) => page.evaluate(() => Object.fromEntries(
  window.__edsTest.state.pages.flatMap(item => item.elements).map(element => [element.id, element])
));

test("部品タグ採番は信号矢印・母線の送り矢印・極性マークを書き換えない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("facilityLadder");
  await page.locator("#ladBuildBtn").click();
  await page.evaluate(() => {
    const { state, defaultElement } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    current.elements.push(
      { ...defaultElement("arrow", 60, 100), id: "sig", points: [[60, 100], [70, 100]], label: "SIG-A", signalRole: "source" },
      { ...defaultElement("pushButton", 60, 120), id: "pb", label: "", tag: "" }
    );
  });
  await runAutoTag(page, { overwrite: true });
  const result = await page.evaluate(() => {
    const { state } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    return {
      forks: current.elements.filter(element => element.type === "arrow" && element.ladderRail).map(element => [element.label, element.tag || ""]),
      marks: current.elements.filter(element => element.type === "polarityMark").map(element => [element.label, element.tag || ""]),
      sig: current.elements.find(element => element.id === "sig"),
      pb: current.elements.find(element => element.id === "pb")
    };
  });
  expect(result.forks).toEqual([["", ""], ["", ""], ["", ""], ["", ""]]);
  expect(result.marks).toEqual([["P1", ""], ["N1", ""]]);
  expect(result.sig.label).toBe("SIG-A");
  expect(result.sig.tag || "").toBe("");
  expect(result.pb).toMatchObject({ tag: "PB01", label: "PB01" });

  // 採番対象外の信号矢印は部品タグ規則の表にも出さない(パレットに無い旧種別も出さない)。
  await page.locator("#actionMenu").selectOption("tagRules");
  const typeCells = await page.locator("#dialogBody tbody tr td:first-child").allTextContents();
  expect(typeCells).toContain("押しボタン");
  expect(typeCells).not.toContain("信号矢印");
  expect(typeCells.some(text => /^[a-z][A-Za-z]+$/.test(text))).toBe(false);
  expect(await page.locator('#dialogBody [data-tag-prefix-type="rectifierBox"]').count()).toBe(0);
});

test("部品タグ採番(上書き)は接点をコイルの新タグへ追従させ、固定タグと重複しない", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      { id: "coil1", type: "coil", x: 100, y: 40, w: 10, h: 4.4, tag: "CR1", label: "CR1" },
      { id: "coil2", type: "coil", x: 100, y: 60, w: 10, h: 4.4, tag: "CR7", label: "CR7" },
      { id: "c1a", type: "contactNO", x: 40, y: 40, w: 10, h: 4.4, label: "CR1" },
      { id: "c1fixed", type: "contactNC", x: 40, y: 50, w: 10, h: 4.4, tag: "CR7", label: "CR7", fixedTag: true },
      { id: "orphan", type: "contactNO", x: 40, y: 70, w: 10, h: 4.4, tag: "CR9", label: "CR9" },
      { id: "pbFixed", type: "pushButton", x: 40, y: 90, w: 10, h: 5, tag: "PB01", label: "PB01", fixedTag: true },
      { id: "pbOther", type: "pushButton", x: 40, y: 110, w: 10, h: 5, tag: "PB01", label: "PB01" }
    ]),
    sheet("p2", [
      { id: "c1b", type: "contactNC", x: 40, y: 40, w: 10, h: 4.4, tag: "CR1", label: "CR1" }
    ])
  ]));
  await runAutoTag(page, { overwrite: true });
  const elements = await byId(page);
  expect(elements.coil1).toMatchObject({ tag: "CR01", label: "CR01" });
  expect(elements.coil2).toMatchObject({ tag: "CR02", label: "CR02" });
  // 接点は番号を新しく振られず、親コイルの新タグへ付け替わる(別ページの接点も)。
  expect(elements.c1a).toMatchObject({ tag: "CR01", label: "CR01" });
  expect(elements.c1b).toMatchObject({ tag: "CR01", label: "CR01" });
  // タグ固定の接点・対応コイルの無い接点は変えない。
  expect(elements.c1fixed).toMatchObject({ tag: "CR7", label: "CR7" });
  expect(elements.orphan).toMatchObject({ tag: "CR9", label: "CR9" });
  // タグ固定の部品が使っている番号は飛ばす。
  expect(elements.pbFixed).toMatchObject({ tag: "PB01", label: "PB01" });
  expect(elements.pbOther).toMatchObject({ tag: "PB02", label: "PB02" });
  await expect(page.locator("#status")).toContainText("接点2個をコイルのタグに追従");
});

test("部品タグ採番(現在ページのみ・上書き)でも他ページの接点がコイルへ追従する", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      { id: "coil", type: "coil", x: 100, y: 40, w: 10, h: 4.4, tag: "K5", label: "K5" },
      { id: "pbOtherPage", type: "pushButton", x: 40, y: 90, w: 10, h: 5, label: "" }
    ]),
    sheet("p2", [
      { id: "contact", type: "contactNO", x: 40, y: 40, w: 10, h: 4.4, label: "K5" },
      { id: "pbKeep", type: "pushButton", x: 40, y: 60, w: 10, h: 5, tag: "PB01", label: "PB01" }
    ])
  ]));
  await runAutoTag(page, { allPages: false, overwrite: true });
  const elements = await byId(page);
  expect(elements.coil).toMatchObject({ tag: "CR01" });
  expect(elements.contact).toMatchObject({ tag: "CR01", label: "CR01" });
  // 他ページ(採番範囲外)の部品のタグとは重複させない。
  expect(elements.pbKeep).toMatchObject({ tag: "PB01" });
  expect(elements.pbOtherPage).toMatchObject({ tag: "PB02" });
});

test("部品タグ採番(未入力のみ)は使用中の番号を飛ばし、未入力の接点へは番号を振らない", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      { id: "pbOld", type: "pushButton", x: 40, y: 40, w: 10, h: 5, tag: "PB01", label: "PB01" },
      { id: "pbNew", type: "pushButton", x: 40, y: 60, w: 10, h: 5, label: "" },
      { id: "coilOld", type: "coil", x: 100, y: 40, w: 10, h: 4.4, tag: "CR01", label: "CR01" },
      { id: "coilNew", type: "coil", x: 100, y: 60, w: 10, h: 4.4, label: "" },
      { id: "contactNew", type: "contactNO", x: 40, y: 80, w: 10, h: 4.4, label: "" },
      { id: "lampFixed", type: "lamp", x: 40, y: 100, w: 10, h: 4.4, label: "", fixedTag: true }
    ])
  ]));
  await runAutoTag(page, { overwrite: false, start: "1" });
  const elements = await byId(page);
  expect(elements.pbOld).toMatchObject({ tag: "PB01" });
  expect(elements.pbNew).toMatchObject({ tag: "PB02", label: "PB02" });
  expect(elements.coilOld).toMatchObject({ tag: "CR01" });
  expect(elements.coilNew).toMatchObject({ tag: "CR02", label: "CR02" });
  expect(elements.contactNew.tag || "").toBe("");
  expect(elements.contactNew.label).toBe("");
  expect(elements.lampFixed.tag || "").toBe("");
});

test("監査の部品タグ未採番は部品タグ採番と同じ基準で判定し、採番後は消える", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("powerOn");
  await page.locator("#poBuildBtn").click();
  const generated = await page.evaluate(() => {
    const { state } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    return current.elements.find(element => element.type === "selectorSwitch");
  });
  expect(generated).toMatchObject({ tag: "KS1", label: "KS1" });
  await page.evaluate(() => {
    const { state, defaultElement } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    current.elements.push(
      { ...defaultElement("selectorSwitch", 60, 250), id: "ssLabelOnly", label: "SS1" },
      { ...defaultElement("selectorSwitch", 90, 250), id: "ssEmpty", label: "" },
      { ...defaultElement("contactNO", 120, 250), id: "contactEmpty", label: "" }
    );
  });
  await page.locator("#auditBtn").click();
  const tagRows = page.locator("#dialogBody tr").filter({ hasText: "部品タグが未採番" });
  // ラベルだけ入っている部品(採番の「未入力のみ」が飛ばすもの)は未採番として出さない。
  await expect(tagRows).toHaveCount(1);
  await expect(tagRows.first()).toContainText("切替スイッチ");
  await expect(page.locator("#dialogBody tr").filter({ hasText: "接点のタグが未入力です" })).toHaveCount(1);
  await page.locator("#dialogClose").click();

  await runAutoTag(page, { overwrite: false });
  const elements = await byId(page);
  expect(elements.ssLabelOnly).toMatchObject({ label: "SS1" });
  expect(elements.ssEmpty.tag).toMatch(/^SS\d+$/);
  expect(elements.ssEmpty.tag).not.toBe("SS1");
  await page.locator("#auditBtn").click();
  await expect(page.locator("#dialogBody tr").filter({ hasText: "部品タグが未採番" })).toHaveCount(0);
});

test("信号矢印の相手の監査は1行だけ出て選択でき、ルールOFFで消える", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      { id: "sigSrc", type: "arrow", points: [[60, 100], [70, 100]], label: "SIG-X", signalRole: "source", arrowStyle: "open" },
      { id: "sigDup1", type: "arrow", points: [[60, 120], [70, 120]], label: "SIG-Y", signalRole: "source", arrowStyle: "open" },
      { id: "sigDup2", type: "arrow", points: [[60, 140], [70, 140]], label: "SIG-Y", signalRole: "source", arrowStyle: "open" }
    ])
  ]));
  await page.locator("#auditBtn").click();
  const single = page.locator("#dialogBody tbody tr").filter({ hasText: "SIG-X" });
  await expect(single).toHaveCount(1);
  await expect(single.locator("button", { hasText: "選択" })).toHaveCount(1);
  const pair = page.locator("#dialogBody tbody tr").filter({ hasText: "SIG-Y" });
  await expect(pair).toHaveCount(1);
  await expect(pair).toContainText("受信（destination）の信号矢印がありません");
  await expect(pair.locator("button", { hasText: "選択" })).toHaveCount(1);

  await page.locator('#dialogBody [data-audit-rule="signal"]').uncheck();
  await expect(page.locator("#dialogBody tbody tr").filter({ hasText: "SIG-X" })).toHaveCount(0);
  await expect(page.locator("#dialogBody tbody tr").filter({ hasText: "SIG-Y" })).toHaveCount(0);
});

test("接続点生成はT分岐と3本以上の端点集合だけに置き、交差・継ぎ足し・角には置かない", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      // 十字交差(端点なし)
      { id: "crossH", type: "wire", points: [[20, 40], [60, 40]] },
      { id: "crossV", type: "wire", points: [[40, 20], [40, 60]] },
      // 一直線の継ぎ足し
      { id: "joinA", type: "wire", points: [[80, 40], [100, 40]] },
      { id: "joinB", type: "wire", points: [[100, 40], [120, 40]] },
      // L字の角(2本の端点)
      { id: "cornerA", type: "wire", points: [[140, 40], [160, 40]] },
      { id: "cornerB", type: "wire", points: [[160, 40], [160, 60]] },
      // T分岐(端点が相手の途中)
      { id: "teeMain", type: "wire", points: [[20, 100], [60, 100]] },
      { id: "teeBranch", type: "wire", points: [[40, 100], [40, 120]] },
      // 3本の端点が1点に集まる
      { id: "triA", type: "wire", points: [[80, 100], [100, 100]] },
      { id: "triB", type: "wire", points: [[100, 100], [120, 100]] },
      { id: "triC", type: "wire", points: [[100, 100], [100, 120]] },
      // 折れ点(相手の途中)に載る端点
      { id: "bent", type: "wire", points: [[140, 100], [160, 100], [160, 130]] },
      { id: "toBend", type: "wire", points: [[160, 100], [180, 100]] },
      // 同じ向きの重ね描き(分岐ではない)
      { id: "overA", type: "wire", points: [[20, 160], [60, 160]] },
      { id: "overB", type: "wire", points: [[40, 160], [80, 160]] }
    ])
  ]));
  answerDialogs(page, [false]);
  await page.locator("#actionMenu").selectOption("autoJunction");
  const dots = await page.evaluate(() => window.__edsTest.state.pages[0].elements
    .filter(element => element.type === "junction")
    .map(element => [element.x, element.y])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  expect(dots).toEqual([[40, 100], [100, 100], [160, 100]]);
  await expect(page.locator("#status")).toContainText("3個の接続点を生成しました");

  // 交差しているだけの配線は線番採番で別ネットのまま(同じ線番にならない)。
  answerDialogs(page, [false, true, "1"]);
  await page.locator("#autoWireBtn").click();
  const elements = await byId(page);
  expect(elements.crossH.wireNo).toBeTruthy();
  expect(elements.crossV.wireNo).toBeTruthy();
  expect(elements.crossH.wireNo).not.toBe(elements.crossV.wireNo);
  expect(elements.teeMain.wireNo).toBe(elements.teeBranch.wireNo);
});

test("ラング追加は設備ラダーの実母線(P1〜N1)に合わせ、汎用ラダーは従来位置のまま", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("facilityLadder");
  await page.locator("#ladBuildBtn").click();
  await page.locator("#actionMenu").selectOption("addRung");
  const facility = await page.evaluate(() => {
    const { state } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    return {
      rungs: current.elements.filter(element => element.ladderRung).map(element => element.points),
      texts: current.elements.filter(element => element.type === "text" && /^\d{3}$/.test(element.text)).length
    };
  });
  expect(facility.rungs).toEqual([[[32.5, 55], [147.5, 55]]]);
  expect(facility.texts).toBe(0);

  // 母線の下端(217.5)を越えるラングは追加しない。
  for (let i = 0; i < 12; i += 1) await page.locator("#actionMenu").selectOption("addRung");
  const lastY = await page.evaluate(() => {
    const { state } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    return Math.max(...current.elements.filter(element => element.ladderRung).map(element => element.points[0][1]));
  });
  expect(lastY).toBeLessThanOrEqual(212.5);
  await expect(page.locator("#status")).toContainText("ラングを追加する余白がありません");

  await page.locator("#templateMenu").selectOption("ladder");
  await page.locator("#actionMenu").selectOption("addRung");
  const generic = await page.evaluate(() => {
    const { state } = window.__edsTest;
    const current = state.pages.find(item => item.id === state.activePageId);
    const rungs = current.elements.filter(element => element.ladderRung);
    return {
      last: rungs[rungs.length - 1].points,
      count: rungs.length,
      numbers: current.elements.filter(element => element.type === "text" && /^\d{3}$/.test(element.text)).length
    };
  });
  expect(generic.count).toBe(11);
  expect(generic.last).toEqual([[35, 205], [175, 205]]);
  expect(generic.numbers).toBe(11);
});

test("行削除は削除行の中だけの配線と接続点を一緒に消し、下の行と重ねない", async ({ page }) => {
  // 行10(y=122)・行11(y=131.5)。配線は2.5mm方眼上の最寄り行に置く。
  const rails = [
    { id: "railL", type: "wire", points: [[32.5, 30], [32.5, 217.5]], ladderRail: "P1", hideWireNo: true },
    { id: "railR", type: "wire", points: [[147.5, 30], [147.5, 217.5]], ladderRail: "N1", hideWireNo: true }
  ];
  const rows = [
    { id: "row10", type: "wire", points: [[32.5, 122.5], [147.5, 122.5]], wireNo: "10" },
    { id: "j10L", type: "junction", x: 32.5, y: 122.5, w: 2, h: 2, r: 0.5 },
    { id: "j10R", type: "junction", x: 147.5, y: 122.5, w: 2, h: 2, r: 0.5 },
    { id: "row11", type: "wire", points: [[32.5, 132.5], [147.5, 132.5]], wireNo: "11" },
    { id: "j11L", type: "junction", x: 32.5, y: 132.5, w: 2, h: 2, r: 0.5 }
  ];
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([sheet("p1", [...rails, ...rows], { frameVariant: "ladder" })]));
  await page.locator("#actionMenu").selectOption("rungShift");
  await page.locator("#rsMode").selectOption("delete");
  await page.locator("#rsRow").fill("10");
  await page.locator("#rsRunBtn").click();
  const elements = await byId(page);
  expect(elements.row10).toBeUndefined();
  expect(elements.j10L).toBeUndefined();
  expect(elements.j10R).toBeUndefined();
  expect(elements.row11.points).toEqual([[32.5, 123], [147.5, 123]]);
  expect(elements.j11L).toMatchObject({ x: 32.5, y: 123 });
  expect(elements.railL.points).toEqual([[32.5, 30], [32.5, 208]]);
  await expect(page.locator("#status")).toContainText("配線1本・接続点2個を削除");

  // 削除行で途切れて行の外へ続く配線・部品がある場合は中止する(何も変えない)。
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([sheet("p1", [
    ...rails,
    { id: "drop", type: "wire", points: [[60, 112.5], [60, 122.5]] },
    { id: "row10", type: "wire", points: [[32.5, 122.5], [147.5, 122.5]] },
    { id: "row11", type: "wire", points: [[32.5, 132.5], [147.5, 132.5]] },
    { id: "lamp", type: "lamp", x: 100, y: 120.3, w: 10, h: 4.4, label: "PL1" }
  ], { frameVariant: "ladder" })]));
  await page.locator("#actionMenu").selectOption("rungShift");
  await page.locator("#rsMode").selectOption("delete");
  await page.locator("#rsRow").fill("10");
  await page.locator("#rsRunBtn").click();
  await expect(page.locator("#status")).toContainText("削除対象の行に部品が 1 個・行の外へ続く配線が 1 本あります");
  const unchanged = await byId(page);
  expect(unchanged.row10.points).toEqual([[32.5, 122.5], [147.5, 122.5]]);
  expect(unchanged.row11.points).toEqual([[32.5, 132.5], [147.5, 132.5]]);
});

test("監査・検索・クロスリファレンスに内部IDや種別キーを出さない", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    sheet("p1", [
      { id: "el-internal-wire", type: "wire", points: [[40, 50], [80, 50]] },
      { id: "c-empty", type: "contactNO", x: 100, y: 80, w: 10, h: 4.4, label: "" },
      { id: "lamp-empty", type: "lamp", x: 100, y: 100, w: 10, h: 4.4, label: "" },
      { id: "coil2", type: "coil", x: 100, y: 120, w: 10, h: 4.4, tag: "CR2", label: "CR2" },
      { id: "pm", type: "polarityMark", x: 31.2, y: 22.4, w: 2.6, h: 2.6, label: "P1", sign: "+" },
      { id: "pos", type: "positionMark", x: 68, y: 140, w: 4, h: 6, label: "切", markStyle: "line" }
    ])
  ]));
  await page.locator("#auditBtn").click();
  const wireRow = page.locator("#dialogBody tbody tr").filter({ hasText: "線番が未入力です" });
  await expect(wireRow).toHaveCount(1);
  // 始点(40, 50)を右パネルと同じ座標系(Yは下端から上が＋)で示す。A4縦の高さは297mm。
  await expect(wireRow.locator("td").nth(3)).toHaveText("配線（始点 X40, Y247）");
  const bodyText = await page.locator("#dialogBody").innerText();
  expect(bodyText).not.toContain("el-internal-wire");
  const emptyLabelTargets = await page.locator("#dialogBody tbody tr").filter({ hasText: "ラベルが未入力です" }).locator("td:nth-child(4)").allTextContents();
  expect(emptyLabelTargets.sort()).toEqual(["a接点", "ランプ"]);
  expect(bodyText).not.toMatch(/\bcontactNO\b|\blamp\b/);
  await page.locator("#dialogClose").click();

  await page.locator("#searchBtn").click();
  await page.locator("#searchQuery").fill("CR2");
  await page.locator("#runSearchBtn").click();
  const resultRow = page.locator("#searchResults tbody tr");
  await expect(resultRow).toHaveCount(1);
  await expect(resultRow.locator("td").nth(1)).toHaveText("コイル");
  await expect(resultRow.locator("td").nth(2)).toHaveText("CR2");
  // 種別は画面と同じ表示名で検索できる(内部の種別キーは検索対象にしない)。
  await page.locator("#searchQuery").fill("コイル");
  await page.locator("#runSearchBtn").click();
  await expect(page.locator("#searchResults tbody tr")).toHaveCount(1);
  await page.locator("#dialogClose").click();

  await page.locator("#actionMenu").selectOption("crossRef");
  const kinds = await page.locator("#dialogBody tbody tr").evaluateAll(rows => rows
    .map(row => Array.from(row.cells).map(cell => cell.textContent.trim()))
    .filter(cells => cells[1] === "部品")
    .map(cells => cells[0]));
  expect(kinds).toEqual(["CR2"]);
});
