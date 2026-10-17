
(function () {
  console.log("[Plan Custom Overview] Persistent script active.");

  function injectCard() {
    if (document.querySelector("#custom-overview-card")) return;

    // Target <main> container identified during browser debugging
    const container = document.querySelector("main") || document.querySelector(".main-panel") || document.body;
    if (!container) return;

    const card = document.createElement("div");
    card.id = "custom-overview-card";
    card.style.cssText = "margin: 25px 0; padding: 20px; background: #1e1e2d; color: #ffffff; border-radius: 8px; border: 1px solid #32324e; font-family: sans-serif; clear: both;";
    card.innerHTML = `
      <h3 style="margin-top:0; color: #50fa7b; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span>⛏️</span> Key Resource Totals
      </h3>
      <p style="margin-bottom:0; color: #a6accd; font-size: 14px;">
        Custom Plan telemetry card injected via Nginx reverse proxy.
      </p>
    `;

    container.appendChild(card);
    console.log("[Plan Custom Overview] Card appended to <main> container.");
  }

  injectCard();

  // Observer keeps card mounted during client-side SPA tab switches
  const observer = new MutationObserver(injectCard);
  observer.observe(document.body, { childList: true, subtree: true });
})();
