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
    const body = card.querySelector(".custom-overview-body");
    body.innerHTML = RESOURCES.map((r) => `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span>${r.label}</span>
        <strong>${(totals[r.name] || 0).toLocaleString()}</strong>
      </div>`).join("");
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

    const card = document.createElement("div");
    card.id = CARD_ID;
    card.dataset.route = route.key;
    card.style.cssText = "margin: 25px 0; padding: 20px; background: #1e1e2d; color: #ffffff; border-radius: 8px; border: 1px solid #32324e; font-family: sans-serif; clear: both;";
    card.innerHTML = `
      <h3 style="margin-top:0; color: #50fa7b; font-weight: 600;">⛏️ ${route.type === "player" ? "Player" : "Key"} Resource Totals</h3>
      <div class="custom-overview-body" style="color: #a6accd;">Loading metrics...</div>
    `;
    main.appendChild(card);

    loadTotals(route)
      .then((totals) => {
        // Ignore the result if the user navigated away while loading
        if (card.isConnected) renderRows(card, totals);
      })
      .catch((err) => {
        console.error("[Plan Custom Overview] Failed to load totals:", err);
        const body = card.querySelector(".custom-overview-body");
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
