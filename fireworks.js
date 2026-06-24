/*
 * July 4th fireworks — red, white & blue.
 * Minimalist night-sky takeover that plays once on page load,
 * but only on the calendar date of July 4th in US Eastern time.
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

  function start() {
    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Flag-inspired palette, brightened so it reads against a night sky.
    var COLORS = ["#E63946", "#F7F7FF", "#4895EF"]; // red, white, blue

    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    var s = canvas.style;
    s.position = "fixed";
    s.inset = "0";
    s.width = "100%";
    s.height = "100%";
    s.zIndex = "9999";
    s.pointerEvents = "none";
    s.opacity = "0";
    s.transition = "opacity 1.2s ease";
    document.body.appendChild(canvas);

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
    }
    resize();
    window.addEventListener("resize", resize);

    var rockets = [];
    var sparks = [];
    var running = true;
    var startTime = null;
    // How long fireworks keep launching, then a graceful fade-out.
    var LAUNCH_MS = reduced ? 7000 : 12000;
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
      var count = reduced ? 34 : 58;
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

    function frame(t) {
      if (startTime === null) {
        startTime = t;
        nextLaunch = t;
      }
      var elapsed = t - startTime;

      // Trails: paint a translucent night sky so bursts glow and fade.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = reduced ? "rgba(10,12,24,0.32)" : "rgba(8,10,20,0.22)";
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = "lighter";

      if (running && t >= nextLaunch && elapsed < LAUNCH_MS) {
        launchRocket();
        if (Math.random() < 0.45) launchRocket();
        nextLaunch = t + rand(reduced ? 1100 : 650, reduced ? 1700 : 1200);
      }

      for (var r = rockets.length - 1; r >= 0; r--) {
        var rk = rockets[r];
        rk.x += rk.vx;
        rk.y += rk.vy;
        rk.vy += 0.12; // gravity slows the ascent
        ctx.beginPath();
        ctx.fillStyle = rk.color;
        ctx.shadowBlur = 12;
        ctx.shadowColor = rk.color;
        ctx.arc(rk.x, rk.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        if (rk.vy >= 0 || rk.y <= rk.targetY) {
          explode(rk.x, rk.y, rk.color);
          rockets.splice(r, 1);
        }
      }

      ctx.shadowBlur = 0;
      for (var i = sparks.length - 1; i >= 0; i--) {
        var p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035; // gentle gravity
        p.vx *= 0.985; // air drag
        p.vy *= 0.985;
        p.life -= p.decay;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Once launching is done and the sky has cleared, fade out and exit.
      if (elapsed >= LAUNCH_MS && rockets.length === 0 && sparks.length === 0) {
        cleanup();
        return;
      }
      if (running) requestAnimationFrame(frame);
    }

    function cleanup() {
      running = false;
      s.opacity = "0";
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
      setTimeout(function () {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }, 1300);
    }

    // Let the user dismiss the show early.
    function dismiss() {
      if (!running) return;
      // Stop new launches; let existing sparks settle, then fade.
      startTime = startTime === null ? 0 : startTime - LAUNCH_MS;
    }
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", dismiss);

    // Fade the sky in, then animate.
    requestAnimationFrame(function () {
      s.opacity = "1";
      requestAnimationFrame(frame);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
