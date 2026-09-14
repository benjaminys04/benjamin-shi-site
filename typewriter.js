/*
 * Typewriter intro — the page opens with just the name, then writes itself.
 *
 * A tiny boot guard inline in <head> hides the page before first paint
 * (html.tw-boot) unless the visitor prefers reduced motion or is a crawler.
 * This script snapshots every line of text, empties it, reveals the page —
 * name only — and types everything back in behind a thin blinking caret,
 * like the site is being written live. The chrome (star, theme switch,
 * language row) fades in at the end. Enter, Escape, or tapping the skip
 * hint finishes instantly.
 *
 * The full text always ships in the HTML, so crawlers and no-JS visitors
 * see the finished page; screen readers get an offscreen copy for the
 * duration of the animation.
 */
(function () {
  "use strict";

  var root = document.documentElement;

  // The boot guard didn't run (reduced motion, crawler) or its failsafe
  // already revealed the page — leave everything alone.
  if (!/\btw-boot\b/.test(root.className)) return;

  // --- Cadence (ms). Unhurried on purpose: the page should feel written. --
  var T = {
    openBlink: 1250,         // caret blinks alone under the name before typing
    charMs: 17,              // typical per-character delay (see charDelay)
    charJitter: 0.22,        // log-normal spread around charMs — a typist's hand
    minCharMs: 16,           // never two characters in one frame
    wordPause: [25, 55],     // extra beat after a space: words, not a stream of letters
    cjkFactor: 2.4,          // CJK characters carry whole words — type slower
    punctPause: [120, 220],  // extra beat after . ; : ! ? …
    dashPause: [70, 130],    // smaller beat after — / ·
    hesitateChance: 0.02,    // occasional mid-word hesitation…
    hesitatePause: [100, 260],
    linePause: [200, 380],   // pause between lines
    sectionPause: 300,       // added on top before a new section starts
    listRhythm: 0.06,        // the reading list gains this much pace per item…
    listRhythmFloor: 0.68,   // …down to this fraction of the base cadence
    gapBlinkMin: 300,        // line gaps at least this long show the idle blink
    caretFade: 350,          // the caret's fade-out when the writing ends (ms)
    skipHintAfter: 1700,     // when the skip hint fades in
    endBlink: 1200,          // final blink before the caret leaves
    chromeStagger: 320,      // gap between star / toggle / language fade-ins
    chromeFade: 650          // matches the 0.6s opacity transition below
  };

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  // Standard normal (Box–Muller), for the log-normal keystroke spread.
  function gauss() {
    var u = 1 - Math.random();
    var v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // --- Styles (injected here so all five language pages share one file) ----
  var CSS = [
    // The caret is positioned geometrically from the last typed glyph, so
    // it lands on the true writing point even in RTL/bidi text.
    // The caret is a thin var(--text) bar — a writing caret, not a terminal
    // block. Its blink is a soft fade, not a hard on/off. Theme changes are
    // single-frame swaps (html.theme-snap freezes all transitions for the
    // flip), so the caret changes color in the same frame as the page.
    ".tw-caret{position:absolute;background:var(--text);pointer-events:none;transition:opacity 0.35s ease}",
    ".tw-caret.tw-blink{animation:tw-blink 1s linear infinite}",
    // The pause between lines is only 200–400 ms, so its blink starts
    // mid-cycle: the caret dims a beat after the line ends and is back
    // when the next one starts.
    ".tw-caret.tw-pause{animation:tw-blink 0.8s linear infinite;animation-delay:-0.3s}",
    "@keyframes tw-blink{0%,45%{opacity:1}55%,100%{opacity:0}}",
    // While typing, the motto's hover gloss stays put so the half-typed
    // Latin can't swap out from under the caret.
    "body.tw-typing .motto .latin{opacity:1 !important}",
    "body.tw-typing .motto .english{opacity:0 !important}",
    // The transition lives on the -in class only. On the base class it would
    // ANIMATE the initial hide: on a real network the browser computes styles
    // before this script arrives, so opacity 1 -> 0 would fade over 0.6s and
    // the chrome would flash at page open instead of vanishing instantly.
    ".tw-chrome{opacity:0 !important;pointer-events:none}",
    ".tw-chrome.tw-chrome-in{opacity:1 !important;pointer-events:auto;transition:opacity 0.6s ease}",
    ".tw-name-in{animation:tw-name 0.7s ease-out both}",
    "@keyframes tw-name{from{opacity:0}to{opacity:1}}",
    ".tw-skip{position:fixed;inset-inline:0;bottom:14px;display:block;margin:0 auto;appearance:none;-webkit-appearance:none;background:none;border:0;padding:6px 12px;text-align:center;font:inherit;font-style:italic;font-size:0.7em;color:var(--hover);opacity:0;transition:opacity 1s ease;pointer-events:none;cursor:pointer}",
    // Full opacity once shown: at 0.85 the small gray hint fell to ~2.8:1
    // against the light canvas, and it is the only visible way to skip.
    ".tw-skip.tw-in{opacity:1;pointer-events:auto}",
    ".tw-skip:hover{color:var(--text)}",
    // Offscreen copy of the full text, readable by screen readers while the
    // visible lines are mid-animation.
    ".tw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
    // Printing finishes the page synchronously (beforeprint below); the
    // animation helpers must never reach paper.
    "@media print{.tw-caret,.tw-skip,.tw-sr{display:none !important}}"
  ].join("\n");

  var SKIP_HINTS = {
    en: "press enter or tap here to skip",
    zh: "按回车或点按此处跳过",
    el: "πατήστε enter ή αγγίξτε εδώ για παράλειψη",
    la: "preme enter aut tange hic ut omittas",
    he: "הקש enter או גע כאן כדי לדלג"
  };

  // Strongly-directional character classes, for placing the caret at the
  // writing edge of the current bidi run.
  var RTL_CHAR = /[֐-޿ࢠ-ࣿיִ-﷿ﹰ-﻿]/;
  var LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿḀ-῿⺀-鿿぀-ヿ豈-﫿]/;

  function start() {
    clearTimeout(window.__twReveal);

    var body = document.body;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var isCJK = /^(zh|ja|ko)/i.test(root.lang || "");
    var completed = false;

    // --- Chrome: not typed, fades in once the text is done ----------------
    var chrome = [];
    var chromeEls = [
      document.querySelector("h1 .secret"),
      document.querySelector(".theme-switch"),
      document.querySelector(".lang-switch")
    ];
    for (var c = 0; c < chromeEls.length; c++) {
      var chromeEl = chromeEls[c];
      if (!chromeEl) continue;
      chromeEl.classList.add("tw-chrome");
      // Invisible chrome must be unreachable by keyboard and silent to
      // screen readers until it fades in.
      chromeEl.setAttribute("aria-hidden", "true");
      var focusables = chromeEl.matches("a, button")
        ? [chromeEl]
        : Array.prototype.slice.call(chromeEl.querySelectorAll("a, button"));
      for (var f = 0; f < focusables.length; f++) focusables[f].tabIndex = -1;
      chrome.push({ el: chromeEl, focusables: focusables });
    }

    // --- Lines to type, in reading order -----------------------------------
    // Top-level blocks are one line each, except .section which types its
    // heading and every list item separately. The header row (the name)
    // stays visible from the first paint. Elements with no text (e.g. the
    // July 4th fireworks canvas) are left untouched.
    var lineEls = [];
    var kids = body.children;
    for (var k = 0; k < kids.length; k++) {
      var el = kids[k];
      if (
        el.tagName === "SCRIPT" ||
        el.classList.contains("header-row") ||
        el.classList.contains("lang-switch")
      ) {
        continue;
      }
      if (el.classList.contains("section")) {
        var parts = el.querySelectorAll("p, li");
        for (var s = 0; s < parts.length; s++) lineEls.push(parts[s]);
      } else {
        lineEls.push(el);
      }
    }

    // Snapshot each line's text nodes. The motto types only its Latin face;
    // the hover gloss never gets typed.
    var lines = [];
    for (var i = 0; i < lineEls.length; i++) {
      var lineEl = lineEls[i];
      var scope = lineEl.classList.contains("motto")
        ? lineEl.querySelector(".latin") || lineEl
        : lineEl;
      var nodes = [];
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
      var textNode;
      while ((textNode = walker.nextNode())) {
        // Collapse the source's pretty-printing whitespace so the caret
        // never sits through invisible characters.
        var text = textNode.nodeValue.replace(/\s+/g, " ");
        if (text) nodes.push({ node: textNode, text: text });
      }
      if (!nodes.length) continue;
      // Everything focusable in the line (its links, and the line itself if
      // it carries a tabindex, like the motto) is parked at tabindex=-1
      // until the line is typed, so nothing hidden from screen readers can
      // ever take keyboard focus. The original tabindex value is restored.
      var focusEls = Array.prototype.slice.call(lineEl.querySelectorAll("a"));
      if (lineEl.hasAttribute("tabindex")) focusEls.unshift(lineEl);
      var focusables = [];
      for (var a = 0; a < focusEls.length; a++) {
        focusables.push({ el: focusEls[a], prev: focusEls[a].getAttribute("tabindex") });
        focusEls[a].tabIndex = -1;
        if (focusEls[a].tagName === "A") focusEls[a].style.pointerEvents = "none";
      }
      lines.push({
        el: lineEl,
        scope: scope,
        nodes: nodes,
        focusables: focusables,
        clone: null,
        exposed: false,
        listItem: lineEl.tagName === "LI",
        sectionStart:
          lineEl.parentElement.classList.contains("section") &&
          !lineEl.previousElementSibling
      });
    }
    if (!lines.length) {
      root.className = root.className.replace(/\s*\btw-boot\b/, "");
      return;
    }

    // Screen readers keep the full text (offscreen) while the visible lines
    // are blanked and animated below.
    // Each line's copy is handed back the moment that line finishes typing
    // (see exposeLine), so assistive tech always has exactly one copy of
    // every line. List items are cloned into a real <ul> so the reading
    // list keeps its grouping; the emptied original list is hidden until
    // its first item is done.
    var srClone = document.createElement("div");
    srClone.className = "tw-sr";
    var srList = null;
    for (var q = 0; q < lines.length; q++) {
      var copy = lines[q].el.cloneNode(true);
      if (copy.hasAttribute("tabindex")) copy.tabIndex = -1;
      var copyLinks = copy.querySelectorAll("a");
      for (var w = 0; w < copyLinks.length; w++) copyLinks[w].tabIndex = -1;
      if (lines[q].listItem) {
        if (!srList) {
          srList = document.createElement("ul");
          srClone.appendChild(srList);
        }
        srList.appendChild(copy);
      } else {
        srList = null;
        srClone.appendChild(copy);
      }
      lines[q].clone = copy;
    }
    body.appendChild(srClone);

    for (var j = 0; j < lines.length; j++) {
      for (var n = 0; n < lines[j].nodes.length; n++) {
        lines[j].nodes[n].node.nodeValue = "";
      }
      lines[j].el.style.display = "none";
      lines[j].el.setAttribute("aria-hidden", "true");
      if (lines[j].listItem) lines[j].el.parentElement.setAttribute("aria-hidden", "true");
    }

    // --- Reveal: just the name, gently -------------------------------------
    body.classList.add("tw-typing");
    var h1 = document.querySelector("h1");
    if (h1) h1.classList.add("tw-name-in");
    root.className = root.className.replace(/\s*\btw-boot\b/, "");

    // --- Caret --------------------------------------------------------------
    // A free-floating block positioned off the last typed glyph's rect, so
    // bidi runs (Latin inside the Hebrew page) keep it on the writing edge.
    var caret = document.createElement("span");
    caret.className = "tw-caret";
    caret.setAttribute("aria-hidden", "true");
    body.appendChild(caret);
    var caretAt = null; // {node, offset, line} for repositioning on resize

    function runIsRTL(text, offset, el) {
      for (var i = offset - 1; i >= 0; i--) {
        var ch = text.charAt(i);
        if (RTL_CHAR.test(ch)) return true;
        if (LTR_CHAR.test(ch)) return false;
      }
      return getComputedStyle(el).direction === "rtl";
    }

    // Would a box at (x, y, w, h) paint over anything already typed in this
    // line? In mixed-direction text (Latin inside the Hebrew page) the slot
    // beside the last glyph can belong to a neighbouring bidi run.
    function coversTypedText(x, y, w, h, line, node, offset) {
      var r = document.createRange();
      r.setStart(line.nodes[0].node, 0);
      r.setEnd(node, offset);
      var rects = r.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var t = rects[i];
        if (x + 0.5 < t.right && x + w - 0.5 > t.left && y + 0.5 < t.bottom && y + h - 0.5 > t.top) {
          return true;
        }
      }
      return false;
    }

    function positionCaret(node, offset, line) {
      caretAt = { node: node, offset: offset, line: line };
      // Measure against the typed scope (the motto's Latin span, not the
      // paragraph) so an isolated LTR run inside an RTL page reads its own
      // direction and font.
      var el = line.scope;
      var fs = parseFloat(getComputedStyle(el).fontSize) || 20;
      var w = Math.max(1.5, fs * 0.1);
      var h = fs * 1.05;
      var gap = fs * 0.05;
      var range = document.createRange();
      var rect;
      if (node && offset > 0) {
        // Walk back to the last character that actually renders — a
        // trailing space is collapsed at the line end and measures empty,
        // and the caret must not fall back to the line start mid-word.
        for (var k = offset; k >= 1; k--) {
          range.setStart(node, k - 1);
          range.setEnd(node, k);
          rect = range.getBoundingClientRect();
          if (rect && (rect.width || rect.height)) {
            var rtl = runIsRTL(node.nodeValue, k, el);
            var x = rtl ? rect.left - gap - w : rect.right + gap;
            var y = rect.top + (rect.height - h) / 2;
            if (coversTypedText(x, y, w, h, line, node, k)) {
              // The slot beside this glyph belongs to the neighbouring bidi
              // run (a Latin name being written inside Hebrew text grows
              // against the Hebrew that precedes it): the writing point is
              // that boundary, so centre the bar on it — a pixel into each
              // glyph's side bearing, over neither letter.
              x = (rtl ? rect.left : rect.right) - w / 2;
            }
            moveCaret(x, y, w, h);
            return;
          }
        }
        // Nothing measurable yet in this node — leave the caret where it is.
        return;
      }
      // Line start: an empty block reports a collapsed (too low) rect, so
      // plant a zero-width space, measure exactly where the first character
      // will land, and remove it again before the browser can paint it.
      if (node) {
        node.nodeValue = "\u200B";
        range.setStart(node, 0);
        range.setEnd(node, 1);
        rect = range.getBoundingClientRect();
        node.nodeValue = "";
        if (rect && rect.height) {
          var rtl = getComputedStyle(el).direction === "rtl";
          moveCaret(
            rtl ? rect.right - w : rect.left,
            rect.top + (rect.height - h) / 2,
            w,
            h
          );
          return;
        }
      }
      // Last resort: the element box itself.
      var er = el.getBoundingClientRect();
      var lh = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2;
      moveCaret(
        getComputedStyle(el).direction === "rtl" ? er.right - w : er.left,
        er.top + (lh - h) / 2,
        w,
        h
      );
    }

    function moveCaret(x, y, w, h) {
      caret.style.width = w + "px";
      caret.style.height = h + "px";
      caret.style.left = x + window.scrollX + "px";
      caret.style.top = y + window.scrollY + "px";
    }

    function onResize() {
      if (caretAt) positionCaret(caretAt.node, caretAt.offset, caretAt.line);
    }
    window.addEventListener("resize", onResize);

    // --- Skip hint ------------------------------------------------------------
    var hint = document.createElement("button");
    hint.type = "button";
    hint.className = "tw-skip";
    hint.tabIndex = -1;
    hint.textContent =
      SKIP_HINTS[(root.lang || "en").slice(0, 2).toLowerCase()] || SKIP_HINTS.en;
    hint.addEventListener("click", function () {
      finish();
    });
    body.appendChild(hint);
    var hintTimer = setTimeout(function () {
      hint.classList.add("tw-in");
      hint.tabIndex = 0;
    }, T.skipHintAfter);

    // --- Typing engine ------------------------------------------------------
    var timer = null;
    var li = 0;       // current line
    var ni = 0;       // current text node within the line
    var ci = 0;       // characters typed within that node
    var listDone = 0; // finished list items, for the rhythm speed-up

    // The delay AFTER the character just typed. Intervals are log-normal
    // around charMs — tightly clustered with a long tail, the way a real
    // typist's are — never faster than one frame, with a beat after each
    // word, a longer one after a clause, and the odd hesitation. (A flat
    // ±60% jitter used to land a quarter of the keystrokes a single frame
    // apart: flurries and stalls rather than a hand at work.)
    function charDelay(ch, speed) {
      var base = T.charMs;
      if (isCJK && /[⺀-鿿　-ヿ豈-﫿]/.test(ch)) {
        base *= T.cjkFactor;
      }
      var d = base * Math.exp(gauss() * T.charJitter);
      if (/[.;:!?…。；：！？]/.test(ch)) d += rand(T.punctPause[0], T.punctPause[1]);
      else if (/[—–\/·、，]/.test(ch)) d += rand(T.dashPause[0], T.dashPause[1]);
      else if (ch === " ") d += rand(T.wordPause[0], T.wordPause[1]);
      else if (Math.random() < T.hesitateChance) {
        d += rand(T.hesitatePause[0], T.hesitatePause[1]);
      }
      return Math.max(T.minCharMs, d * speed);
    }

    // The reading list gathers pace item by item once the pattern is set.
    function lineSpeed(line) {
      if (!line.listItem) return 1;
      return Math.max(T.listRhythmFloor, 1 - T.listRhythm * listDone);
    }

    function typeTick() {
      var line = lines[li];
      if (ni >= line.nodes.length) return lineDone();
      var part = line.nodes[ni];
      if (ci >= part.text.length) {
        ni++;
        ci = 0;
        return typeTick();
      }
      var ch = part.text.charAt(ci);
      ci++;
      part.node.nodeValue = part.text.slice(0, ci);
      positionCaret(part.node, ci, line);
      timer = setTimeout(typeTick, charDelay(ch, lineSpeed(line)));
    }

    function startLine() {
      var line = lines[li];
      caret.classList.remove("tw-blink", "tw-pause");
      line.el.style.display = "";
      ni = 0;
      ci = 0;
      positionCaret(line.nodes[0].node, 0, line);
      typeTick();
    }

    function lineDone() {
      var line = lines[li];
      exposeLine(line);
      if (line.listItem) listDone++;
      li++;
      if (li >= lines.length) return endSequence();
      var pause = rand(T.linePause[0], T.linePause[1]);
      if (lines[li].sectionStart) pause += T.sectionPause;
      if (lines[li].listItem) pause *= lineSpeed(lines[li]);
      // A longer gap reads as a moment's thought: let the caret blink there.
      if (pause >= T.gapBlinkMin) caret.classList.add("tw-pause");
      timer = setTimeout(startLine, pause);
    }

    // A finished line goes back to assistive tech and the keyboard in one
    // step: its offscreen copy leaves, the original is un-hidden, and only
    // then do its links (and its own tabindex) become reachable again.
    function exposeLine(line) {
      if (line.exposed) return;
      line.exposed = true;
      if (line.clone && line.clone.parentNode) {
        var holder = line.clone.parentNode;
        holder.removeChild(line.clone);
        if (holder !== srClone && !holder.firstChild && holder.parentNode) {
          holder.parentNode.removeChild(holder);
        }
      }
      line.el.removeAttribute("aria-hidden");
      if (line.listItem) line.el.parentElement.removeAttribute("aria-hidden");
      for (var f = 0; f < line.focusables.length; f++) {
        var item = line.focusables[f];
        if (item.el.tagName === "A") item.el.style.pointerEvents = "";
        if (item.prev === null) item.el.removeAttribute("tabindex");
        else item.el.setAttribute("tabindex", item.prev);
      }
    }

    // --- Endings ------------------------------------------------------------
    // sync=true (printing) reveals the chrome in the same tick, no fade.
    function chromeIn(stagger, sync) {
      function reveal(item) {
        item.el.classList.add("tw-chrome-in");
        item.el.removeAttribute("aria-hidden");
        for (var f = 0; f < item.focusables.length; f++) {
          item.focusables[f].removeAttribute("tabindex");
        }
      }
      // Strip the helper classes once the fade lands, returning the chrome
      // to its stock styling (the star keeps its hover spin).
      function settle(item) {
        item.el.classList.remove("tw-chrome", "tw-chrome-in");
      }
      for (var i = 0; i < chrome.length; i++) {
        if (sync) {
          reveal(chrome[i]);
          settle(chrome[i]);
          continue;
        }
        (function (item, delay) {
          setTimeout(function () {
            reveal(item);
            setTimeout(function () { settle(item); }, T.chromeFade);
          }, delay);
        })(chrome[i], i * stagger);
      }
    }

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (caret.parentNode) {
        // Fade out rather than vanish (the transition on .tw-caret). The
        // blink animation owns opacity while it runs, so pin the current
        // value first and flush styles, or the transition has no start.
        var cur = getComputedStyle(caret).opacity;
        caret.classList.remove("tw-blink", "tw-pause");
        caret.style.opacity = cur;
        void caret.offsetWidth;
        caret.style.opacity = "0";
        setTimeout(function () {
          if (caret.parentNode) caret.parentNode.removeChild(caret);
        }, T.caretFade);
      }
      if (hint.parentNode) hint.parentNode.removeChild(hint);
      if (srClone.parentNode) srClone.parentNode.removeChild(srClone);
      for (var i = 0; i < lines.length; i++) exposeLine(lines[i]);
      body.classList.remove("tw-typing");
      body.classList.add("tw-done");
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      // The chrome is still fading in for a moment after cleanup; keep the
      // print hook until every fade has settled so a print in that window
      // still gets the whole page.
      setTimeout(function () {
        window.removeEventListener("beforeprint", onPrint);
      }, chrome.length * T.chromeStagger + T.chromeFade + 100);
    }

    // Natural finish: one last blink where the writing stopped, chrome
    // fading in around it, then the caret leaves.
    function endSequence() {
      completed = true;
      clearTimeout(hintTimer);
      hint.classList.remove("tw-in");
      hint.tabIndex = -1;
      caret.classList.add("tw-blink");
      chromeIn(T.chromeStagger);
      timer = setTimeout(cleanup, T.endBlink);
    }

    // Skip: fill everything in at once. sync=true is the print path — the
    // page must be whole before beforeprint returns, so no fades at all.
    function finish(sync) {
      if (completed && !sync) return;
      clearTimeout(timer);
      clearTimeout(hintTimer);
      if (!completed) {
        completed = true;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          for (var n = 0; n < line.nodes.length; n++) {
            line.nodes[n].node.nodeValue = line.nodes[n].text;
          }
          line.el.style.display = "";
          exposeLine(line);
        }
      }
      chromeIn(sync ? 0 : 120, sync);
      cleanup();
    }

    // Printing mid-intro would otherwise print a half-written page. The
    // name's own fade-in is cut short too, so it never prints pale.
    function onPrint() {
      if (h1) h1.classList.remove("tw-name-in");
      finish(true);
    }
    window.addEventListener("beforeprint", onPrint);

    function onKey(e) {
      if (completed) return;
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // Enter on a focused, already-typed link (or the hint button itself)
      // should act like the link or button it is; Escape always skips.
      if (e.key === "Enter" && e.target.closest && e.target.closest("a, button")) return;
      e.preventDefault();
      finish();
    }
    document.addEventListener("keydown", onKey);

    // --- Begin: caret blinks alone under the name, then the writing starts --
    var first = lines[0];
    first.el.style.display = "";
    positionCaret(first.nodes[0].node, 0, first);
    caret.classList.add("tw-blink");
    timer = setTimeout(function () {
      caret.classList.remove("tw-blink");
      typeTick();
    }, T.openBlink);
  }

  // Give the preloaded EB Garamond a beat to arrive (capped, so a slow
  // connection never delays the intro past the boot guard's failsafe):
  // the caret is measured from real glyph boxes, and a face swap mid-line
  // would re-flow what has already been written.
  function whenFontsSettled(cb) {
    var done = false;
    var go = function () { if (!done) { done = true; cb(); } };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(go, go);
      setTimeout(go, 700);
    } else {
      go();
    }
  }

  function boot() {
    whenFontsSettled(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
