(() => {
  "use strict";

  const ICONS = {
    mic: `<i data-lucide="mic"></i>`,
    cpu: `<i data-lucide="cpu"></i>`,
    "wifi-off": `<i data-lucide="wifi-off"></i>`,
    share: `<i data-lucide="share-2"></i>`,
    clock: `<i data-lucide="clock"></i>`,
    shield: `<i data-lucide="shield-check"></i>`,
    download: `<i data-lucide="download"></i>`,
    github: `<i data-lucide="github"></i>`,
    arrow: `<i data-lucide="arrow-right"></i>`,
    globe: `<i data-lucide="globe"></i>`,
  };

  function icon(name) {
    return ICONS[name] || "";
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

  function renderDynamicContent(config) {
    // Download buttons
    document.querySelectorAll("[data-download]").forEach((el) => {
      el.href = config.links.download;
    });
    document.querySelectorAll("[data-github]").forEach((el) => {
      el.href = config.links.github;
    });

    // Version badges
    document.querySelectorAll("[data-version]").forEach((el) => {
      el.textContent = `v${config.app.version}`;
    });

    // Contact email
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
      return;
    }

    renderFeatures(config.features);
    renderDynamicContent(config);

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
