(function () {
  console.log("[Plan Custom Overview] Script loaded.");

  const CARD_ID = "custom-overview-card";
  const PAGE_ID = "custom-metric-page";
  // Tests can point this at a local server; in production the nginx proxy serves the folder here
  const ASSET_BASE = window.CUSTOM_ASSET_BASE || "/custom_assets/";

  // Only these pages get a card: server overview, plugins overview, player overview
  function getRoute() {
    const m = location.pathname.match(/^\/(server|player)\/([^/]+)\/(overview|plugins-overview)\/?$/);
    if (!m) return null;
    const [, type, id, page] = m;
    if (type === "player" && page !== "overview") return null;
    return { type, id, key: location.pathname };
  }

  // A metric page is shown by adding #metric=<name> (and optionally &player=<uuid>) to the URL
  function getView() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const metric = params.get("metric");
    if (!metric || !/^[a-z0-9_]+$/.test(metric)) return null;
    const player = params.get("player");
    return { metric, player: player && /^[0-9a-f-]{8,40}$/i.test(player) ? player : null };
  }

  function navigate(hash) {
    if (hash) {
      location.hash = hash;
    } else {
      history.pushState(null, "", location.pathname + location.search);
      sync();
    }
  }

  // The page code is only downloaded the first time someone opens a metric
  let pageScript = null;
  function loadPageScript() {
    if (window.CustomMetricPage) return Promise.resolve();
    if (!pageScript) {
      pageScript = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${ASSET_BASE}custom_metric_page.js?t=${Date.now()}`;
        script.onload = resolve;
        script.onerror = () => {
          pageScript = null;
          reject(new Error("custom_metric_page.js failed to load"));
        };
        document.head.appendChild(script);
      });
    }
    return pageScript;
  }

  // Precomputed server-side by scripts/build_metrics.py from the snapshot database
  async function loadActivity() {
    const res = await fetch(`${ASSET_BASE}metrics.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("metrics.json returned " + res.status);
    return res.json();
  }

  function escapeHtml(text) {
    const el = document.createElement("div");
    el.textContent = text;
    return el.innerHTML;
  }

  // Ratios need more precision than counts (1.37 vs 1.4); big numbers drop decimals to keep columns narrow
  function fmt(value, kind) {
    if (value === null || value === undefined) return "–";
    const digits = kind === "ratio" ? 2 : Math.abs(value) >= 100 ? 0 : 1;
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function labelFor(resource) {
    return `<a class="co-link" href="#metric=${resource.name}">${resource.label}</a>`;
  }

  function renderActivity(card, route, metrics) {
    const body = card.querySelector(".activity-body");
    const isPlayer = route.type === "player";
    const source = isPlayer ? metrics.players[route.id] : metrics.server;
    if (!source) {
      body.textContent = "No activity recorded for this player yet.";
      return;
    }

    const columns = [["total", "Total"], ["gain_24h", "24h"], ["gain_7d", "7d"]];
    if (isPlayer) columns.push(["avg_per_session", "/sess"]);

    const header = columns.map(([, title]) => `<th class="text-end">${title}</th>`).join("");
    const rows = metrics.resources.map((r) => {
      const cells = columns.map(([key]) => `<td class="text-end">${fmt(source[key] && source[key][r.name], r.kind)}</td>`).join("");
      return `<tr><td>${labelFor(r)}</td>${cells}</tr>`;
    }).join("");

    let html = `<div class="table-responsive"><table class="table table-sm mb-3 co-activity"><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;

    const since = new Date(metrics.tracking_since).toLocaleDateString();
    html += `<small class="text-muted">Gains count from ${since} (when tracking began).</small>`;
    body.innerHTML = html;
  }

  // One table with both boards: all time (first three columns) and the last 7 days (last three)
  function leaderboardTable(metrics) {
    const boards = [["total", "All time"], ["gain_7d", "Last 7 days"]];
    const places = ["1st", "2nd", "3rd"];
    const rows = metrics.resources.map((r) => {
      const cells = boards.map(([key], b) => {
        const top = (metrics.leaderboards[r.name] && metrics.leaderboards[r.name][key]) || [];
        return places.map((place, i) => {
          const entry = top[i];
          const name = entry ? escapeHtml(entry.name) : "–";
          const value = entry ? `<span class="co-val text-muted">${fmt(entry.value, r.kind)}</span>` : "";
          return `<td class="${b && i === 0 ? "co-sep" : ""}" data-rank="${i + 1}"><span class="co-name">${name}</span>${value}</td>`;
        }).join("");
      }).join("");
      return `<tr><td class="co-metric">${labelFor(r)}</td>${cells}</tr>`;
    }).join("");
    const groupHeader = boards.map(([, title], b) => `<th colspan="3" class="${b ? "co-sep" : ""}">${title}</th>`).join("");
    const placeHeader = boards.map((_, b) => places.map((p, i) => `<th class="${b && i === 0 ? "co-sep" : ""}">${p}</th>`).join("")).join("");
    const legend = `<div class="co-legend">${boards.map(([, title]) => `<span>${title}</span>`).join("")}</div>`;
    return `${legend}<div class="table-responsive"><table class="table table-sm mb-0 co-stack"><thead><tr><th></th>${groupHeader}</tr><tr><th></th>${placeHeader}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // On phones each metric becomes a compact block (name, then all time on the left and the last
  // 7 days on the right) and the activity table gets tighter, so nothing is wider than the screen.
  function ensureStyles() {
    if (document.getElementById("custom-overview-style")) return;
    const style = document.createElement("style");
    style.id = "custom-overview-style";
    style.textContent = `
      #${CARD_ID} .co-link { color: inherit; text-decoration: none; border-bottom: 1px dotted rgba(128, 128, 128, 0.7); }
      #${CARD_ID} .co-activity td:not(:first-child) { white-space: nowrap; }
      #${CARD_ID} .co-stack { table-layout: fixed; font-size: 0.85rem; }
      #${CARD_ID} .co-stack thead tr:first-child th:first-child { width: 14%; }
      #${CARD_ID} .co-sep { border-left: 1px solid rgba(128, 128, 128, 0.25); }
      #${CARD_ID} .co-val { margin-left: 0.35rem; white-space: nowrap; }
      #${CARD_ID} .co-legend { display: none; }
      @media (max-width: 991.98px) {
        #${CARD_ID} .co-stack { font-size: 0.78rem; }
        #${CARD_ID} .co-stack thead { display: none; }
        #${CARD_ID} .co-legend { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.75rem; font-size: 0.78rem; font-weight: 600; color: #888; padding: 0.25rem 0; position: sticky; top: 0; z-index: 2; background-color: var(--bs-body-bg, #fff); border-bottom: 1px solid rgba(128, 128, 128, 0.25); }
        #${CARD_ID} .co-stack tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto repeat(3, auto); grid-auto-flow: column; column-gap: 0.75rem; padding: 0.3rem 0; border-bottom: 1px solid rgba(128, 128, 128, 0.25); }
        #${CARD_ID} .co-stack td { display: flex; justify-content: space-between; gap: 0.3rem; border: 0; padding: 0.05rem 0; min-width: 0; }
        #${CARD_ID} .co-stack td.co-metric { grid-column: 1 / -1; grid-row: 1; font-weight: 600; font-size: 0.85rem; }
        #${CARD_ID} .co-stack td.co-sep { border-left: 0; }
        #${CARD_ID} .co-stack td[data-rank]::before { content: attr(data-rank); flex: none; width: 0.9rem; color: #888; }
        #${CARD_ID} .co-stack .co-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #${CARD_ID} .co-stack .co-val { flex: none; margin-left: 0; }
      }
      @media (max-width: 767.98px) {
        #${CARD_ID} .co-activity { font-size: 0.78rem; }
        #${CARD_ID} .co-activity th, #${CARD_ID} .co-activity td { padding: 0.25rem 0.15rem; }
      }`;
    document.head.appendChild(style);
  }

  function renderLeaderboards(card, metrics) {
    card.querySelector(".leaderboard-body").innerHTML = leaderboardTable(metrics);
  }

  // Plan's own cards for these extensions are replaced by the custom cards below
  const HIDDEN_EXTENSIONS = ["PlaceholderAPI"];

  function hideNativeExtensions() {
    document.querySelectorAll("main .extension-wrapper").forEach((wrapper) => {
      const title = wrapper.querySelector(".card-header h6");
      if (title && HIDDEN_EXTENSIONS.includes(title.textContent.trim())) wrapper.style.display = "none";
    });
  }

  function mountCard(route) {
    const main = document.querySelector("main");
    // Wait until Plan has rendered its own page content so the card lands below it
    if (!main || !main.querySelector(":scope > .load-in")) return;

    const existing = document.getElementById(CARD_ID);
    if (existing && existing.dataset.route === route.key) {
      if (main.lastElementChild !== existing) main.appendChild(existing);
      return;
    }
    if (existing) existing.remove();
    ensureStyles();

    // Reuse Plan's own card markup (row > col > card) so theme, dark mode and spacing are inherited
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "row";
    card.dataset.route = route.key;
    const isServer = route.type === "server";
    card.innerHTML = `
      <div class="col-12">
        <div class="card">
          <div class="card-header"><h6>📈 ${isServer ? "Resource Activity" : "Player Resource Activity"}</h6></div>
          <div class="card-body activity-body">Loading metrics...</div>
        </div>
      </div>
      ${isServer ? `
      <div class="col-12">
        <div class="card">
          <div class="card-header"><h6>🏆 Leaderboards</h6></div>
          <div class="card-body leaderboard-body">Loading metrics...</div>
        </div>
      </div>` : ""}
    `;
    main.appendChild(card);

    loadActivity()
      .then((metrics) => {
        // Ignore the result if the user navigated away while loading
        if (!card.isConnected) return;
        renderActivity(card, route, metrics);
        if (isServer) renderLeaderboards(card, metrics);
        // Coming back from a metric page: return to where the list was
        if (returnScroll) {
          window.scrollTo(0, returnScroll);
          returnScroll = 0;
        }
      })
      .catch((err) => {
        console.error("[Plan Custom Overview] Failed to load activity metrics:", err);
        card.querySelectorAll(".activity-body, .leaderboard-body").forEach((body) => {
          body.textContent = "Activity metrics not available yet.";
        });
      });
  }

  function mountMetricPage(route, view) {
    const main = document.querySelector("main");
    if (!main || !main.querySelector(":scope > .load-in")) return;

    const key = route.key + location.hash;
    const existing = document.getElementById(PAGE_ID);
    if (existing && existing.dataset.key === key) {
      if (main.lastElementChild !== existing) main.appendChild(existing);
      return;
    }
    if (existing) existing.remove();

    const page = document.createElement("div");
    page.id = PAGE_ID;
    page.className = "row";
    page.dataset.key = key;
    main.appendChild(page);
    window.scrollTo(0, 0);

    loadPageScript()
      .then(() => window.CustomMetricPage.render(page, { base: ASSET_BASE, route, view, navigate }))
      .catch((err) => {
        console.error("[Plan Custom Overview] Could not open the metric page:", err);
        page.textContent = "The metric page could not be loaded.";
      });
  }

  // While a metric page is open Plan's own overview content is hidden, so it reads as its own page
  function setNativeContentHidden(hidden) {
    const content = document.querySelector("main > .load-in");
    if (content) content.style.display = hidden ? "none" : "";
  }

  let returnScroll = 0;

  function sync() {
    hideNativeExtensions();
    const route = getRoute();
    if (!route) {
      [CARD_ID, PAGE_ID].forEach((id) => {
        const stale = document.getElementById(id);
        if (stale) stale.remove();
      });
      return;
    }
    const view = getView();
    setNativeContentHidden(Boolean(view));
    if (view) {
      const list = document.getElementById(CARD_ID);
      if (list) list.remove();
      mountMetricPage(route, view);
    } else {
      const page = document.getElementById(PAGE_ID);
      if (page) page.remove();
      mountCard(route);
    }
  }

  // Remember where the list was so Back puts you in the same place
  document.addEventListener("click", (event) => {
    if (event.target.closest("a.co-link")) returnScroll = window.scrollY;
  });
  window.addEventListener("hashchange", sync);

  // Plan is a React SPA, so re-sync on every DOM change (route changes, late renders)
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  }).observe(document.body, { childList: true, subtree: true });

  sync();
})();
