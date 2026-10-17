(function () {
  console.log("[Plan Custom Overview] Script loaded.");

  function tryInjectCard() {
    if (document.querySelector("#custom-overview-card")) return;

    // Target Plan's main view container
    const container = document.querySelector("main") || document.querySelector(".main-panel");
    if (!container) return;

    const card = document.createElement("div");
    card.id = "custom-overview-card";
    card.style.cssText = "margin: 20px 0; padding: 20px; background: #1e1e2d; color: #ffffff; border-radius: 8px; border: 1px solid #32324e; font-family: sans-serif;";
    card.innerHTML = `
      <h3 style="margin-top:0; color: #50fa7b; font-weight: 600;">⛏️ Key Resource Totals</h3>
      <p style="margin-bottom:0; color: #a6accd; font-size: 14px;">Custom telemetry card automatically rendered.</p>
    `;

    container.appendChild(card);
    console.log("[Plan Custom Overview] Card mounted to <main>.");
  }

  // 1. Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInjectCard);
  } else {
    tryInjectCard();
  }

  // 2. Poll every 500ms to catch React's initial mount cycle
  const interval = setInterval(tryInjectCard, 500);

  // 3. Observe dynamic SPA tab navigation DOM mutations
  const observer = new MutationObserver(() => tryInjectCard());
  observer.observe(document.body, { childList: true, subtree: true });
})();
