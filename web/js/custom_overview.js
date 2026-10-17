(function () {
    'use strict';

    // 1. Wait for Plan's dashboard DOM to load
    document.addEventListener('DOMContentLoaded', function () {
        initOverviewWidget();
    });

    function initOverviewWidget() {
        // Target the Server Overview main container
        const overviewContainer = document.querySelector('#overview, .overview-cards, #main-content');
        if (!overviewContainer) {
            setTimeout(initOverviewWidget, 1000);
            return;
        }

        // Prevent duplicate injection
        if (document.getElementById('custom-papi-overview-card')) return;

        // 2. Fetch server extension data from Plan's API
        fetch('/v1/server')
            .then(response => response.json())
            .then(data => {
                renderOverviewCard(overviewContainer, data);
            })
            .catch(err => console.error('[CustomOverview] Error fetching server stats:', err));
    }

    function renderOverviewCard(container, data) {
        // Build card element
        const card = document.createElement('div');
        card.id = 'custom-papi-overview-card';
        card.className = 'card col-12 col-md-6 col-lg-4 mb-4';
        card.style.cssText = 'background: #2b2b2b; color: #fff; border-radius: 8px; padding: 15px; margin-bottom: 20px;';

        card.innerHTML = `
            <div class="card-header" style="font-weight: bold; font-size: 1.1em; border-bottom: 1px solid #444; padding-bottom: 8px;">
                ⛏️ Key Resource Totals (Server Overview)
            </div>
            <div class="card-body" id="custom-papi-stats-list" style="padding-top: 10px;">
                <div style="color: #aaa;">Loading aggregated metrics...</div>
            </div>
        `;

        // Insert card at top of overview container
        container.insertBefore(card, container.firstChild);

        // Populate metrics from extension providers
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
