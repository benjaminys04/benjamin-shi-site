/*
 * Typewriter intro — the page opens with just the name, then writes itself.
 *
 * A tiny boot guard inline in <head> hides the page before first paint
 * (html.tw-boot) unless the visitor prefers reduced motion or is a crawler.
 * This script snapshots every line of text, empties it, reveals the page —
 * name only — and types everything back in with a blinking block caret,
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
    charMs: 22,              // base per-character delay, jittered below
    cjkFactor: 2.4,          // CJK characters carry whole words — type slower
    punctPause: [120, 220],  // extra beat after . ; : ! ? …
    dashPause: [70, 130],    // smaller beat after — / ·
    hesitateChance: 0.02,    // occasional mid-word hesitation…
    hesitatePause: [100, 260],
    linePause: [200, 380],   // pause between lines
    sectionPause: 300,       // added on top before a new section starts
    listRhythm: 0.82,        // the reading list speeds up once in rhythm
    skipHintAfter: 1700,     // when the skip hint fades in
    endBlink: 1200,          // final blink before the caret leaves
    chromeStagger: 320,      // gap between star / toggle / language fade-ins
    chromeFade: 650          // matches the 0.6s opacity transition below
  };

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  // --- Styles (injected here so all five language pages share one file) ----
  var CSS = [
    // The caret is positioned geometrically from the last typed glyph, so
    // it lands on the true writing point even in RTL/bidi text.
    ".tw-caret{position:absolute;background:var(--text);pointer-events:none}",
    ".tw-caret.tw-blink{animation:tw-blink 0.9s step-end infinite}",
    "@keyframes tw-blink{0%,49%{opacity:1}50%,100%{opacity:0}}",
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
    ".tw-skip.tw-in{opacity:0.85;pointer-events:auto}",
    ".tw-skip:hover{color:var(--text)}",
    // Offscreen copy of the full text, readable by screen readers while the
    // visible lines are mid-animation.
    ".tw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}"
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
      var anchors = lineEl.querySelectorAll("a");
      for (var a = 0; a < anchors.length; a++) {
        anchors[a].style.pointerEvents = "none";
        anchors[a].tabIndex = -1;
      }
      lines.push({
        el: lineEl,
        nodes: nodes,
        anchors: anchors,
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
    var srClone = document.createElement("div");
    srClone.className = "tw-sr";
    for (var q = 0; q < lines.length; q++) {
      var copy = lines[q].el.cloneNode(true);
      var copyLinks = copy.querySelectorAll("a");
      for (var w = 0; w < copyLinks.length; w++) copyLinks[w].tabIndex = -1;
      srClone.appendChild(copy);
    }
    body.appendChild(srClone);

    for (var j = 0; j < lines.length; j++) {
      for (var n = 0; n < lines[j].nodes.length; n++) {
        lines[j].nodes[n].node.nodeValue = "";
      }
      lines[j].el.style.display = "none";
      lines[j].el.setAttribute("aria-hidden", "true");
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
    var caretAt = null; // {node, offset, el} for repositioning on resize

    function runIsRTL(text, offset, el) {
      for (var i = offset - 1; i >= 0; i--) {
        var ch = text.charAt(i);
        if (RTL_CHAR.test(ch)) return true;
        if (LTR_CHAR.test(ch)) return false;
      }
      return getComputedStyle(el).direction === "rtl";
    }

    function positionCaret(node, offset, el) {
      caretAt = { node: node, offset: offset, el: el };
      var fs = parseFloat(getComputedStyle(el).fontSize) || 20;
      var w = fs * 0.5;
      var h = fs * 1.05;
      var gap = fs * 0.08;
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
            var x = runIsRTL(node.nodeValue, k, el)
              ? rect.left - gap - w
              : rect.right + gap;
            moveCaret(x, rect.top + (rect.height - h) / 2, w, h);
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
      if (caretAt) positionCaret(caretAt.node, caretAt.offset, caretAt.el);
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

    function charDelay(ch, speed) {
      var base = T.charMs;
      if (isCJK && /[⺀-鿿　-ヿ豈-﫿]/.test(ch)) {
        base *= T.cjkFactor;
      }
      var d = base * rand(0.45, 1.65);
      if (/[.;:!?…。；：！？]/.test(ch)) d += rand(T.punctPause[0], T.punctPause[1]);
      else if (/[—–\/·、，]/.test(ch)) d += rand(T.dashPause[0], T.dashPause[1]);
      else if (Math.random() < T.hesitateChance) {
        d += rand(T.hesitatePause[0], T.hesitatePause[1]);
      }
      return d * speed;
    }

    function lineSpeed(line) {
      return line.listItem && listDone >= 2 ? T.listRhythm : 1;
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
      positionCaret(part.node, ci, line.el);
      timer = setTimeout(typeTick, charDelay(ch, lineSpeed(line)));
    }

    function startLine() {
      var line = lines[li];
      line.el.style.display = "";
      ni = 0;
      ci = 0;
      positionCaret(line.nodes[0].node, 0, line.el);
      typeTick();
    }

    function lineDone() {
      var line = lines[li];
      enableAnchors(line);
      if (line.listItem) listDone++;
      li++;
      if (li >= lines.length) return endSequence();
      var pause = rand(T.linePause[0], T.linePause[1]);
      if (lines[li].sectionStart) pause += T.sectionPause;
      if (lines[li].listItem && listDone >= 2) pause *= T.listRhythm;
      timer = setTimeout(startLine, pause);
    }

    function enableAnchors(line) {
      for (var a = 0; a < line.anchors.length; a++) {
        line.anchors[a].style.pointerEvents = "";
        line.anchors[a].removeAttribute("tabindex");
      }
    }

    // --- Endings ------------------------------------------------------------
    function chromeIn(stagger) {
      for (var i = 0; i < chrome.length; i++) {
        (function (item, delay) {
          setTimeout(function () {
            item.el.classList.add("tw-chrome-in");
            item.el.removeAttribute("aria-hidden");
            for (var f = 0; f < item.focusables.length; f++) {
              item.focusables[f].removeAttribute("tabindex");
            }
            // Strip the helper classes once the fade lands, returning the
            // chrome to its stock styling (the star keeps its hover spin,
            // the toggle its pressed shadows).
            setTimeout(function () {
              item.el.classList.remove("tw-chrome", "tw-chrome-in");
            }, T.chromeFade);
          }, delay);
        })(chrome[i], i * stagger);
      }
    }

    function cleanup() {
      if (caret.parentNode) caret.parentNode.removeChild(caret);
      if (hint.parentNode) hint.parentNode.removeChild(hint);
      if (srClone.parentNode) srClone.parentNode.removeChild(srClone);
      for (var i = 0; i < lines.length; i++) {
        lines[i].el.removeAttribute("aria-hidden");
      }
      body.classList.remove("tw-typing");
      body.classList.add("tw-done");
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
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

    // Skip: fill everything in at once.
    function finish() {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      clearTimeout(hintTimer);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        for (var n = 0; n < line.nodes.length; n++) {
          line.nodes[n].node.nodeValue = line.nodes[n].text;
        }
        line.el.style.display = "";
        enableAnchors(line);
      }
      chromeIn(120);
      cleanup();
    }

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
    positionCaret(first.nodes[0].node, 0, first.el);
    caret.classList.add("tw-blink");
    timer = setTimeout(function () {
      caret.classList.remove("tw-blink");
      typeTick();
    }, T.openBlink);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
