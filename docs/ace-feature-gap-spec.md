# AutoCAD Electrical 機能ギャップ実装仕様書(Codex 引き渡し用・第2部)

最終更新: 2026-07-10
対象: `index.html`(単一ファイル。**このファイル以外は編集しないこと**)
前提: 第1部 `docs/scan-symbol-reproduction-spec.md`(シンボル形状・図枠・テンプレート)を
**先に実装済みであること**。本書のコードは第1部のジオメトリ方式・ladder図枠・行ピッチ9.5mmを前提とする。

本書は「見本PDFの忠実再現」と「AutoCAD Electrical(ACE)全機能化」の両面から、
**機能面**の不足と改善点を洗い出し、具体的な実装案とコードをまとめたもの。
第1部が「形」の仕様、本書が「振る舞い・データ・自動処理」の仕様である。

---

## 0. Codex への必須指示

1. 実装順序は「6. 実装フェーズ」に従う。フェーズA(見本再現に必須)を最優先。
2. 新規フィールドはすべて**省略可能**とし、旧JSONの読込・既存機能を壊さない。
3. 迷ったら本書の数値・コードを正とする。**見本PDFの番号体系(2.2)は実測で確定済み**であり、
   独自の採番方式を発明しないこと。
4. 各フェーズ完了時に第1部 8.1 の構文チェックを実行する。
5. `index.html` 以外のファイルは変更しない。

---

## 1. 機能ギャップ総覧(ACE機能 × 現状)

| ACE機能領域 | 現状 | 不足(→本書の節) |
|---|---|---|
| プロジェクト/ページ管理 | ページタブ・複製・並替 ✓ | ページ左余白の縦書き注記(→2.10) |
| 回路図作成 | パレット配置・配線分割 ✓ | 回路ビルダー(→3.4)、グループ化(→4.1)、ミラー/等間隔複製(→4.2) |
| 配線と線番 | 手動/自動採番・書式 ✓ | 行参照 %R(→3.11)、線番の配置制御(→2.5)、配線の結合/分割(→4.3) |
| クロスリファレンス | 一覧ダイアログのみ | **コイル↔接点の親子自動参照(→2.2)**、図面上への参照番号自動表示(→2.2)、クロス参照表/機器符号表の自動記入(→2.3, 2.4) |
| 信号矢印(Source/Dest) | 手動配置・種別のみ | 対向矢印の自動ペア注記(→2.7) |
| 端子と端子台 | エディタ・CSV取込 ✓ | ジャンパ(渡り)表現(→3.5) |
| PLC/I-O | CSV取込・ユニット列(第1部) | 16進アドレス連番ビルダー(→3.6) |
| カタログ/部品DB | 属性手入力のみ | **部品カタログDB+選択適用(→3.1)**、BOM集計帳票(→3.2) |
| 図面監査 | 基本監査 ✓ | 電気的監査: 孤立コイル/孤立接点/接点数上限(→3.3)、タグ重複のリアルタイム警告(→3.7) |
| 盤レイアウト | 配置図テンプレのみ | 回路図部品→フットプリント連携挿入(→3.8) |
| 標準パック | 仮実装(定数のみ) | JSON入出力による外部化(→3.9) |
| DXF | 出力 ✓ | 取込MVP(→3.10) |
| 線種 | 実線/破線 | 一点鎖線ほかプリセット・文字下線(→2.8) |
| ラダー | 単純テンプレのみ | 行グリッド/行アドレス体系(→2.1)、複数レール(→2.9) |

---

## 2. 見本PDF再現に不足している機能(フェーズA)

### 2.1 ラダー行グリッドと行アドレス体系

見本の全ページは「行番号00〜20(ピッチ9.5mm、行00=Y27mm)」のグリッド上に配線・部品が乗る。
このグリッドを**アドレス計算の基準**として実装する(第1部5章の図枠定数と一致)。

```js
const LADDER_GRID = { top: 27, pitch: 9.5, rows: 20 };

function ladderRowAt(y) {
  const row = Math.round((y - LADDER_GRID.top) / LADDER_GRID.pitch);
  return Math.max(0, Math.min(LADDER_GRID.rows, row));
}

function elementLadderRow(element) {
  const box = elementBounds(element);
  if (!box) return 0;
  return ladderRowAt(box.y + box.h / 2);
}

function pageSheetNumber(page) {
  const n = Number(page.title?.page);
  return Number.isFinite(n) && n > 0 ? n : state.pages.indexOf(page) + 1;
}

// 見本の参照アドレス: 「頁番号(パディング無し)+行番号(2桁)」
// 例: 頁15 行04 → "1504" / 頁4 行04 → "404" / 頁20 行19 → "2019"
function elementAddress(page, element) {
  return String(pageSheetNumber(page)) + String(elementLadderRow(element)).padStart(2, "0");
}
```

**根拠(実測)**: `scan-001 (1).pdf 頁15` 行04 のコイル CR1X に対し、
`頁20` 行19/20 と `頁24`(scan-001.pdf p1A)行02 の CR1X 接点に **1504** が付記され、
コイル側のクロス参照表に **2019 / 2020 / 2402** が列挙されている。完全に
「頁+行」体系である。

### 2.2 コイル↔接点クロスリファレンスの自動化(最重要)

ACE の親子参照そのもの。**同じタグ**を持つコイル(親)と接点(子)を全ページから対応付け、

- 接点の下の参照番号(第1部 4.1 の `refNo`)= **親コイルのアドレス** を自動表示
- コイル側は、子接点のアドレス一覧をクロス参照表(2.3)に自動記入

```js
// ===== コイル↔接点クロスリファレンス =====
let crossRefCache = null; // render() の先頭で null に戻す(下記パッチ参照)

function coilTypes() {
  return new Set(["coil"]);
}

function contactChildTypes() {
  return new Set(["contactNO", "contactNC", "contactBlock", "thermalRelay"]);
}

function buildCrossRefCache() {
  const coils = new Map();    // tag -> { page, element, address }
  const contacts = new Map(); // tag -> [{ page, element, address, closed }]
  state.pages.forEach(page => {
    page.elements.forEach(element => {
      const tag = componentTag(element);
      if (!tag) return;
      if (coilTypes().has(element.type)) {
        if (!coils.has(tag)) coils.set(tag, { page, element, address: elementAddress(page, element) });
      } else if (contactChildTypes().has(element.type)) {
        const list = contacts.get(tag) || [];
        list.push({
          page,
          element,
          address: elementAddress(page, element),
          closed: element.type === "contactNC" || element.type === "thermalRelay" || element.blockContact === "NC"
        });
        contacts.set(tag, list);
      }
    });
  });
  return { coils, contacts };
}

function crossRefData() {
  if (!crossRefCache) crossRefCache = buildCrossRefCache();
  return crossRefCache;
}

// 接点の参照番号。手入力 refNo が最優先、無ければ親コイルのアドレス
function contactAutoRefNo(element) {
  if (element.refNo) return String(element.refNo);
  const tag = componentTag(element);
  if (!tag) return "";
  const coil = crossRefData().coils.get(tag);
  return coil && coil.element.id !== element.id ? coil.address : "";
}
```

統合:

1. `render()` の先頭に `crossRefCache = null;` を追加(全再描画時に再計算)。
2. 第1部 2.3 の `geoTextValue` を次で置換:

```js
function geoTextValue(element, prim) {
  if (prim.field === "refNo" && contactChildTypes().has(element.type)) {
    return contactAutoRefNo(element);
  }
  if (prim.field === "descLine") {
    return String(element.description || "").split(/\r?\n/)[0];
  }
  if (prim.field) {
    const raw = element[prim.field];
    return raw === undefined || raw === null ? "" : String(raw);
  }
  return prim.value === undefined ? "" : String(prim.value);
}
```

