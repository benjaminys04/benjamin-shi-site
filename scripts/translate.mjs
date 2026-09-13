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

  const cjkRule = lang.htmlLang === "zh"
    ? `- Chinese typography: never insert a space between Chinese characters, including on either side of an inline <a> link whose text is Chinese (write 我也做<a …>投资</a>。, not 我也做 <a …>投资</a>。). A single space is fine only between Chinese text and a Latin-script word such as "garamond" or an author's name. Use full-width Chinese punctuation (。，：) in Chinese sentences.`
    : "";

  return `You are an expert literary translator. Translate the following HTML page into ${lang.name}.

Output ONLY the complete, valid HTML document — no markdown, no code fences, no commentary. Begin your response with "<!DOCTYPE html>" and end it with "</html>".

ABSOLUTE RULES — follow every one:
- Preserve the document structure byte-for-byte except for the human-visible natural-language text. Do not touch tag names, attribute names, attribute values (including every lang, hreflang, data-path and tabindex value), class names, id values, HTML comments, the <style> block, the <script> blocks, or any inline JS. Keep character entities such as &#xFE0E; exactly as written.
- Do NOT translate or modify any URL, href, src, or the favicon links. Keep all links pointing where they point.
- Translate visible text nodes and these human-readable attributes only: each button's aria-label, the aria-label on the <a class="secret"> link, and the <nav class="lang-switch"> aria-label.
- Do NOT translate the language-switcher link labels inside <nav class="lang-switch"> (english · 中文 · ελληνικά · latina · עברית). They are endonyms and must stay exactly as-is in every language.
- Do NOT translate proper names: the heading "Benjamin Shi", the <title> "Benjamin Shi", and the brand link texts "twitter", "substack", "linkedin", and "garamond". Leave them exactly as written.
- In the reading list, translate the MEANING of each book title (inside <em>), but keep every author's name in its original Latin spelling, unchanged (e.g. "edward rutherfurd", "ernst jünger", "javier blas"). Translate the conjunction "and" between two authors into ${lang.name}.
${latinMottoRule}
${cjkRule}
- Match the site's quiet, lowercase aesthetic where it is natural for ${lang.name}; use normal orthography/casing for scripts where lowercase does not apply.
- Produce fluent, accurate, idiomatic ${lang.name} — this is a personal homepage, not a literal gloss.

Here is the page to translate:

${html}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One attempt per language used to be the whole story: a 429, a 529
// "overloaded" or a dropped connection failed the run, and the four pages
// then kept serving the previous English revision until someone re-ran the
// workflow by hand. Retry the retryable, with backoff and Retry-After.
async function callClaude(prompt, lang) {
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let wait = backoff(attempt);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      // The body reads sit inside the try on purpose: a connection dropped
      // after the headers arrive is just as transient as one dropped before.
      if (res.ok) return await res.json();
      const body = await res.text();
      const retryable = res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
      const err = new Error(`Anthropic API ${res.status} for ${lang.folder} (attempt ${attempt}): ${body}`);
      if (!retryable) err.fatal = true;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) wait = retryAfter * 1000;
      throw err;
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err.message.startsWith("Anthropic API")
        ? err
        : new Error(`network error for ${lang.folder} (attempt ${attempt}): ${err.message}`);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(wait);
    }
  }
  throw lastErr;
}

function backoff(attempt) {
  return Math.min(30_000, 2000 * 2 ** (attempt - 1)) + Math.random() * 1000;
}

// The whole design rests on the <style> and <script> blocks coming back
// byte-identical, and on the page being complete. Check both before writing
// anything: a truncated or slightly "improved" page must fail the run, not
// deploy.
const PROTECTED = /<style[\s\S]*?<\/style>|<script[^>]*>[\s\S]*?<\/script>/g;

function validate(out, source, data, lang) {
  if (data.stop_reason !== "end_turn") {
    throw new Error(`${lang.folder}: response did not finish cleanly (stop_reason ${data.stop_reason})`);
  }
  if (!/^<!doctype html>/i.test(out)) {
    throw new Error(`${lang.folder}: output does not start with <!DOCTYPE html>:\n${out.slice(0, 200)}`);
  }
  if (!/<\/html>\s*$/i.test(out)) {
    throw new Error(`${lang.folder}: output does not end with </html> (truncated?)`);
  }
  const want = source.match(PROTECTED) || [];
  const got = out.match(PROTECTED) || [];
  if (want.length !== got.length) {
    throw new Error(`${lang.folder}: expected ${want.length} style/script blocks, got ${got.length}`);
  }
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== got[i]) {
      throw new Error(`${lang.folder}: style/script block ${i + 1} was altered by the translation`);
    }
  }
  const entity = (s) => (s.match(/&#xFE0E;/g) || []).length;
  if (entity(out) !== entity(source)) {
    throw new Error(`${lang.folder}: the &#xFE0E; text-presentation entities did not survive`);
  }
}

async function translate(html, lang) {
  const data = await callClaude(buildPrompt(html, lang), lang);
  let out = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip accidental markdown fences, if any.
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();

  validate(out, html, data, lang);

  // Deterministically force the correct lang/dir on the <html> tag so it never
  // depends on the model getting it right.
  const htmlTag = lang.rtl
    ? `<html lang="${lang.htmlLang}" dir="rtl">`
    : `<html lang="${lang.htmlLang}">`;
  out = out.replace(/<html[^>]*>/i, htmlTag);

  // On the Latin page the motto gloss stays English inside a lang="la"
  // document; mark it so screen readers switch voice.
  if (lang.htmlLang === "la") {
    out = out.replace('<span class="english">', '<span class="english" lang="en">');
  }

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
