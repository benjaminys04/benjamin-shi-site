# benjaminys.com

A single static page (`index.html`), served from the repo root via Cloudflare.

## Languages

The site is available in five languages. The URL **is** the toggle — just
append the suffix and forward the link:

| Language | URL |
| --- | --- |
| English (canonical) | `https://benjaminys.com/` |
| Chinese | `https://benjaminys.com/ch` |
| Greek | `https://benjaminys.com/gr` |
| Latin | `https://benjaminys.com/lt` |
| Hebrew | `https://benjaminys.com/hb` |

Every page also shows a small language switcher at the bottom.

## How translation stays in sync (you never translate by hand)

`index.html` is the **only** file you edit. Everything else follows
automatically:

1. You edit `index.html` and push to `main`.
2. The **Translate pages** GitHub Action ([.github/workflows/translate.yml](.github/workflows/translate.yml))
   runs [scripts/translate.mjs](scripts/translate.mjs), which sends the new
   page to Claude and regenerates `ch/`, `gr/`, `lt/`, `hb/`.
3. The Action commits the updated translations (commit message ends in
   `[skip ci]`; it only touches the translated folders, so it never
   re-triggers itself).
4. Cloudflare redeploys all five pages.

The translator is instructed to preserve all markup, CSS, JS, URLs and proper
names (your name, brand links, and book authors), translate only the visible
text and book-title meanings, keep the Latin motto in Latin, and set `dir="rtl"`
for Hebrew.

## One-time setup (required)

The Action needs a Claude API key:

1. Get a key at <https://console.anthropic.com/> (the API key starts with `sk-ant-`).
2. In this repo: **Settings → Secrets and variables → Actions → New repository secret**.
3. Name it `ANTHROPIC_API_KEY`, paste the key, save.

That's it. The next push that changes `index.html` will auto-translate. To
regenerate without editing the page, run the workflow manually from the
**Actions** tab (**Run workflow**).

## Running translation locally (optional)

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/translate.mjs
```

Override the model with `TRANSLATE_MODEL` (default `claude-opus-4-8`).

## Adding another language

1. Add an entry to the `LANGS` array in [scripts/translate.mjs](scripts/translate.mjs)
   (`folder` = URL suffix, `htmlLang`, `rtl`, `name`).
2. Add a matching `<a>` to the `.lang-switch` nav in `index.html`.
3. Push — the new folder is generated on the next run.
