(function () {
  console.log("[Plan Custom Overview] Script initialized.");

  function injectCard() {
    if (document.querySelector("#custom-overview-card")) return;

    // Target Plan's inner main grid wrapper (skipping body so it stays within content margins)
    const container = document.querySelector(".content .container-fluid") || 
                      document.querySelector(".content") || 
                      document.querySelector(".main-panel") || 
                      document.querySelector("#page-wrapper");

    if (!container) return;

    const card = document.createElement("div");
    card.id = "custom-overview-card";
    card.className = "row";
    card.style.cssText = "margin-top: 25px; margin-bottom: 25px; width: 100%;";
    card.innerHTML = `
      <div class="col-12" style="width: 100%;">
        <div class="card" style="background: #ffffff; color: #2c3e50; padding: 20px; border-radius: 6px; border: 1px solid #e3e3e3; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
          <h4 style="margin-top:0; font-weight: 600; color: #1b1e24;">⛏️ Key Resource Totals</h4>
          <p style="margin-bottom:0; color: #6c757d; font-size: 14px;">Custom analytics telemetry appended to bottom of dashboard overview.</p>
        </div>
      </div>
    `;

    // appendChild places the card at the very bottom of the overview container
    container.appendChild(card);
    console.log("[Plan Custom Overview] Card successfully appended to bottom of container.");
  }

  injectCard();

  // MutationObserver maintains the card during dynamic SPA tab navigation
  const observer = new MutationObserver(injectCard);
  observer.observe(document.body, { childList: true, subtree: true });
})();