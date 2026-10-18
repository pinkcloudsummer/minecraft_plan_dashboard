(function () {
  console.log("[Plan Custom Overview] Script loaded.");

  const CARD_ID = "custom-overview-card";

  // PlaceholderAPI extension values summed into the card
  const RESOURCES = [
    { name: "statistic_mine_block:stone", label: "🪨 Stone Mined" },
    { name: "statistic_mine_block:coal_ore", label: "⬛ Coal Ore" },
    { name: "statistic_mine_block:iron_ore", label: "⚙️ Iron Ore" },
    { name: "statistic_mine_block:copper_ore", label: "🟧 Copper Ore" },
    { name: "statistic_mine_block:diamond_ore", label: "💎 Diamond Ore" },
  ];

  // Only these pages get a card: server overview, plugins overview, player overview
  function getRoute() {
    const m = location.pathname.match(/^\/(server|player)\/([^/]+)\/(overview|plugins-overview)\/?$/);
    if (!m) return null;
    const [, type, id, page] = m;
    if (type === "player" && page !== "overview") return null;
    return { type, id, key: location.pathname };
  }

  function sumValues(extensionDataList, totals) {
    extensionDataList.forEach((ext) => {
      (ext.tabs || []).forEach((tab) => {
        (tab.values || []).forEach((v) => {
          const name = v.description && v.description.name;
          if (!RESOURCES.some((r) => r.name === name)) return;
          totals[name] = (totals[name] || 0) + (parseInt(v.value, 10) || 0);
        });
      });
    });
  }

  async function loadTotals(route) {
    const totals = {};
    if (route.type === "server") {
      const res = await fetch("/v1/extensionData?server=" + route.id);
      sumValues((await res.json()).extensions || [], totals);
    } else {
      const res = await fetch("/v1/player?player=" + route.id);
      // One entry per server the player has data on
      ((await res.json()).extensions || []).forEach((entry) => sumValues(entry.extensionData || [], totals));
    }
    return totals;
  }

  function renderRows(card, totals) {
    const body = card.querySelector(".totals-body");
    body.innerHTML = RESOURCES.map((r) => `
      <p>${r.label}<span class="float-end">${(totals[r.name] || 0).toLocaleString()}</span></p>`).join("");
  }

  // Precomputed server-side by scripts/build_metrics.py from the snapshot database
  async function loadActivity() {
    const res = await fetch("/custom_assets/metrics.json?t=" + Date.now());
    if (!res.ok) throw new Error("metrics.json returned " + res.status);
    return res.json();
  }

  function escapeHtml(text) {
    const el = document.createElement("div");
    el.textContent = text;
    return el.innerHTML;
  }

  // Ratios need more precision than counts (1.37 vs 1.4)
  function fmt(value, kind) {
    if (value === null || value === undefined) return "–";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: kind === "ratio" ? 2 : 1 });
  }

  function labelFor(resource) {
    const known = RESOURCES.find((r) => r.name === resource.name);
    // Keep the emoji from RESOURCES but use the short name so table rows don't wrap
    return known ? `${known.label.split(" ")[0]} ${resource.label}` : resource.label;
  }

  function renderActivity(card, route, metrics) {
    const body = card.querySelector(".activity-body");
    const isPlayer = route.type === "player";
    const source = isPlayer ? metrics.players[route.id] : metrics.server;
    if (!source) {
      body.textContent = "No activity recorded for this player yet.";
      return;
    }

    const columns = [["total", "Total"], ["gain_24h", "24h"], ["gain_7d", "7d"], ["per_hour", "/hr"]];
    if (isPlayer) columns.push(["avg_per_session", "/session"]);

    const header = columns.map(([, title]) => `<th class="text-end">${title}</th>`).join("");
    const rows = metrics.resources.map((r) => {
      const cells = columns.map(([key]) => `<td class="text-end">${fmt(source[key] && source[key][r.name], r.kind)}</td>`).join("");
      return `<tr><td>${labelFor(r)}</td>${cells}</tr>`;
    }).join("");

    let html = `<table class="table table-sm mb-3"><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table>`;

    const since = new Date(metrics.tracking_since).toLocaleDateString();
    html += `<small class="text-muted">Gains count from ${since} (when tracking began). /hr uses lifetime totals over active playtime.</small>`;
    body.innerHTML = html;
  }

  function leaderboardTable(metrics, key) {
    const rows = metrics.resources.map((r) => {
      const top = (metrics.leaderboards[r.name] && metrics.leaderboards[r.name][key]) || [];
      const cells = [0, 1, 2].map((i) => top[i]
        ? `<td>${escapeHtml(top[i].name)} <span class="text-muted">${fmt(top[i].value, r.kind)}</span></td>`
        : "<td>–</td>").join("");
      return `<tr><td>${labelFor(r)}</td>${cells}</tr>`;
    }).join("");
    return `<table class="table table-sm mb-3"><thead><tr><th></th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderLeaderboards(card, metrics) {
    const body = card.querySelector(".leaderboard-body");
    body.innerHTML = `
      <p><strong>All time</strong></p>${leaderboardTable(metrics, "total")}
      <p><strong>Last 7 days</strong></p>${leaderboardTable(metrics, "gain_7d")}`;
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

    // Reuse Plan's own card markup (row > col > card) so theme, dark mode and spacing are inherited
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "row";
    card.dataset.route = route.key;
    const isServer = route.type === "server";
    card.innerHTML = `
      <div class="col-lg-6 col-md-6">
        <div class="card">
          <div class="card-header"><h6>⛏️ ${route.type === "player" ? "Player" : "Key"} Resource Totals</h6></div>
          <div class="card-body totals-body">Loading metrics...</div>
        </div>
      </div>
      <div class="col-lg-6 col-md-6">
        <div class="card">
          <div class="card-header"><h6>📈 Resource Activity</h6></div>
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

    loadTotals(route)
      .then((totals) => {
        // Ignore the result if the user navigated away while loading
        if (card.isConnected) renderRows(card, totals);
      })
      .catch((err) => {
        console.error("[Plan Custom Overview] Failed to load totals:", err);
        const body = card.querySelector(".totals-body");
        if (body) body.textContent = "Metrics unavailable.";
      });

    loadActivity()
      .then((metrics) => {
        if (!card.isConnected) return;
        renderActivity(card, route, metrics);
        if (isServer) renderLeaderboards(card, metrics);
      })
      .catch((err) => {
        console.error("[Plan Custom Overview] Failed to load activity metrics:", err);
        card.querySelectorAll(".activity-body, .leaderboard-body").forEach((body) => {
          body.textContent = "Activity metrics not available yet.";
        });
      });
  }

  function sync() {
    hideNativeExtensions();
    const route = getRoute();
    if (!route) {
      const stale = document.getElementById(CARD_ID);
      if (stale) stale.remove();
      return;
    }
    mountCard(route);
  }

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
