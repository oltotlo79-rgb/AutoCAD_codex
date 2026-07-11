# -*- coding: utf-8 -*-
"""docs/manual.md から docs/PDF/manual.pdf を生成するビルドスクリプト。

使い方:
    python docs/tools/build-manual-pdf.py

必要環境:
    - Python 3 + markdown パッケージ (pip install markdown)
    - PyMuPDF (pip install pymupdf) … ページ番号の型押しと目次リンク検証に使用
      (無ければ番号なし・リンク未検証で完成)
    - Google Chrome (ヘッドレス印刷に使用)

処理の流れ:
    manual.md → (markdown変換+表紙/リンク付き目次/コールアウト装飾) → HTML
             → Chrome headless print-to-pdf → PyMuPDFでページ番号を型押し・目次リンク検証
"""
import datetime
import html as html_lib
import pathlib
import re
import subprocess
import sys
import tempfile

import markdown

REPO = pathlib.Path(__file__).resolve().parents[2]
MD_PATH = REPO / "docs" / "manual.md"
PDF_PATH = REPO / "docs" / "PDF" / "manual.pdf"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_URI = MD_PATH.parent.as_uri().rstrip("/") + "/"

ACCENT = "#0f6f63"      # 深緑(アプリのアクセント色と同じ)
ACCENT_LIGHT = "#e3efec"
ACCENT2 = "#d96332"     # 補助色(オレンジ)
INK = "#1a232c"

md_text = MD_PATH.read_text(encoding="utf-8")

# Markdownから参照しているローカル画像を、PDF生成前に検査する。
# 誤記したパスのまま「画像だけ抜けたPDF」を配布しないための事前チェック。
missing_images = []
for image_source in re.findall(r'!\[[^\]]*\]\(([^)\s]+)', md_text):
    if re.match(r"^[a-z]+://", image_source, flags=re.I):
        continue
    image_path = MD_PATH.parent.joinpath(*pathlib.PurePosixPath(image_source).parts)
    if not image_path.is_file():
        missing_images.append(image_source)
if missing_images:
    raise FileNotFoundError("manual image not found: " + ", ".join(missing_images))

# ---- 本文をHTMLへ変換 ----
renderer = markdown.Markdown(
    extensions=["tables", "fenced_code", "attr_list", "toc"],
    extension_configs={"toc": {"toc_depth": "2-3", "marker": ""}},
)
body = renderer.convert(md_text)

# ---- 本文と同じ見出しIDから、クリック可能な目次を作る(h2=章, h3=節) ----
def iter_toc(items):
    for item in items:
        yield item
        yield from iter_toc(item.get("children", []))


toc_items = list(iter_toc(renderer.toc_tokens))
toc_html_parts = []
for item in toc_items:
    cls = "toc-chapter" if item["level"] == 2 else "toc-section"
    target = html_lib.escape(item["id"], quote=True)
    label = html_lib.escape(html_lib.unescape(item["name"]))
    toc_html_parts.append(f'<a class="{cls}" href="#{target}">{label}</a>')
toc_html = "\n".join(toc_html_parts)

# 先頭の h1(書名)は表紙で表現するため除去
body = re.sub(r"^<h1\b[^>]*>.*?</h1>\s*", "", body, count=1, flags=re.S)
# コールアウト: 💡/⚠️ で始まる引用をヒント/注意ボックスへ
body = body.replace("<blockquote>\n<p>💡", '<blockquote class="hint">\n<p>💡')
body = body.replace("<blockquote>\n<p>⚠️", '<blockquote class="warn">\n<p>⚠️')

# 単独行の画像を図版へ変換し、title（なければalt）をキャプションに使う。
def image_to_figure(match):
    image_tag = match.group(1)
    title_match = re.search(r'\stitle="([^"]*)"', image_tag)
    alt_match = re.search(r'\salt="([^"]*)"', image_tag)
    caption = html_lib.unescape((title_match or alt_match).group(1)) if (title_match or alt_match) else ""
    caption_html = f"<figcaption>{html_lib.escape(caption)}</figcaption>" if caption else ""
    return f"<figure>{image_tag}{caption_html}</figure>"

