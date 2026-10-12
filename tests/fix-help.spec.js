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

// 初心者が読む順(はじめの5ステップ→画面→配置→配線→…→困ったとき)。見出しは先頭一致で照合する。
const HELP_SECTIONS = [
  "はじめの5ステップ",
  "画面の見かた",
  "部品の配置",
  "配線のコツ",
  "選択・編集を速くするコツ",
  "ページ操作",
  "シンボルデザインの切替",
  "回路ライブラリ・テンプレート・一括生成",
  "タグとクロスリファレンス",
  "自動処理と監査",
  "元に戻す・バックアップ",
  "検索・一括置換",
  "保存と出力",
  "帳票・集計",
  "タッチ操作",
  "キーボードショートカット一覧",
  "困ったとき"
];

async function openHelp(page) {
  await page.locator("#helpBtn").click();
  await expect(page.locator("#dialogTitle")).toHaveText("使い方ガイド");
}

test("ヘルプの見出しが初心者向けの順に並び、表が横にはみ出さない", async ({ page }) => {
  await openHelp(page);
  const layout = await page.evaluate(() => {
    const body = document.querySelector("#dialogBody");
    const first = body.querySelector(":scope > .panel-title");
    const titles = [first?.textContent.trim(),
      ...Array.from(body.querySelectorAll(":scope > details > summary")).map(node => node.textContent.trim())];
    // すべての折りたたみ(入れ子を含む)を開いた状態で、ダイアログが横スクロールにならないこと。
    body.querySelectorAll("details").forEach(node => { node.open = true; });
    const dialog = document.querySelector("#dialogBackdrop .dialog");
    const tables = Array.from(body.querySelectorAll("table")).map(table => table.scrollWidth <= table.parentElement.clientWidth + 1);
    return {
      titles,
      firstIsCollapsible: !!first?.closest("details"),
      overflow: dialog.scrollWidth - dialog.clientWidth,
      tables
    };
  });
  expect(layout.firstIsCollapsible, "はじめの5ステップは折りたたまず常に見せる").toBe(false);
  expect(layout.titles).toHaveLength(HELP_SECTIONS.length);
  layout.titles.forEach((title, index) => {
    expect(title.startsWith(HELP_SECTIONS[index]), `${index + 1}番目の見出し「${title}」`).toBe(true);
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.tables.every(Boolean)).toBe(true);
});

test("ショートカット一覧は実在するキー(Ctrl+K・Tab・Alt+クリック・Backspace等)を載せる", async ({ page }) => {
  await openHelp(page);
  const table = page.locator("#dialogBody details", { has: page.locator("summary", { hasText: "キーボードショートカット一覧" }) }).locator("table");
  const text = await table.evaluate(node => node.textContent);
  for (const key of ["Ctrl+K", "Tab", "Alt+クリック", "Backspace", "Alt+← / Alt+→", "Q", "Enter / Space", "Delete / Backspace",
    "Ctrl+D", "Ctrl+S", "Esc", "J（配線）", "N", "X@Y", "Shift（配線）", "Space / Tab（配線）", "ダイアログ表示中"]) {
    expect(text, key).toContain(key);
  }

  // 一覧に載せたキーが実際に働くこと(代表としてCtrl+KとTab)。
  await page.locator("#dialogClose").click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+k");
  await expect(page.locator("#dialogTitle")).toHaveText("コマンドパレット");
  await page.keyboard.press("Escape");
  await expect(page.locator("#dialogBackdrop")).toBeHidden();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Tab");
  await expect(page.locator(".app")).toHaveClass(/left-collapsed/);
  await expect(page.locator(".app")).toHaveClass(/right-collapsed/);
  await page.keyboard.press("Tab");
  await expect(page.locator(".app")).not.toHaveClass(/left-collapsed|right-collapsed/);
});

test("ヘルプ本文は現在の動作だけを書き、取扱説明書PDFへ案内する", async ({ page }) => {
  await openHelp(page);
  const text = await page.locator("#dialogBody").evaluate(node => node.textContent);
  expect(text).not.toMatch(/追加しました|是正しました|復活|以前は|設備標準/);
  expect(text).not.toContain("1クリック");
  const last = await page.locator("#dialogBody > details").last().locator("li").last().textContent();
  expect(last).toContain("docs/PDF/manual.pdf");
  expect(last).toMatch(/26章/);
  expect(last).toMatch(/28章/);
});

test("空ページの「はじめかた」カードは回路ライブラリの置き方を正しく案内する", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 11,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "compact", title: {}, elements: [] }]
  }));
  const card = await page.evaluate(() => {
    const group = Array.from(document.querySelectorAll("#canvas g[pointer-events='none']"))
      .find(node => Array.from(node.querySelectorAll("text")).some(text => text.textContent === "はじめかた"));
    if (!group) return null;
    const box = group.querySelector("rect").getBBox();
    const lines = Array.from(group.querySelectorAll("text")).map(text => {
      const b = text.getBBox();
      return { text: text.textContent, inside: b.x >= box.x && b.x + b.width <= box.x + box.width };
    });
    return { lines };
  });
  expect(card).not.toBeNull();
  const library = card.lines.find(line => line.text.includes("回路ライブラリ"));
  expect(library.text).not.toContain("1クリック");
  expect(library.text).toContain("ドラッグ");
  expect(library.text).toContain("用紙クリック");
  expect(card.lines.every(line => line.inside), "文字がカードからはみ出さない").toBe(true);
});
