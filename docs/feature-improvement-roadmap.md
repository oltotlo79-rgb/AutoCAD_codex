# 機能拡張・改善ロードマップ（実装根拠付き）

- 調査日: 2026-07-11
- 調査基準コミット: `20cf5ae`
- 対象: `index.html`、`docs/manual.md`、`docs/requirements.md`、既存の実装計画・申し送り・再現仕様
- 本書の位置づけ: 実装前の提案書。今回、`index.html` は変更していない。

## 1. 結論

本ツールは、複数ページ作図、電気シンボル、配線、線番・タグ採番、クロスリファレンス、端子台・PLC、監査、BOM・帳票、JSON/SVG/PNG/PDF/DXF/CSV 入出力、下絵、標準パック、履歴、図面差分まで既に備えている。したがって、次の投資先は単なるボタン追加ではなく、以下の順が妥当である。

1. **データ保全と操作不整合の解消**: JSON 読込の欠落、将来版データ、Esc、入力欄の Undo、壊れた入力への対処。
2. **事故を起こしにくい業務フロー**: 置換・CSV・DXF の事前確認、監査の例外管理とクイック修正、未保存表示。
3. **日常作図の高速化**: ネット追跡、重なり選択、多点配線、パラメータ付き回路テンプレート。
4. **大規模案件への備え**: 状態管理の整理、IndexedDB、差分履歴、差分描画、空間インデックス、テスト可能なソース分割。

最初のリリースでは **R-01～R-06** を優先する。短期間で実害を減らせ、後続改修を安全に進めるテスト基盤も同時に作れるためである。

## 2. 前提と評価基準

### 2.1 維持する製品要件

