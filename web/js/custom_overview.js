(function () {
    'use strict';

    console.log('[Plan Custom Overview] Script initialized.');

    // Keep polling (not just until first mount) so the card is re-injected after SPA page routing
    setInterval(function () {
        // Query selectors matching Plan server and player page wrappers
        const container = document.querySelector('#page-wrapper') ||
                          document.querySelector('.content') ||
                          document.querySelector('#main-content') ||
                          document.querySelector('.main-panel');

        if (!container) return;
        if (document.getElementById('custom-papi-overview-card')) return;

        renderOverviewCard(container);
    }, 200);

    function renderOverviewCard(container) {
        console.log('[Plan Custom Overview] Container found. Injecting custom card...');

        const card = document.createElement('div');
        card.id = 'custom-papi-overview-card';
        card.className = 'row';
        card.style.margin = '15px 0';

        card.innerHTML = `
            <div class="col-lg-12">
                <div class="card" style="background: #1e1e2d; color: #fff; padding: 20px; border-radius: 8px; border: 1px solid #2b2b40;">
                    <h3 style="margin-top: 0;">⛏️ Key Resource Totals</h3>
                    <div id="custom-papi-stats-list">
                        <div style="color: #aaa;">Loading aggregated metrics...</div>
                    </div>
                </div>
            </div>
        `;

        container.prepend(card);
        populateStats();
    }

    function populateStats() {
        fetch('/v1/players')
            .then(res => res.json())
            .then(players => {
                const statsList = document.getElementById('custom-papi-stats-list');
                if (!statsList) return;

                // Example JavaScript Aggregation Query across player payload
                let totalStone = 0;
                let totalCoal = 0;
                let totalIron = 0;

                // Aggregate / Diff stats dynamically in JS
                if (Array.isArray(players)) {
                    players.forEach(p => {
                        if (p.extensions) {
                            totalStone += parseInt(p.extensions['statistic_mine_block:stone'] || 0);
                            totalCoal += parseInt(p.extensions['statistic_mine_block:coal_ore'] || 0);
                            totalIron += parseInt(p.extensions['statistic_mine_block:iron_ore'] || 0);
                        }
                    });
                }

                statsList.innerHTML = `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span>🪨 Stone Mined:</span>
                        <strong>${totalStone.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span>⬛ Coal Ore:</span>
                        <strong>${totalCoal.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>⚙️ Iron Ore:</span>
                        <strong>${totalIron.toLocaleString()}</strong>
                    </div>
                `;
            })
            .catch(err => {
                const statsList = document.getElementById('custom-papi-stats-list');
                if (statsList) statsList.innerHTML = '<div style="color: #888;">Metrics aggregated via server tasks.</div>';
            });
    }
})();



