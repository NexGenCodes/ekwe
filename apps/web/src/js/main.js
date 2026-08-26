(() => {
  "use strict";

  document.documentElement.classList.add("js");

  const ICONS = {
    mic: `<i data-lucide="mic"></i>`,
    cpu: `<i data-lucide="cpu"></i>`,
    share: `<i data-lucide="share-2"></i>`,
    clock: `<i data-lucide="clock"></i>`,
    shield: `<i data-lucide="shield-check"></i>`,
    waves: `<i data-lucide="waves"></i>`,
    download: `<i data-lucide="download"></i>`,

    arrow: `<i data-lucide="arrow-right"></i>`,
    globe: `<i data-lucide="globe"></i>`,
  };

  function icon(name) {
    return ICONS[name] || "";
  }

  /* ── Waveform ─────────────────────────────────────── */
  function initWaveform() {
    const bars = document.querySelectorAll("#hero-waveform span");
    if (!bars.length) return;

    bars.forEach((bar) => {
      const amp = 20 + Math.random() * 80;
      const dur = (0.8 + Math.random() * 0.8).toFixed(2);
      const delay = (Math.random() * 1.5).toFixed(2);
      bar.style.setProperty("--amp", `${amp}%`);
      bar.style.setProperty("--dur", `${dur}s`);
      bar.style.setProperty("--d", `${delay}s`);
    });
  }

  /* ── Language ticker (seamless loop) ──────────────── */
  function initTicker() {
    const track = document.getElementById("language-ticker");
    if (!track) return;
    track.innerHTML += track.innerHTML;
  }

  /* ── Scroll reveal ────────────────────────────────── */
  function initReveal() {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;

    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    els.forEach((el) => observer.observe(el));
  }

  /* ── Count-up stats ───────────────────────────────── */
  function initCounters() {
    const counters = document.querySelectorAll("[data-count]");
    if (!counters.length) return;

    const animate = (el) => {
      const target = parseInt(el.dataset.count, 10) || 0;
      const duration = 1400;
      const start = performance.now();

      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = target;
      };

      requestAnimationFrame(tick);
    };

    if (!("IntersectionObserver" in window)) {
      counters.forEach(animate);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((el) => observer.observe(el));
  }

  /* ── Mobile nav (close on link tap) ─────────────────── */
  function initMobileNav() {
    const toggle = document.getElementById("nav-toggle");
    if (!toggle) return;

    document.querySelectorAll(".nav-links a").forEach((link) => {
      link.addEventListener("click", () => {
        toggle.checked = false;
      });
    });
  }

  /* ── Live label cycle ─────────────────────────────── */
  function initLiveLabel() {
    const label = document.getElementById("live-label");
    if (!label) return;

    const states = ["Ready", "Listening", "Transcribing", "Translating"];
    let i = 0;

    setInterval(() => {
      i = (i + 1) % states.length;
      label.textContent = states[i];
    }, 2400);
  }

  function renderFeatures(features) {
    const grid = document.getElementById("features-grid");
    if (!grid) return;

    grid.innerHTML = features
      .map(
        (f) => `
        <div class="feature-card">
          <div class="feature-icon">${icon(f.icon)}</div>
          <h3>${f.title}</h3>
          <p>${f.description}</p>
        </div>`
      )
      .join("");
  }

  async function detectAbi() {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues(["architecture"]);
        if (hints.architecture) {
          if (hints.architecture.includes("arm")) return "arm64-v8a";
          if (hints.architecture.includes("x86")) return "armeabi-v7a";
        }
      } catch {}
    }
    return "arm64-v8a";
  }

  function renderDynamicContent(config, abi) {
    const urls = config.links.downloadUrls || {};
    const primaryUrl = urls[abi] || config.links.download;
    const fallbackAbi = abi === "arm64-v8a" ? "armeabi-v7a" : "arm64-v8a";
    const fallbackUrl = urls[fallbackAbi] || config.links.download;

    document.querySelectorAll("[data-download-primary]").forEach((el) => {
      el.href = primaryUrl;
    });

    document.querySelectorAll("[data-download-fallback]").forEach((el) => {
      el.href = fallbackUrl;
    });

    document.querySelectorAll("[data-download]").forEach((el) => {
      el.href = primaryUrl;
    });

    document.querySelectorAll("[data-download-abi-label]").forEach((el) => {
      el.textContent = fallbackAbi === "arm64-v8a" ? "arm64" : "armv7";
    });

    document.querySelectorAll("[data-version]").forEach((el) => {
      el.textContent = `v${config.app.version}`;
    });

    document.querySelectorAll("[data-email]").forEach((el) => {
      el.href = `mailto:${config.contact.email}`;
      el.textContent = config.contact.email;
    });
  }

  async function init() {
    let config;
    try {
      const resp = await fetch("/config.json");
      config = await resp.json();
    } catch {
      config = null;
    }

    const abi = await detectAbi();

    if (config) {
      renderFeatures(config.features);
      renderDynamicContent(config, abi);
    }

    initWaveform();
    initTicker();
    initReveal();
    initCounters();
    initMobileNav();
    initLiveLabel();

    // Load Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();