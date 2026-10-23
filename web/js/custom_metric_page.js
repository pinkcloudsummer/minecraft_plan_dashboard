(function () {
  "use strict";

  const HOUR = 3600000;
  const PALETTE = ["#4a90e2", "#50b46b", "#f5a623", "#e0556b", "#9b6bd1", "#2cb5b5"];
  const OTHER_COLOR = "#a0a0a0";
  const STYLE_ID = "custom-metric-style";
  const MAX_DAYS_SHOWN = 60;
  const MAX_WEEKS_SHOWN = 12;
  const SESSIONS_SHOWN = 10;
  const TYPE_NOTES = {
    single: "Single stat",
    aggregate: "Combined stat",
    ratio: "Ratio",
  };

  // ---------- small helpers ----------

  function esc(text) {
    const el = document.createElement("div");
    el.textContent = text === null || text === undefined ? "" : String(text);
    return el.innerHTML;
  }

  function fmt(value, ratio) {
    if (value === null || value === undefined || !isFinite(value)) return "–";
    const digits = ratio ? 2 : Math.abs(value) >= 100 ? 0 : 1;
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function trendOf(current, previous) {
    if (!previous) return null;
    return ((current - previous) / previous) * 100;
  }

  function trendHtml(change) {
    if (change === null) return '<span class="text-muted">–</span>';
    const cls = change > 0 ? "cm-up" : change < 0 ? "cm-down" : "text-muted";
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
    return `<span class="${cls}">${arrow} ${Math.abs(Math.round(change))}%</span>`;
  }

  const ratioOf = (numerator, denominator) => (denominator > 0 ? numerator / denominator : null);

  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const addDays = (ts, n) => {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };
  const startOfWeek = (ts) => {
    const d = new Date(startOfDay(ts));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const dateLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ---------- turning hourly gains into days, weeks and rhythms ----------

  function mergePairs(lists) {
    const merged = new Map();
    lists.forEach((pairs) => pairs.forEach(([hour, gain]) => merged.set(hour, (merged.get(hour) || 0) + gain)));
    return merged;
  }

  function bucketBy(map, keyOf) {
    const buckets = new Map();
    map.forEach((gain, hour) => {
      const key = keyOf(hour);
      buckets.set(key, (buckets.get(key) || 0) + gain);
    });
    return buckets;
  }

  function dayStarts(firstTs, nowTs) {
    const days = [];
    for (let d = startOfDay(firstTs); d <= nowTs; d = addDays(d, 1)) days.push(d);
    return days.slice(-MAX_DAYS_SHOWN);
  }

  function weekStarts(firstTs, nowTs) {
    const weeks = [];
    for (let w = startOfWeek(firstTs); w <= nowTs; w = addDays(w, 7)) weeks.push(w);
    return weeks.slice(-MAX_WEEKS_SHOWN);
  }

  function rhythm(map) {
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    map.forEach((gain, hour) => {
      const d = new Date(hour);
      hours[d.getHours()] += gain;
      weekdays[(d.getDay() + 6) % 7] += gain;
    });
    return { hours, weekdays };
  }

  // Numbers for one block (the stat, or one side of a ratio) limited to a player or the whole server
  function scopedBlock(block, scope) {
    const ids = (scope ? [scope] : Object.keys(block.total)).filter((id) => block.total[id] !== undefined);
    const add = (byPlayer) => ids.reduce((sum, id) => sum + (byPlayer[id] || 0), 0);
    const win = (windows, key) => ids.reduce((sum, id) => sum + ((windows[id] || {})[key] || 0), 0);
    const pairs = (hourly) => mergePairs(ids.map((id) => hourly[id] || []));
    return {
      ids,
      total: add(block.total),
      d1: win(block.windows, "d1"),
      d7: win(block.windows, "d7"),
      p7: win(block.windows, "p7"),
      pairs: pairs(block.hourly),
      components: block.components.map((c) => ({
        ...c,
        total: add(block.component_totals[c.name] || {}),
        d1: win(block.component_windows[c.name] || {}, "d1"),
        d7: win(block.component_windows[c.name] || {}, "d7"),
        p7: win(block.component_windows[c.name] || {}, "p7"),
        pairs: () => pairs(block.component_hourly[c.name] || {}),
      })),
    };
  }

  // ---------- SVG charts (sized to their container, so they stay readable on phones) ----------

  function niceMax(value) {
    if (value <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const f = value / power;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
  }

  function axisFormat(value) {
    return Math.abs(value) >= 1000 ? Number(value).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }) : fmt(value, value % 1 !== 0 && Math.abs(value) < 10);
  }

  function frame(el, cfg) {
    const width = Math.max(240, el.clientWidth || 320);
    const height = cfg.height || 200;
    const m = { l: 42, r: 8, t: 8, b: 24 };
    const max = niceMax(cfg.max);
    const iw = width - m.l - m.r;
    const ih = height - m.t - m.b;
    const y = (v) => m.t + ih - (v / max) * ih;
    const n = cfg.labels.length;
    let parts = "";
    [0, 0.5, 1].forEach((f) => {
      const yy = y(max * f);
      parts += `<line x1="${m.l}" x2="${width - m.r}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity="0.15"/>`;
      parts += `<text x="${m.l - 5}" y="${yy + 4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.65">${axisFormat(max * f)}</text>`;
    });
    const band = iw / Math.max(n, 1);
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 52))));
    cfg.labels.forEach((label, i) => {
      if (i % step !== 0) return;
      parts += `<text x="${m.l + band * (i + 0.5)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.65">${esc(label)}</text>`;
    });
    return { width, height, m, iw, ih, y, band, n, parts, max };
  }

  function tipLayer(f, cfg) {
    // Invisible full-height columns carry the tooltip text for mouse and touch
    let parts = "";
    for (let i = 0; i < f.n; i++) {
      const tip = esc(cfg.tip(i));
      parts += `<rect x="${f.m.l + f.band * i}" y="${f.m.t}" width="${f.band}" height="${f.ih}" fill="transparent" data-tip="${tip}"/>`;
    }
    return parts;
  }

  function drawBars(el, cfg) {
    const stacked = cfg.stacked;
    const sums = cfg.labels.map((_, i) => cfg.series.reduce((s, sr) => s + (sr.values[i] || 0), 0));
    const peak = stacked ? Math.max(0, ...sums) : Math.max(0, ...cfg.series.flatMap((sr) => sr.values.map((v) => v || 0)));
    const f = frame(el, { ...cfg, max: peak });
    let bars = "";
    const count = cfg.series.length;
    for (let i = 0; i < f.n; i++) {
      let base = 0;
      cfg.series.forEach((sr, s) => {
        const value = sr.values[i] || 0;
        if (value <= 0) return;
        const groupW = f.band * 0.78;
        const w = stacked ? groupW : groupW / count;
        const x = f.m.l + f.band * i + (f.band - groupW) / 2 + (stacked ? 0 : w * s);
        const top = f.y(stacked ? base + value : value);
        const bottom = f.y(stacked ? base : 0);
        bars += `<rect x="${x}" y="${top}" width="${Math.max(w - 0.5, 1)}" height="${Math.max(bottom - top, 0)}" fill="${sr.color}" rx="1"/>`;
        if (stacked) base += value;
      });
    }
    el.innerHTML = `<svg width="${f.width}" height="${f.height}" role="img">${f.parts}${bars}${tipLayer(f, cfg)}</svg>`;
  }

  function drawLines(el, cfg) {
    const peak = Math.max(0, ...cfg.series.flatMap((sr) => sr.values.filter((v) => v !== null && v !== undefined)));
    const f = frame(el, { ...cfg, max: peak });
    let lines = "";
    cfg.series.forEach((sr) => {
      let path = "";
      let pen = false;
      sr.values.forEach((v, i) => {
        if (v === null || v === undefined) {
          pen = false;
          return;
        }
        const x = f.m.l + f.band * (i + 0.5);
        path += `${pen ? "L" : "M"}${x},${f.y(v)}`;
        pen = true;
      });
      lines += `<path d="${path}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round"/>`;
      if (f.n <= 40) {
        sr.values.forEach((v, i) => {
          if (v === null || v === undefined) return;
          lines += `<circle cx="${f.m.l + f.band * (i + 0.5)}" cy="${f.y(v)}" r="2.5" fill="${sr.color}"/>`;
        });
      }
    });
    el.innerHTML = `<svg width="${f.width}" height="${f.height}" role="img">${f.parts}${lines}${tipLayer(f, cfg)}</svg>`;
  }

  function legend(series) {
    if (series.length < 2) return "";
    return `<div class="cm-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  }

  // Charts are described as data first, then drawn once their container has a width
  function chartHost(id, cfg, drawer) {
    return { id, cfg, drawer };
  }

  // ---------- page pieces ----------

  function tile(label, value, sub) {
    return `<div class="cm-tile"><div class="cm-l">${esc(label)}</div><div class="cm-v">${value}</div><div class="cm-s">${sub || "&nbsp;"}</div></div>`;
  }

  function card(title, body, extra) {
    return `<div class="col-12"><div class="card"><div class="card-header d-flex justify-content-between align-items-center flex-wrap"><h6>${title}</h6>${extra || ""}</div><div class="card-body">${body}</div></div></div>`;
  }

  function table(headers, rows, cls) {
    const head = headers.map((h, i) => `<th class="${i ? "text-end" : ""}">${h}</th>`).join("");
    const body = rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "text-end" : ""}">${c}</td>`).join("")}</tr>`).join("");
    return `<div class="table-responsive"><table class="table table-sm mb-0 ${cls || ""}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function componentTable(block, title, state, key) {
    const comps = block.components;
    if (comps.length < 2) return "";
    const withActivity = comps.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
    const hidden = comps.length - withActivity.length;
    const shown = state.showAll[key] ? comps.slice().sort((a, b) => b.total - a.total) : withActivity;
    const total = block.total || 1;
    const rows = shown.map((c) => [
      `${esc(c.label)} <span class="text-muted cm-group">${esc(c.group)}</span>`,
      fmt(c.total),
      fmt(c.d7),
      `<span class="cm-bar" style="width:${Math.min(100, (c.total / total) * 100)}%"></span> ${Math.round((c.total / total) * 100)}%`,
    ]);
    const toggle = hidden > 0 || state.showAll[key]
      ? `<button type="button" class="btn btn-sm btn-link cm-showall" data-key="${key}">${state.showAll[key] ? "Hide" : "Show"} ${hidden} with no activity</button>`
      : "";
    return card(title, rows.length ? table(["Stat", "Total", "7d", "Share"], rows, "cm-components") + toggle : '<span class="text-muted">No activity yet.</span>');
  }

  // ---------- the two page types ----------

  function sumPage(data, scope, state, nowTs) {
    const block = scopedBlock(data.main, scope);
    const days = dayStarts(data.tracking_since, nowTs);
    const weeks = weekStarts(data.tracking_since, nowTs);
    const dailyOf = (map) => {
      const byDay = bucketBy(map, startOfDay);
      return days.map((d) => byDay.get(d) || 0);
    };
    const daily = dailyOf(block.pairs);
    const weeklyMap = bucketBy(block.pairs, startOfWeek);
    const weekly = weeks.map((w) => weeklyMap.get(w) || 0);

    const activeDays = daily.filter((v) => v > 0).length;
    const best = Math.max(0, ...daily);
    const bestDay = days[daily.indexOf(best)];
    const gained = daily.reduce((a, b) => a + b, 0);
    const sessions = data.sessions.filter((s) => !scope || s[0] === scope);
    const sessionGains = sessions.map((s) => s[3]);
    const avgSession = sessionGains.length ? sessionGains.reduce((a, b) => a + b, 0) / sessionGains.length : null;

    const tiles = [
      tile("Total", fmt(block.total), "lifetime"),
      tile("Last 24 hours", fmt(block.d1)),
      tile("Last 7 days", fmt(block.d7), `${trendHtml(trendOf(block.d7, block.p7))} vs prior 7d`),
      tile("Avg / active day", fmt(activeDays ? gained / activeDays : null), `${activeDays} active day${activeDays === 1 ? "" : "s"}`),
      tile("Best day", fmt(best || null), best ? dateLabel(bestDay) : ""),
      tile("Avg / session", fmt(avgSession), `${sessionGains.length} session${sessionGains.length === 1 ? "" : "s"}`),
    ].join("");

    // Trend chart: stacked by the biggest components, plus a cumulative view
    const dayLabels = days.map(dateLabel);
    const weekLabels = weeks.map(dateLabel);
    let series;
    let labels;
    let cfgBuilder;
    if (state.mode === "cumulative") {
      let run = 0;
      series = [{ name: "Cumulative", color: PALETTE[0], values: daily.map((v) => (run += v)) }];
      labels = dayLabels;
      cfgBuilder = (host) => chartHost("trend", { labels, series, tip: (i) => `${labels[i]}: ${fmt(series[0].values[i])} gained so far`, height: 220 }, drawLines);
    } else {
      const weeklyView = state.mode === "weekly";
      const per = weeklyView ? (map) => { const b = bucketBy(map, startOfWeek); return weeks.map((w) => b.get(w) || 0); } : dailyOf;
      labels = weeklyView ? weekLabels : dayLabels;
      const totalSeries = weeklyView ? weekly : daily;
      if (block.components.length > 1) {
        const ranked = block.components.slice().sort((a, b) => b.d7 + b.total / 1e6 - (a.d7 + a.total / 1e6)).slice(0, 5).filter((c) => c.total > 0);
        series = ranked.map((c, i) => ({ name: c.label, color: PALETTE[i], values: per(c.pairs()) }));
        const rest = totalSeries.map((v, i) => Math.max(0, v - series.reduce((s, sr) => s + sr.values[i], 0)));
        if (rest.some((v) => v > 0)) series.push({ name: "Other", color: OTHER_COLOR, values: rest });
      } else {
        series = [{ name: block.components[0] ? block.components[0].label : "Gained", color: PALETTE[0], values: totalSeries }];
      }
      cfgBuilder = () => chartHost("trend", {
        labels, series, stacked: true, height: 220,
        tip: (i) => `${labels[i]}${weeklyView ? " (week)" : ""}: ${fmt(totalSeries[i])}` + series.filter((s) => series.length > 1 && s.values[i] > 0).map((s) => `<br>${s.name}: ${fmt(s.values[i])}`).join(""),
      }, drawBars);
    }
    const trendHost = cfgBuilder();

    const weekRows = weeks.slice().reverse().map((w, idx) => {
      const i = weeks.length - 1 - idx;
      const prev = i > 0 ? weekly[i - 1] : null;
      const label = `${dateLabel(w)}${idx === 0 ? ' <span class="text-muted">(so far)</span>' : ""}`;
      return [label, fmt(weekly[i]), prev === null ? "–" : trendHtml(trendOf(weekly[i], prev))];
    });

    const rh = rhythm(block.pairs);
    const hourHost = chartHost("hours", {
      labels: rh.hours.map((_, h) => String(h)), series: [{ name: "Gained", color: PALETTE[1], values: rh.hours }], height: 150,
      tip: (i) => `${i}:00 – ${i}:59: ${fmt(rh.hours[i])}`,
    }, drawBars);
    const dowHost = chartHost("weekdays", {
      labels: WEEKDAYS, series: [{ name: "Gained", color: PALETTE[2], values: rh.weekdays }], height: 150,
      tip: (i) => `${WEEKDAYS[i]}: ${fmt(rh.weekdays[i])}`,
    }, drawBars);

    const players = scope ? "" : playersCard(data, block, state);
    const sessionsCard = sessionsTable(data, sessions, scope);

    const modes = ["daily", "weekly", "cumulative"];
    const toggle = `<div class="btn-group btn-group-sm cm-modes">${modes.map((m) => `<button type="button" class="btn btn-outline-secondary ${state.mode === m ? "active" : ""}" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div>`;

    const html = [
      card("Trend", `<div class="cm-chart" id="cm-trend"></div>${legend(series)}<small class="text-muted">Counts from ${new Date(data.tracking_since).toLocaleDateString()} when tracking began.</small>`, toggle),
      componentTable(block, "Breakdown", state, "main"),
      card("Weekly", table(["Week of", "Gained", "vs prior week"], weekRows)),
      card("When it happens", `<div class="row"><div class="col-md-8"><div class="small text-muted">By hour of day</div><div class="cm-chart" id="cm-hours"></div></div><div class="col-md-4"><div class="small text-muted">By weekday</div><div class="cm-chart" id="cm-weekdays"></div></div></div>`),
      players,
      sessionsCard,
    ].join("");
    return { tiles, html, hosts: [trendHost, hourHost, dowHost] };
  }

  function playersCard(data, block, state) {
    const rows = Object.keys(data.main.total)
      .map((id) => ({
        id,
        name: data.players[id] || id.slice(0, 8),
        total: data.main.total[id],
        d7: data.main.windows[id].d7,
        p7: data.main.windows[id].p7,
      }))
      .sort((a, b) => b.total - a.total);
    const server = rows.reduce((s, r) => s + r.total, 0) || 1;
    const body = table(
      ["Player", "Total", "7d", "vs prior", "Share"],
      rows.map((r) => [
        `<a href="#metric=${esc(data.name)}&player=${esc(r.id)}">${esc(r.name)}</a>`,
        fmt(r.total), fmt(r.d7), trendHtml(trendOf(r.d7, r.p7)), `${Math.round((r.total / server) * 100)}%`,
      ])
    );
    return card("Players", body);
  }

  function sessionsTable(data, sessions, scope) {
    const recent = sessions.slice(-SESSIONS_SHOWN).reverse();
    if (!recent.length) return card("Recent sessions", '<span class="text-muted">No sessions recorded since tracking began.</span>');
    const rows = recent.map(([uuid, start, end, gain]) => {
      const minutes = Math.round((end - start) / 60000);
      const length = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
      const when = new Date(start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return scope ? [when, length, fmt(gain)] : [`${when}<br><span class="text-muted">${esc(data.players[uuid] || uuid.slice(0, 8))}</span>`, length, fmt(gain)];
    });
    return card("Recent sessions", table([scope ? "Started" : "Started / player", "Length", "Gained"], rows));
  }

  function ratioPage(data, scope, state, nowTs) {
    const num = scopedBlock(data.num, scope);
    const den = scopedBlock(data.den, scope);
    const days = dayStarts(data.tracking_since, nowTs);
    const weeks = weekStarts(data.tracking_since, nowTs);
    const perDay = (map) => { const b = bucketBy(map, startOfDay); return days.map((d) => b.get(d) || 0); };
    const perWeek = (map) => { const b = bucketBy(map, startOfWeek); return weeks.map((w) => b.get(w) || 0); };
    const nDaily = perDay(num.pairs);
    const dDaily = perDay(den.pairs);
    const activeDays = days.filter((_, i) => nDaily[i] > 0 || dDaily[i] > 0).length;

    const sevenRatio = ratioOf(num.d7, den.d7);
    const prevRatio = ratioOf(num.p7, den.p7);
    const delta = sevenRatio !== null && prevRatio !== null ? sevenRatio - prevRatio : null;
    const deltaHtml = delta === null ? '<span class="text-muted">–</span>' : `<span class="${delta > 0 ? "cm-up" : delta < 0 ? "cm-down" : "text-muted"}">${delta > 0 ? "▲" : delta < 0 ? "▼" : ""} ${Math.abs(delta).toFixed(2)}</span>`;
    const tiles = [
      tile("Ratio", fmt(ratioOf(num.total, den.total), true), "lifetime"),
      tile("Last 24 hours", fmt(ratioOf(num.d1, den.d1), true), `${fmt(num.d1)} ÷ ${fmt(den.d1)}`),
      tile("Last 7 days", fmt(sevenRatio, true), `${deltaHtml} vs prior 7d`),
      tile("Numerator", fmt(num.total), "lifetime"),
      tile("Denominator", fmt(den.total), "lifetime"),
      tile("Active days", String(activeDays), "since tracking began"),
    ].join("");

    const dayLabels = days.map(dateLabel);
    const weekLabels = weeks.map(dateLabel);
    let trendHost;
    let series;
    if (state.mode === "ratio") {
      let cumN = 0;
      let cumD = 0;
      const cumulative = days.map((_, i) => { cumN += nDaily[i]; cumD += dDaily[i]; return ratioOf(cumN, cumD); });
      const rolling = days.map((_, i) => {
        const from = Math.max(0, i - 6);
        return ratioOf(nDaily.slice(from, i + 1).reduce((a, b) => a + b, 0), dDaily.slice(from, i + 1).reduce((a, b) => a + b, 0));
      });
      series = [
        { name: "Rolling 7 days", color: PALETTE[0], values: rolling },
        { name: "Since tracking began", color: PALETTE[2], values: cumulative },
      ];
      trendHost = chartHost("trend", {
        labels: dayLabels, series, height: 220,
        tip: (i) => `${dayLabels[i]}<br>Rolling 7d: ${fmt(rolling[i], true)}<br>Cumulative: ${fmt(cumulative[i], true)}`,
      }, drawLines);
    } else {
      const weeklyView = state.mode === "weekly";
      const n = weeklyView ? perWeek(num.pairs) : nDaily;
      const d = weeklyView ? perWeek(den.pairs) : dDaily;
      const labels = weeklyView ? weekLabels : dayLabels;
      series = [
        { name: data.num.components.length === 1 ? data.num.components[0].label : "Numerator", color: PALETTE[0], values: n },
        { name: data.den.components.length === 1 ? data.den.components[0].label : "Denominator", color: PALETTE[1], values: d },
      ];
      trendHost = chartHost("trend", {
        labels, series, height: 220,
        tip: (i) => `${labels[i]}<br>${series[0].name}: ${fmt(n[i])}<br>${series[1].name}: ${fmt(d[i])}<br>Ratio: ${fmt(ratioOf(n[i], d[i]), true)}`,
      }, drawBars);
    }

    const wn = perWeek(num.pairs);
    const wd = perWeek(den.pairs);
    const weekRows = weeks.slice().reverse().map((w, idx) => {
      const i = weeks.length - 1 - idx;
      return [`${dateLabel(w)}${idx === 0 ? ' <span class="text-muted">(so far)</span>' : ""}`, fmt(wn[i]), fmt(wd[i]), fmt(ratioOf(wn[i], wd[i]), true)];
    });

    const rn = rhythm(num.pairs);
    const rd = rhythm(den.pairs);
    const hourHost = chartHost("hours", {
      labels: rn.hours.map((_, h) => String(h)), height: 150,
      series: [{ name: "Numerator", color: PALETTE[0], values: rn.hours }, { name: "Denominator", color: PALETTE[1], values: rd.hours }],
      tip: (i) => `${i}:00 – ${i}:59<br>Numerator: ${fmt(rn.hours[i])}<br>Denominator: ${fmt(rd.hours[i])}`,
    }, drawBars);
    const dowHost = chartHost("weekdays", {
      labels: WEEKDAYS, height: 150,
      series: [{ name: "Numerator", color: PALETTE[0], values: rn.weekdays }, { name: "Denominator", color: PALETTE[1], values: rd.weekdays }],
      tip: (i) => `${WEEKDAYS[i]}<br>Numerator: ${fmt(rn.weekdays[i])}<br>Denominator: ${fmt(rd.weekdays[i])}`,
    }, drawBars);

    let players = "";
    if (!scope) {
      const rows = Object.keys(data.num.total)
        .filter((id) => data.den.total[id] !== undefined)
        .map((id) => ({
          id, name: data.players[id] || id.slice(0, 8),
          n: data.num.total[id], d: data.den.total[id],
          n7: data.num.windows[id].d7, d7: data.den.windows[id].d7,
        }))
        .sort((a, b) => (ratioOf(b.n, b.d) || 0) - (ratioOf(a.n, a.d) || 0));
      players = card("Players", table(
        ["Player", "Ratio", "7d ratio", "Num", "Den"],
        rows.map((r) => [`<a href="#metric=${esc(data.name)}&player=${esc(r.id)}">${esc(r.name)}</a>`, fmt(ratioOf(r.n, r.d), true), fmt(ratioOf(r.n7, r.d7), true), fmt(r.n), fmt(r.d)])
      ));
    }

    const modes = [["daily", "Daily"], ["weekly", "Weekly"], ["ratio", "Ratio"]];
    const toggle = `<div class="btn-group btn-group-sm cm-modes">${modes.map(([m, t]) => `<button type="button" class="btn btn-outline-secondary ${state.mode === m ? "active" : ""}" data-mode="${m}">${t}</button>`).join("")}</div>`;
    const html = [
      card("Trend", `<div class="cm-chart" id="cm-trend"></div>${legend(series)}<small class="text-muted">Counts from ${new Date(data.tracking_since).toLocaleDateString()} when tracking began. Ratio is numerator ÷ denominator.</small>`, toggle),
      card("Weekly", table(["Week of", "Numerator", "Denominator", "Ratio"], weekRows)),
      card("When it happens", `<div class="row"><div class="col-md-8"><div class="small text-muted">By hour of day</div><div class="cm-chart" id="cm-hours"></div>${legend(hourHost.cfg.series)}</div><div class="col-md-4"><div class="small text-muted">By weekday</div><div class="cm-chart" id="cm-weekdays"></div></div></div>`),
      players,
      componentTable(num, "Numerator breakdown", state, "num"),
      componentTable(den, "Denominator breakdown", state, "den"),
    ].join("");
    return { tiles, html, hosts: [trendHost, hourHost, dowHost] };
  }

  // ---------- mounting ----------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .cm-page .cm-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
      .cm-page .cm-tile { border: 1px solid rgba(128,128,128,0.25); border-radius: 0.35rem; padding: 0.5rem 0.65rem; }
      .cm-page .cm-l { font-size: 0.75rem; opacity: 0.7; }
      .cm-page .cm-v { font-size: 1.3rem; font-weight: 700; line-height: 1.3; }
      .cm-page .cm-s { font-size: 0.75rem; opacity: 0.8; }
      .cm-page .cm-up { color: #28a745; }
      .cm-page .cm-down { color: #dc3545; }
      .cm-page .cm-chart { position: relative; width: 100%; }
      .cm-page .cm-chart svg { display: block; }
      .cm-page .cm-tip { position: absolute; pointer-events: none; background: rgba(30,30,30,0.92); color: #fff; font-size: 0.75rem; padding: 0.25rem 0.45rem; border-radius: 0.25rem; white-space: nowrap; z-index: 5; }
      .cm-page .cm-legend { display: flex; flex-wrap: wrap; gap: 0.25rem 0.9rem; font-size: 0.78rem; margin: 0.35rem 0; }
      .cm-page .cm-legend i { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 2px; margin-right: 0.3rem; }
      .cm-page .cm-bar { display: inline-block; height: 0.5rem; background: #4a90e2; border-radius: 2px; min-width: 1px; max-width: 60px; vertical-align: middle; }
      .cm-page .cm-group { font-size: 0.72rem; }
      .cm-page .cm-modes .btn { color: inherit; border-color: rgba(128,128,128,0.5); background: transparent; }
      .cm-page .cm-modes .btn.active { background: #4a90e2; border-color: #4a90e2; color: #fff; }
      .cm-page .cm-back { text-decoration: none; }
      .cm-page .cm-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
      @media (max-width: 767.98px) {
        .cm-page .table { font-size: 0.8rem; }
        .cm-page .table th, .cm-page .table td { padding: 0.25rem 0.3rem; }
        .cm-page .cm-v { font-size: 1.1rem; }
      }`;
    document.head.appendChild(style);
  }

  async function render(root, ctx) {
    injectStyles();
    root.classList.add("cm-page");
    root.innerHTML = card("Loading…", '<span class="text-muted">Loading metric details…</span>');

    const name = ctx.view.metric;
    let data;
    try {
      const res = await fetch(`${ctx.base}metric_data/${name}.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error("[Plan Custom Overview] Metric details failed to load:", err);
      if (root.isConnected) {
        root.innerHTML = card(`<a class="cm-back" href="#">← Overview</a>`, "Details for this metric aren't available yet. They are built every 5 minutes.");
      }
      return;
    }
    if (!root.isConnected) return;

    const isPlayerRoute = ctx.route.type === "player";
    const state = { scope: isPlayerRoute ? ctx.route.id : ctx.view.player || null, mode: "daily", showAll: {} };
    if (data.type === "ratio") state.mode = "daily";
    const tip = document.createElement("div");
    tip.className = "cm-tip";
    tip.style.display = "none";

    const draw = () => {
      const nowTs = Date.now();
      const scopeKnown = !state.scope || (data.players && data.players[state.scope]);
      const page = scopeKnown
        ? (data.type === "ratio" ? ratioPage : sumPage)(data, state.scope, state, nowTs)
        : null;

      const scopeName = state.scope ? (data.players[state.scope] || "this player") : "Whole server";
      const select = isPlayerRoute ? "" : `<select class="form-select form-select-sm cm-scope" style="width:auto">
          <option value="">Whole server</option>
          ${Object.keys(data.players).sort((a, b) => data.players[a].localeCompare(data.players[b])).map((id) => `<option value="${esc(id)}" ${id === state.scope ? "selected" : ""}>${esc(data.players[id])}</option>`).join("")}
        </select>`;
      const note = data.type === "ratio" ? "Ratio · numerator ÷ denominator" : data.type === "aggregate" ? `Combined stat · ${data.main.components.length} stats added together` : TYPE_NOTES[data.type] || "";
      const header = card(
        `<a class="cm-back" href="#">←</a> ${esc(data.label)}`,
        `<div class="text-muted">${esc(note)} · ${esc(scopeName)}</div>
         ${select ? `<div class="cm-controls">${select}</div>` : ""}
         ${page ? `<div class="cm-tiles">${page.tiles}</div>` : '<div class="mt-2">No data for this player yet.</div>'}`
      );
      root.innerHTML = header + (page ? page.html : "");
      root.appendChild(tip);

      const drawAll = () => {
        if (!page) return;
        page.hosts.forEach((host) => {
          const el = root.querySelector(`#cm-${host.id}`);
          if (el) host.drawer(el, host.cfg);
        });
      };
      drawAll();
      root._redraw = drawAll;

      root.querySelectorAll(".cm-modes button").forEach((b) => b.addEventListener("click", () => { state.mode = b.dataset.mode; draw(); }));
      root.querySelectorAll(".cm-showall").forEach((b) => b.addEventListener("click", () => { state.showAll[b.dataset.key] = !state.showAll[b.dataset.key]; draw(); }));
      const scopeSelect = root.querySelector(".cm-scope");
      if (scopeSelect) {
        scopeSelect.addEventListener("change", () => {
          ctx.navigate(`#metric=${name}${scopeSelect.value ? `&player=${scopeSelect.value}` : ""}`);
        });
      }
      root.querySelectorAll(".cm-chart").forEach((chart) => {
        const show = (event) => {
          const target = event.target.closest("[data-tip]");
          if (!target) { tip.style.display = "none"; return; }
          tip.innerHTML = target.dataset.tip;
          tip.style.display = "block";
          const box = root.getBoundingClientRect();
          const x = Math.min(event.clientX - box.left + 12, box.width - tip.offsetWidth - 4);
          tip.style.left = `${Math.max(x, 4)}px`;
          tip.style.top = `${event.clientY - box.top - tip.offsetHeight - 10}px`;
        };
        chart.addEventListener("pointermove", show);
        chart.addEventListener("pointerdown", show);
        chart.addEventListener("pointerleave", () => { tip.style.display = "none"; });
      });
    };

    // Re-draw charts when the width changes (rotating a phone, resizing a window)
    let lastWidth = root.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!root.isConnected) { observer.disconnect(); return; }
      if (Math.abs(root.clientWidth - lastWidth) > 4 && root._redraw) {
        lastWidth = root.clientWidth;
        root._redraw();
      }
    });
    observer.observe(root);

    draw();
  }

  window.CustomMetricPage = { render };
})();