3. `showCrossReference()`(既存ダイアログ)に「コイル→接点」ビューを追加:
   各コイル行に `アドレス / 接点数 / 接点アドレス一覧(選択ボタン付き)` を表示する
   (既存 `attachDialogSelection()` を流用)。

### 2.3 クロス参照表(図枠左下)の自動記入

第1部 5.3 `drawLadderFrame` は空の13列グリッドを描く。ここへ**そのページにあるコイル**の
タグと子接点アドレスを流し込む。**b接点(closed)は数字に下線**(実測確認済み)。

```js
function pageCoilXrefColumns(page) {
  const data = crossRefData();
  const cols = [];
  page.elements.forEach(element => {
    if (!coilTypes().has(element.type)) return;
    const tag = componentTag(element);
    if (!tag) return;
    cols.push({ tag, refs: data.contacts.get(tag) || [] });
  });
  return cols.slice(0, 13);
}

// drawLadderFrame の末尾で呼ぶ
function fillLadderXrefTable(frame, page, size) {
  const L = 19, xrefR = 105.8;
  const B = size.h - 24;
  const tblTop = B - 49;
  const colW = (xrefR - L) / 13;
  pageCoilXrefColumns(page).forEach((col, i) => {
    const x = L + colW * i;
    frame.appendChild(textEl(col.tag, x + 0.6, tblTop + 2.5, { fontSize: 1.8 }));
    col.refs.slice(0, 12).forEach((ref, j) => {
      const y = tblTop + 7.5 + j * 2.6;
      frame.appendChild(textEl(ref.address, x + colW - 0.8, y, { fontSize: 1.7, anchor: "end" }));
      if (ref.closed) {
        const w = String(ref.address).length * 1.06;
        frame.appendChild(svgEl("line", { x1: x + colW - 0.8 - w, y1: y + 1.1, x2: x + colW - 0.8, y2: y + 1.1, class: "frame-light" }));
      }
    });
  });
}
```

DXF側 `dxfFrame`(ladder分岐)にも同じ内容を `dxfText`/`dxfLine` で出力する。

### 2.4 機器符号表(図枠右下)の自動記入

そのページに登場する機器タグ(コイル+接点、重複除外)を明細行へ流し込む。
`内容` = description の1行目、`頁` = 親コイルが**他ページ**にある場合のみそのシート番号。

```js
function pageDeviceTableRows(page) {
  const data = crossRefData();
  const seen = new Set();
  const rows = [];
  page.elements.forEach(element => {
    const tag = componentTag(element);
    if (!tag || seen.has(tag)) return;
    if (!coilTypes().has(element.type) && !contactChildTypes().has(element.type)) return;
    seen.add(tag);
    const coil = data.coils.get(tag);
    rows.push({
      tag,
      desc: String(element.description || coil?.element.description || "").split(/\r?\n/)[0],
      page: coil && coil.page.id !== page.id ? String(pageSheetNumber(coil.page)) : ""
    });
  });
  return rows.slice(0, 20); // 2グループ×10行
}

// drawLadderFrame の末尾で呼ぶ(devTop/gw は第1部 5.3 と同じ値を再計算)
function fillLadderDeviceTable(frame, page, size) {
  const xrefR = 105.8, R = size.w - 19;
  const B = size.h - 24;
  const devTop = B - 49;
  const gw = (R - xrefR) / 2;
  const rowH = (28.5 - 2.6) / 10;
  pageDeviceTableRows(page).forEach((row, index) => {
    const gi = Math.floor(index / 10);
    const gx = xrefR + gi * gw;
    const y = devTop + 2.6 + (index % 10) * rowH + rowH * 0.7;
    frame.appendChild(textEl(row.tag, gx + 0.6, y, { fontSize: 1.7 }));
    if (row.desc) frame.appendChild(textEl(row.desc, gx + 11.6, y, { fontSize: 1.7 }));
    if (row.page) frame.appendChild(textEl(row.page, gx + gw - 2.25, y, { fontSize: 1.7, anchor: "middle" }));
  });
}
```

### 2.5 配線ラベル(線番)の配置制御

見本では配線ラベルが「**終端の手前・右寄せ**」(PLC端子の左)や「中央上」など位置が使い分けられる。
`wireNoAlign`("mid" | "start" | "end")と微調整 `wireNoDx` / `wireNoDy` を追加する。

```js
function wireNoAnchorPoint(element) {
  const points = element.points || [[0, 0], [20, 0]];
  const align = element.wireNoAlign || "mid";
  const dx = Number(element.wireNoDx || 0);
  const dy = Number(element.wireNoDy || 0);
  if (align === "mid") {
    const mid = wireLabelPoint(points);
    return { x: mid.x + 1.6 + dx, y: mid.y - 1.8 + dy, anchor: "start" };
  }
  const end = align === "end" ? points[points.length - 1] : points[0];
  return {
    x: end[0] + (align === "end" ? -1.2 : 1.2) + dx,
    y: end[1] - 1.6 + dy,
    anchor: align === "end" ? "end" : "start"
  };
}
```

- `drawWire()` の線番描画を `wireNoAnchorPoint()` 使用に置換
  (FIX 表示は従来どおりラベルの下)。
- `dxfElement()` の wire 分岐も同じ位置計算に置換(anchor "end" は
  `x - 文字数*size*0.6` で近似)。
- 右パネル `labelFields` の wire 分岐に「線番位置」(中央/始点/終点)セレクトと
  「位置調整X/Y」数値入力を追加。
- PLC入力回路テンプレート(第1部6.2)では生成する配線に `wireNoAlign:"end"` を設定。

### 2.6 機能説明の2段ラベル(接点・コイルの上の小書き)

見本の接点は「機能説明(1.8mm)/タグ(2.0mm)」の2段。既存 `description` の1行目を
自動表示する(新フィールド不要。2.2 の `geoTextValue` に `descLine` 実装済み)。

第1部の geo 定義へ **1行追記**(contactNO / contactNC / thermalRelay / pushButton /
pushButtonEmergency / coil / lamp / breaker):

```js
// 例: contactNO の prims に追加
{ t: "text", p: [4, -3.6], size: 1.8, anchor: "middle", field: "descLine" }
// coil / lamp / breaker は中心 x に合わせる(coil/lamp: x=5, breaker: x=6)
```

### 2.7 信号矢印のページ間ペア注記

発信元(source)矢印と受信先(destination)矢印が同ラベルで対になったとき、
**相手側のシート番号を自動注記**する(ACE の Source/Destination Arrow 相当)。

```js
function arrowCounterpartNote(element) {
  const role = element.signalRole || "reference";
  if (!element.label || role === "reference") return "";
  const targetRole = role === "source" ? "destination" : "source";
  for (const page of state.pages) {
    for (const item of page.elements) {
      if (item.type === "arrow" && item.id !== element.id && item.label === element.label
        && (item.signalRole || "reference") === targetRole) {
        return "頁" + pageSheetNumber(page);
      }
    }
  }
  return "";
}
```

`drawArrow()` のラベル描画の後に追加:

```js
const note = arrowCounterpartNote(element);
if (note) {
  const tip = points[points.length - 1];
  g.appendChild(textEl(note, tip[0], tip[1] - 3, { fontSize: 1.8, anchor: "end" }));
}
```

DXF にも同様に出力。監査(既存の片側検出)はそのまま活きる。

### 2.8 線種プリセットと文字下線

- `specificFields` の line 分岐の「破線」入力をセレクト+自由入力の2段にする:

