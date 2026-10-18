// SK Irrigation Manager — watering report on the Dashboard.
// Reads the daily totals kept by the integration (sk_irrigation/stats) and
// draws a dependency-free SVG chart: stacked bars per program, lines for the
// completed and skipped cycles, and a detail panel per period on hover / tap.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const MANUAL = "_manual";
const MANUAL_COLOR = "#90a4ae";
const OTHER_COLOR = "#b0bec5";
const WINDOW = { day: 31, week: 16, month: 12, year: 10 };
const STATS_TTL = 60000;

const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return [t.getUTCFullYear(), Math.ceil(((t - y0) / 864e5 + 1) / 7)];
}

// first day of the bucket that contains d
function bucketStart(d, g) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  if (g === "week") x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  else if (g === "month") x.setDate(1);
  else if (g === "year") x.setMonth(0, 1);
  return x;
}

function nextBucket(d, g) {
  const x = new Date(d);
  if (g === "day") x.setDate(x.getDate() + 1);
  else if (g === "week") x.setDate(x.getDate() + 7);
  else if (g === "month") x.setMonth(x.getMonth() + 1);
  else x.setFullYear(x.getFullYear() + 1);
  return x;
}

function fmtHM(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

function fmtShort(sec) {
  const m = Math.round(sec / 60);
  if (!m && sec > 0) return `${Math.round(sec)} s`;
  return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m}′`;
}

// round axis steps: minutes use clock-friendly steps, other values 1/2/5 × 10^n
function niceStep(raw, minutes) {
  if (minutes) {
    const steps = [5, 10, 15, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3000, 6000, 12000, 30000, 60000];
    return steps.find((s) => s >= raw) || steps[steps.length - 1];
  }
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export const ReportMixin = {
  _rep() {
    if (!this._repState) {
      let g = "week";
      try { g = localStorage.getItem("ski-rep-g") || "week"; } catch (e) { /* ignore */ }
      this._repState = { g: WINDOW[g] ? g : "week", off: 0, flt: "all", met: "min", hide: new Set() };
    }
    return this._repState;
  },

  // fetch the daily totals when the dashboard shows and after each finished run
  async _repLoad(force = false) {
    const marker = this._state?.history?.[0]?.id || "";
    const fresh = this._repStats && this._repMarker === marker && Date.now() - this._repAt < STATS_TTL;
    if ((!force && fresh) || this._repLoading) return;
    this._repLoading = true;
    try {
      const res = await this._hass.callWS({ type: "sk_irrigation/stats" });
      this._repStats = res.days || {};
      this._repMarker = marker;
      this._repAt = Date.now();
      const host = this.shadowRoot.getElementById("ski-report");
      if (host && this._tab === "dashboard") host.outerHTML = this._reportHtml();
    } catch (err) {
      this._repStats = this._repStats || {};
    } finally {
      this._repLoading = false;
    }
  },

  _repPrograms() {
    const progs = this._programs.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    progs.push({ id: MANUAL, name: this.t("rep_manual"), color: MANUAL_COLOR });
    return progs;
  },

  _repZoneOk(zid) {
    const f = this._rep().flt;
    if (f === "all" || f.startsWith("p:")) return true;
    if (f.startsWith("g:")) return (this._group(f.slice(2))?.zone_ids || []).includes(zid);
    if (f.startsWith("z:")) return zid === f.slice(2);
    return true;
  },

  _repProgOk(pid) {
    const f = this._rep().flt;
    return !f.startsWith("p:") || f.slice(2) === pid;
  },

  _repFlow(zid) { return Number(this._zone(zid)?.flow_rate) || 0; },

  // aggregate the daily stats into buckets for the current grouping and window
  _repBuckets() {
    const st = this._rep();
    const g = st.g;
    const days = this._repStats || {};
    const known = new Set(this._repPrograms().map((p) => p.id));
    const now = new Date(this._now());
    const keys = Object.keys(days).sort();
    const first = keys.length ? parseDay(keys[0]) : now;
    // bucket list: from the first stored day to today (no gaps)
    const all = [];
    for (let b = bucketStart(first, g); b <= now; b = nextBucket(b, g)) all.push(b);
    if (!all.length) all.push(bucketStart(now, g));
    const win = WINDOW[g] * (this.clientWidth && this.clientWidth < 700 ? 0.5 : 1);
    const end = all.length - st.off * Math.round(win);
    const starts = all.slice(Math.max(0, end - Math.round(win)), Math.max(0, end));
    const buckets = starts.map((s) => ({ start: s, end: new Date(nextBucket(s, g).getTime() - 864e5), sec: 0, liters: 0, byProg: {}, zones: {}, ok: 0, stop: 0, rain: 0, cond: 0, daysWithData: 0 }));
    const index = new Map(buckets.map((b) => [isoDay(b.start), b]));
    const covers = new Set(this._programs.filter((p) => (p.steps || []).some((stp) => {
      const skip = new Set(stp.skip || []);
      return (this._group(stp.group_id)?.zone_ids || []).some((z) => !skip.has(z) && this._repZoneOk(z));
    })).map((p) => p.id));
    for (const [day, progs] of Object.entries(days)) {
      const b = index.get(isoDay(bucketStart(parseDay(day), g)));
      if (!b) continue;
      b.daysWithData += 1;
      for (const [pidRaw, p] of Object.entries(progs)) {
        const pid = known.has(pidRaw) ? pidRaw : "_other";
        if (!this._repProgOk(pid)) continue;
        let watered = 0;
        for (const [zid, sec] of Object.entries(p.z || {})) {
          if (!this._repZoneOk(zid)) continue;
          watered += sec;
          b.zones[zid] = (b.zones[zid] || 0) + sec;
          b.liters += (sec / 60) * this._repFlow(zid);
        }
        b.sec += watered;
        b.byProg[pid] = (b.byProg[pid] || 0) + watered;
        // cycles count for the filter when the program waters the filtered sprinklers
        if (watered || st.flt === "all" || st.flt.startsWith("p:") || covers.has(pid)) {
          b.ok += p.ok || 0; b.stop += p.stop || 0; b.rain += p.rain || 0; b.cond += p.cond || 0;
        }
      }
    }
    return { buckets, hasPrev: end - Math.round(win) > 0, hasNext: st.off > 0 };
  },

  _repLabel(b, long = false) {
    const g = this._rep().g;
    const lang = this._hass.language;
    const months = this.t("months");
    if (g === "day") {
      return long ? b.start.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : `${b.start.getDate()}/${b.start.getMonth() + 1}`;
    }
    if (g === "week") {
      const [, w] = isoWeek(b.start);
      if (!long) return `W${pad(w)}`;
      const fd = (d) => `${d.getDate()} ${months[d.getMonth()]}`;
      return `${this.t("rep_week")} ${w} (${fd(b.start)} – ${fd(b.end)})`;
    }
    if (g === "month") {
      return long ? b.start.toLocaleDateString(lang, { month: "long", year: "numeric" })
        : `${months[b.start.getMonth()]} ${String(b.start.getFullYear()).slice(2)}`;
    }
    return String(b.start.getFullYear());
  },

  // columns of the sprinkler detail: by name prefix ("C1 · Canal 2"), HA device, area, or plain chunks
  _repZoneColumns(zones) {
    const tryGroups = (fn) => {
      const m = new Map();
      zones.forEach((z) => { const k = fn(z); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(z); });
      const covered = [...m.values()].reduce((a, l) => a + l.length, 0);
      if (covered === zones.length && m.size >= 2 && m.size <= 8 && [...m.values()].every((l) => l.length >= 2)) return m;
      return null;
    };
    const prefix = (z) => { const mt = /^(.+?)\s*[·|\-–:]\s+/.exec(z.name); return mt ? mt[1] : null; };
    let m = tryGroups(prefix);
    let strip = !!m;
    if (!m) {
      m = tryGroups((z) => {
        const ent = this._hass.entities?.[z.entity_id];
        const dev = ent?.device_id && this._hass.devices?.[ent.device_id];
        return dev ? dev.name_by_user || dev.name : null;
      });
    }
    if (!m) m = tryGroups((z) => (this._candidates || []).find((c) => c.entity_id === z.entity_id)?.area || null);
    if (!m) {
      m = new Map();
      const per = Math.ceil(zones.length / Math.max(1, Math.ceil(zones.length / 8)));
      for (let i = 0; i < zones.length; i += per) m.set(`#${i}`, zones.slice(i, i + per));
    }
    return [...m.entries()].map(([title, list]) => ({
      title: title.startsWith("#") ? "" : title,
      zones: list.map((z) => ({ ...z, short: strip ? z.name.replace(/^(.+?)\s*[·|\-–:]\s+/, "") : z.name })),
    }));
  },

  // ------------------------------------------------------------ html
  _reportHtml() {
    if (!this._repStats) {
      this._repLoad();
      return `<div class="card" id="ski-report"><div class="hd"><h2><ha-icon icon="mdi:chart-bar"></ha-icon>${this.t("rep_title")}</h2></div>
        <div class="empty">…</div></div>`;
    }
    this._repLoad();
    const st = this._rep();
    const { buckets, hasPrev, hasNext } = this._repBuckets();
    const progs = this._repPrograms().filter((p) => this._repProgOk(p.id));
    if (buckets.some((b) => b.byProg._other)) progs.push({ id: "_other", name: this.t("rep_other"), color: OTHER_COLOR });
    const hasFlow = this._zones.some((z) => Number(z.flow_rate) > 0);
    const met = hasFlow ? st.met : "min";
    const value = (b, pid) => {
      if (met === "min") return (pid ? b.byProg[pid] || 0 : b.sec) / 60;
      if (!pid) return b.liters;
      // liters per program: proportional share of the bucket's liters
      return b.sec ? (b.liters * (b.byProg[pid] || 0)) / b.sec : 0;
    };
    // KPIs for the window and the window before it
    const sum = (list) => list.reduce((a, b) => ({ sec: a.sec + b.sec, l: a.l + b.liters, ok: a.ok + b.ok, sk: a.sk + b.rain + b.cond, stop: a.stop + b.stop }),
      { sec: 0, l: 0, ok: 0, sk: 0, stop: 0 });
    const tot = sum(buckets);
    const prevState = { ...st, off: st.off + 1 };
    const saved = this._repState;
    this._repState = prevState;
    const prev = sum(this._repBuckets().buckets);
    this._repState = saved;
    const daysInWindow = buckets.length ? Math.max(1, Math.round((Math.min(this._now(), buckets.at(-1).end.getTime() + 864e5) - buckets[0].start.getTime()) / 864e5)) : 1;
    const delta = (a, b) => {
      if (!b) return "";
      const d = Math.round(((a - b) / b) * 100);
      return `<small class="${d < 0 ? "dn" : ""}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d)} % ${this.t("rep_vs_prev")}</small>`;
    };
    const kpis = [
      [this.t("rep_k_time"), fmtHM(tot.sec), delta(tot.sec, prev.sec)],
      [this.t("rep_k_water"), hasFlow ? `${Math.round(tot.l).toLocaleString(this._hass.language)} L` : "—",
        hasFlow ? delta(tot.l, prev.l) : `<small class="mu">${this.t("rep_no_flow")}</small>`],
      [this.t("rep_k_ok"), tot.ok, tot.stop ? `<small class="dn">${tot.stop} ${this.t("rep_stopped")}</small>` : ""],
      [this.t("rep_k_skipped"), tot.sk, `<small class="mu">${this.t("rep_skip_hint")}</small>`],
      [this.t("rep_k_daily"), fmtHM(tot.sec / daysInWindow), ""],
    ];
    // chart geometry
    const W = 1400, H = 420, L = 74, R = 58, Tp = 22, B = 58;
    const cw = W - L - R, ch = H - Tp - B, n = Math.max(1, buckets.length), slot = cw / n, bw = Math.min(46, slot * 0.62);
    const shown = progs.filter((p) => !st.hide.has(p.id));
    const stackOf = (b) => shown.reduce((a, p) => a + value(b, p.id), 0);
    const rawV = Math.max(met === "min" ? 10 : 50, ...buckets.map(stackOf)) * 1.08;
    const stepV = niceStep(rawV / 5, met === "min");
    const ticksV = Math.max(1, Math.ceil(rawV / stepV));
    const maxV = stepV * ticksV;
    const rawC = Math.max(3, ...buckets.map((b) => Math.max(b.ok + b.stop, b.rain + b.cond))) * 1.15;
    const stepC = niceStep(rawC / ticksV, false);
    const maxC = stepC * ticksV;
    const y = (v) => Tp + ch - (v / maxV) * ch;
    const y2 = (v) => Tp + ch - (v / maxC) * ch;
    const axis = (v) => (met === "min" ? (v >= 60 && v % 60 === 0 ? `${v / 60} h` : v >= 60 ? `${Math.floor(v / 60)} h ${pad(Math.round(v % 60))}` : `${Math.round(v)} min`) : `${Math.round(v).toLocaleString(this._hass.language)} L`);
    let svg = "";
    for (let i = 0; i <= ticksV; i += 1) {
      const v = stepV * i;
      svg += `<line class="rg" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="ra" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${axis(v)}</text>
        <text class="ra" x="${W - R + 10}" y="${y2(stepC * i) + 4}">${Math.round(stepC * i)}</text>`;
    }
    svg += `<text class="ra t" x="4" y="12">${met === "min" ? this.t("rep_axis_time") : this.t("rep_axis_water")}</text>
      <text class="ra t" x="${W - R + 10}" y="12">${this.t("rep_axis_cycles")}</text>`;
    buckets.forEach((b, i) => {
      const cx = L + slot * i + slot / 2;
      let acc = 0;
      const parts = shown.map((p) => [p, value(b, p.id)]).filter(([, v]) => v > 0);
      parts.forEach(([p, v], k) => {
        const y0 = y(acc), y1 = y(acc + v);
        acc += v;
        svg += `<rect class="rb" data-rep-i="${i}" x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0.5, y0 - y1)}" fill="${esc(p.color)}" rx="${k === parts.length - 1 ? 5 : 0}"/>`;
      });
      svg += `<rect class="rh" data-rep-i="${i}" x="${L + slot * i}" y="${Tp}" width="${slot}" height="${ch}"/>
        <text class="ra" x="${cx}" y="${H - B + 18}" text-anchor="end" transform="rotate(-40 ${cx} ${H - B + 18})">${esc(this._repLabel(b))}</text>`;
    });
    const line = (fn, color, dash) => {
      const pts = buckets.map((b, i) => [L + slot * i + slot / 2, y2(fn(b))]);
      if (!pts.length) return "";
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i += 1) {
        const [a, c] = [pts[i - 1], pts[i]];
        const mx = (a[0] + c[0]) / 2;
        d += ` C${mx},${a[1]} ${mx},${c[1]} ${c[0]},${c[1]}`;
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" ${dash ? 'stroke-dasharray="7 6"' : ""} pointer-events="none"/>`
        + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="var(--ski-card)" stroke="${color}" stroke-width="2.6" pointer-events="none"/>`).join("");
    };
    if (!st.hide.has("ok")) svg += line((b) => b.ok + b.stop, "#6c63ff");
    if (!st.hide.has("sk")) svg += line((b) => b.rain + b.cond, "#e5533d", true);
    svg += `<line class="rcur" x1="0" x2="0" y1="${Tp}" y2="${Tp + ch}"/>`;
    this._repView = { buckets, progs, met, slot, L, W };
    const empty = !buckets.some((b) => b.sec || b.ok || b.rain || b.cond);
    const legend = [...progs.map((p) => `<span class="${st.hide.has(p.id) ? "off" : ""}" data-action="rep-toggle" data-id="${esc(p.id)}"><i class="sw" style="background:${esc(p.color)}"></i>${esc(p.name)}</span>`),
      `<span class="${st.hide.has("ok") ? "off" : ""}" data-action="rep-toggle" data-id="ok"><i class="rr" style="border-color:#6c63ff"></i>${this.t("rep_k_ok")}</span>`,
      `<span class="${st.hide.has("sk") ? "off" : ""}" data-action="rep-toggle" data-id="sk"><i class="rr" style="border-color:#e5533d;border-style:dashed"></i>${this.t("rep_k_skipped")}</span>`].join("");
    const opt = (v, label) => `<option value="${esc(v)}" ${st.flt === v ? "selected" : ""}>${esc(label)}</option>`;
    return `<div class="card report" id="ski-report">
      <div class="hd"><h2><ha-icon icon="mdi:chart-bar"></ha-icon>${this.t("rep_title")}</h2>
        <div class="seg">${["day", "week", "month", "year"].map((g) => `<button class="${st.g === g ? "on" : ""}" data-action="rep-group" data-id="${g}">${this.t(`rep_${g}`)}</button>`).join("")}</div>
        <span class="rep-nav"><button class="btn icon" data-action="rep-prev" ${hasPrev ? "" : "disabled"}><ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <span class="small muted">${buckets.length ? `${esc(this._repLabel(buckets[0]))} – ${esc(this._repLabel(buckets.at(-1)))}` : ""}</span>
          <button class="btn icon" data-action="rep-next" ${hasNext ? "" : "disabled"}><ha-icon icon="mdi:chevron-right"></ha-icon></button></span>
      </div>
      <div class="rep-ctl">
        <label class="rep-sel">${this.t("rep_show")} <select data-bind="rep:flt">${opt("all", this.t("rep_all"))}
          <optgroup label="${esc(this.t("programs"))}">${this._programs.map((p) => opt(`p:${p.id}`, p.name)).join("")}${opt(`p:${MANUAL}`, this.t("rep_manual"))}</optgroup>
          ${this._groups.length ? `<optgroup label="${esc(this.t("groups"))}">${this._groups.map((g) => opt(`g:${g.id}`, g.name)).join("")}</optgroup>` : ""}
          <optgroup label="${esc(this.t("zones"))}">${this._zones.map((z) => opt(`z:${z.id}`, z.name)).join("")}</optgroup></select></label>
        <label class="rep-sel">${this.t("rep_measure")} <select data-bind="rep:met" ${hasFlow ? "" : "disabled"}>
          <option value="min" ${met === "min" ? "selected" : ""}>${esc(this.t("rep_axis_time"))}</option>
          <option value="l" ${met === "l" ? "selected" : ""}>${esc(this.t("rep_k_water"))}</option></select></label>
        <span class="small muted">${this.t("rep_hover_hint")}</span>
      </div>
      <div class="rep-kpis">${kpis.map(([k, v, s]) => `<div class="kpi"><span>${k}</span><b>${v}</b>${s}</div>`).join("")}</div>
      <div class="rep-legend">${legend}</div>
      <div class="rep-chart" id="rep-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg}</svg>
        ${empty ? `<div class="rep-empty">${this.t("rep_empty")}</div>` : ""}
        <div class="rep-tip" id="rep-tip"></div>
      </div>
    </div>`;
  },

  // ------------------------------------------------------------ hover / tap detail
  _repHover(e) {
    const chart = this.shadowRoot.getElementById("rep-chart");
    if (!chart || !this._repView) return;
    const hit = e.target.closest?.("[data-rep-i]");
    if (!hit || !chart.contains(hit)) { this._repHide(); return; }
    this._repShow(Number(hit.dataset.repI), e, chart);
  },

  _repHide() {
    const chart = this.shadowRoot.getElementById("rep-chart");
    if (!chart) return;
    chart.querySelector(".rep-tip").style.display = "none";
    chart.querySelector(".rcur")?.setAttribute("visibility", "hidden");
    chart.querySelectorAll(".rb.hl").forEach((r) => r.classList.remove("hl"));
    this._repTipI = null;
  },

  _repShow(i, e, chart) {
    const { buckets, progs, slot, L, W } = this._repView;
    const b = buckets[i];
    const tip = chart.querySelector(".rep-tip");
    if (this._repTipI !== i) {
      this._repTipI = i;
      chart.querySelectorAll(".rb.hl").forEach((r) => r.classList.remove("hl"));
      chart.querySelectorAll(`.rb[data-rep-i="${i}"]`).forEach((r) => r.classList.add("hl"));
      const cur = chart.querySelector(".rcur");
      const cx = L + slot * i + slot / 2;
      cur.setAttribute("x1", cx); cur.setAttribute("x2", cx); cur.setAttribute("visibility", "visible");
      const zones = this._zones.filter((z) => this._repZoneOk(z.id));
      const cols = this._repZoneColumns(zones);
      const max = Math.max(1, ...zones.map((z) => b.zones[z.id] || 0));
      const lang = this._hass.language;
      const hasFlow = this._zones.some((z) => Number(z.flow_rate) > 0);
      const watered = zones.filter((z) => b.zones[z.id]);
      const top = watered.slice().sort((a, c) => b.zones[c.id] - b.zones[a.id])[0];
      tip.innerHTML = `<div class="l"><h4>${esc(this._repLabel(b, true))}</h4>
        <div class="row"><span class="k"><i class="dot" style="background:#03a9f4"></i>${this.t("rep_k_time")}</span><b class="v" style="color:#5fb6ff">${fmtHM(b.sec)}</b></div>
        ${hasFlow ? `<div class="row"><span class="k"><i class="dot" style="background:#26c6da"></i>${this.t("rep_k_water")}</span><b class="v" style="color:#4dd0e1">${Math.round(b.liters).toLocaleString(lang)} L</b></div>` : ""}
        <div class="row"><span class="k"><i class="dot" style="background:#6c63ff"></i>${this.t("rep_k_ok")}</span><b class="v" style="color:#9d97ff">${b.ok}</b></div>
        ${b.stop ? `<div class="row"><span class="k"><i class="dot" style="background:#f2a900"></i>${this.t("rep_stopped_runs")}</span><b class="v" style="color:#ffd27a">${b.stop}</b></div>` : ""}
        <div class="row"><span class="k"><i class="dot" style="background:#e5533d"></i>${this.t("rep_k_skipped")}</span><b class="v" style="color:#ff8a75">${b.rain + b.cond}</b></div>
        ${b.rain + b.cond ? `<div class="sk">🌧 ${b.rain} ${this.t("rep_by_rain")} · ⚡ ${b.cond} ${this.t("rep_by_cond")}</div>` : ""}
        <h4 class="sub">${this.t("rep_by_program")}</h4>
        ${progs.filter((p) => b.byProg[p.id]).map((p) => `<div class="row"><span class="k"><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}</span><b class="v">${fmtHM(b.byProg[p.id])}</b></div>`).join("") || `<div class="muted2">—</div>`}
      </div>
      <div class="r"><h4>${this.t("rep_by_zone")}</h4>
        <div class="cols" style="grid-template-columns:repeat(${Math.min(cols.length, 4)},minmax(170px,1fr))">
        ${cols.map((c) => {
          const total = c.zones.reduce((a, z) => a + (b.zones[z.id] || 0), 0);
          return `<div class="col">${c.title ? `<h5><span>${esc(c.title)}</span><span>${fmtHM(total)}</span></h5>` : ""}
            ${c.zones.map((z) => { const v = b.zones[z.id] || 0; return `<div class="zr ${v ? "" : "zero"}"><span class="zn" title="${esc(z.name)}">${esc(z.short)}</span>
              <span class="mb"><i style="width:${(v / max) * 100}%;background:${esc(z.color)}"></i></span><span class="t">${v ? fmtShort(v) : "—"}</span></div>`; }).join("")}</div>`;
        }).join("")}</div>
        <div class="foot"><span>${this.t("rep_watered_of", { n: watered.length, m: zones.length })}</span>
          <span>${top ? `${this.t("rep_most")}: ${esc(top.name)} · ${fmtHM(b.zones[top.id])}` : ""}</span></div>
      </div>`;
    }
    tip.style.display = "flex";
    // phones: a bottom sheet instead of a floating panel (the chart is too small to hold it)
    const sheet = chart.getBoundingClientRect().width < 700;
    tip.classList.toggle("sheet", sheet);
    if (sheet) { tip.style.left = ""; tip.style.top = ""; return; }
    const r = chart.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const px = e.clientX ?? r.left + ((L + slot * i + slot / 2) / W) * r.width;
    const py = e.clientY ?? r.top + r.height / 2;
    let x = px - r.left + 18;
    if (x + tw > r.width - 6) x = px - r.left - tw - 18;
    x = Math.max(6, Math.min(x, r.width - tw - 6));
    let yy = py - r.top - th / 2;
    yy = Math.max(4, Math.min(yy, Math.max(4, r.height - th - 4)));
    tip.style.left = `${x}px`;
    tip.style.top = `${yy}px`;
  },

  _repAction(a, el) {
    const st = this._rep();
    switch (a) {
      case "rep-group":
        st.g = el.dataset.id; st.off = 0;
        try { localStorage.setItem("ski-rep-g", st.g); } catch (e) { /* ignore */ }
        break;
      case "rep-prev": st.off += 1; break;
      case "rep-next": st.off = Math.max(0, st.off - 1); break;
      case "rep-toggle": { const id = el.dataset.id; if (st.hide.has(id)) st.hide.delete(id); else st.hide.add(id); break; }
      default: return;
    }
    this._repRefresh();
  },

  _repRefresh() {
    const host = this.shadowRoot.getElementById("ski-report");
    if (host) host.outerHTML = this._reportHtml();
  },
};
