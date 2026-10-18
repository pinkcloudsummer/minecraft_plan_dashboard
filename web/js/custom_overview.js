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
    const body = card.querySelector(".card-body");
    body.innerHTML = RESOURCES.map((r) => `
      <p>${r.label}<span class="float-end">${(totals[r.name] || 0).toLocaleString()}</span></p>`).join("");
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
    card.innerHTML = `
      <div class="col-lg-6 col-md-6">
        <div class="card">
          <div class="card-header"><h6>⛏️ ${route.type === "player" ? "Player" : "Key"} Resource Totals</h6></div>
          <div class="card-body">Loading metrics...</div>
        </div>
      </div>
    `;
    main.appendChild(card);

    loadTotals(route)
      .then((totals) => {
        // Ignore the result if the user navigated away while loading
        if (card.isConnected) renderRows(card, totals);
      })
      .catch((err) => {
        console.error("[Plan Custom Overview] Failed to load totals:", err);
        const body = card.querySelector(".card-body");
        if (body) body.textContent = "Metrics unavailable.";
      });
  }

  function sync() {
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
