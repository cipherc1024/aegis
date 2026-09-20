import fs from "node:fs";

const src = process.argv[2];
const dst = process.argv[3] || ".tenderly-verify/upload-min.json";
const parsed = JSON.parse(fs.readFileSync(src, "utf8"));
const out = { language: parsed.language, sources: parsed.sources, settings: parsed.settings };
fs.writeFileSync(dst, JSON.stringify(out));
console.log("wrote", dst, fs.statSync(dst).size, "bytes");
