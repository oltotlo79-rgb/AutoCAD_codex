# 章ごとの撮影ジョブ

`docs/tools/capture-manual-screenshots.js` が起動時にこのフォルダの `*.js` を読み込みます。
各ファイルは次のように撮影ジョブを登録します（ファイル名は章番号で始めると並びが分かりやすくなります）。

```js
const { job, freshPage, shot, shotDialog } = require("../capture-manual-screenshots.js");

job(["85-example.png"], async browser => {
  const { context, page } = await freshPage(browser);
  // …画面を操作…
  await shot(page, "85-example.png");
  await context.close();
});
```

撮り直し: `node docs/tools/capture-manual-screenshots.js 85`（ファイル名に「85」を含む画像だけ）。
