
(function () {
  console.log("[Plan Custom Overview] Script initialized.");

  function injectCard() {
    if (document.querySelector("#custom-overview-card")) return;

    // Target <main> confirmed by browser DOM debugger
    const container = document.querySelector("main") || document.body;

    const card = document.createElement("div");
    card.id = "custom-overview-card";
    card.style.cssText = "margin: 20px 0; padding: 20px; background: #1e1e2d; color: #ffffff; border-radius: 8px; border: 1px solid #32324e; font-family: sans-serif;";
    card.innerHTML = `
      <h3 style="margin-top:0; color: #50fa7b; font-weight: 600;">⛏️ Key Resource Totals</h3>
      <p style="margin-bottom:0; color: #a6accd; font-size: 14px;">Custom Plan telemetry card rendered successfully.</p>
    `;

    container.appendChild(card);
    console.log("[Plan Custom Overview] Card successfully appended to <main>.");
  }

  injectCard();

  // MutationObserver handles client-side SPA tab changes
  const observer = new MutationObserver(injectCard);
  observer.observe(document.body, { childList: true, subtree: true });
})();
