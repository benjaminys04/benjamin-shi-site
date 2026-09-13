/*
 * July 4th fireworks — red, white & blue.
 * Minimalist night-sky takeover that plays once on page load,
 * but only on the calendar date of July 4th in US Eastern time.
 *
 * It waits for the typewriter intro to finish (the two used to play on
 * top of each other, burying the intro's skip hint under the sky), sits
 * out entirely for reduced-motion visitors, and while it runs the canvas
 * owns the pointer so a dismissing tap cannot fall through onto a link.
 * The simulation advances in fixed 60 Hz steps, so it looks the same on a
 * 120 Hz phone as on a 60 Hz laptop.
 */
(function () {
  "use strict";

  // --- Date guard: only on July 4th, US Eastern (EST/EDT) -----------------
  function isJulyFourthEastern() {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric"
      }).formatToParts(new Date());
      var month, day;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "month") month = parts[i].value;
        if (parts[i].type === "day") day = parts[i].value;
      }
      return month === "7" && day === "4";
    } catch (e) {
      return false;
    }
  }

  if (!isJulyFourthEastern()) return;

  // A full-screen animation is exactly what reduced-motion visitors asked
  // not to see; the typewriter already sits out for them, so does this.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Same wording as the typewriter's hint, so the two intros read as one.
  var SKIP_HINTS = {
    en: "press enter or tap here to skip",
    zh: "按回车或点按此处跳过",
    el: "πατήστε enter ή αγγίξτε εδώ για παράλειψη",
    la: "preme enter aut tange hic ut omittas",
    he: "הקש enter או גע כאן כדי לדלג"
  };

  // Run cb once the typewriter intro is over: body.tw-done, or no intro at
  // all (no html.tw-boot and no body.tw-typing — reduced motion, crawlers,
  // or the boot guard's failsafe having revealed the static page).
  function whenIntroDone(cb) {
    var root = document.documentElement;
    var waited = 0;
    (function poll() {
      var body = document.body;
      var done = body && body.classList.contains("tw-done");
      var typing =
        /\btw-boot\b/.test(root.className) ||
        (body && body.classList.contains("tw-typing"));
      if (done || !typing || waited >= 90000) return cb();
      waited += 250;
      setTimeout(poll, 250);
    })();
  }

  function start() {
    // Flag-inspired palette, brightened so it reads against a night sky.
    var COLORS = ["#E63946", "#F7F7FF", "#4895EF"]; // red, white, blue
    var SKY = "rgb(8, 10, 20)";

    var style = document.createElement("style");
    style.textContent = [
      ".fw-skip{position:fixed;inset-inline:0;bottom:14px;z-index:10000;display:block;margin:0 auto;appearance:none;-webkit-appearance:none;background:none;border:0;padding:6px 12px;text-align:center;font:inherit;font-style:italic;font-size:0.7em;color:#F7F7FF;opacity:0;transition:opacity 1s ease;pointer-events:none;cursor:pointer}",
      ".fw-skip.fw-in{opacity:0.9;pointer-events:auto}",
      "@media print{.fw-sky,.fw-skip{display:none !important}}"
    ].join("\n");
    document.head.appendChild(style);

    var canvas = document.createElement("canvas");
    canvas.className = "fw-sky";
    canvas.setAttribute("aria-hidden", "true");
    var s = canvas.style;
    s.position = "fixed";
    s.inset = "0";
    s.width = "100%";
    s.height = "100%";
    s.zIndex = "9999";
    // The canvas takes the pointer for the duration of the show: a tap to
    // dismiss lands here, never on the link hiding under the sky.
    s.pointerEvents = "auto";
    s.opacity = "0";
    s.transition = "opacity 1.2s ease";
    document.body.appendChild(canvas);

    // A visible, focusable way out, in the page's own hint style.
    var hint = document.createElement("button");
    hint.type = "button";
    hint.className = "fw-skip";
    var lang = (document.documentElement.lang || "en").slice(0, 2).toLowerCase();
    hint.textContent = SKIP_HINTS[lang] || SKIP_HINTS.en;
    document.body.appendChild(hint);
    var hintTimer = setTimeout(function () {
      hint.classList.add("fw-in");
    }, 1200);

    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0,
      H = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing the backing store wipes it; paint the sky straight back so
      // the page never flashes through a transparent canvas.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = SKY;
      ctx.fillRect(0, 0, W, H);
    }
    resize();
    window.addEventListener("resize", resize);

    var rockets = [];
    var sparks = [];
    var running = true;
    var dismissed = false;
    var startTime = null;
    var lastT = null;
    var acc = 0;
    var STEP = 1000 / 60; // fixed simulation step, in ms
    // How long fireworks keep launching, then a graceful fade-out.
    var LAUNCH_MS = 12000;
    var nextLaunch = 0;

    function rand(a, b) {
      return a + Math.random() * (b - a);
    }

    function pick(arr) {
      return arr[(Math.random() * arr.length) | 0];
    }

    function launchRocket() {
      rockets.push({
        x: rand(W * 0.18, W * 0.82),
        y: H,
        vx: rand(-0.4, 0.4),
        vy: rand(-9.2, -7.6) * (H / 800 + 0.4),
        targetY: rand(H * 0.16, H * 0.42),
        color: pick(COLORS)
      });
    }

    function explode(x, y, color) {
      var count = 58;
      var speed = rand(2.6, 4.2);
      for (var i = 0; i < count; i++) {
        var ang = (Math.PI * 2 * i) / count + rand(-0.06, 0.06);
        var v = speed * rand(0.55, 1);
        sparks.push({
          x: x,
          y: y,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          life: 1,
          decay: rand(0.012, 0.022),
          color: color,
          size: rand(1.4, 2.4)
        });
      }
    }

    // One 60 Hz step of physics plus one notch of trail fade.
    function step() {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(8,10,20,0.22)";
      ctx.fillRect(0, 0, W, H);

      for (var r = rockets.length - 1; r >= 0; r--) {
        var rk = rockets[r];
        rk.x += rk.vx;
        rk.y += rk.vy;
        rk.vy += 0.12; // gravity slows the ascent
        if (rk.vy >= 0 || rk.y <= rk.targetY) {
          explode(rk.x, rk.y, rk.color);
          rockets.splice(r, 1);
        }
      }

      for (var i = sparks.length - 1; i >= 0; i--) {
        var p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035; // gentle gravity
        p.vx *= 0.985; // air drag
        p.vy *= 0.985;
        p.life -= p.decay;
        if (p.life <= 0) sparks.splice(i, 1);
      }
    }

    function draw() {
      ctx.globalCompositeOperation = "lighter";
      for (var r = 0; r < rockets.length; r++) {
        var rk = rockets[r];
        ctx.beginPath();
        ctx.fillStyle = rk.color;
        ctx.shadowBlur = 12;
        ctx.shadowColor = rk.color;
        ctx.arc(rk.x, rk.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      for (var i = 0; i < sparks.length; i++) {
        var p = sparks[i];
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function frame(t) {
      if (startTime === null) {
        startTime = t;
        nextLaunch = t;
        lastT = t;
      }
      var elapsed = t - startTime;

      if (running && !dismissed && t >= nextLaunch && elapsed < LAUNCH_MS) {
        launchRocket();
        if (Math.random() < 0.45) launchRocket();
        nextLaunch = t + rand(650, 1200);
      }

      // Catch-up is capped so a tab coming back from the background does
      // not fast-forward the whole show in one frame.
      acc += Math.min(t - lastT, STEP * 5);
      lastT = t;
      var stepped = false;
      while (acc >= STEP) {
        acc -= STEP;
        stepped = true;
        step();
      }
      if (stepped) draw();

      // Once launching is over (or the show was dismissed) and the sky has
      // cleared, fade out and exit.
      if ((elapsed >= LAUNCH_MS || dismissed) && rockets.length === 0 && sparks.length === 0) {
        cleanup();
        return;
      }
      if (running) requestAnimationFrame(frame);
    }

    function cleanup() {
      running = false;
      clearTimeout(hintTimer);
      s.opacity = "0";
      s.pointerEvents = "none"; // the page is usable again during the fade
      hint.classList.remove("fw-in");
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
      setTimeout(function () {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (hint.parentNode) hint.parentNode.removeChild(hint);
        if (style.parentNode) style.parentNode.removeChild(style);
      }, 1300);
    }

    // Let the user dismiss the show early: no new launches, the sparks in
    // the air settle, then the fade. Tracked as its own flag so a dismissal
    // before the first frame counts too.
    function dismiss() {
      if (!running) return;
      dismissed = true;
    }
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", dismiss);
    // A synthesized click (assistive tech, switch access) fires neither of
    // the above, so the button also dismisses on click.
    hint.addEventListener("click", dismiss);

    // Fade the sky in, then animate.
    requestAnimationFrame(function () {
      if (!running) return;
      s.opacity = "1";
      requestAnimationFrame(frame);
    });
  }

  function boot() {
    whenIntroDone(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
