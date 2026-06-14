#!/usr/bin/env node
// Regenerates the translated copies of index.html using the Claude API.
//
// For each target language it sends the canonical English index.html to Claude
// with strict rules (preserve all markup/CSS/JS/URLs, translate only visible
// text, keep proper names) and writes the result to <dir>/index.html.
//
// Run locally:   ANTHROPIC_API_KEY=sk-ant-... node scripts/translate.mjs
// In CI it is invoked by .github/workflows/translate.yml on every push that
// touches index.html.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "index.html");

const MODEL = process.env.TRANSLATE_MODEL || "claude-opus-4-8";
const API_KEY = process.env.ANTHROPIC_API_KEY;

// Target languages. `dir` is the URL/output folder (the toggle in the URL).
const LANGS = [
  { folder: "ch", htmlLang: "zh", rtl: false, name: "Simplified Chinese (Mandarin)" },
  { folder: "gr", htmlLang: "el", rtl: false, name: "Modern Greek" },
  { folder: "lt", htmlLang: "la", rtl: false, name: "Latin" },
  { folder: "hb", htmlLang: "he", rtl: true,  name: "Hebrew" },
];

function buildPrompt(html, lang) {
  const latinMottoRule = lang.htmlLang === "la"
    ? `- This IS the Latin page, so the .latin motto span is already in the page language. Leave the <span class="english"> motto gloss EXACTLY as the original English ("i seek not praise; i fear not blame") — do not change it.`
    : `- Keep the <span class="latin"> motto ("laudem non quaero; culpam non timeo") in Latin, unchanged. Translate ONLY the <span class="english"> gloss into ${lang.name}, rendering the meaning of the Latin ("i seek not praise; i fear not blame").`;

  return `You are an expert literary translator. Translate the following HTML page into ${lang.name}.

Output ONLY the complete, valid HTML document — no markdown, no code fences, no commentary. Begin your response with "<!DOCTYPE html>".

ABSOLUTE RULES — follow every one:
- Preserve the document structure byte-for-byte except for the human-visible natural-language text. Do not touch tag names, attribute names, class names, id values, the <style> block, the <script> blocks, or any inline JS.
- Do NOT translate or modify any URL, href, src, or the data: favicon. Keep all links pointing where they point.
- Translate visible text nodes and these human-readable attributes only: each button's aria-label, and the <nav class="lang-switch"> aria-label.
- Do NOT translate the language-switcher link labels inside <nav class="lang-switch"> (english · 中文 · ελληνικά · latina · עברית). They are endonyms and must stay exactly as-is in every language.
- Do NOT translate proper names: the heading "Benjamin Shi", the <title> "Benjamin Shi", and the brand link texts "twitter", "substack", "linkedin", and "garamond". Leave them exactly as written.
- In the reading list, translate the MEANING of each book title (inside <em>), but keep every author's name in its original Latin spelling, unchanged (e.g. "edward rutherfurd", "ernst jünger", "javier blas"). Translate the conjunction "and" between two authors into ${lang.name}.
${latinMottoRule}
- Match the site's quiet, lowercase aesthetic where it is natural for ${lang.name}; use normal orthography/casing for scripts where lowercase does not apply.
- Produce fluent, accurate, idiomatic ${lang.name} — this is a personal homepage, not a literal gloss.

Here is the page to translate:

${html}`;
}

async function translate(html, lang) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      messages: [{ role: "user", content: buildPrompt(html, lang) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status} for ${lang.folder}: ${body}`);
  }

  const data = await res.json();
  let out = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip accidental markdown fences, if any.
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();

  if (!out.startsWith("<!DOCTYPE")) {
    throw new Error(`Unexpected output for ${lang.folder} (did not start with <!DOCTYPE):\n${out.slice(0, 200)}`);
  }

  // Deterministically force the correct lang/dir on the <html> tag so it never
  // depends on the model getting it right.
  const htmlTag = lang.rtl
    ? `<html lang="${lang.htmlLang}" dir="rtl">`
    : `<html lang="${lang.htmlLang}">`;
  out = out.replace(/<html[^>]*>/i, htmlTag);

  return out + (out.endsWith("\n") ? "" : "\n");
}

async function main() {
  if (!API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const html = await readFile(SOURCE, "utf8");

  for (const lang of LANGS) {
    process.stdout.write(`translating → /${lang.folder} (${lang.name}) … `);
    const translated = await translate(html, lang);
    const dir = resolve(ROOT, lang.folder);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "index.html"), translated, "utf8");
    console.log("done");
  }

  console.log("All translations regenerated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
