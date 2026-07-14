const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);

if (!scripts.length) {
  throw new Error("index.htmlにインラインscriptが見つかりません。");
}

scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    error.message = `index.htmlのscript #${index + 1}: ${error.message}`;
    throw error;
  }
});

console.log(`index.html: ${scripts.length}個のインラインscriptを構文確認しました。`);
