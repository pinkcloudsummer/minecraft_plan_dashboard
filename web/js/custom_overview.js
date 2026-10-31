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
      #${CARD_ID} .co-mobile-tabs { display: none; }
      #${CARD_ID} .co-records-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.65rem; }
      #${CARD_ID} .co-record-box { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 0.45rem; padding: 0.6rem 0.75rem; background: rgba(128, 128, 128, 0.04); display: flex; flex-direction: column; justify-content: space-between; transition: border-color 0.15s ease; }
      #${CARD_ID} .co-record-box:hover { border-color: rgba(74, 144, 226, 0.55); }
      #${CARD_ID} .co-rec-head { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; font-size: 0.78rem; font-weight: 600; opacity: 0.85; }
      #${CARD_ID} .co-rec-val { font-size: 1.25rem; font-weight: 700; line-height: 1.25; margin: 0.2rem 0 0.1rem; }
      #${CARD_ID} .co-rec-unit { font-size: 0.78rem; font-weight: 500; opacity: 0.7; margin-left: 0.2rem; }
      #${CARD_ID} .co-rec-meta { font-size: 0.75rem; opacity: 0.8; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem; }
      #${CARD_ID} .co-rec-top5 { margin-top: 0.45rem; padding-top: 0.4rem; border-top: 1px dashed rgba(128, 128, 128, 0.25); font-size: 0.73rem; display: none; }
      #${CARD_ID} .co-record-box.is-open .co-rec-top5 { display: block; }
      #${CARD_ID} .co-rec-toggle { cursor: pointer; user-select: none; font-size: 0.7rem; opacity: 0.65; text-decoration: underline dotted; }
      #${CARD_ID} .co-rec-row { display: flex; justify-content: space-between; gap: 0.35rem; padding: 0.08rem 0; }
      #${CARD_ID} .co-habits-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.65rem; }
      #${CARD_ID} .co-habit-box { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 0.45rem; padding: 0.65rem 0.75rem; background: rgba(128, 128, 128, 0.04); cursor: pointer; transition: border-color 0.15s ease; }
      #${CARD_ID} .co-habit-box:hover { border-color: rgba(74, 144, 226, 0.55); }
      #${CARD_ID} .co-habit-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.4rem; margin-bottom: 0.35rem; }
      #${CARD_ID} .co-habit-name { font-weight: 700; font-size: 0.92rem; color: inherit; text-decoration: none; border-bottom: 1px dotted rgba(128, 128, 128, 0.7); }
      #${CARD_ID} .co-habit-name:hover { color: #4a90e2; }
      #${CARD_ID} .co-habit-expand-hint { font-size: 0.72rem; opacity: 0.65; text-decoration: underline dotted; white-space: nowrap; }
      #${CARD_ID} .co-habit-details { display: none; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed rgba(128, 128, 128, 0.25); font-size: 0.75rem; cursor: default; }
      #${CARD_ID} .co-habit-box.is-open .co-habit-details { display: block; }
      #${CARD_ID} .co-dow-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.2rem; align-items: end; height: 42px; margin: 0.35rem 0 0.15rem; padding-top: 4px; }
      #${CARD_ID} .co-dow-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
      #${CARD_ID} .co-dow-fill { width: 100%; max-width: 18px; background: #4a90e2; border-radius: 2px 2px 0 0; min-height: 2px; }
      #${CARD_ID} .co-dow-lbl { font-size: 0.65rem; opacity: 0.7; margin-top: 2px; }
      #${CARD_ID} .co-split-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.2); margin: 0.35rem 0 0.25rem; }
      #${CARD_ID} .co-mix-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.2); margin: 0.35rem 0 0.25rem; }
      #${CARD_ID} .co-social-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
      #${CARD_ID} .co-social-box { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 0.45rem; padding: 0.65rem 0.75rem; background: rgba(128, 128, 128, 0.04); }
      #${CARD_ID} .co-social-title { font-size: 0.85rem; font-weight: 700; margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: space-between; }
      #${CARD_ID} .co-duo-row { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; padding: 0.25rem 0; border-bottom: 1px solid rgba(128, 128, 128, 0.14); font-size: 0.8rem; }
      #${CARD_ID} .co-duo-row:last-child { border-bottom: 0; }
      #${CARD_ID} .co-sub-badge { font-size: 0.7rem; opacity: 0.75; white-space: nowrap; }
      @media (max-width: 991.98px) {
        #${CARD_ID} .co-social-grid { grid-template-columns: 1fr; }
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
        #${CARD_ID} .co-mobile-tabs { display: flex; gap: 0.35rem; margin-bottom: 0.6rem; overflow-x: auto; padding-bottom: 0.15rem; }
        #${CARD_ID} .co-mobile-tabs button { flex: 1 1 auto; white-space: nowrap; font-size: 0.76rem; padding: 0.28rem 0.5rem; border-radius: 0.35rem; border: 1px solid rgba(128, 128, 128, 0.35); background: transparent; color: inherit; }
        #${CARD_ID} .co-mobile-tabs button.active { background: #4a90e2; border-color: #4a90e2; color: #fff; font-weight: 600; }
        #${CARD_ID} .co-tab-pane:not(.active) { display: none; }
        #${CARD_ID} .co-records-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.45rem; }
        #${CARD_ID} .co-record-box { padding: 0.45rem 0.55rem; }
        #${CARD_ID} .co-rec-val { font-size: 1.05rem; }
        #${CARD_ID} .co-habits-grid { grid-template-columns: 1fr; gap: 0.5rem; }
        #${CARD_ID} .co-activity { font-size: 0.78rem; }
        #${CARD_ID} .co-activity th, #${CARD_ID} .co-activity td { padding: 0.25rem 0.15rem; }
      }`;
    document.head.appendChild(style);
  }

  const MIX_COLORS = {
    mining: "#4a90e2",
    lumber: "#8b5a2b",
    farming: "#50b46b",
    crafting: "#f5a623",
    combat: "#e0556b",
    exploration: "#9b6bd1",
  };

  function fmtDateShort(dateStr) {
    if (!dateStr) return "";
    const parts = String(dateStr).split("-");
    if (parts.length !== 3) return dateStr;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function renderServerRecordsSection(records) {
    if (!records || !records.length) {
      return '<span class="text-muted">No server records recorded yet.</span>';
    }
    const boxes = records.map((rec) => {
      const topList = rec.top || [];
      const first = topList[0];
      if (!first) {
        return `<div class="co-record-box">
          <div class="co-rec-head"><span>${rec.icon} ${escapeHtml(rec.title)}</span></div>
          <div class="co-rec-val text-muted">–</div>
          <div class="co-rec-meta"><span>${escapeHtml(rec.subtitle || "")}</span></div>
        </div>`;
      }
      const mainVal = first.display_value ? escapeHtml(first.display_value) : fmt(first.value, rec.kind === "day_hours" ? "ratio" : "sum");
      const unitStr = first.display_value ? "" : `<span class="co-rec-unit">${escapeHtml(first.unit || "")}</span>`;
      let subLeft = fmtDateShort(first.date);
      let subRight = "";
      if (rec.kind === "people") {
        subRight = first.top_player ? escapeHtml(first.top_player) : "";
      } else if (rec.kind === "session") {
        subRight = `${escapeHtml(first.top_player || "")} (${first.active_pct ?? 100}% active)`;
      } else if (first.top_player) {
        const topVal = first.top_player_value ? ` (${fmt(first.top_player_value)})` : "";
        subRight = `🏅 ${escapeHtml(first.top_player)}${topVal}`;
      }

      const moreRows = topList.slice(1, 5).map((item, idx) => {
        const vStr = item.display_value ? escapeHtml(item.display_value) : `${fmt(item.value)} ${escapeHtml(item.unit || "")}`;
        const who = item.top_player ? ` · ${escapeHtml(item.top_player)}` : "";
        return `<div class="co-rec-row"><span>#${idx + 2} ${escapeHtml(fmtDateShort(item.date))}${who}</span><strong>${vStr}</strong></div>`;
      }).join("");

      const toggleBtn = moreRows ? `<span class="co-rec-toggle" data-rec-toggle>Top ${topList.length} ▾</span>` : "";
      const top5Block = moreRows ? `<div class="co-rec-top5">${moreRows}</div>` : "";

      return `<div class="co-record-box">
        <div>
          <div class="co-rec-head"><span>${rec.icon} ${escapeHtml(rec.title)}</span>${toggleBtn}</div>
          <div class="co-rec-val">${mainVal}${unitStr}</div>
        </div>
        <div>
          <div class="co-rec-meta"><span>📅 ${escapeHtml(subLeft)}</span><span>${subRight}</span></div>
          ${top5Block}
        </div>
      </div>`;
    }).join("");

    return `<div class="co-records-grid">${boxes}</div>`;
  }

  const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function renderHabitBox(p, startExpanded) {
    const wkdayPct = p.weekday_pct !== undefined ? p.weekday_pct : (100 - (p.weekend_pct || 0));
    const wkendPct = p.weekend_pct || 0;
    const splitBar = `<div class="co-split-bar" title="Weekdays: ${wkdayPct}% · Weekends: ${wkendPct}%">
      <div style="width:${wkdayPct}%;background:#4a90e2"></div>
      <div style="width:${wkendPct}%;background:#50b46b"></div>
    </div>`;

    // Expanded section: Day-of-week mini bars, Time-of-day blocks, and Activity timing breakdown
    const dowHist = p.weekdays_histogram || [0, 0, 0, 0, 0, 0, 0];
    const maxDow = Math.max(0.01, ...dowHist);
    const dowBarsHtml = `<div class="co-dow-bars">
      ${dowHist.map((val, i) => {
        const hPct = Math.round((val / maxDow) * 100);
        const color = i >= 5 ? "#50b46b" : "#4a90e2";
        return `<div class="co-dow-col" title="${WEEKDAY_SHORT[i]}: ${val}h">
          <div class="co-dow-fill" style="height:${Math.max(6, hPct)}%;background:${color}"></div>
          <span class="co-dow-lbl">${WEEKDAY_SHORT[i][0]}</span>
        </div>`;
      }).join("")}
    </div>`;

    const todList = (p.time_of_day_split || []).filter((t) => t.pct > 0);
    const todHtml = todList.length
      ? `<div class="mt-2">
          <div class="fw-semibold opacity-75 mb-1">Time of Day Split</div>
          ${todList.map((t) => `<div class="co-rec-row"><span>${escapeHtml(t.label)}</span><strong>${t.pct}% <span class="text-muted fw-normal">(${t.hours}h)</span></strong></div>`).join("")}
        </div>`
      : "";

    const mix = p.activity_mix || [];
    const mixHtml = mix.length
      ? `<div class="mt-2">
          <div class="fw-semibold opacity-75 mb-1">Session Activity &amp; When It Happens</div>
          ${mix.map((m) => {
            const timing = m.peak_day && m.peak_hour
              ? ` · most on ${escapeHtml(m.peak_day)} (${m.peak_day_pct}%) @ ${escapeHtml(m.peak_hour)}`
              : "";
            return `<div class="co-rec-row">
              <span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${MIX_COLORS[m.key] || "#4a90e2"};margin-right:4px"></i>${escapeHtml(m.short)}${timing}</span>
              <strong>${m.share_pct}%</strong>
            </div>`;
          }).join("")}
        </div>`
      : "";

    const playerUrl = `/player/${encodeURIComponent(p.uuid)}/overview`;

    return `<div class="co-habit-box${startExpanded ? " is-open" : ""}" data-habit-box>
      <div class="co-habit-head">
        <a class="co-habit-name" href="${playerUrl}" data-player-link title="Open player overview page">${escapeHtml(p.name)}</a>
        <span class="co-habit-expand-hint" data-habit-toggle>${startExpanded ? "Details ▴" : "Time split ▾"}</span>
      </div>
      <div class="co-rec-meta">
        <span>🕒 Fav time: <strong>${escapeHtml(p.fav_hour_label)}</strong> (${p.fav_hour_pct}%)</span>
        <span>📅 Fav day: <strong>${escapeHtml(p.fav_weekday_short)}</strong> (${p.fav_weekday_pct}%)</span>
      </div>
      ${splitBar}
      <div class="co-rec-meta">
        <span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:#4a90e2;margin-right:3px"></i>Wkday ${wkdayPct}% · <i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:#50b46b;margin-right:3px"></i>Wknd ${wkendPct}%</span>
        <span>${p.total_hours}h (${p.session_count} sess)</span>
      </div>
      <div class="co-rec-meta mt-1">
        <span>avg ${p.avg_session_mins}m · max ${escapeHtml(p.longest_session_display || "0m")}</span>
        <span>${p.active_days || 0} active d${p.tiny_sessions ? ` · ${p.tiny_sessions} tiny` : ""}</span>
      </div>
      <div class="co-habit-details" data-habit-details>
        <div class="fw-semibold opacity-75">Day of Week Distribution</div>
        ${dowBarsHtml}
        ${todHtml}
        ${mixHtml}
        <div class="mt-2 pt-1 text-end">
          <a class="co-link small fw-semibold" href="${playerUrl}" data-player-link>Open Player Overview →</a>
        </div>
      </div>
    </div>`;
  }

  function renderServerHabitsSection(habitsMap) {
    const list = Object.values(habitsMap || {}).filter((p) => p.session_count > 0 || (p.activity_mix && p.activity_mix.length > 0));
    list.sort((a, b) => (b.total_hours - a.total_hours) || (b.session_count - a.session_count));
    if (!list.length) {
      return '<span class="text-muted">No session habit profiles available yet.</span>';
    }
    return `<div class="co-habits-grid">${list.map((p) => renderHabitBox(p, false)).join("")}</div>`;
  }

  function renderServerSocialSection(social) {
    if (!social) return '<span class="text-muted">No co-play data available yet.</span>';
    const duos = social.top_duos || [];
    const ships = social.ships_in_night || [];
    const soloSocial = social.solo_vs_social || [];

    const duosHtml = duos.length
      ? duos.slice(0, 6).map((d) => `<div class="co-duo-row">
          <span><strong>${escapeHtml(d.name1)}</strong> &amp; <strong>${escapeHtml(d.name2)}</strong></span>
          <span class="text-end"><strong>${escapeHtml(d.shared_display)}</strong> <span class="co-sub-badge">(${d.overlap_pct}% overlap · ${d.shared_sessions} sess)</span></span>
        </div>`).join("")
      : '<div class="text-muted small">No overlapping sessions recorded yet.</div>';

    const shipsHtml = ships.length
      ? ships.slice(0, 6).map((s) => {
          const missBadge = s.near_misses > 0
            ? `${s.near_misses} near-miss${s.near_misses === 1 ? "" : "es"} (<30m)`
            : s.closest_gap_mins !== null ? `closest gap ${s.closest_gap_mins}m` : "never crossed paths";
          return `<div class="co-duo-row">
            <span><strong>${escapeHtml(s.name1)}</strong> &amp; <strong>${escapeHtml(s.name2)}</strong></span>
            <span class="text-end"><span class="co-sub-badge">${s.overlap_pct}% overlap · ${escapeHtml(missBadge)}</span></span>
          </div>`;
        }).join("")
      : '<div class="text-muted small">Not enough player pairs to compare yet.</div>';

    const socialHtml = soloSocial.length
      ? soloSocial.slice(0, 6).map((p) => `<div class="co-duo-row">
          <span><strong>${escapeHtml(p.name)}</strong> <span class="co-sub-badge">(${p.total_hours}h)</span></span>
          <span class="text-end">🤝 ${p.social_pct}% group · 🐺 ${p.solo_pct}% solo</span>
        </div>`).join("")
      : '<div class="text-muted small">No session overlap breakdown yet.</div>';

    return `<div class="co-social-grid">
      <div class="co-social-box">
        <div class="co-social-title"><span>🤝 Dynamic Duos (Most Time Together)</span></div>
        ${duosHtml}
      </div>
      <div class="co-social-box">
        <div class="co-social-title"><span>🚢 Ships in the Night (Keep Missing Each Other)</span></div>
        ${shipsHtml}
      </div>
      <div class="co-social-box">
        <div class="co-social-title"><span>🧲 Social Butterfly vs. Lone Wolf</span></div>
        ${socialHtml}
      </div>
    </div>`;
  }

  function renderInsights(card, route, metrics) {
    const insights = metrics.insights;
    if (!insights) return;

    if (route.type === "server") {
      const container = card.querySelector(".insights-body");
      if (!container) return;
      container.innerHTML = `
        <div class="co-mobile-tabs">
          <button type="button" class="active" data-co-tab="records">🏅 Top Days &amp; Records</button>
          <button type="button" data-co-tab="habits">🕒 Session Habits</button>
          <button type="button" data-co-tab="social">🤝 Co-Play &amp; Missed</button>
        </div>
        <div class="co-tab-pane active" data-co-pane="records">
          <div class="small text-muted mb-2">All-time single-day server highs and marathon milestones. Click any card with a <em>Top 5</em> link to expand runner-up days.</div>
          ${renderServerRecordsSection(insights.records)}
        </div>
        <div class="co-tab-pane mt-3" data-co-pane="habits">
          <h6 class="mb-2" style="font-size:0.9rem;font-weight:700">🕒 Player Session &amp; Time Split</h6>
          <div class="small text-muted mb-2">Weekday vs. weekend and favorite hour of the day. Click a card to expand full day/time and session activity breakdowns, or click a player's name to open their page.</div>
          ${renderServerHabitsSection(insights.habits)}
        </div>
        <div class="co-tab-pane mt-3" data-co-pane="social">
          <h6 class="mb-2" style="font-size:0.9rem;font-weight:700">🤝 Co-Play Dynamics &amp; Missed Connections</h6>
          ${renderServerSocialSection(insights.social)}
        </div>
      `;

      // Bind Top-5 expanders on record boxes
      container.querySelectorAll("[data-rec-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const box = btn.closest(".co-record-box");
          if (box) box.classList.toggle("is-open");
        });
      });

      // Bind expandable player habit cards
      container.querySelectorAll("[data-habit-box]").forEach((box) => {
        box.addEventListener("click", (event) => {
          if (event.target.closest("[data-player-link]")) return;
          box.classList.toggle("is-open");
          const hint = box.querySelector("[data-habit-toggle]");
          if (hint) hint.textContent = box.classList.contains("is-open") ? "Details ▴" : "Time split ▾";
        });
      });

      // Bind mobile tab switcher
      const tabBtns = container.querySelectorAll("[data-co-tab]");
      const panes = container.querySelectorAll("[data-co-pane]");
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = btn.dataset.coTab;
          tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
          panes.forEach((p) => {
            p.classList.toggle("active", p.dataset.coPane === target);
            if (window.innerWidth <= 767.98) {
              p.classList.remove("mt-3");
            }
          });
        });
      });
    } else {
      const container = card.querySelector(".player-insights-body");
      if (!container) return;
      const pHabit = insights.habits && insights.habits[route.id];
      const pSocial = insights.social && insights.social.by_player && insights.social.by_player[route.id];
      if (!pHabit && !pSocial) {
        container.textContent = "No session insights recorded for this player yet.";
        return;
      }
      const buddies = (pSocial && pSocial.buddies) || [];
      const missed = (pSocial && pSocial.missed) || [];

      const buddiesHtml = buddies.length
        ? buddies.map((b) => `<div class="co-duo-row"><span><strong>${escapeHtml(b.name)}</strong></span><span>${escapeHtml(b.shared_display)} <span class="co-sub-badge">(${b.overlap_pct}% of playtime)</span></span></div>`).join("")
        : '<div class="text-muted small">No co-play overlap recorded yet.</div>';

      const missedHtml = missed.length
        ? missed.map((m) => `<div class="co-duo-row"><span><strong>${escapeHtml(m.name)}</strong></span><span class="co-sub-badge">${m.near_misses ? `${m.near_misses} near-misses (<30m)` : `${m.overlap_pct}% overlap`}</span></div>`).join("")
        : '<div class="text-muted small">No missed connections detected.</div>';

      container.innerHTML = `
        <div class="co-social-grid">
          ${pHabit ? renderHabitBox(pHabit, true) : ""}
          <div class="co-social-box">
            <div class="co-social-title"><span>🤝 Top Co-Play Buddies</span><span class="co-sub-badge">${pSocial ? `${pSocial.social_pct}% group / ${pSocial.solo_pct}% solo` : ""}</span></div>
            ${buddiesHtml}
          </div>
          <div class="co-social-box">
            <div class="co-social-title"><span>🚢 Ships in the Night</span></div>
            ${missedHtml}
          </div>
        </div>
      `;

      container.querySelectorAll("[data-habit-box]").forEach((box) => {
        box.addEventListener("click", (event) => {
          if (event.target.closest("[data-player-link]")) return;
          box.classList.toggle("is-open");
          const hint = box.querySelector("[data-habit-toggle]");
          if (hint) hint.textContent = box.classList.contains("is-open") ? "Details ▴" : "Time split ▾";
        });
      });
    }
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
          <div class="card-header"><h6>${isServer ? "🏛️ All-Time Server Records &amp; Session Insights" : "🕒 Player Session Profile &amp; Co-Play"}</h6></div>
          <div class="card-body ${isServer ? "insights-body" : "player-insights-body"}">Loading insights...</div>
        </div>
      </div>
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
        renderInsights(card, route, metrics);
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
        card.querySelectorAll(".insights-body, .player-insights-body, .activity-body, .leaderboard-body").forEach((body) => {
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