| 名称 | stroke-dasharray |
|---|---|
| 実線 | (空) |
| 破線 | `3 2` |
| 一点鎖線(盤外・装置境界) | `6 1.5 1.5 1.5` |
| 二点鎖線 | `8 1.5 1.5 1.5 1.5 1.5` |
| 細点線(接点ブロック枠) | `1.4 1.2` |

- `installationBox` / `locationBox` の「枠線破線」プレースホルダにも
  `6 1.5 1.5 1.5` を追記(見本の外部装置枠は一点鎖線)。
- **文字下線**: 見本の系統図・信号名に下線付き文字がある。`text` 要素に
  `underline`(checkbox)を追加し、`drawText()` の末尾に:

```js
if (element.underline) {
  const lines = String(element.text || "").split("\n");
  const size = Number(element.fontSize || 3.5);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const w = line.length * size * 0.62; // 近似幅
    const y = index * size * 1.25 + size * 0.72;
    g.appendChild(svgEl("line", { x1: 0, y1: y, x2: w, y2: y, class: "symbol-line", stroke: element.stroke || state.settings.stroke }));
  });
}
```

DXF は `dxfText` の後に同位置の `dxfLine` を出す。

### 2.9 複数レール対応ラダーテンプレート(P1/P2/P3/P3M)

見本 頁15(リレー回路)は左に4本のレールを持つ。第1部 6.1 の
`addFacilityLadderPage()` にレール本数・名称を指定できるようにする。

```text
仕様(実測):
- 最右レール(P1)を x=32.5 に固定。追加レールは左へ 4.0mm ピッチ
  (P2=28.5, P3=24.5, P3M=20.5)。frameの左枠(19)より内側に収まる。
- 各レール上端: polarityMark(+)とレール名。i本目のラベルYは 24 + 3*i
  (P1が最上、左のレールほど下がる: 見本の階段状配置)。
- 下端にもレール名を同様に表示(Yは 219 + 3*i)。
- 右レール(N1)は x=146.5、polarityMark(−)。
- レール本体は wire(ladderRail フラグ付き・線番なし)y30〜217、両端 fork 矢印。
```

ダイアログ入力: レール名 CSV(既定 `P1,P2,P3,P3M`)、右レール名(既定 `N1`)、
`(DC24V)` 注記の有無。

### 2.10 左余白の縦書き設備注記

全ページの左余白(枠外 x≈16.5)に「302パノラマループ搭載機」等の**縦書き注記**がある。

- `page.title.sideNote`(文字列)を追加。
- 右パネル「ページ設定」に `側注記` 入力(`<input id="pageSideNote">`)を追加し、
  `syncInspector()` に `setValue("pageSideNote", page.title.sideNote || "")`、
  `attachEvents()` に `updatePageField("pageSideNote", (page, value) => { page.title.sideNote = value; })` を追加。
- `drawLadderFrame` に:

```js
if (page.title.sideNote) {
  frame.appendChild(textEl(page.title.sideNote, 16.5, size.h / 2, {
    fontSize: 2.2, anchor: "middle",
    transform: "rotate(-90 16.5 " + (size.h / 2) + ")"
  }));
}
```

- DXF: 回転テキストは `dxfText` に回転コード(グループ50)を追加した
  `dxfTextRotated(out,page,layer,x,y,size,text,angle)` を新設して出力する
  (`"50", String(angle)` を TEXT エンティティに追加するだけ)。

---

## 3. AutoCAD Electrical 全機能化のための実装(フェーズB/C)

### 3.1 部品カタログDB(フェーズB)

属性(メーカー/品番/定格/説明)を**毎回手入力**しているのが最大の非効率。
プロジェクト内カタログ(`state.catalog`)と選択適用ダイアログを追加する。

```js
// ensureProjectDefaults() に追加:
if (!Array.isArray(state.catalog)) state.catalog = [];
// 要素: { family, manufacturer, catalog, description, rating, maxNO, maxNC }
```