body = re.sub(r"<p>(<img\b[^>]*>)</p>", image_to_figure, body)

today = datetime.date.today().strftime("%Y-%m-%d")

# 表紙の回路モチーフ(ラダー図風のあしらい)
cover_svg = """
<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" style="width:96mm;height:58mm;opacity:.9">
  <g stroke="#ffffff" stroke-width="1.1" fill="none" stroke-linecap="round">
    <line x1="14" y1="8" x2="14" y2="112"/>
    <line x1="186" y1="8" x2="186" y2="112"/>
    <line x1="14" y1="28" x2="78" y2="28"/><line x1="94" y1="28" x2="150" y2="28"/><line x1="164" y1="28" x2="186" y2="28"/>
    <rect x="78" y="22" width="4.5" height="12" fill="#ffffff"/><rect x="89.5" y="22" width="4.5" height="12" fill="#ffffff"/>
    <circle cx="157" cy="28" r="7"/>
    <line x1="14" y1="58" x2="60" y2="58"/><line x1="76" y1="58" x2="118" y2="58"/><line x1="132" y1="58" x2="186" y2="58"/>
    <rect x="60" y="52" width="4.5" height="12" fill="#ffffff"/><rect x="71.5" y="52" width="4.5" height="12" fill="#ffffff"/>
    <circle cx="125" cy="58" r="7"/><line x1="120" y1="53" x2="130" y2="63"/><line x1="130" y1="53" x2="120" y2="63"/>
    <line x1="14" y1="88" x2="46" y2="88"/><line x1="62" y1="88" x2="186" y2="88"/>
    <circle cx="54" cy="88" r="8"/><line x1="49" y1="83" x2="59" y2="93"/><line x1="59" y1="83" x2="49" y2="93"/>
    <circle cx="100" cy="88" r="2.2" fill="#ffffff"/>
    <line x1="100" y1="88" x2="100" y2="104"/><line x1="92" y1="104" x2="108" y2="104"/>
    <line x1="95" y1="108" x2="105" y2="108"/><line x1="98" y1="112" x2="102" y2="112"/>
  </g>
</svg>
"""

html = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="{BASE_URI}">
<title>Electrical Drawing Studio 取扱説明書</title>
<style>
  @page {{ size: A4; margin: 17mm 15mm 19mm 15mm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: "Yu Gothic UI", "Meiryo", sans-serif;
    font-size: 10pt; line-height: 1.78; color: {INK};
    margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}

  /* ===== 表紙 ===== */
  .cover {{
    height: 255mm;
    border-radius: 6mm;
    background: linear-gradient(150deg, #0d5d53 0%, {ACCENT} 45%, #17877a 78%, #1e9e8e 100%);
    color: #fff;
    padding: 22mm 18mm;
    display: flex; flex-direction: column;
    page-break-after: always;
    position: relative; overflow: hidden;
  }}
  .cover .doc-kind {{
    display: inline-block; align-self: flex-start;
    border: 1.6px solid rgba(255,255,255,.85); border-radius: 999px;
    padding: 2px 16px; font-size: 11pt; letter-spacing: .35em; text-indent: .35em;
  }}
  .cover h1 {{ font-size: 27pt; line-height: 1.4; margin: 14mm 0 2mm; letter-spacing: .02em; }}
  .cover .subtitle {{ font-size: 13.5pt; opacity: .92; margin-bottom: 4mm; }}
  .cover .lead {{ font-size: 10.5pt; opacity: .88; line-height: 2.0; }}
  .cover .art {{ margin-top: auto; text-align: right; }}
  .cover .meta {{
    border-top: 1px solid rgba(255,255,255,.5); padding-top: 4mm; margin-top: 6mm;
    display: flex; justify-content: space-between; font-size: 9.5pt; letter-spacing: .08em;
  }}
  .cover .stripe {{
    position: absolute; right: -18mm; top: -18mm; width: 66mm; height: 66mm;
    background: {ACCENT2}; opacity: .18; border-radius: 50%;
  }}

  /* ===== 目次 ===== */
  .toc {{ page-break-after: always; }}
  .toc h2.toc-title {{
    background: none; color: {ACCENT}; padding: 0 0 6px; margin: 0 0 16px;
    font-size: 17pt; border-bottom: 3px solid {ACCENT};
  }}
  .toc-columns {{ column-count: 2; column-gap: 10mm; }}
  .toc-chapter, .toc-section {{ display: block; text-decoration: none; }}
  .toc-chapter {{
    font-weight: 700; font-size: 10.2pt; color: {INK};
    margin: 9px 0 3px; padding: 3px 8px;
    background: {ACCENT_LIGHT}; border-left: 3.5px solid {ACCENT}; border-radius: 2px;
    break-inside: avoid;
  }}
  .toc-section {{ font-size: 9pt; color: #45525e; margin: 1.5px 0 1.5px 14px; }}

  /* ===== 見出し ===== */
  h2 {{
    page-break-before: always; page-break-after: avoid;
    background: linear-gradient(92deg, {ACCENT} 0%, #17877a 100%);
    color: #fff; font-size: 15.5pt; letter-spacing: .03em;
    padding: 9px 16px; border-radius: 4px; margin: 0 0 4px;
    border-bottom: 3.5px solid {ACCENT2};
  }}
  h2:first-of-type {{ page-break-before: avoid; }}
  h3 {{
    font-size: 12pt; color: {ACCENT}; margin: 22px 0 6px;
    padding-left: 10px; border-left: 4.5px solid {ACCENT2};
    page-break-after: avoid;
  }}
  h4 {{ font-size: 10.7pt; color: #24483f; margin: 15px 0 5px; page-break-after: avoid; }}
  p {{ margin: 7px 0; text-align: justify; orphans: 2; widows: 2; }}

  /* ===== コールアウト ===== */
  blockquote {{
    margin: 10px 0; padding: 8px 14px; border-radius: 4px;
    background: #f3f5f7; border-left: 4.5px solid #93a3b1;
    page-break-inside: avoid;
  }}
  blockquote p {{ margin: 2px 0; }}
  blockquote.hint {{ background: {ACCENT_LIGHT}; border-left-color: {ACCENT}; }}
  blockquote.warn {{ background: #fbeee7; border-left-color: {ACCENT2}; }}

  /* ===== 表 ===== */
  table {{
    border-collapse: collapse; width: 100%; margin: 10px 0;
    font-size: 9.3pt; line-height: 1.7; page-break-inside: avoid;
  }}
  thead {{ display: table-header-group; }}
  tr {{ page-break-inside: avoid; }}
  th {{
    background: {ACCENT}; color: #fff; font-weight: 600;
    padding: 5px 9px; text-align: left; border: 1px solid {ACCENT};
  }}
  td {{ border: 1px solid #c8d4d1; padding: 4.5px 9px; vertical-align: top; }}
  tr:nth-child(even) td {{ background: #f4f8f7; }}

  /* ===== コード/図解 ===== */
  code {{
    background: {ACCENT_LIGHT}; color: #0b4a42;
    padding: 1px 6px; border-radius: 3px; font-size: 9.3pt;
    font-family: "Consolas", "Yu Gothic UI", monospace;
  }}
  pre {{
    background: #f4f7f6; border: 1px solid #d5e0dd; border-left: 4.5px solid {ACCENT};
    border-radius: 4px; padding: 10px 14px; overflow-x: hidden;
    page-break-inside: avoid;
  }}
  pre code {{ background: none; padding: 0; color: {INK}; font-size: 8.8pt; line-height: 1.55; }}
  ul, ol {{ padding-left: 24px; margin: 7px 0; }}
  li {{ margin: 2.5px 0; orphans: 2; widows: 2; }}
  strong {{ color: #0b4a42; }}
  hr {{ border: none; border-top: 1px solid #c8d4d1; margin: 18px 0; }}

  /* ===== 操作画面 ===== */
  figure {{
    margin: 12px auto 16px; padding: 3mm;
    border: 1px solid #cbd8d5; border-radius: 4px;
    background: #f7faf9; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }}
  figure img {{
    display: block; width: auto; height: auto;
    max-width: 100%; max-height: 205mm; margin: 0 auto;
    object-fit: contain; border: 1px solid #b6c5c2; border-radius: 3px;
    box-shadow: 0 2px 7px rgba(21, 53, 47, .14);
  }}
  figure img.shot-full {{ width: 100%; }}
  figure img.shot-wide {{ width: 86%; }}
  figure img.shot-panel {{ max-width: 68%; }}
  figcaption {{
    margin-top: 2.5mm; color: #4c5d59; font-size: 8.4pt;
    line-height: 1.45; text-align: left;
  }}
</style>
</head>
<body>

<div class="cover">
  <div class="stripe"></div>
  <span class="doc-kind">取扱説明書</span>
  <h1>Electrical Drawing Studio</h1>
  <div class="subtitle">ブラウザで動く電気図面作図ツール — 操作マニュアル</div>
  <div class="lead">
    部品を置いて、つないで、印刷するだけ。<br>
    リレー回路図・端子接続図・PLC入出力図・機器配置図を、
    インストール不要の単一HTMLファイルで作図できます。
  </div>
  <div class="art">{cover_svg}</div>
  <div class="meta">
    <span>Electrical Drawing Studio</span>
    <span>発行日 {today}</span>
  </div>
</div>

<div class="toc">
  <h2 class="toc-title">目次</h2>
  <div class="toc-columns">
{toc_html}
  </div>
</div>

{body}
</body>
</html>
"""

with tempfile.TemporaryDirectory() as tmp:
    html_path = pathlib.Path(tmp) / "manual.html"
    html_path.write_text(html, encoding="utf-8")
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--allow-file-access-from-files",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF_PATH}", html_path.as_uri()
    ], check=True)

print(f"PDF written: {PDF_PATH}")

# ---- ページ番号の型押し(表紙を除く)と目次リンク検証 ----
try:
    import fitz  # PyMuPDF
except ImportError as error:  # PyMuPDF が無い環境でも番号なし・未検証で完成させる
    print("page numbering and TOC link verification skipped:", error)
else:
    with fitz.open(PDF_PATH) as doc:
        page_count = doc.page_count
        for i in range(1, page_count):
            page = doc[i]
            w, h = page.rect.width, page.rect.height
            label = str(i + 1)
            page.insert_text((w / 2 - 3 * len(label), h - 24), label,
                             fontsize=9, fontname="helv", color=(0.24, 0.33, 0.31))
            page.draw_line(fitz.Point(42, h - 34), fitz.Point(w - 42, h - 34),
                           color=(0.06, 0.44, 0.39), width=0.7)
        doc.saveIncr()
    print(f"page numbers stamped: 2..{page_count}")

    expected_targets = {item["id"] for item in toc_items}
    with fitz.open(PDF_PATH) as check_doc:
        destinations = check_doc.resolve_names()
        linked_targets = set()
        invalid_links = []
        for source_page, page in enumerate(check_doc):
            for link in page.get_links():
                target = link.get("nameddest")
                if target not in expected_targets:
                    continue
                linked_targets.add(target)
                if (link.get("kind") not in (fitz.LINK_GOTO, fitz.LINK_NAMED)
                        or not 0 <= link.get("page", -1) < check_doc.page_count):
                    invalid_links.append((source_page, target, link))

        missing_destinations = expected_targets - destinations.keys()
        invalid_destinations = {
            target: destinations[target]
            for target in expected_targets & destinations.keys()
            if not 0 <= destinations[target].get("page", -1) < check_doc.page_count
        }
        missing_links = expected_targets - linked_targets

    if missing_destinations or invalid_destinations or missing_links or invalid_links:
        raise RuntimeError(
            "invalid PDF TOC links: "
            f"missing_destinations={sorted(missing_destinations)}, "
            f"invalid_destinations={invalid_destinations}, "
            f"missing_links={sorted(missing_links)}, "
            f"invalid_links={invalid_links}"
        )
    print(f"TOC links verified: {len(expected_targets)}")