- Chrome / Edge 系ブラウザを基本対象とし、外部サーバー、インストーラ、常時接続を必須にしない。根拠: [requirements.md L13-L14](requirements.md#L13-L14)
- 図面表示は SVG、内部データは JSON とし、保存後も再編集できること。根拠: [requirements.md L20-L23](requirements.md#L20-L23)
- 配布物は引き続き単一 `index.html` でよい。ただし、**開発時のソースを複数モジュールに分け、リリース時に単一 HTML へ束ねる**ことは要件と両立する。
- 既存 JSON は移行して読めること。新機能は省略可能なプロパティから導入し、旧データを壊さない。

### 2.2 優先度と工数

| 区分 | 意味 |
|---|---|
| P0 | データ欠落、誤操作、説明との不一致、回帰防止。次回リリース候補 |
| P1 | 業務効率・品質を大きく上げる。P0 後に順次実装 |
| P2 | 大規模案件、拡張性、操作快適性をさらに上げる |

工数は **1人で実装・自動テスト・取扱説明書更新まで行う概算人日**である。既存の単一ファイル構造を直接改修する場合は、影響調査により増える可能性がある。

## 3. 優先順位一覧

| ID | 提案 | 優先度 | 概算 | 主な効果 |
|---|---|---:|---:|---|
| R-01 | JSON 読込の欠落修正、統一 validator、将来版保護 | P0 | 1日 + 4～6日 | 保存内容の欠落・破損を防ぐ |
| R-02 | Esc と入力欄 Ctrl+Z/Y の実装修正 | P0 | 0.5～1日 | 説明書どおりの操作、誤 Undo 防止 |
| R-03 | 画像・JSON・PNG 出力の容量制限と失敗処理 | P0 | 2～4日 | 巨大・破損ファイルによる停止を防ぐ |
| R-04 | 単体・統合・E2E テストと CI | P0 | 5～8日 | 保存・接続・描画の回帰を自動検出 |
| R-05 | 安全な検索・一括置換プレビュー | P0 | 4～5日 | 全ページ誤置換を防ぐ |
| R-06 | 標準パック v2、検証、差分適用、衝突解決 | P0 | 4～6日 | 不正設定・重複・部分適用を防ぐ |
| F-01 | CSV 取込ウィザード | P1 | 4～6日 | 列ずれ・重複・大量誤生成を防ぐ |
| F-02 | 監査 waiver、クイック修正、検図記録 | P1 | 6～8日 | 監査を実運用の品質ゲートにする |
| F-03 | 未保存表示、上書き保存、終了時保護 | P1 | 2～4日 | 保存忘れとファイル乱立を防ぐ |
| F-04 | ライブネット強調と接続診断 | P1 | 3～4日 | 誤接続・未接続を作図中に発見 |
| F-05 | 重なり選択、選択フィルター、CAD 型範囲選択 | P1 | 4～5日 | 高密度図面での誤選択を削減 |
| F-06 | 多点連続配線と直交ルート候補 | P1 | 6～9日 | 複雑な配線の描き直しを削減 |
| F-07 | パラメータ付き回路・ページテンプレート | P1 | 6～8日 | 標準回路の再利用と変更漏れ防止 |
| F-08 | DXF 取込プレビューと往復精度向上 | P1 | 6～10日 | CAD 受け渡しの予測可能性を上げる |
| F-09 | 改訂差分帳票と検図・承認記録 | P1 | 7～10日 | 変更内容と承認後変更を追跡する |
| U-01 | ダイアログ/メニューのフォーカス管理と高コントラスト | P1 | 4～6日 | キーボード・弱視・色覚差へ対応 |
| A-01 | document/view/runtime 状態分離と action 化 | P1 | 4～7日 | Undo・保存・描画更新の漏れを減らす |
| A-02 | IndexedDB と画像 asset 分離 | P1 | 6～10日 | 下絵を含む大容量案件を安定保存 |
| A-03 | 全量 Undo から checkpoint + 差分履歴へ | P1 | 5～8日 | メモリと同期保存の負荷を削減 |
| A-04 | 開発ソースのモジュール分割と要素レジストリ | P1 | 8～12日 | 部品追加・テスト・並行開発を容易にする |
| A-05 | 図枠・帳票・監査定義の標準パック外部化 | P1 | 10～15日 | 自社標準をコード変更なしで展開する |
| A-06 | 差分 SVG 描画、空間 index、Worker | P2 | 12～20日 | 大規模ページの操作待ちを削減 |
| U-02 | コマンドパレットと可変・折り畳みパネル | P2 | 4～6日 | 多機能化後も操作を探しやすくする |
| D-01 | 実装状況・説明書・リリース検査の一元化 | P2 | 2～3日 | 「実装済みなのに未完」等の文書ずれを防ぐ |

## 4. P0: 先に直すべき信頼性・安全性

### R-01. JSON 読込の欠落修正と統一 validator

**根拠**

- `SCHEMA_VERSION = 2` と 1→2 migration はあるが、未来版は警告後そのまま返す。根拠: [`migrateProjectData()` L1603-L1633](../index.html#L1603-L1633)
- 保存は `state` 全体を JSON 化する。根拠: [`saveProject()` L11583-L11589](../index.html#L11583-L11589)
- `ensureProjectDefaults()` は `catalog`、`standardPacks`、`plcModules` を正式な状態として扱う。根拠: [`ensureProjectDefaults()` L1745-L1765](../index.html#L1745-L1765)
- しかしファイルから開く経路は、それら3項目を復元していない。根拠: [`openProjectFile()` L11973-L12000](../index.html#L11973-L12000)
- 取扱説明書は JSON にユーザー部品と標準設定が含まれると説明している。根拠: [manual.md L1117-L1131](manual.md#L1117-L1131)
- バックアップ、ブラウザ内プロジェクト、ファイル読込が別々の置換処理を持つ。根拠: [`applyBackupSnapshot()` L11649-L11664](../index.html#L11649-L11664)、[`loadStoredProject()` L11716-L11735](../index.html#L11716-L11735)

**実際に何をするか**

1. 即時修正として `openProjectFile()` に `catalog`、`standardPacks`、`plcModules` の復元を追加する。
2. 次に読込経路を以下へ統一する。

   ```text
   ファイル/バックアップ/ブラウザ保存
        ↓ parseProject(raw, source)
   構文検査 → version判定 → migration → schema検証 → normalize
        ↓ replaceDocument(normalized)
   履歴初期化 → dirty解除 → 1回だけrender
   ```

3. validator で最低限、ページ ID・要素 ID の一意性、`activePageId` の存在、要素種別、有限数座標、配線点数、用紙範囲、参照先 ID、レイヤ/配線種別参照を検査する。
4. `schemaVersion > SCHEMA_VERSION` は状態を変更せず停止し、「新しい版で開く」「JSONを退避」の案内を出す。警告だけで現行版として再保存しない。
5. 軽微な欠損は「修復プレビュー」で既定値を提示し、重大な欠損は読込拒否に分ける。
6. JSON ルートへ `savedAt`、`createdWith`、任意の `documentId` を追加し、診断時に版を特定できるようにする。

**受入条件**

- `catalog`、`standardPacks`、`plcModules`、`customSymbols`、下絵、表題欄 layout を含む図面で、保存→初期化→読込後の文書状態が一致する。
- v1、v2、未来版、重複 ID、`NaN` 相当、未知要素の fixture を自動テストし、失敗時に現在図面が変わらない。
- 修復した項目は件数と場所を一覧表示する。

### R-02. Esc と入力欄 Ctrl+Z/Y の実装修正

**根拠**

- キャンバスヒントは Esc で選択へ戻れると表示し、取扱説明書も配置・選択・配線で Esc を案内している。根拠: [`updateCanvasHint()` L1950-L1965](../index.html#L1950-L1965)、[manual.md L283-L283](manual.md#L283)、[manual.md L628-L650](manual.md#L628-L650)
- `cancelPlacementMode()` は存在するが、グローバル `onKeyDown()` に Escape 分岐がない。根拠: [`cancelPlacementMode()` L7932-L7937](../index.html#L7932-L7937)、[`onKeyDown()` L16789-L16869](../index.html#L16789-L16869)
- 入力中判定より先に Ctrl+Z/Y を処理するため、入力欄で文字を戻す操作が図面全体の Undo/Redo になる。根拠: [`onKeyDown()` L16789-L16807](../index.html#L16789-L16807)

**実際に何をするか**

1. `INPUT`、`TEXTAREA`、`SELECT`、`contenteditable` の判定を Ctrl+Z/Y/C/V/D より前へ移す。入力中の編集ショートカットはブラウザ既定動作へ委ねる。
2. Escape の処理順を「その場編集取消 → ダイアログ/メニューを閉じる → 未確定ドラッグ取消 → 配置/配線モード取消 → 選択解除」とする。
3. ドラッグ中に作った仮要素はモデルへ残さず、開始前状態へ戻す。
4. Ctrl+S は入力中でも保存するかを独立条件にし、仕様をヘルプへ明記する。

**受入条件**

- 入力欄の Ctrl+Z は文字だけを戻し、図面履歴 index は変わらない。
- 部品配置、配線中、インライン編集、ダイアログ、コンテキストメニューの各状態で Esc が1回ずつ期待どおり働く。

### R-03. 画像・JSON・PNG 出力の容量制限と失敗処理

**根拠**

- 下絵は MIME が `image/*` かだけを確認し、byte 数・pixel 数・実データ形式を検査しない。decode 失敗時も代替寸法で追加処理へ進む。根拠: [`readUnderlayImageFile()` L11808-L11842](../index.html#L11808-L11842)
- 2面分割は元画像と同寸 canvas を複数生成する。根拠: [`index.html` L11887-L11916](../index.html#L11887-L11916)
- JSON は容量確認なしで `readAsText` し、PNG 出力には画像 decode 失敗や `toBlob(null)` の処理がない。根拠: [`openProjectFile()` L11973-L12000](../index.html#L11973-L12000)、[`index.html` L12010-L12036](../index.html#L12010-L12036)

**実際に何をするか**

1. 設定可能な上限として、ファイル byte 数、画像総 pixel 数、ページ数、要素数を設ける。初期値は実機計測後に確定し、超過時は「縮小して続行」「取消」を出す。
2. PNG/JPEG/WebP は magic number と decode の両方を確認する。SVG 下絵は script・外部参照を除去してから使うか、当面は raster 化する。
3. `createImageBitmap()` と縮小 canvas を用い、印刷に必要な解像度を保ちながら下絵を保存前に downsample する。
4. `FileReader.onerror`、画像 `onerror`、canvas 取得失敗、`toBlob` の null、Object URL 解放を共通エラー処理へまとめる。
5. 失敗時は要素・ページ・履歴を一切追加せず、ファイル名、原因、対処を表示する。

**受入条件**

- 破損画像、拡張子偽装、極端に大きい画像、破損 JSON で、現在図面を変えずに終了する。
- 2面分割と PNG 出力の途中失敗でも、操作を継続でき、不要な Object URL を残さない。

### R-04. 単体・統合・E2E テストと CI

**根拠**

- 調査時点で tracked な `package.json`、`tests/`、Playwright/Vitest/Jest 設定がない。
- 実装は CSS が [L7-L913](../index.html#L7-L913)、画面が [L915-L1218](../index.html#L915-L1218)、JavaScript が [L1220-L16877](../index.html#L1220-L16877) の単一ファイルに集中している。
- テスト用公開 hook は6項目だけである。根拠: [`window.__edsTest` L16875](../index.html#L16875)
- 保存移行、接続点、ネット解析、監査など、回帰時の影響が大きい処理がある。根拠: [`migrateProjectData()` L1616-L1633](../index.html#L1616-L1633)、[`buildWireNets()` L12212-L12247](../index.html#L12212-L12247)、[`auditProject()` L14293-L14475](../index.html#L14293-L14475)

**実際に何をするか**

1. 純粋関数を先に `src/core/` へ抽出し、Vitest 等で schema migration、geometry、接続 anchor、wire net、採番、監査を単体テストする。
2. 保存→新規→読込の round-trip と、バックアップ/ブラウザ保存/ファイル読込の同値性を統合テストする。
3. 全パレット要素について SVG snapshot と DXF golden を作り、「SVGでは描けるがDXFで欠落」を検出する。
4. Playwright で新規作成、部品配置、配線、インライン編集、Undo/Redo、保存/読込、監査、印刷プレビューを E2E 化する。
5. CI で unit、E2E、生成済み単一 HTML の差分、マニュアル画像リンク切れ、PDF 生成を検査する。

**受入条件**

- R-01 と R-02 の再現ケースが自動テストで固定される。
- PR/commit ごとにテストが再現可能で、失敗時に機能名と fixture が特定できる。
- 開発ソースを分割しても、配布物は外部依存なしの単一 `index.html` として起動する。

### R-05. 安全な検索・一括置換

**根拠**

- 現在の検索 UI は検索語と置換値が中心である。根拠: [`showSearchDialog()` L13225-L13245](../index.html#L13225-L13245)
- 一括置換は固定フィールドを全ページ走査し、プレビュー・対象選択なしで即時適用する。根拠: [`runReplaceAll()` L13248-L13274](../index.html#L13248-L13274)
- 検索は単純な部分一致である。根拠: [`findElements()` L13288-L13305](../index.html#L13288-L13305)
- 取扱説明書も全ページ一括置換として案内している。根拠: [manual.md L1028-L1047](manual.md#L1028-L1047)

**実際に何をするか**

1. 検索条件を `{scope, pageIds, types, layers, fields, matchMode, caseSensitive}` としてモデル化する。
2. 部分一致、完全一致、正規表現を選べるようにし、正規表現エラーは適用前に表示する。
3. 「ページ / 要素 / フィールド / 変更前 / 変更後」のプレビュー表を出し、行ごとのチェックで適用対象を選ぶ。
4. 配列フィールド（端子文字、表セル等）も、どの添字が変わるかを明示する。
5. 選択行を1回の `commitHistory` で適用し、1回の Undo で全置換を戻せるようにする。
6. Ctrl+F を検索へ割り当て、検索条件をプロジェクトへ保存しない一時状態とする。

**受入条件**

- 「取消」では文書 JSON と履歴が変わらない。
- プレビュー件数、実変更件数、Undo 後の状態が一致する。
- ロック要素・非表示レイヤを含めるかを明示選択できる。

### R-06. 標準パック v2、検証、差分適用、衝突解決

**根拠**

- 現在の標準パックは、配線種別、レイヤ、監査設定、帳票列、ユーザー部品、カタログ、PLC preset、表題欄 layout をまとめて出力する。根拠: [`index.html` L10282-L10300](../index.html#L10282-L10300)
- 取込時の入口検査は主に `packVersion === 1` で、内部項目の型・ID一意性・参照整合を十分には検証しない。根拠: [`index.html` L10305-L10322](../index.html#L10305-L10322)
- 同一 ID の pack を追加でき、適用処理は `state` を順次変更するため、衝突の説明と transaction rollback がない。根拠: [`index.html` L10312-L10367](../index.html#L10312-L10367)
- 標準選択は最初に一致した ID を使うため、重複時の結果が利用者から分かりにくい。根拠: [`index.html` L7941-L7949](../index.html#L7941-L7949)

**実際に何をするか**

1. `packVersion: 2` とし、`id`、`label`、`vendor`、`version`、`compatibleSchema`、`createdAt`、`description`、`capabilities`、`checksum` を持たせる。
2. wire type、layer、symbol、catalog、PLC preset、title layout ごとに必須 field、値域、ID一意性、参照先を検証する。
3. 取込時に「追加 / 更新 / 削除なし / 衝突」を設定分類ごとに preview する。
4. ID 衝突は「既存を更新」「新IDで複製」「その項目を除外」「全取消」を選べるようにする。
5. `deepClone(documentState)` へ試験適用し、全検証成功後だけ `batchAction()` で入れ替える。途中 error で半分だけ適用しない。
6. 適用範囲を「新規ページの既定」「現在ページ」「全ページ」から明示選択する。
7. v1→v2 migration を用意し、同じ pack の二重取込は更新候補として扱う。

**受入条件**

- 不正 pack は field path 付きで拒否し、現在 state と履歴を変えない。
- 同じ pack を二度取り込んでも曖昧な同一 ID が増えない。
- pack 出力→空 project へ取込→再出力した正規化 JSON が一致する。
- v1 pack は警告と移行内容を表示した上で読める。

## 5. P1: 業務フローと作図機能

### F-01. CSV 取込ウィザード

**根拠**

- 端子 CSV と PLC CSV は、読込→文字コード推定→正規化後、確認なしでページ生成へ進む。根拠: [`importTerminalCsvFile()` L8122-L8139](../index.html#L8122-L8139)、[`importPlcCsvFile()` L8142-L8159](../index.html#L8142-L8159)
- delimiter は先頭5行の comma/tab 数で決め、ヘッダー別名と列位置を自動推定する。欠損値は既定値や列順で補う。根拠: [`parseDelimitedRows()` L8188-L8227](../index.html#L8188-L8227)、[`normalizeTerminalCsvRows()` L8230-L8258](../index.html#L8230-L8258)、[`normalizePlcCsvRows()` L8261-L8287](../index.html#L8261-L8287)
- catalog CSV は別の即時取込経路を持ち、同じ文字コード推定・preview を共有していない。根拠: [`index.html` L9986-L10013](../index.html#L9986-L10013)
- 取扱説明書も、取込後に端子名と線番を1行ずつ確認するよう求めている。根拠: [manual.md L816-L829](manual.md#L816-L829)

**実際に何をするか**

1. ファイル選択後にまだページを作らず、文字コード、区切り、ヘッダー有無、先頭20行を表示する。
2. 必須/任意フィールドと CSV 列の対応を select で変更可能にする。推定結果は初期値として再利用する。
3. 行ごとに「必須値欠落」「重複端子」「重複 PLC address」「不明 direction」「列余り」を検証し、error/warning を表示する。
4. 作成予定ページ数、開始ページ名、1ページの行数を事前表示する。
5. 「正常行のみ」「警告を含める」「取消」を選び、確定時だけ1つの Undo 単位でページを追加する。
6. 同じ CSV の再取込用に `sourceKey` と stable row key を持たせ、将来は「新規追加 / 既存更新 / 競合」の差分同期へ拡張する。
7. 端子、PLC、catalog が同じ `parseImportFile()` と mapping UI を使い、mapping profile を標準パックへ保存できるようにする。

**受入条件**

- 確定前はページ数・履歴・active page が変わらない。
- UTF-8/Shift_JIS、CSV/TSV、quoted newline、ヘッダーなしの fixture で期待どおり mapping できる。
- 重複 address/terminal を行番号付きで表示する。

### F-02. 監査 waiver、クイック修正、検図記録

**根拠**

- 現在の監査設定はルール単位の ON/OFF である。根拠: [`AUDIT_RULES` / `auditRuleOn()` L14247-L14262](../index.html#L14247-L14262)
- 結果からできる操作は対象の「選択」が中心で、issue に `ruleId` や修正情報がない。根拠: [`showAudit()` L14265-L14287](../index.html#L14265-L14287)、[`auditProject()` L14293-L14475](../index.html#L14293-L14475)
- 取扱説明書も、指摘を選択して手修正し、再監査する流れである。根拠: [manual.md L996-L1024](manual.md#L996-L1024)

**実際に何をするか**

1. issue を次の形へ正規化する。

   ```js
   { ruleId, severity, pageId, elementId, fingerprint, message, fixId, fixData }
   ```

2. `fingerprint = ruleId + elementId + 問題値` とし、`state.project.auditWaivers` に理由、担当、期限、登録日時を保存する。問題値が変われば waiver を失効させる。
3. 未採番→既存自動採番、未タグ→既存自動タグ、範囲外 jumper→無効 pair 除去、用紙外→用紙内へ移動、接続点不足→既存接続点生成など、安全な修正だけ `fixId` を付ける。
4. 「修正案プレビュー」「選択項目を修正」を用意し、全修正を1回の Undo 単位にする。曖昧な接続や意図判断が必要な項目は自動修正しない。
5. 重大度、新規、waiver 済み、ページ、担当で絞り込み、CSV/HTML へ監査結果を出せるようにする。
6. 検図時に文書 hash、実行ルール、問題件数、waiver、担当、日時を `reviewRecord` として保存する。図面変更後は「検図後に変更あり」と表示する。

**受入条件**

- waiver は対象値が変わると自動的に再指摘される。
- クイック修正のプレビュー、適用、Undo、再監査で件数が整合する。
- 検図記録から、どの状態・ルールで承認したか追跡できる。

### F-03. 未保存表示、上書き保存、終了時保護

**根拠**

- 現在の保存は毎回 timestamp 付き JSON を download する。根拠: [`saveProject()` L11583-L11589](../index.html#L11583-L11589)
- Ctrl+S も常に同じ処理を呼ぶ。根拠: [`onKeyDown()` L16792-L16795](../index.html#L16792-L16795)
- `attachEvents()` に `beforeunload`、`pagehide`、`visibilitychange` の終了保護がない。根拠: [`attachEvents()` L15769-L16031](../index.html#L15769-L16031)

**実際に何をするか**

1. `documentRevision` と `lastSavedRevision` を分け、差があればタイトル/ステータスへ「未保存」を表示する。
2. File System Access API を機能検出し、対応時は「保存」「名前を付けて保存」で同一 file handle へ書く。非対応時は現行 download を維持する。
3. dirty 時だけ `beforeunload` で確認する。`visibilitychange` で hidden になった時点で IndexedDB へ回復 snapshot を保存し、`pagehide` は best-effort の補助にする。
4. Undo で保存済み revision に戻った場合は dirty を解除する。
5. JSON download 方式でも、最後に保存した日時と revision を表示する。

**受入条件**

- 編集→保存→編集→Undo の各段階で dirty 表示が正しい。
- API 非対応/許可拒否でも従来保存が使える。
- 未保存状態で新規作成、別 JSON 読込、タブ終了を行うと確認される。

### F-04. ライブネット強調と接続診断

**根拠**

- 同電位 wire group を作る `buildWireNets()` と、ページ間信号を扱う処理は既にある。根拠: [`buildWireNets()` L12212-L12247](../index.html#L12212-L12247)、[`index.html` L12262-L12275](../index.html#L12262-L12275)
- 現状は主に採番、ネットリスト、監査へ利用し、通常キャンバス上の追跡表示はない。
- 未接続は事後監査で検出する。根拠: [`auditFloatingWireEnds()` L14478-L14505](../index.html#L14478-L14505)、[manual.md L628-L650](manual.md#L628-L650)

**実際に何をするか**

1. wire/terminal/部品 pin 選択時に同一ネットの要素 ID を取得し、保存しない `highlightedNet` へ保持する。
2. SVG の overlay group に太い半透明線、端点、ページ間 signal arrow を描く。PDF/SVG/PNG/DXF 出力には含めない。
3. 右パネルへ「ネット全選択」「次の接続先」「ページ間信号先へ」を追加する。
4. 文書更新を debounce して浮き端点だけ再計算し、作図中は非確定端点を警告形状で示す。
5. 大規模ページでは A-06 の空間 index を使い、通常操作を止めない。

**受入条件**

- 線番が空でも物理接続だけで同一ネットを強調できる。
- 強調表示は保存 JSON と全出力へ混入しない。
- ページ間 signal arrow から相手ページ/行へ移動できる。

### F-05. 重なり選択と選択フィルター

**根拠**

- click 選択は `event.target.closest('[data-id]')` の最上位要素が中心である。根拠: [`onCanvasPointerDown()` L16099-L16195](../index.html#L16099-L16195)
- 範囲選択は外接矩形との交差判定である。根拠: [`applyMarqueeSelection()` L16500-L16520](../index.html#L16500-L16520)
- Shift 複数選択と「同種をページ内全選択」は既にあるため、それらを置き換えず補完する。

**実際に何をするか**

1. pointer 位置と `elementBounds` / wire segments から候補 stack を作り、Alt+click で重なり順に循環する。
2. 右click/長押し時は候補名、タグ、レイヤを一覧にし、直接選択できるようにする。
3. `selectionFilter = {types, layers, wireTypes, locked, installation, location}` を view state に持ち、click と矩形選択の両方へ適用する。
4. 左→右矩形は完全包含、右→左矩形は交差を既定とし、設定で現在方式にも戻せるようにする。
5. フィルター適用中はキャンバス上に badge を出し、「選べない理由」を明示する。

**受入条件**

- 同一点の wire、symbol、frame-related element を順番に選べる。
- locked/hidden layer の扱いが filter 表示と一致する。
- 範囲方向ごとの包含/交差 fixture が一致する。

### F-06. 多点連続配線と直交ルート候補

**根拠**

- 現在は pointer down から2点配線を作り pointer up で確定する。根拠: [`onCanvasPointerDown()` L16147-L16156](../index.html#L16147-L16156)、[`index.html` L16463-L16496](../index.html#L16463-L16496)
- 作図中の形状は直線、L、反転L、Z 系を切り替え、確定後に中間点編集できる。根拠: [`index.html` L16284-L16306](../index.html#L16284-L16306)、[manual.md L628-L696](manual.md#L628-L696)

**実際に何をするか**

1. 第1段階として、W 開始後に click ごとに中間点を追加し、Enter/二重clickで確定、Backspaceで1点戻す、Escで全取消を実装する。
2. 既存 Space/Shift の形状切替は最初の区間または「手動ルート候補」として残す。
3. 第2段階として、可視かつ locked な部品 bounds を clearance 付き障害物へ変換し、グリッド上 A* で直交ルートを2～3候補生成する。
4. Space で候補を巡回し、ルート長、曲がり数、既存 wire 交差数の重みを設定可能にする。
5. 自動ルートは確定前の preview に留め、確定後は通常の `points` 配列として保存する。

**受入条件**

- Enter、Backspace、Esc、Undo の各操作で仮点や仮 wire が残らない。
- 自動候補は locked bounds を横切らず、既存の wire split/join、番号、DXF 出力で通常 wire と同じ結果になる。

### F-07. パラメータ付き回路・ページテンプレート

**根拠**

- ユーザー回路は選択要素を `deepClone` して静的 template として保存する。根拠: [`registerSelectedAsSymbol()` L11438-L11473](../index.html#L11438-L11473)
- 配置時は座標 offset を加えてそのまま複製する。根拠: [`placeTemplates()` L7751-L7795](../index.html#L7751-L7795)
- 組込ページ template も固定 action である。取扱説明書の現行仕様: [manual.md L1085-L1103](manual.md#L1085-L1103)

**実際に何をするか**

1. template schema を `kind(page/circuit)`、`name`、`category`、`description`、`preview`、`params[]`、`elements`、`pageSettings`、`version` へ拡張する。
2. `${TAG_START}`、`${WIRE_PREFIX}`、`${ADDRESS_START}`、`${INSTALLATION}`、`${LOCATION}` 等を対象文字列へ展開する resolver を作る。
3. 配置前フォームで値、採番範囲、既存タグとの競合を preview し、確定時に stable ID を再生成する。
4. 現在ページ全体または選択回路から登録し、SVG thumbnail を自動生成する。
5. 標準パックへ同梱し、schema version migration を追加する。

**受入条件**

- 同じ template を異なる開始タグ/線番で複数回配置しても ID とタグが意図せず重複しない。
- 未指定 parameter、型不一致、既存タグ競合を確定前に表示する。
- 旧 static template は migration なしでも従来どおり置ける。

### F-08. DXF 取込プレビューと往復精度向上

**根拠**

- DXF 取込は file を解析後、現在ページへ直ちに要素を追加する。根拠: [`index.html` L10538-L10558](../index.html#L10538-L10558)
- 対応 entity は LINE/CIRCLE/TEXT/ARC/LWPOLYLINE で、ARC は12分割線、全要素は同じ import layer/現在 stroke、現在ページ高さ基準で Y 反転される。根拠: [`dxfEntitiesToElements()` L10561-L10633](../index.html#L10561-L10633)、[manual.md L1562-L1566](manual.md#L1562-L1566)
- DXF 出力は別 dispatch を持つ。根拠: [`buildDxf()` L14563-L14570](../index.html#L14563-L14570)、[`dxfElement()` L14714](../index.html#L14714)

**実際に何をするか**

1. 取込前に entity 数、DXF layer、bounds、unit 候補、未対応 entity を集計する。
2. unit/scale、原点、Y 軸、中央配置/用紙へ fit、DXF layer→本ツール layer の mapping を preview 画面で選ぶ。
3. ARC は可能なら arc element として保持し、LWPOLYLINE の bulge、MTEXT、POLYLINE、INSERT は fixture を用意して段階対応する。
4. 未対応 entity は無視件数だけでなく layer/handle/type を一覧化し、元 DXF を失わず再試行できるようにする。
5. 確定時に一括追加し、取消と1回 Undo を保証する。
6. 本ツール→DXF→再取込の golden fixture で、座標 tolerance、layer、文字、円弧、線種を検証する。

**受入条件**

- 取込確定前に状態が変わらず、用紙外配置を preview で判別できる。
- 対応 entity の round-trip が定義した座標 tolerance 内に収まり、未対応項目は件数ゼロと誤表示しない。

### F-09. 改訂差分帳票と検図・承認記録

**根拠**

- 現在の図面差分は要素 ID 基準で追加・変更・削除を数えるが、変更項目ごとの旧値/新値を帳票用データとして保持しない。根拠: [`index.html` L10434-L10468](../index.html#L10434-L10468)
- 差分 UI はページ別件数と重ね表示が中心で、CSV/改訂差分表の出力がない。根拠: [`index.html` L10470-L10535](../index.html#L10470-L10535)
- 改訂履歴の主項目は `rev`、`date`、`note` で、作成・検図・承認者や基準版 hash を持たない。根拠: [`index.html` L13345-L13387](../index.html#L13345-L13387)
- 帳票 CSV にも対象改訂、生成日時、承認状態を示す共通 metadata がない。根拠: [`index.html` L12919-L12928](../index.html#L12919-L12928)

**実際に何をするか**

1. 差分を `{pageId, elementId, operation, before, after, fields[]}` で保持し、field ごとの旧値/新値を生成する。
2. 要素だけでなく、ページ名、表題欄、project 属性、layer/wire type/standard 設定の変更も分類する。
3. 「ページ / タグ / 操作 / 項目 / 旧値 / 新値」を CSV と印刷用改訂差分表へ出す。
4. 改訂履歴へ `author`、`checker`、`approver`、各日時、`baselineDigest`、`currentDigest`、`auditSummary` を追加する。
5. key order と一時 state を除外して正規化した document JSON を SHA-256 化し、承認後に変更されたら「検図・承認後に変更あり」と表示する。
6. 初期実装は業務上の記名記録であり、法的な電子署名ではないことを UI と manual に明記する。証明書署名は別 scope にする。

**受入条件**

- 線番、tag、page 名、表題欄の変更で旧値/新値が出る。
- 画面、CSV、印刷表の追加/変更/削除件数が一致する。
- 承認後に1文字でも文書が変わると digest 不一致になる。
- 誰が、いつ、どの基準版と監査結果を承認したか追跡できる。

### U-01. フォーカス管理、高コントラスト、非色依存表示

**根拠**

- dialog は `role="dialog"` / `aria-modal` を持つが、`openDialog()` / `closeDialog()` は表示切替のみである。根拠: [`index.html` L1207-L1217](../index.html#L1207-L1217)、[`openDialog()` L14532-L14542](../index.html#L14532-L14542)
- context menu も `role="menu"` はあるが、各項目の keyboard navigation と focus 復帰が不足している。
- `prefers-reduced-motion` は実装済みだが、`forced-colors`、`prefers-contrast`、UI 倍率はない。根拠: [`index.html` L906-L912](../index.html#L906-L912)
- 既定 wire 種別は色の違いへの依存が大きい。根拠: [`index.html` L1663-L1667](../index.html#L1663-L1667)

**実際に何をするか**

1. dialog に `aria-labelledby="dialogTitle"` を付け、open 時に直前 focus を保存、最初の操作要素へ focus、Tab/Shift+Tab trap、Esc close、close 後に focus 復帰する。背景は `inert` にする。
2. context menu item に role/tabindex を付け、上下矢印、Home/End、Enter、Esc の roving tabindex を実装する。
3. palette item を button または option とし、キーボードで候補移動・選択できるようにする。現状の palette DOM 根拠: [`renderPalette()` L2038-L2113](../index.html#L2038-L2113)
4. `settings.accessibility = {theme, uiScale, nonColorCues}` を追加する。
5. 安全線=二重線、動力線=長破線など、色以外の pattern と凡例を用意する。選択/監査重大度も枠形状・icon・文字を併用する。

**受入条件**

- mouse を使わず、dialog を開く→全操作へ移動→閉じる→元ボタンへ戻る操作ができる。
- high contrast/forced colors で、選択、警告、wire 種別を色だけに頼らず識別できる。
- UI 125%/150% で主要操作が重ならず、横 scroll だけに依存しない。

## 6. P1～P2: 基盤・性能・保守性

### A-01. 文書・画面・一時状態の分離と action 化

**根拠**

- 単一 `state` に文書情報と `activePageId`、zoom 等が混在し、selection、tool、drag、clipboard、history は別 global である。根拠: [`index.html` L1637-L1693](../index.html#L1637-L1693)
- tab 切替は `activePageId` を直接変えて履歴へ積まず、zoom は条件により履歴へ入る。根拠: [`renderTabs()` L2245-L2257](../index.html#L2245-L2257)、[`setZoom()` L6047-L6051](../index.html#L6047-L6051)
- 各変更箇所が `commitHistory()` と `render()` を個別に呼ぶため、新機能で片方を忘れる余地がある。

**実際に何をするか**

1. `documentState`: project、pages、layers、wireTypes、catalog、customSymbols 等。
2. `viewState`: activePageId、selection、zoom、paletteFilter、activeTool、panel state 等。
3. `runtimeState`: drag、clipboard、file handle、DOM refs、cache 等。
4. `dispatch(action)` と `mutateDocument(reason, fn)` を導入し、履歴、dirty、cache invalidation、render scheduling を一元化する。
5. 複数変更は `batchAction()` で1つの Undo 単位にする。既存関数は adapter から段階移行する。

**受入条件**

- tab/zoom/selection だけの変更では文書 JSON と Undo が変わらない。
- 文書 action は必ず dirty、履歴、必要 cache、描画を更新する。
- 既存 JSON の出力項目は互換性を維持する。

### A-02. IndexedDB と画像 asset 分離

**根拠**

- 自動 backup は localStorage に最新 + 3世代を全量保存する。根拠: [`index.html` L1809-L1846](../index.html#L1809-L1846)
- `commitHistory()` は操作ごとに `JSON.stringify(state)` し、同じ snapshot を同期的に localStorage へ書く。根拠: [`commitHistory()` L1849-L1876](../index.html#L1849-L1876)
- browser project store は全 project を1つの localStorage key にまとめ、各 snapshot も全量 JSON である。根拠: [`readProjectStore()` / `writeProjectStore()` L11671-L11689](../index.html#L11671-L11689)、[`storeCurrentProject()` L11698-L11710](../index.html#L11698-L11710)
- 下絵は base64 Data URL を要素の `imageData` に持つ。根拠: [`buildUnderlayImageElement()` L11942-L11968](../index.html#L11942-L11968)

**実際に何をするか**

1. IndexedDB に `projects`、`revisions`、`assets` store を設ける。
2. 下絵 element は `assetId` と crop/transform のみ持ち、Blob は `assets` へ content hash 単位で1回保存する。
3. project/revision/asset 更新を transaction 化し、`navigator.storage.estimate()` の使用量を project 管理画面へ表示する。
4. 旧 `imageData` は初回読込時に Blob 化する。JSON export は互換用の asset 埋込 mode を残す。
5. 大規模案件用に `.edsproj` package を追加し、`project.json`、`assets/`、hash と版を持つ `manifest.json` を1つの ZIP に格納する。
6. 参照されない asset は ref count または安全な GC で削除する。

**受入条件**

- 同じ下絵を複製・世代保存しても Blob 本体が重複しない。
- 旧 JSON、旧 localStorage backup を移行でき、失敗時は旧データを消さない。
- `.edsproj` の保存→読込で画像 pixel、crop、位置、回転、透明度が一致し、欠落 asset は placeholder と警告で示す。
- 容量不足を保存失敗後ではなく事前に表示できる。

### A-03. checkpoint + 差分 Undo

**根拠**

- Undo は最大60件の全量 JSON snapshot である。根拠: [`HISTORY_LIMIT` / `commitHistory()` L1803-L1862](../index.html#L1803-L1862)
- 復元も JSON 全量 parse である。根拠: [`restoreHistory()` L1917-L1924](../index.html#L1917-L1924)
- 下絵画像も state 内にあるため、同じ base64 が最大60回 memory に複製され得る。

**実際に何をするか**

1. A-01 の各 action が forward/inverse patch を返すようにする。
2. 20操作ごと等に checkpoint を置き、それ以外は patch で保持する。
3. 同じ選択の矢印移動、同じ field の連続入力は300～500msで coalesce する。
4. 上限を件数だけでなく推定 byte 数でも管理する。
5. view state と asset Blob は履歴対象外にする。

**受入条件**

- 現行の代表操作すべてで Undo/Redo 後の document JSON が期待値と一致する。
- 画像を含む大規模 fixture で、60全量 snapshot より memory 使用量と commit 時間が減る。
- history timeline の理由・時刻・任意時点 jump を維持する。

### A-04. 開発ソースのモジュール分割と要素レジストリ

**根拠**

- 16,000行超の単一 HTML に状態、描画、入出力、監査、event 登録が集中している。`attachEvents()` だけでも [L15769-L16031](../index.html#L15769-L16031) に及ぶ。
- 要素追加時は既定値、layer、SVG、DXF、anchor、inspector、監査を複数箇所で更新する。根拠: [`drawElement()` L2763-L2868](../index.html#L2763-L2868)、[`supportsElectricalAttributes()` L7012-L7016](../index.html#L7012-L7016)、[`defaultElement()` L7157-L7244](../index.html#L7157-L7244)、[`dxfElement()` L14714](../index.html#L14714)
- 主要形状は `SYMBOL_GEO` へ寄せているが、対象外は旧経路も残る。根拠: [`index.html` L1245-L1249](../index.html#L1245-L1249)

**実際に何をするか**

1. 純粋処理から `src/core/schema.js`、`geometry.js`、`netlist.js`、`audit.js` へ抽出する。
2. 次に `src/render/svg.js`、`src/io/dxf.js`、`src/persistence/project-store.js` を分ける。
3. `ELEMENT_DEFINITIONS[type]` に `defaults`、`defaultLayer`、`bounds`、`anchors`、`inspectorFields`、`svgRenderer`、`dxfRenderer`、`capabilities` を集約する。
4. 既存 type は legacy adapter で1種類ずつ移行し、一括 rewrite を避ける。
5. esbuild 等で IIFE と CSS/markup を単一 HTML へ inline し、生成物を release artifact とする。

**受入条件**

- 「palette にある全 type が defaults/SVG/DXF/anchor 定義を持つ」整合テストが通る。
- build 後の `index.html` は file open で offline 起動し、外部 request を行わない。
- source map または build metadata から不具合箇所を追跡できる。

### A-05. 図枠・帳票・監査定義の標準パック外部化

**根拠**

- `compact` / `detailed` 表題欄は既に JSON 駆動で、標準パックにも含まれる。根拠: [`index.html` L2437-L2554](../index.html#L2437-L2554)、[`index.html` L10298-L10299](../index.html#L10298-L10299)
- 一方、側帯、目次、設備標準図枠には固定描画が残る。根拠: [`index.html` L2556-L2605](../index.html#L2556-L2605)
- DXF 側の図枠・表題欄も別の固定実装を持ち、画面用 `titleLayouts` と完全には共通化されていない。根拠: [`index.html` L14607-L14709](../index.html#L14607-L14709)
- 帳票 column 候補と監査 rule 定義にもコード固定部分がある。根拠: [`index.html` L12941-L12953](../index.html#L12941-L12953)、[`AUDIT_RULES` L14247-L14255](../index.html#L14247-L14255)
- 要件は図枠、表題欄、記号、線番、端子表、帳票、監査、表示 style を分離して標準パック化する方針である。根拠: [requirements.md L220-L233](requirements.md#L220-L233)

**実際に何をするか**

1. `frameDefinitions` を line、rect、text、field、table、repeat-row の座標 primitive で定義する。
2. 同じ normalized definition を SVG renderer と DXF renderer に渡し、`ladder`、`side`、`index`、`compact`、`detailed` を順次移行する。
3. `reportDefinitions` に安定した field ID、表示名、列順、sort、group、filter、小計、file name を持たせ、画面表・CSV・挿入表を同じ row model から生成する。
4. `auditProfiles` に rule ID、severity、threshold、例外条件、説明を持たせ、F-02 の waiver/fix と接続する。
5. 標準パック適用前に sample page を SVG と DXF の双方で preview し、欠落 field と用紙外 primitive を検査する。
6. app が必須とする安全な primitive/schema と、pack が上書きできる appearance/rule を分ける。任意 script は pack に許可しない。

**受入条件**

- コード変更なしで表題欄の罫線、項目、改訂欄、帳票見出し、監査 severity を変更できる。
- 同じ custom 図枠が画面、PDF、SVG、DXF で同じ座標・文字内容になる。
- 画面一覧、CSV、挿入表の行数と値が一致する。
- 「組込標準へ戻す」で定義と表示が完全に初期状態へ戻る。

### A-06. 差分 SVG 描画、空間 index、Web Worker

**根拠**

- `render()` の light mode でも canvas は再描画され、`drawPageSvg()` は `svg.innerHTML = ""` で全要素を再構築する。根拠: [`render()` L2281-L2292](../index.html#L2281-L2292)、[`drawPageSvg()` L2297-L2318](../index.html#L2297-L2318)
- pointer move 中にも light render が呼ばれる。根拠: [`index.html` L16212-L16238](../index.html#L16212-L16238)
- snap は候補 anchor/segment を全要素から集め、wire net は wire pair を比較する。根拠: [`snapPoint()` L7285-L7302](../index.html#L7285-L7302)、[`collectSnapAnchors()` L7311-L7359](../index.html#L7311-L7359)、[`closestSegmentSnapPoint()` L7373-L7386](../index.html#L7373-L7386)、[`buildWireNets()` L12212-L12247](../index.html#L12212-L12247)
- 全ページ採番、監査、DXF 生成は UI thread 上の同期処理である。根拠: [`autoWireNumbers()` L12279-L12343](../index.html#L12279-L12343)、[`auditProject()` L14293-L14475](../index.html#L14293-L14475)、[`buildDxf()` L14563-L14570](../index.html#L14563-L14570)

**実際に何をするか**

1. SVG を `underlays/grid/frame/elements/overlay` の固定 group に分け、`data-id` で変更要素だけ更新する。
2. drag 中は選択 group の transform と overlay だけ動かし、pointer up で model を確定する。pointer move は `requestAnimationFrame` で1 frame にまとめる。
3. page ごとに `byId` Map、bounds uniform grid、connection point grid、segment grid を持ち、action の変更 ID だけ更新する。
4. wire net は端点 hash と segment bucket から候補だけを Union-Find へ渡す。
5. 大規模時だけ監査、net、DXF を Worker へ送り、進捗、取消、document revision 不一致時の破棄を実装する。
6. 現行全走査版と index 版の結果一致テストを用意してから切り替える。

**受入条件**

- 初期性能目標として、1ページ1,000要素 fixture の drag/pan 中 pointer 応答 p95 を32ms以下とし、測定値を CI artifact に残す。
- snap/net/audit の結果が現行アルゴリズムと一致する。
- Worker 処理中も UI が操作でき、取消後に古い結果を適用しない。

### U-02. コマンドパレットと可変・折り畳みパネル

**根拠**

- 機能 menu は多数の action を持ち、実行 Map と UI option が別管理である。根拠: [`index.html` L1020-L1077](../index.html#L1020-L1077)、[`index.html` L15846-L15895](../index.html#L15846-L15895)
- main layout は左260px、右304pxの固定列で、screen 幅向け media query はなく、print と reduced motion が中心である。根拠: [`index.html` L227](../index.html#L227)、[`index.html` L559-L598](../index.html#L559-L598)、[`index.html` L906-L912](../index.html#L906-L912)

**実際に何をするか**

1. `commandRegistry = [{id,label,group,keywords,shortcut,isEnabled,run}]` に上部操作、menu、template action を統合する。
2. Ctrl+K で検索、最近使用、お気に入り、disabled 理由を表示する。既存 select は同じ registry から生成して残す。
3. CSS grid 幅を `--left-panel-width` / `--right-panel-width` にし、keyboard 操作可能な splitter と左右 collapse button を追加する。
4. panel 幅と開閉は view state/local preference に保存し、狭い幅では片側 drawer へ切り替える。

**受入条件**

- registry 登録 action は command palette と既存 menu の双方から同じ enabled 判定で実行される。
- 1024px 幅、UI 150%でも canvas が消えず、左右 panel を keyboard で開閉・resize できる。

### D-01. 実装状況・説明書・リリース検査の一元化

**根拠**

- `implementation-plan.md` は最終 manual PDF を未完としているが、`docs/PDF/manual.pdf` は存在する。根拠: [implementation-plan.md L21](implementation-plan.md#L21)、[implementation-plan.md L214-L215](implementation-plan.md#L214-L215)
- 同計画は表題欄 layout 外部化を残課題とする一方、申し送りは compact/detailed のデータ駆動化を完了と記録している。根拠: [implementation-plan.md L168-L169](implementation-plan.md#L168-L169)、[implementation-handover.md L299-L316](implementation-handover.md#L299-L316)
- 実装済み機能が「次にやるなら」に残る箇所もあり、文書ごとの更新時点が異なる。根拠: [implementation-handover.md L290-L297](implementation-handover.md#L290-L297)、[implementation-handover.md L318-L357](implementation-handover.md#L318-L357)

**実際に何をするか**

1. `docs/feature-matrix.json` 等を唯一の状態 source とし、機能 ID、実装状態、manual 節、test ID、対応 commit、制約を持たせる。
2. 実装計画の checklist、manual の機能索引、release checklist を matrix から生成または検査する。
3. CI で manual image link、PDF 更新日時、feature→test→manual の欠落を検出する。
4. 完了済み計画は archive し、現在の backlog と受入未確認を分ける。

**受入条件**

- 「実装済み / manualあり / testあり / 目視受入済み」を1箇所で判定できる。
- PDF または画像が古い場合、release 前に CI が検出する。

## 7. 推奨実装順と依存関係

### 第1段階: 事故防止（1人で約4～6週間）

1. R-02 Esc / Ctrl+Z 修正
2. R-01 の即時 round-trip bug 修正
3. R-04 の最小 test 基盤を作り、1・2の再現 test を固定
4. R-03 入出力 guard
5. R-05 置換 preview
6. R-06 標準パック安全取込

### 第2段階: 業務品質（1人で約5～8週間）

1. F-01 CSV wizard
2. F-02 監査 workflow
3. F-03 dirty / save
4. F-04 network highlight
5. U-01 focus / contrast
6. F-09 改訂差分 / 検図記録

### 第3段階: 基盤整理と作図高速化（1人で約10～16週間）

1. A-01 state/action 分離
2. A-04 pure core と element registry の段階分割
3. A-05 図枠 / 帳票 / 監査定義の共通化
4. A-02 IndexedDB / assets
5. A-03 patch history
6. F-05 precision selection、F-06 wiring、F-07 parameterized templates、F-08 DXF

### 第4段階: 大規模案件（実測後）

1. 大規模 fixture と性能 baseline を R-04 に追加
2. A-06 の差分 SVG
3. 空間 index
4. 閾値を超える処理だけ Worker 化
5. U-02 command/panel、D-01 documentation governance

依存関係の要点は次のとおりである。

```text
R-04 テスト基盤 ─┬─ R-01 読込統一
                 ├─ F-08 DXF往復
                 └─ A-04 モジュール分割

A-01 action化 ───┬─ A-03 差分Undo
                 ├─ A-06 差分描画・index
                 └─ F-02 一括クイック修正

A-02 asset分離 ─── A-03 履歴軽量化
```

## 8. 今は優先しない項目

以下は技術的に不可能とは限らないが、現行の「単一 HTML・offline・server 不要」という製品範囲では費用対効果が低い。

- **DWG binary の完全往復**: 専用 library/licensing/検証環境を別 project として評価する。現状は DXF 往復精度を先に上げる。
- **server 必須の同時共同編集・中央 DB**: 認証、競合解決、監査 log、運用基盤が必要で、現行配布形態とは別製品 scope になる。
- **PLC メーカー実 database の内蔵**: 更新責任と license を決めてから connector/package として扱う。固定データを単一 HTML に埋め込まない。
- **参照図面54ページの完全一致を「機能実装」で代替**: 機械検査済み部分とは別に、最終的な人手 overlay 受入を完了させる。根拠: [scan-reproduction-checklist.md L139-L142](scan-reproduction-checklist.md#L139-L142)、[implementation-handover.md L336-L339](implementation-handover.md#L336-L339)

## 9. 最初のリリースの完了定義

最初の改善リリースは、次をすべて満たした時点で完了とする。

- JSON 保存→読込で、正式な全 document field が保持される。
- 未来版/破損 JSON は現在図面を変えずに停止する。
- Esc と入力欄 Ctrl+Z/Y の自動テストが通る。
- 置換は preview と選択適用を経由し、1回 Undo できる。
- 標準パックは検証と差分 preview 後に transaction 適用される。
- 破損・巨大入力で page/element/history を中途半端に追加しない。
- 主要 E2E、SVG/DXF golden、manual link check が CI で通る。
- 変更機能の `docs/manual.md` と `docs/PDF/manual.pdf` が同じ release で更新される。

この完了定義を先に満たせば、その後の機能追加や内部構造変更を、現行の保存互換性と作図結果を守りながら進められる。