```js
function showCatalogManager() {
  const rows = (state.catalog || []).map((item, index) => `
    <tr data-cat-row="${index}">
      <td><input data-cat-field="family" value="${escapeAttr(item.family || "")}" placeholder="CR" style="width:64px"></td>
      <td><input data-cat-field="manufacturer" value="${escapeAttr(item.manufacturer || "")}"></td>
      <td><input data-cat-field="catalog" value="${escapeAttr(item.catalog || "")}"></td>
      <td><input data-cat-field="description" value="${escapeAttr(item.description || "")}"></td>
      <td><input data-cat-field="rating" value="${escapeAttr(item.rating || "")}" style="width:80px"></td>
      <td><input data-cat-field="maxNO" type="number" step="1" value="${item.maxNO ?? ""}" style="width:56px"></td>
      <td><input data-cat-field="maxNC" type="number" step="1" value="${item.maxNC ?? ""}" style="width:56px"></td>
      <td><button type="button" data-cat-delete="${index}">削除</button></td>
    </tr>`).join("");
  openDialog("部品カタログ", `
    <p class="muted">種別接頭辞(%Fと同じ)で絞り込みに使われます。a/b接点上限はリレー監査(3.3)に使われます。</p>
    <table class="report-table">
      <thead><tr><th>種別</th><th>メーカー</th><th>品番</th><th>説明</th><th>定格</th><th>a上限</th><th>b上限</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="inline" style="justify-content:flex-end;margin-top:12px">
      <button type="button" id="addCatalogRowBtn">行追加</button>
      <button type="button" id="applyCatalogBtn" class="primary">適用</button>
    </div>`);
  qs("#addCatalogRowBtn").addEventListener("click", () => {
    applyCatalogEdits(false);
    state.catalog.push({});
    showCatalogManager();
  });
  qs("#applyCatalogBtn").addEventListener("click", () => applyCatalogEdits(true));
  qsa("[data-cat-delete]", qs("#dialogBody")).forEach(button => {
    button.addEventListener("click", () => {
      applyCatalogEdits(false);
      state.catalog.splice(Number(button.dataset.catDelete), 1);
      showCatalogManager();
    });
  });
}

function applyCatalogEdits(close) {
  qsa("[data-cat-row]", qs("#dialogBody")).forEach(row => {
    const item = state.catalog[Number(row.dataset.catRow)];
    if (!item) return;
    qsa("[data-cat-field]", row).forEach(input => {
      const key = input.dataset.catField;
      if (key === "maxNO" || key === "maxNC") item[key] = input.value === "" ? undefined : Number(input.value);
      else item[key] = input.value;
    });
  });
  if (close) {
    closeDialog();
    commitHistory("部品カタログを更新しました。");
    render();
  }
}

function showCatalogPicker() {
  const element = selectedElement();
  if (!element || !supportsElectricalAttributes(element)) {
    setStatus("電気部品を選択してからカタログを開いてください。");
    return;
  }
  const family = tagPrefix(element.type);
  const items = (state.catalog || [])
    .map((item, index) => ({ ...item, index }))
    .filter(item => !family || !item.family || item.family === family);
  const html = items.length
    ? `<table class="report-table"><thead><tr><th>メーカー</th><th>品番</th><th>説明</th><th>定格</th><th></th></tr></thead>
       <tbody>${items.map(item => `<tr><td>${escapeHtml(item.manufacturer || "")}</td><td>${escapeHtml(item.catalog || "")}</td><td>${escapeHtml(item.description || "")}</td><td>${escapeHtml(item.rating || "")}</td><td><button type="button" data-cat-pick="${item.index}">選択</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">該当するカタログがありません。「部品カタログ」で登録してください。</p>';
  openDialog("カタログ選択", html);
  qsa("[data-cat-pick]", qs("#dialogBody")).forEach(button => {
    button.addEventListener("click", () => {
      const item = state.catalog[Number(button.dataset.catPick)];
      const target = selectedElement();
      if (!item || !target) return;
      target.manufacturer = item.manufacturer || "";
      target.catalog = item.catalog || "";
      if (!target.description) target.description = item.description || "";
      if (!target.rating) target.rating = item.rating || "";
      closeDialog();
      commitHistory("カタログを適用しました。");
      render();
    });
  });
}
```

UI 追加:
- 左パネル「自動処理」に `部品カタログ` ボタン → `showCatalogManager`
- `electricalAttributeFields()` のメーカー/品番の下に
  `<button type="button" id="catalogPickBtn" style="width:100%;margin-top:8px">カタログから選択</button>`
  を追加し、`renderSelectionPanel` で `showCatalogPicker` を接続。

### 3.2 BOM(部品集計表)

メーカー×品番×種別でグルーピングし数量とタグ一覧を出す(ACE の部品表レポート)。

```js
function collectBomRows() {
  const map = new Map();
  state.pages.forEach(page => {
    page.elements.forEach(element => {
      if (!supportsElectricalAttributes(element)) return;
      if (!tagPrefix(element.type)) return;
      const key = [element.manufacturer || "", element.catalog || "", element.type].join("::");
      const row = map.get(key) || {
        type: paletteLabel(element.type),
        manufacturer: element.manufacturer || "",
        catalog: element.catalog || "",
        description: element.description || "",
        rating: element.rating || "",
        qty: 0,
        tags: []
      };
      row.qty += 1;
      const tag = componentTag(element);
      if (tag) row.tags.push(tag);
      map.set(key, row);
    });
  });
  return Array.from(map.values()).sort((a, b) =>
    a.type.localeCompare(b.type) || a.manufacturer.localeCompare(b.manufacturer) || a.catalog.localeCompare(b.catalog));
}

function exportBomCsv() {
  const headers = ["type", "manufacturer", "catalog", "description", "rating", "qty", "tags"];
  const rows = collectBomRows();
  const csv = [headers.join(","), ...rows.map(row => headers.map(h =>
    csvCell(h === "tags" ? row.tags.join(" ") : row[h])).join(","))].join("\r\n");
  download("electrical-bom.csv", csv, "text/csv;charset=utf-8");
  setStatus("BOM CSVを書き出しました。");
}

function showBomTable() {
  const rows = collectBomRows();
  const html = rows.length
    ? `<table class="report-table"><thead><tr><th>種別</th><th>メーカー</th><th>品番</th><th>説明</th><th>定格</th><th>数量</th><th>タグ</th></tr></thead>
       <tbody>${rows.map(row => `<tr><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.manufacturer)}</td><td>${escapeHtml(row.catalog)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.rating)}</td><td>${row.qty}</td><td>${escapeHtml(row.tags.join(" "))}</td></tr>`).join("")}</tbody></table>
       <div class="inline" style="justify-content:flex-end;margin-top:12px">
         <button type="button" id="bomCsvBtn">CSV出力</button>
         <button type="button" id="bomInsertBtn" class="primary">表として挿入</button>
       </div>`
    : '<p class="muted">集計対象の部品がありません。</p>';
  openDialog("部品集計表(BOM)", html);
  qs("#bomCsvBtn")?.addEventListener("click", exportBomCsv);
  qs("#bomInsertBtn")?.addEventListener("click", () => {
    const page = currentPage();
    const body = collectBomRows().slice(0, 20).map(row =>
      [row.type, row.manufacturer, row.catalog, row.rating, String(row.qty)].join("\t"));
    const table = {
      ...defaultElement("table", 22, 42),
      rows: body.length + 1,
      cols: 5,
      w: Math.min(pageSize(page).w - 44, 170),
      h: Math.max(28, (body.length + 1) * 6),
      label: "部品集計表",
      cellText: ["種別\tメーカー\t品番\t定格\t数量", ...body].join("\n"),
      reportTable: true
    };
    page.elements.push(table);
    selectSingle(table.id);
    closeDialog();
    commitHistory("BOM表を挿入しました。");
    render();
  });
}
```

UI: 左パネル「自動処理」に `BOM` ボタン。

### 3.3 リレー監査(孤立コイル/孤立接点/接点数上限)

`auditProject()` の末尾(return の前)に追加:

```js
const xref = buildCrossRefCache();
xref.coils.forEach((coil, tag) => {
  const children = xref.contacts.get(tag) || [];
  if (!children.length) {
    issues.push({ level: "情報", page: coil.page.name, pageId: coil.page.id, elementId: coil.element.id, message: "コイルに対応する接点がありません。", target: tag });
  }
  const cat = (state.catalog || []).find(item => item.catalog && item.catalog === coil.element.catalog);
  const maxNO = Number(cat?.maxNO ?? 4);
  const maxNC = Number(cat?.maxNC ?? 4);
  const usedNO = children.filter(c => !c.closed).length;
  const usedNC = children.filter(c => c.closed).length;
  if (usedNO > maxNO) issues.push({ level: "警告", page: coil.page.name, pageId: coil.page.id, elementId: coil.element.id, message: "a接点の使用数が上限を超えています(" + usedNO + "/" + maxNO + ")。", target: tag });
  if (usedNC > maxNC) issues.push({ level: "警告", page: coil.page.name, pageId: coil.page.id, elementId: coil.element.id, message: "b接点の使用数が上限を超えています(" + usedNC + "/" + maxNC + ")。", target: tag });
});
xref.contacts.forEach((list, tag) => {
  if (xref.coils.has(tag)) return;
  const first = list[0];
  issues.push({ level: "注意", page: first.page.name, pageId: first.page.id, elementId: first.element.id, message: "接点に対応するコイルがありません。", target: tag + "(" + list.length + "箇所)" });
});
```

※ サーマルリレー接点(OL)はコイルを持たないのが正常のため、
`xref.contacts` 側チェックでは `element.type === "thermalRelay"` の接点のみのタグは除外する
(`list.every(item => item.element.type === "thermalRelay")` なら skip)。

### 3.4 回路ビルダー: モータ分岐回路(ACE Circuit Builder 相当)

見本 頁10/11 のモータ主回路(遮断器3極 → MC接点 → サーマル素子 → モータ → 接地)を
一括生成する。第1部の geo シンボルが前提。

```js
function showMotorCircuitDialog() {
  openDialog("モータ分岐回路", `
    <div class="row">
      <div><label>開始X mm</label><input id="mcX" type="number" step="0.5" value="40"></div>
      <div><label>1相目Y mm</label><input id="mcY" type="number" step="0.5" value="65"></div>
    </div>
    <div class="row">
      <div><label>全長 mm</label><input id="mcSpan" type="number" step="1" value="96"></div>
      <div><label>モータタグ</label><input id="mcTag" value="M1"></div>
    </div>
    <div class="row">
      <div><label>MC接点タグ</label><input id="mcContactTag" value="MC2M1"></div>
      <div><label>サーマルタグ</label><input id="mcThermalTag" value="OL1"></div>
    </div>
    <label><input id="mcWithBreaker" type="checkbox" checked style="width:auto;min-height:auto"> 遮断器3極(連動破線つき)</label>
    <label><input id="mcWithThermal" type="checkbox" checked style="width:auto;min-height:auto"> サーマル素子</label>
    <label><input id="mcWithGround" type="checkbox" checked style="width:auto;min-height:auto"> モータ接地</label>
    <div class="inline" style="justify-content:flex-end;margin-top:12px">
      <button type="button" id="mcBuildBtn" class="primary">生成</button>
    </div>`);
  qs("#mcBuildBtn").addEventListener("click", buildMotorBranchFromDialog);
}

function buildMotorBranchFromDialog() {
  const page = currentPage();
  if (!page) return;
  const x0 = Number(qs("#mcX").value || 40);
  const y0 = Number(qs("#mcY").value || 65);
  const span = Math.max(70, Number(qs("#mcSpan").value || 96));
  const tag = qs("#mcTag").value || "M1";
  const pitch = 5.6; // モータ左アンカー(2.4/8/13.6)のピッチに一致
  const withBreaker = qs("#mcWithBreaker").checked;
  const withThermal = qs("#mcWithThermal").checked;
  const withGround = qs("#mcWithGround").checked;
  const created = [];
  const lineYs = [y0, y0 + pitch, y0 + pitch * 2];
  const motorX = x0 + span;
  const motor = { ...defaultElement("motor", motorX, y0 - 2.4), label: tag, tag };
  created.push(motor);
  const stations = []; // [x開始, x終了] を相ごとに切る装置
  let cursor = x0 + 4;
  const breakers = [];
  if (withBreaker) {
    lineYs.forEach(y => {
      const el = { ...defaultElement("breaker", cursor, y - 3), label: "", tag: "" };
      breakers.push(el);
      created.push(el);
    });
    breakers[0].label = "CB-" + tag;
    stations.push([cursor, cursor + 12]);
    cursor += 22;
  }
  lineYs.forEach((y, i) => {
    const el = { ...defaultElement("contactNO", cursor, y - 2.2), label: i === 0 ? (qs("#mcContactTag").value || "MC") : "" };
    created.push(el);
  });
  stations.push([cursor, cursor + 8]);
  cursor += 18;
  if (withThermal) {
    lineYs.forEach((y, i) => {
      const el = { ...defaultElement("thermalElement", cursor, y - 3), label: i === 0 ? (qs("#mcThermalTag").value || "OL") : "" };
      created.push(el);
    });
    stations.push([cursor, cursor + 8]);
    cursor += 18;
  }
  // 配線: 各相を装置間で分割して生成
  lineYs.forEach((y, i) => {
    let sx = x0;
    stations.forEach(([a, b]) => {
      created.push({ ...defaultElement("wire", sx, y), points: [[sx, y], [round(a), y]] });
      sx = b;
    });
    const endX = round(motorX + 0.9); // モータ小円端子の中心
    created.push({ ...defaultElement("wire", sx, y), points: [[sx, y], [endX, y]] });
  });
  if (withBreaker && breakers.length === 3) {
    // 連動破線: アーク頂点(ローカル 4.75, 0.75)どうしを結ぶ
    const lx = round(breakers[0].x + 4.75);
    created.push({ ...defaultElement("mechanicalLink", lx, 0), points: [[lx, round(breakers[0].y + 0.75)], [lx, round(breakers[2].y + 0.75)]] });
  }
  if (withGround) {
    const gx = round(motorX + 14.6), gy = round(y0 - 2.4 + 14.6);
    created.push({ ...defaultElement("wire", gx, gy), points: [[gx, gy], [gx, gy + 8]] });
    created.push({ ...defaultElement("ground", gx - 2, gy + 8), label: "" });
  }
  page.elements.push(...created);
  setSelection(created.map(el => el.id));
  closeDialog();
  commitHistory("モータ分岐回路を生成しました。");
  render();
}
```

UI: 左パネル「自動処理」に `モータ回路` ボタン。
※ 生成後は通常要素なので個別編集・タグ採番・帳票の対象になる。

### 3.5 端子台ジャンパ(渡り線)

`terminalStrip` / `connector` に `jumpers`(例 `"1-2;3-5"`)を追加し、
端子ノードの下(縦向きは右)に渡り弧を描く。

```js
function terminalJumperPairs(element) {
  return String(element.jumpers || "")
    .split(";")
    .map(pair => pair.split("-").map(n => Number(n.trim())))
    .filter(p => p.length === 2 && p.every(Number.isFinite));
}
```

`drawTerminalStrip()` のノード描画後に追加(両 orientation 共通):

```js
const start = Number(element.start || 1);
terminalJumperPairs(element).forEach(([a, b]) => {
  const ia = a - start, ib = b - start;
  if (ia < 0 || ib < 0 || ia >= geo.count || ib >= geo.count) return;
  const na = terminalStripNodeLocal(element, ia);
  const nb = terminalStripNodeLocal(element, ib);
  const off = geo.vertical ? 3.6 : 3.6;
  const cx = (na.x + nb.x) / 2 + (geo.vertical ? off : 0);
  const cy = (na.y + nb.y) / 2 + (geo.vertical ? 0 : off);
  g.appendChild(svgEl("path", { d: "M " + na.x + " " + na.y + " Q " + cx + " " + cy + " " + nb.x + " " + nb.y, class: "symbol-line", stroke, fill: "none" }));
});
```

- DXF: 2次ベジェを8分割した折れ線で近似出力(小ヘルパ `dxfQuadApproxLocal` を新設)。
- 端子台エディタ(`showTerminalEditor`)に「ジャンパ」列(`data-terminal-field="jumpers"`)を追加。
- 帳票(`collectReportRows` の terminalStrip 分岐)の detail に `jumpers=...` を追記。
- 監査: ジャンパ番号が端子範囲外なら「警告」。

### 3.6 PLCアドレス連番ビルダー(16進対応)

見本のアドレスは **16進連番**(X068→X069→X06A→…→X06F→X070、Y0F0→Y0F7)。

```js
function splitPlcAddress(address) {
  const match = String(address || "").trim().match(/^(.*?)([0-9A-Fa-f]{1,4})$/);
  return match ? { prefix: match[1], digits: match[2] } : null;
}

function plcAddressSequence(start, count) {
  const parts = splitPlcAddress(start);
  if (!parts) return Array.from({ length: count }, (_, i) => String(start) + i);
  const base = parseInt(parts.digits, 16);
  return Array.from({ length: count }, (_, i) =>
    parts.prefix + (base + i).toString(16).toUpperCase().padStart(parts.digits.length, "0"));
}
```

ダイアログ `showPlcUnitBuilder()`: ユニット名 / 開始アドレス(例 X060)/ 点数(既定16)を入力し、
`plcBlock`(第1部 4.22 unit スタイル)を
`pinText = plcAddressSequence(start, count).join("\n")`、`rows = count`、
`h = count * 9.5` で現在ページに配置する。
UI: 左パネル「自動処理」に `PLCユニット` ボタン。
第1部 6.2 の PLC入力回路テンプレートもこの関数でアドレス列を生成するよう共通化する。

### 3.7 タグ重複のリアルタイム警告

`updateSelectedFromInput()` で `key === "tag"` のとき(履歴コミット前に):

```js
if (key === "tag" && value) {
  const dup = state.pages.some(page => page.elements.some(item =>
    item.id !== element.id && item.type === element.type && componentTag(item) === value));
  if (dup) setStatus("注意: 同種部品でタグ「" + value + "」が重複しています。");
}
```

### 3.8 盤レイアウト連携(回路図→フットプリント挿入)

回路図の部品一覧から選択した部品を、現在ページへ**タグ付きフットプリント矩形**として
格子状に挿入する(ACE のパネルレイアウト・フットプリント挿入の簡易版)。

```js
const FOOTPRINT_SIZES = {
  plcBlock: [46, 32], powerSupply: [42, 26], breaker: [16, 26], coil: [12, 22],
  transformer: [36, 30], terminalStrip: [58, 14], motor: [30, 30], deviceBox: [28, 20]
};

function showPanelLayoutLinkDialog() {
  const rows = collectReportRows().filter(row => row.record === "component" && row.tag);
  if (!rows.length) {
    openDialog("盤レイアウト連携", '<p class="muted">タグ付きの部品がありません。部品タグを採番してください。</p>');
    return;
  }
  openDialog("盤レイアウト連携", `
    <p class="muted">チェックした部品をフットプリント(矩形+タグ)として現在ページへ挿入します。</p>
    <table class="report-table"><thead><tr><th></th><th>タグ</th><th>種別</th><th>ページ</th><th>設備</th><th>場所</th></tr></thead>
    <tbody>${rows.map((row, index) => `<tr>
      <td><input type="checkbox" data-panel-pick="${index}" checked style="width:auto;min-height:auto"></td>
      <td>${escapeHtml(row.tag)}</td><td>${escapeHtml(paletteLabel(row.type))}</td>
      <td>${escapeHtml(row.page)}</td><td>${escapeHtml(row.installation)}</td><td>${escapeHtml(row.location)}</td>
    </tr>`).join("")}</tbody></table>
    <div class="inline" style="justify-content:flex-end;margin-top:12px">
      <button type="button" id="panelInsertBtn" class="primary">挿入</button>
    </div>`);
  qs("#panelInsertBtn").addEventListener("click", () => {
    const picked = qsa("[data-panel-pick]", qs("#dialogBody"))
      .filter(input => input.checked)
      .map(input => rows[Number(input.dataset.panelPick)]);
    insertPanelFootprints(picked);
  });
}

function insertPanelFootprints(items) {
  const page = currentPage();
  if (!page || !items.length) return;
  const cols = 4, pitchX = 44, pitchY = 30, x0 = 30, y0 = 50;
  const created = items.map((row, index) => {
    const size = FOOTPRINT_SIZES[row.type] || [18, 14];
    return {
      id: uid("el"), type: "rect",
      x: x0 + (index % cols) * pitchX, y: y0 + Math.floor(index / cols) * pitchY,
      w: size[0], h: size[1],
      label: row.tag, panelRef: row.tag,
      rotation: 0, stroke: state.settings.stroke, layer: "layout"
    };
  });
  page.elements.push(...created);
  setSelection(created.map(item => item.id));
  closeDialog();
  commitHistory(created.length + "個のフットプリントを挿入しました。");
  render();
}
```

- 監査追加(任意・情報レベル): タグ付き部品のうち、どのページにも
  `panelRef === tag` の矩形が無いものを「盤レイアウト未配置」として列挙。
- UI: 右パネルのテンプレート群に `盤連携` ボタン。

### 3.9 標準パックの外部化(JSON入出力)

要件 §10「標準パック差し替え」の第一歩。現在の標準(線番書式・タグ規則・配線種別・レイヤ・図枠)を
JSONとして出力/取込できるようにする。

```js
function exportStandardPack() {
  const pack = {
    packVersion: 1,
    id: "pack-" + Date.now().toString(36),
    label: prompt("標準パック名", "カスタム標準") || "カスタム標準",
    grid: state.settings.grid,
    wireNumberFormat: state.settings.wireNumberFormat,
    componentTagFormat: state.settings.componentTagFormat,
    componentTagPrefixes: deepClone(state.settings.componentTagPrefixes || {}),
    wireTypes: deepClone(state.wireTypes),
    layers: deepClone(state.layers),
    frameVariant: currentPage()?.frameVariant || "ladder"
  };
  download("standard-pack.json", JSON.stringify(pack, null, 2), "application/json");
  setStatus("標準パックを書き出しました。");
}

function importStandardPackFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const pack = JSON.parse(reader.result);
      if (!pack || pack.packVersion !== 1) throw new Error("packVersion が不正です。");
      state.standardPacks = state.standardPacks || [];
      state.standardPacks.push(pack);
      applyStandardPack(pack);
      commitHistory("標準パック「" + (pack.label || pack.id) + "」を適用しました。");
      render();
    } catch (error) {
      setStatus("標準パックの取込に失敗しました: " + error.message);
    }
  };
  reader.readAsText(file);
}

function applyStandardPack(pack) {
  if (pack.grid) state.settings.grid = pack.grid;
  if (pack.wireNumberFormat) state.settings.wireNumberFormat = pack.wireNumberFormat;
  if (pack.componentTagFormat) state.settings.componentTagFormat = pack.componentTagFormat;
  if (pack.componentTagPrefixes) state.settings.componentTagPrefixes = deepClone(pack.componentTagPrefixes);
  if (Array.isArray(pack.wireTypes) && pack.wireTypes.length) state.wireTypes = deepClone(pack.wireTypes);
  if (Array.isArray(pack.layers) && pack.layers.length) state.layers = deepClone(pack.layers);
  if (pack.frameVariant) {
    const page = currentPage();
    if (page) page.frameVariant = pack.frameVariant;
  }
}
```

- `renderStandardSelect()` を `STANDARDS + (state.standardPacks || [])` の連結で描画し、
  `applyStandard()` は id が standardPacks 側なら `applyStandardPack` を呼ぶよう拡張。
- UI: 右パネル「標準」の下に `標準出力` / `標準取込` ボタン+隠しfile input
  (accept ".json")。
- 将来: 第1部の `SYMBOL_GEO` 上書き(記号差し替え)や監査ルールもこのpackへ追加する
  (スキーマは `packVersion` を上げて拡張)。

### 3.10 DXF取込 MVP(フェーズC)

LINE / CIRCLE / TEXT / LWPOLYLINE を現在ページの要素に変換する最小実装。
シンボル認識はしない(下絵より正確なトレース素材として使う)。

```js
function importDxfFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const elements = dxfEntitiesToElements(String(reader.result || ""));
      if (!elements.length) {
        setStatus("DXFから取り込める要素がありません。");
        return;
      }
      const page = currentPage();
      page.elements.push(...elements);
      setSelection(elements.map(el => el.id));
      commitHistory("DXFから" + elements.length + "要素を取り込みました。");
      render();
    } catch (error) {
      setStatus("DXF取込に失敗しました: " + error.message);
    }
  };
  reader.readAsText(file);
}

function dxfEntitiesToElements(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const page = currentPage();
  const H = pageSize(page).h;
  const flipY = y => round(H - Number(y || 0));
  const out = [];
  let inEntities = false;
  let current = null;
  const flush = () => {
    if (!current) { return; }
    const d = current.data;
    if (current.name === "LINE" && d[10] !== undefined && d[11] !== undefined) {
      out.push({ id: uid("el"), type: "line", points: [[round(d[10]), flipY(d[20])], [round(d[11]), flipY(d[21])]], label: "", strokeWidth: .32, dash: "", stroke: state.settings.stroke, layer: "symbols" });
    } else if (current.name === "CIRCLE" && d[40] !== undefined) {
      const r = Number(d[40]);
      out.push({ ...defaultElement("circle", round(d[10] - r), round(flipY(d[20]) - r)), w: round(r * 2), h: round(r * 2), label: "" });
    } else if (current.name === "TEXT" && d[1] !== undefined) {
      out.push({ ...defaultElement("text", round(d[10] || 0), flipY(d[20])), text: String(d[1]), fontSize: Number(d[40] || 2.5) });
    } else if (current.name === "LWPOLYLINE" && (current.pts || []).length >= 2) {
      for (let i = 1; i < current.pts.length; i++) {
        out.push({ id: uid("el"), type: "line", points: [[round(current.pts[i - 1][0]), flipY(current.pts[i - 1][1])], [round(current.pts[i][0]), flipY(current.pts[i][1])]], label: "", strokeWidth: .32, dash: "", stroke: state.settings.stroke, layer: "symbols" });
      }
    }
    current = null;
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    const value = lines[i + 1].trim();
    if (code === 2 && value === "ENTITIES") { inEntities = true; continue; }
    if (code === 0) {
      if (value === "ENDSEC") { flush(); inEntities = false; continue; }
      if (inEntities) { flush(); current = { name: value, data: {}, pts: [] }; continue; }
    }
    if (inEntities && current) {
      if (current.name === "LWPOLYLINE" && code === 10) current.pts.push([Number(value)]);
      else if (current.name === "LWPOLYLINE" && code === 20 && current.pts.length) current.pts[current.pts.length - 1].push(Number(value));
      else if (current.data[code] === undefined) current.data[code] = isNaN(Number(value)) ? value : Number(value);
    }
  }
  flush();
  return out;
}
```

制限(仕様として明記): ARC/INSERT/HATCH は対象外。単位はmm前提($INSUNITS 無視)。
UI: 左パネル「自動処理」の DXF ボタン横に `DXF取込` ボタン+隠しfile input(accept ".dxf")。

### 3.11 線番・タグ書式の `%R`(ラダー行参照)対応

ACE のライン参照方式線番(例 `1504` 形式の線番)を可能にする。

- `formatWireNumber(format, page, number)` → `formatWireNumber(format, page, number, element)` に拡張し、
  置換を1つ追加:

```js
.replaceAll("%R", element ? String(elementLadderRow(element)).padStart(2, "0") : "")
```

  呼び出し元 `autoWireNumbers()` で `formatWireNumber(format, page, next, element)` と渡す
  (wire の行は `element.points[0][1]` 基準: `elementLadderRow` は elementBounds 経由で対応済み)。
- `formatComponentTag()` にも同じ `%R` 置換を追加。
- マニュアル記載は不要(本タスク対象外)だが、線番書式のプレースホルダとして
  `%S%R` で「頁+行」形式(見本の参照番号と同体系)が組めることをコードコメントに記す。

---

## 4. 編集操作の残ギャップ(実装計画の未完了項目)

### 4.1 グループ化/グループ解除

```js
function groupSelected() {
  const selected = selectedElements();
  if (selected.length < 2) {
    setStatus("グループ化するには2つ以上の要素を選択してください。");
    return;
  }
  const groupId = uid("grp");
  selected.forEach(element => { element.group = groupId; });
  commitHistory(selected.length + "件をグループ化しました。");
  render();
}

function ungroupSelected() {
  const selected = selectedElements();
  let count = 0;
  selected.forEach(element => {
    if (element.group) { delete element.group; count += 1; }
  });
  if (!count) { setStatus("グループ化された要素がありません。"); return; }
  commitHistory("グループを解除しました。");
  render();
}

function expandSelectionToGroups() {
  const page = currentPage();
  if (!page) return;
  const groups = new Set(selectedElements().map(el => el.group).filter(Boolean));
  if (!groups.size) return;
  setSelection(page.elements
    .filter(el => selectedIds.includes(el.id) || groups.has(el.group))
    .map(el => el.id));
}
```

- `onCanvasPointerDown()` の要素クリック処理で、
  `if (!selectedIds.includes(targetId)) selectSingle(targetId);` の直後に
  `expandSelectionToGroups();` を追加(Shiftクリック経路には入れない)。
- 複数選択パネルに `グループ化` / `解除` ボタンを追加し接続。
- 削除/複製/コピーは選択集合単位の既存実装のままで正しく動く。

### 4.2 左右ミラーと等間隔複製

```js
function mirrorSelectedHorizontal() {
  const selected = selectedElements();
  if (!selected.length) return;
  if (selected.some(isElementLocked)) { setStatus("ロックされた要素はミラーできません。"); return; }
  const target = unionBounds(selected.map(elementBounds).filter(Boolean));
  const axis = target.x + target.w / 2;
  selected.forEach(element => {
    if (element.points) {
      element.points = element.points.map(point => [round(axis * 2 - point[0]), point[1]]);
    } else {
      const box = elementBounds(element);
      element.x = round(axis * 2 - box.x - box.w);
    }
  });
  commitHistory("左右ミラーしました。");
  render();
}
```

※ 制限を仕様として明記: シンボル内部形状は反転しない(見本の記号はほぼ左右対称のため実用上問題なし)。
回転された要素は境界基準の近似。

```js
function showArrayCopyDialog() {
  openDialog("等間隔複製", `
    <div class="row">
      <div><label>複製数</label><input id="arrCount" type="number" min="1" step="1" value="3"></div>
      <div><label>間隔X mm</label><input id="arrDx" type="number" step="0.5" value="0"></div>
    </div>
    <label>間隔Y mm</label><input id="arrDy" type="number" step="0.5" value="9.5">
    <div class="inline" style="justify-content:flex-end;margin-top:12px">
      <button type="button" id="arrApplyBtn" class="primary">複製</button>
    </div>`);
  qs("#arrApplyBtn").addEventListener("click", () => {
    const page = currentPage();
    const selected = selectedElements();
    if (!page || !selected.length) return;
    const count = Math.max(1, Math.floor(Number(qs("#arrCount").value || 1)));
    const dx = Number(qs("#arrDx").value || 0);
    const dy = Number(qs("#arrDy").value || 0);
    const created = [];
    for (let n = 1; n <= count; n++) {
      selected.forEach(element => {
        const copy = deepClone(element);
        copy.id = uid("el");
        copy.locked = false;
        delete copy.group;
        translateElement(copy, dx * n, dy * n);
        created.push(copy);
      });
    }
    page.elements.push(...created);
    setSelection(created.map(el => el.id));
    closeDialog();
    commitHistory(created.length + "件を等間隔複製しました。");
    render();
  });
}
```

既定の間隔Y 9.5 = ラダー行ピッチ(ラング上の回路を行単位で量産する用途)。
UI: 複数選択/単一選択パネルに `ミラー` / `等間隔複製` ボタン。

### 4.3 配線の結合・分割

```js
function mergeSelectedWires() {
  const page = currentPage();
  const selected = selectedElements();
  if (selected.length !== 2 || selected.some(el => el.type !== "wire")) {
    setStatus("結合するには配線を2本選択してください。");
    return;
  }
  const [a, b] = selected;
  const pa = a.points || [];
  const pb = b.points || [];
  const near = (p, q) => Math.abs(p[0] - q[0]) < .6 && Math.abs(p[1] - q[1]) < .6;
  let points = null;
  if (near(pa[pa.length - 1], pb[0])) points = [...pa, ...pb.slice(1)];
  else if (near(pa[pa.length - 1], pb[pb.length - 1])) points = [...pa, ...pb.slice(0, -1).reverse()];
  else if (near(pa[0], pb[0])) points = [...pa.slice().reverse(), ...pb.slice(1)];
  else if (near(pa[0], pb[pb.length - 1])) points = [...pb, ...pa.slice(1)];
  if (!points) {
    setStatus("端点が一致する配線を選択してください。");
    return;
  }
  a.points = orthogonalizePoints(points);
  page.elements = page.elements.filter(el => el.id !== b.id);
  selectSingle(a.id);
  commitHistory("配線を結合しました。");
  render();
}

function splitSelectedWire() {
  const page = currentPage();
  const element = selectedElement();
  if (!page || !element || element.type !== "wire") return;
  if (isElementLocked(element)) { setStatus("ロックされた配線は変更できません。"); return; }
  const points = element.points || [];
  if (points.length < 2) return;
  let before, after;
  if (points.length === 2) {
    const mid = [round((points[0][0] + points[1][0]) / 2), round((points[0][1] + points[1][1]) / 2)];
    before = [points[0], mid];
    after = [mid, points[1]];
  } else {
    const cut = Math.floor(points.length / 2);
    before = points.slice(0, cut + 1);
    after = points.slice(cut);
  }
  const second = deepClone(element);
  second.id = uid("el");
  second.points = after;
  second.hideWireNo = true;
  element.points = before;
  page.elements.push(second);
  setSelection([element.id, second.id]);
  commitHistory("配線を分割しました。");
  render();
}
```

UI: wire 選択時の `specificFields` に `結合(2本選択時)` / `分割` ボタンを追加
(結合ボタンは複数選択パネル側にも置く)。

---

## 5. データモデル変更一覧(すべて省略可能・後方互換)

| 追加先 | フィールド | 型/既定 | 用途 |
|---|---|---|---|
| 接点系要素 | `refNo` | string "" | 参照番号の手動上書き(空なら2.2の自動値) |
| wire | `wireNoAlign` / `wireNoDx` / `wireNoDy` | "mid" / 0 / 0 | 線番配置(2.5) |
| arrow | `arrowStyle` / `arrowAtStart` | "open" / false | 第1部4.18+本書2.7 |
| lamp | `lampColor` | "W" | 色文字(第1部4.7) |
| pushButton | `pbStyle` | "momentary" | 非常停止形切替(第1部4.8) |
| resistor | `resistorStyle` | "box" | バリスタ切替(第1部4.16) |
| connector | `connStyle` | (無し) | "pair"でコネクタ対(第1部4.17) |
| contactBlock | `blockFrame` | "solid" | 実線/点線枠(第1部4.20) |
| plcBlock | `plcStyle` | "grid" | "unit"でユニット列(第1部4.22) |
| terminalStrip/connector | `jumpers` | "" | ジャンパ(3.5) |
| table | `cellDiagonals` | "" | 斜線セル(第1部4.24) |
| text | `underline` | false | 下線(2.8) |
| 全要素 | `group` | (無し) | グループ化(4.1) |
| rect | `panelRef` | (無し) | 盤レイアウト連携(3.8) |
| page.title | `sideNote` | "" | 左余白縦書き注記(2.10) |
| state | `catalog` | [] | 部品カタログ(3.1) |
| state | `standardPacks` | [] | 取込済み標準パック(3.9) |
| 新タイプ | `thermalElement` `pressureSwitch` `positionMark` `polarityMark` | — | 第1部参照 |

JSON保存は `state` 全体を書き出す既存実装のため追加作業なし。
`openProjectFile` も未知フィールドを素通しするため互換性は保たれる。

---

## 6. 実装フェーズと受入条件

### フェーズA(見本PDF再現に必須) — 2章全部

| 項 | 受入条件 |
|---|---|
| 2.1 行グリッド | `elementAddress` が 頁15行04 の要素に対し "1504" を返す(単体で確認) |
| 2.2 クロス参照 | 頁15にコイル CR1X、別ページに CR1X 接点を置くと、接点の下に **1504** が自動表示される。コイルを行05へ動かすと全接点の表示が 1505 に追従する |
| 2.3 参照表 | コイルのあるページの左下表に、タグ+接点アドレスが列挙され、b接点の数字に下線が付く |
| 2.4 機器符号表 | ページ上の機器タグ・説明・親コイル頁が右下表に出る |
| 2.5 線番配置 | 線番を「終点」にすると PLC 端子手前で右寄せ表示される |
| 2.6 2段ラベル | description の1行目が接点タグの上に小さく出る |
| 2.7 矢印ペア | source/destination の同名矢印に相手の頁番号が出る。片側だけなら出ない |
| 2.8 線種/下線 | 一点鎖線プリセットが選べ、下線付き文字が印刷/SVG/DXFに反映 |
| 2.9 複数レール | 4本レールのラダーページが生成でき、レール名が階段状に表示 |
| 2.10 側注記 | 側注記入力が全ページ左余白に縦書き表示・印刷される |

### フェーズB(ACEコア機能) — 3.1〜3.7, 3.11, 4章

| 項 | 受入条件 |
|---|---|
| 3.1 カタログ | 登録→部品選択→「カタログから選択」でメーカー/品番が入る |
| 3.2 BOM | 同一品番2個が qty=2 で1行に集計。CSVと表挿入が動く |
| 3.3 リレー監査 | 接点の無いコイル=情報、コイルの無い接点=注意、上限超過=警告(OL単独は誤検出しない) |
| 3.4 回路ビルダー | 3相分岐(CB3極+連動破線+MC+OL素子+モータ+接地)が1回で生成され、配線が装置端子で分割済み |
| 3.5 ジャンパ | `1-2;3-5` で渡り弧が表示、DXF・帳票にも反映 |
| 3.6 PLC連番 | X068 開始16点で X068〜X077(16進)が生成される |
| 3.7 重複警告 | タグ入力確定時に重複ステータスが出る |
| 3.11 %R | 線番書式 `%S%R` で「頁+行」形式の線番が採番される |
| 4.1〜4.3 | グループ選択追従・ミラー・等間隔複製・配線結合/分割が動く |

### フェーズC(拡張) — 3.8〜3.10

| 項 | 受入条件 |
|---|---|
| 3.8 盤連携 | チェックした部品がフットプリントとして格子配置され、タグが表示される |
| 3.9 標準パック | 出力したJSONを取り込むと配線種別・タグ規則が再現される |
| 3.10 DXF取込 | 本ツールが出力したDXFを取り込み、線/円/文字が同位置に復元される(往復テスト) |

---

## 7. 検証手順

1. **構文チェック**: 第1部 8.1 と同じ(各フェーズ完了時に実行)。
2. **クロスリファレンス往復テスト**(フェーズAの主検証):
   - ページ1(頁15扱い: 表題欄の頁を15に設定)行04にコイル CR1X を配置
   - ページ2(頁20)行19/20に contactNO、ページ3(頁24)行02に contactNO を配置、全て tag=CR1X
   - 期待: 各接点の下に `1504`、ページ1左下表の CR1X 列に `2019/2020/2402`
   - ページ2の接点を contactNC に変更 → 表の該当数字に下線が付く
3. **見本ページ再現テスト**: 第1部 8.3 の下絵オーバーレイに加え、
   本書実装後は「参照番号・表・注記が下絵と一致するか」まで照合し、
   `docs/scan-reproduction-checklist.md` の記録対象に含める(記録は人が行う)。
4. **帳票整合**: BOM・帳票CSV・監査を同一図面で実行し、部品数が矛盾しないこと。
5. **後方互換**: 本書実装前に保存したJSONを読み込み、エラーなく表示・再保存できること。

---

## 8. 対象外・将来課題

- ワイヤーネット解析(接続グラフによる同電位線番の共有)— 現状は端点近傍推定(FROM/TO)で代替。
  次期: 端点一致+junction を辺とするグラフで net を構築し、`autoWireNumbers` を net 単位化する。
- 図面間の配線継続(Source/Dest 矢印を線番でリンクし net を跨ぐ)— 2.7 の注記を土台に拡張。
- シンボルビルダー(GUIでの記号作成)— 現状はユーザー部品登録+`SYMBOL_GEO` 直接編集で代替。
- 端子台の多段(2段/3段端子)・DINレール表現。
- PDFの直接下絵化(pdf.js 同梱は単一HTML要件と配布サイズの兼ね合いで別途判断)。
