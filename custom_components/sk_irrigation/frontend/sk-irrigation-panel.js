// SK Irrigation Manager — Home Assistant panel.
// Dependency-free web component: renders with template strings, uses event
// delegation, and implements pointer-based drag & drop (mouse + touch).
import { I18N } from "./sk-irrigation-i18n.js";
import { STYLES } from "./sk-irrigation-styles.js";

const DOMAIN = "sk_irrigation";
const TABS = [
  ["dashboard", "mdi:view-dashboard-outline"],
  ["zones", "mdi:sprinkler"],
  ["groups", "mdi:vector-arrange-below"],
  ["programs", "mdi:calendar-clock"],
  ["settings", "mdi:cog-outline"],
  ["history", "mdi:history"],
];
const PALETTE = ["#2e9e6b", "#1e88e5", "#f2a900", "#e5533d", "#8e44ad", "#00a6a6", "#ef6c00", "#5c6bc0", "#7cb342", "#d81b60"];
const MODES = ["weekdays", "interval", "monthdays", "odd", "even", "dates"];
const WEATHER = ["rainy", "pouring", "lightning-rainy", "snowy", "snowy-rainy", "hail", "lightning", "fog", "windy"];
const STATUS_ICON = {
  idle: "mdi:sprinkler-variant", running: "mdi:sprinkler-variant", paused: "mdi:pause-circle-outline",
  rain_delay: "mdi:weather-pouring", disabled: "mdi:power-off",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const attr = (o) => esc(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, "0");

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o[k] = o[k] ?? {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
}

// ---------------------------------------------------------------- planning
// Mirrors model.py so the editor can preview durations and the timeline.
function simulate(steps, cap, zoneDelay, stepDelay) {
  const bars = [];
  let t = 0;
  steps.forEach((step, si) => {
    const n = step.zones.length;
    if (!n) return;
    let limit = step.concurrency <= 0 ? n : Math.min(step.concurrency, n);
    if (cap > 0) limit = Math.min(limit, cap);
    const slots = new Array(Math.max(1, limit)).fill(t);
    let end = t;
    step.zones.forEach((z) => {
      let idx = 0;
      slots.forEach((v, i) => { if (v < slots[idx]) idx = i; });
      const start = slots[idx];
      const finish = start + z.seconds;
      bars.push({ ...z, start, end: finish, step: si });
      end = Math.max(end, finish);
      slots[idx] = finish + zoneDelay;
    });
    t = end + (si < steps.length - 1 ? stepDelay : 0);
  });
  return { total: t, bars };
}

class SkIrrigationPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      this.shadowRoot.adoptedStyleSheets = [sheet];
    } catch (e) {
      this._inlineStyles = true;
    }
    this._tab = "dashboard";
    try { this._tab = localStorage.getItem("ski-tab") || "dashboard"; } catch (e) { /* ignore */ }
    this._edit = null;
    this._dialog = null;
    this._saveTimers = {};
    this._search = "";
    this._domain = "all";
    this._skew = 0;
    const sr = this.shadowRoot;
    sr.addEventListener("click", (e) => this._onClick(e));
    sr.addEventListener("change", (e) => this._onChange(e));
    sr.addEventListener("input", (e) => this._onInput(e));
    sr.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    sr.addEventListener("pointermove", (e) => this._onPointerMove(e));
    sr.addEventListener("pointerup", (e) => this._onPointerUp(e));
    sr.addEventListener("pointercancel", () => this._cancelDrag());
  }

  // ------------------------------------------------------------ HA hooks
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._lang = (hass.language || "en").startsWith("es") ? "es" : "en";
    const mb = this.shadowRoot.querySelector("ha-menu-button");
    if (mb) mb.hass = hass;
    if (first) this._connect();
    else this._updateEntityStates();
  }

  get hass() { return this._hass; }

  set narrow(v) {
    this._narrow = v;
    const mb = this.shadowRoot.querySelector("ha-menu-button");
    if (mb) mb.narrow = v;
  }

  set panel(p) { this._panel = p; }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(), 1000);
    if (this._hass && !this._unsub && this._config) this._subscribe();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    if (this._unsub) { this._unsub.then((u) => u()).catch(() => {}); this._unsub = null; }
  }

  t(key, vars) {
    let s = (I18N[this._lang] || I18N.en)[key] ?? I18N.en[key] ?? key;
    if (vars && typeof s === "string") Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  }

  async _connect() {
    try {
      const data = await this._hass.callWS({ type: `${DOMAIN}/data` });
      this._config = data.config;
      this._candidates = data.candidates;
      this._isAdmin = data.is_admin;
      this._version = data.version;
      this._setState(data.state);
      this._error = null;
      this._subscribe();
    } catch (err) {
      console.error("SK Irrigation:", err);
      this._error = this.t("load_error");
    }
    this._render();
  }

  _subscribe() {
    this._unsub = this._hass.connection.subscribeMessage((msg) => this._onPush(msg), { type: `${DOMAIN}/subscribe` });
    this._unsub.catch(() => { this._unsub = null; });
  }

  _setState(state) {
    this._state = state;
    this._skew = Date.parse(state.now) - Date.now();
  }

  _onPush(msg) {
    const prevStatus = this._state?.status;
    const prevRun = this._state?.current?.id;
    const prevActive = (this._state?.current?.active || []).map((a) => a.zone_id).join();
    if (msg.config && !Object.keys(this._saveTimers).length) this._config = msg.config;
    if (msg.state) this._setState(msg.state);
    if (this._drag || this._dialog) { this._renderToolbar(); return; }
    const activeNow = (this._state?.current?.active || []).map((a) => a.zone_id).join();
    const structural = prevStatus !== this._state.status || prevRun !== this._state.current?.id || prevActive !== activeNow;
    if (this._tab === "dashboard" || this._tab === "history" || (this._tab === "programs" && !this._edit)) {
      if (structural || msg.config || this._tab !== "dashboard") this._render();
    }
    this._renderToolbar();
  }

  // ------------------------------------------------------------ helpers
  get _zones() { return this._config?.zones || []; }
  get _groups() { return this._config?.groups || []; }
  get _programs() { return this._config?.programs || []; }
  _zone(id) { return this._zones.find((z) => z.id === id); }
  _group(id) { return this._groups.find((g) => g.id === id); }
  _now() { return Date.now() + this._skew; }
  _can() { return this._isAdmin !== false; }

  async _ws(msg) {
    try {
      return await this._hass.callWS(msg);
    } catch (err) {
      this._toast(err.message || String(err));
      throw err;
    }
  }

  async _action(action, extra = {}) {
    const res = await this._ws({ type: `${DOMAIN}/action`, action, ...extra });
    if (res?.state) this._setState(res.state);
    return res;
  }

  _queueSave(key, render = false) {
    clearTimeout(this._saveTimers[key]);
    this._saveTimers[key] = setTimeout(async () => {
      delete this._saveTimers[key];
      const res = await this._ws({ type: `${DOMAIN}/save`, key, value: this._config[key] });
      if (!Object.keys(this._saveTimers).length) this._config = res.config;
      this._toast(this.t("saved"));
      if (render) this._render();
    }, 500);
  }

  _toast(text) {
    clearTimeout(this._toastTimer);
    this._toastText = text;
    let el = this.shadowRoot.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; this.shadowRoot.appendChild(el); }
    el.textContent = text;
    this._toastTimer = setTimeout(() => { el.remove(); }, 2400);
  }

  _fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date(this._now());
    const tm = d.toLocaleTimeString(this._hass.language, { hour: "2-digit", minute: "2-digit" });
    const dayDiff = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 86400000);
    if (dayDiff === 0) return `${this.t("today")} ${tm}`;
    if (dayDiff === 1) return `${this.t("tomorrow")} ${tm}`;
    return `${d.toLocaleDateString(this._hass.language, { weekday: "short", day: "numeric", month: "short" })} ${tm}`;
  }

  _budget() { return this._state?.budget ?? 100; }

  _programPlan(program) {
    const factor = (this._budget() / 100) * ((program.budget ?? 100) / 100);
    const maxMin = this._config.settings.max_zone_minutes || 120;
    return (program.steps || []).map((step) => {
      const g = this._group(step.group_id);
      if (!g) return null;
      const zones = g.zone_ids.map((zid) => this._zone(zid)).filter((z) => z && z.enabled && z.entity_id).map((z) => {
        let minutes = step.duration_mode === "custom" ? (step.durations?.[z.id] ?? step.duration) : step.duration;
        minutes = Math.min(Number(minutes) || 0, maxMin);
        return { zone_id: z.id, name: z.name, color: z.color, seconds: Math.round(minutes * 60 * factor) };
      }).filter((z) => z.seconds > 0);
      return { label: g.name, color: g.color, concurrency: step.concurrency, zones };
    }).filter((s) => s && s.zones.length);
  }

  _programSim(program) {
    const s = this._config.settings;
    const zd = program.zone_delay_s >= 0 ? program.zone_delay_s : s.zone_delay_s;
    const sd = program.step_delay_s >= 0 ? program.step_delay_s : s.step_delay_s;
    return simulate(this._programPlan(program), s.max_concurrent, zd, sd);
  }

  _scheduleText(p) {
    const s = p.schedule;
    const wd = this.t("wd");
    const months = this.t("months");
    let txt = "";
    if (s.mode === "weekdays") txt = s.weekdays.length === 7 ? this.t("all") : s.weekdays.map((d) => wd[d]).join(", ") || "—";
    else if (s.mode === "interval") txt = `${this.t("every")} ${s.interval_days} ${this.t("days")}`;
    else if (s.mode === "monthdays") txt = `${this.t("mode_monthdays")}: ${s.month_days.join(", ") || "—"}`;
    else if (s.mode === "dates") txt = `${s.dates.length} × ${this.t("mode_dates").toLowerCase()}`;
    else txt = this.t(`mode_${s.mode}`);
    if (s.months?.length && s.months.length < 12) txt += ` · ${s.months.map((m) => months[m - 1]).join(", ")}`;
    return txt;
  }

  _startText(st) {
    if (st.type === "fixed") return st.time;
    const off = st.offset ? ` ${st.offset > 0 ? "+" : ""}${st.offset}′` : "";
    return `${this.t(st.type)}${off}`;
  }

  _entityName(id) {
    const st = this._hass.states[id];
    return st?.attributes?.friendly_name || id || "—";
  }

  _isOn(entityId) {
    const st = this._hass.states[entityId];
    return !!st && ["on", "open", "opening"].includes(st.state);
  }

  _entityOptions(domains, value, allowEmpty = true) {
    const ids = Object.keys(this._hass.states).filter((id) => domains.includes(id.split(".")[0])).sort();
    const opts = ids.map((id) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(this._entityName(id))} (${esc(id)})</option>`);
    return `${allowEmpty ? `<option value="">${this.t("none")}</option>` : ""}${opts.join("")}`;
  }

  // ------------------------------------------------------------ render
  _render() {
    const sr = this.shadowRoot;
    const scroller = sr.querySelector(".scroller");
    const scroll = scroller ? scroller.scrollTop : 0;
    let body;
    if (this._error) body = `<div class="card"><div class="empty"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>${esc(this._error)}</div></div>`;
    else if (!this._config) body = `<div class="empty">…</div>`;
    else body = this[`_render_${this._tab}`]();
    sr.innerHTML = `
      ${this._inlineStyles ? `<style>${STYLES}</style>` : ""}
      <div class="toolbar">${this._toolbarHtml()}</div>
      <nav class="tabs">${TABS.map(([k, icon]) => `
        <button class="tab ${this._tab === k ? "active" : ""}" data-action="tab" data-id="${k}">
          <ha-icon icon="${icon}"></ha-icon>${this.t(`tab_${k}`)}</button>`).join("")}</nav>
      <div class="scroller"><main>
        ${this._config && !this._can() ? `<div class="banner"><ha-icon icon="mdi:lock-outline"></ha-icon>${this.t("read_only")}</div>` : ""}
        ${body}</main></div>
      ${this._dialog ? this._dialogHtml() : ""}`;
    const newScroller = sr.querySelector(".scroller");
    if (newScroller) newScroller.scrollTop = scroll;
    const mb = sr.querySelector("ha-menu-button");
    if (mb) { mb.hass = this._hass; mb.narrow = this._narrow; }
    this._tick();
  }

  _toolbarHtml() {
    const status = this._state?.status || "idle";
    const running = status === "running";
    return `
      <ha-menu-button></ha-menu-button>
      <div class="title"><ha-icon icon="mdi:sprinkler-variant"></ha-icon>SK ${this.t("title")}</div>
      <span class="pill ${status}"><span class="dot"></span>${this.t(`st_${status}`)}</span>
      ${running || this._state?.queue?.length ? `<button class="btn danger sm" data-action="stop"><ha-icon icon="mdi:stop"></ha-icon>${this.t("stop_all")}</button>` : ""}`;
  }

  _renderToolbar() {
    const tb = this.shadowRoot.querySelector(".toolbar");
    if (!tb) return;
    const pill = tb.querySelector(".pill");
    const status = this._state?.status || "idle";
    if (pill && pill.classList.contains(status) && !!tb.querySelector("[data-action=stop]") === !!(status === "running" || this._state?.queue?.length)) return;
    tb.innerHTML = this._toolbarHtml();
    const mb = tb.querySelector("ha-menu-button");
    if (mb) { mb.hass = this._hass; mb.narrow = this._narrow; }
  }

  // live countdowns / progress without re-rendering
  _tick() {
    const now = this._now();
    this.shadowRoot.querySelectorAll("[data-end]").forEach((el) => {
      const end = Date.parse(el.dataset.end);
      const start = Date.parse(el.dataset.start);
      const total = Math.max(1, end - start);
      const pct = Math.min(100, Math.max(0, ((now - start) / total) * 100));
      if (el.dataset.mode === "clock") el.textContent = fmtClock((end - now) / 1000);
      else if (el.dataset.mode === "bar") el.style.width = `${pct}%`;
      else if (el.dataset.mode === "ring") el.style.setProperty("--p", pct.toFixed(1));
    });
  }

  _updateEntityStates() {
    this.shadowRoot.querySelectorAll("[data-entity]").forEach((el) => {
      const on = this._isOn(el.dataset.entity);
      el.classList.toggle("on", on);
    });
  }

  // ------------------------------------------------------------ dashboard
  _render_dashboard() {
    const st = this._state;
    return `
      <div class="grid cols-main">
        <div class="stack" style="gap:16px">
          ${this._heroHtml()}
          ${this._zonesTilesHtml()}
        </div>
        <div class="stack" style="gap:16px">
          ${this._conditionsHtml()}
          ${this._programsMiniHtml()}
          ${st.queue.length ? this._queueHtml() : ""}
        </div>
      </div>`;
  }

  _heroHtml() {
    const st = this._state;
    const cur = st.current;
    if (!cur) {
      const nxt = st.next;
      const icon = STATUS_ICON[st.status] || STATUS_ICON.idle;
      return `<div class="card"><div class="hero">
        <div class="ring" style="--p:0"><div><ha-icon icon="${icon}"></ha-icon></div></div>
        <div class="info">
          <div class="muted small">${this.t(`st_${st.status}`)}</div>
          <h1>${nxt ? esc(nxt.name) : this.t("no_next_run")}</h1>
          ${nxt ? `<div class="muted"><ha-icon icon="mdi:calendar-clock" style="--mdc-icon-size:16px"></ha-icon> ${this.t("next_run")}: <b>${this._fmtWhen(nxt.at)}</b></div>` : ""}
        </div>
        ${nxt && this._can() ? `<div class="actions"><button class="btn water" data-action="run-program" data-id="${nxt.program_id}"><ha-icon icon="mdi:play"></ha-icon>${this.t("run_now")}</button></div>` : ""}
      </div></div>`;
    }
    const zones = Object.fromEntries(this._zones.map((z) => [z.id, z]));
    const doneIds = new Set(cur.done.map((d) => d.zone_id));
    const activeIds = new Set(cur.active.map((a) => a.zone_id));
    return `<div class="card"><div class="hero running">
        <div class="ring" data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="ring">
          <div><div class="big" data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="clock">--:--</div>
          <div class="small muted">${this.t("remaining")}</div></div></div>
        <div class="info">
          <div class="muted small">${this.t("now_watering")} · ${this.t(`src_${cur.source}`)}</div>
          <h1>${esc(cur.name)}</h1>
          <div class="muted small">${this.t("step")} ${cur.step_index + 1} ${this.t("of")} ${cur.steps.length} · ${cur.zones} ${this.t("zones_lc")}</div>
        </div>
        ${this._can() ? `<div class="actions">
          <button class="btn" data-action="skip"><ha-icon icon="mdi:skip-next"></ha-icon>${this.t("skip")}</button>
          <button class="btn danger solid" data-action="stop"><ha-icon icon="mdi:stop"></ha-icon>${this.t("stop_all")}</button></div>` : ""}
      </div>
      <div class="bd">
        ${cur.active.map((a) => {
          const z = zones[a.zone_id] || { name: a.entity_id, color: "#1e88e5" };
          return `<div class="active-zone">
            <span class="swatch" style="background:${esc(z.color)}"></span>
            <div><b>${esc(z.name)}</b><div class="bar"><i data-start="${a.started}" data-end="${a.ends}" data-mode="bar"></i></div></div>
            <span class="tnum" data-start="${a.started}" data-end="${a.ends}" data-mode="clock"></span>
            ${this._can() ? `<button class="btn icon" title="${this.t("skip")}" data-action="skip" data-id="${a.zone_id}"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : "<span></span>"}
          </div>`;
        }).join("")}
        <div class="steps-track">
          ${cur.steps.map((s, i) => `<div class="st"><b class="${i < cur.step_index ? "muted" : ""}">${esc(s.label)}</b>
            <span class="badge">${s.concurrency === 0 ? this.t("all") : `×${s.concurrency}`}</span>
            ${s.zones.map((z) => `<span class="zpill ${activeIds.has(z.zone_id) ? "active" : doneIds.has(z.zone_id) ? "done" : ""}">
              ${esc(zones[z.zone_id]?.name || z.zone_id)} · ${fmtDur(z.seconds)}</span>`).join("")}</div>`).join("")}
        </div>
      </div></div>`;
  }

  _zonesTilesHtml() {
    const stats = this._state.zone_stats || {};
    if (!this._zones.length) {
      return `<div class="card"><div class="empty"><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("no_zones")}
        <div style="margin-top:12px"><button class="btn primary" data-action="tab" data-id="zones">${this.t("tab_zones")}</button></div></div></div>`;
    }
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("zones")}</h2>
      <span class="muted small">${this._zones.length}</span></div>
      <div class="bd"><div class="tiles">
      ${this._zones.map((z) => {
        const s = stats[z.id];
        return `<div class="tile ${this._isOn(z.entity_id) ? "on" : ""}" style="--c:${esc(z.color)}" data-entity="${esc(z.entity_id || "")}">
          <div class="nm"><ha-icon icon="${esc(z.icon)}"></ha-icon><span style="flex:1">${esc(z.name)}</span>
            <span class="state-dot ${this._isOn(z.entity_id) ? "on" : ""}"></span></div>
          <div class="small muted">${this.t("last_watered")}: ${s?.last ? `${this._fmtWhen(s.last)} · ${fmtDur(s.last_seconds)}` : this.t("never")}</div>
          ${this._can() ? `<div class="row"><button class="btn sm" data-action="open-run" data-kind="zone" data-id="${z.id}" ${z.enabled && z.entity_id ? "" : "disabled"}>
            <ha-icon icon="mdi:play"></ha-icon>${this.t("run")}</button></div>` : ""}
        </div>`;
      }).join("")}
      </div></div></div>`;
  }

  _conditionsHtml() {
    const st = this._state;
    const s = this._config.settings;
    const delay = s.rain_delay_until && Date.parse(s.rain_delay_until) > this._now() ? s.rain_delay_until : null;
    const reasons = st.blocking.filter((r) => r !== "system_disabled");
    const label = (r) => {
      const [k, v] = r.split(":");
      const txt = this.t(`blocking_${k}`);
      return v && k !== "rain_delay" ? `${txt}: ${esc(k === "rain_sensor" ? this._entityName(r.slice(k.length + 1)) : v)}` : txt;
    };
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:shield-check-outline"></ha-icon>${this.t("conditions")}</h2></div><div class="bd">
      <div class="toggle-row"><ha-icon icon="mdi:water-pump"></ha-icon><span class="lbl">${this.t("system_enabled")}</span>
        <label class="switch"><input type="checkbox" data-bind="system" ${s.enabled ? "checked" : ""} ${this._can() ? "" : "disabled"}><span class="tr"></span></label></div>
      <div class="toggle-row" style="align-items:flex-start"><ha-icon icon="mdi:weather-pouring"></ha-icon><div class="lbl">${this.t("rain_delay")}
        ${delay ? `<div class="small muted">${this.t("rain_delay_until")} ${this._fmtWhen(delay)}</div>` : ""}
        ${this._can() ? `<div class="chips" style="margin-top:8px">${[24, 48, 72].map((h) => `<button class="chip" data-action="rain-delay" data-hours="${h}">${h} h</button>`).join("")}
          ${delay ? `<button class="chip" data-action="rain-delay" data-hours="0">${this.t("clear")}</button>` : ""}</div>` : ""}
      </div></div>
      <div class="toggle-row"><ha-icon icon="mdi:water-percent"></ha-icon><span class="lbl">${this.t("budget")}</span><b class="tnum">${Math.round(st.budget)}%</b></div>
      <div style="margin-top:6px">${reasons.length
        ? reasons.map((r) => `<div class="badge amber" style="margin:2px 4px 2px 0"><ha-icon icon="mdi:alert" style="--mdc-icon-size:14px"></ha-icon>${label(r)}</div>`).join("")
        : `<div class="badge green">${this.t("all_clear")}</div>`}</div>
    </div></div>`;
  }

  _programsMiniHtml() {
    const progs = this._programs;
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:calendar-clock"></ha-icon>${this.t("programs")}</h2>
      ${this._can() ? `<button class="btn sm ghost" data-action="tab" data-id="programs"><ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}</div><div class="bd">
      ${progs.length ? progs.map((p) => {
        const next = this._state.next_runs[p.id];
        const sim = this._programSim(p);
        return `<div class="list-row">
          <span class="swatch" style="background:${esc(p.color)}"></span>
          <div style="flex:1;min-width:0"><b>${esc(p.name)}</b>
            <div class="small muted">${p.enabled ? (next ? this._fmtWhen(next) : "—") : this.t("program_disabled")} · ${fmtDur(sim.total)}</div></div>
          ${this._can() ? `<label class="switch"><input type="checkbox" data-bind="progenabled:${p.id}" ${p.enabled ? "checked" : ""}><span class="tr"></span></label>
          <button class="btn icon" title="${this.t("run_now")}" data-action="run-program" data-id="${p.id}"><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>` : ""}
        </div>`;
      }).join("") : `<div class="empty">${this.t("no_programs")}</div>`}
    </div></div>`;
  }

  _queueHtml() {
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:tray-full"></ha-icon>${this.t("queue")}</h2></div><div class="bd">
      ${this._state.queue.map((q, i) => `<div class="list-row"><span class="badge">${i + 1}</span><span style="flex:1">${esc(q.name)}</span>
        <span class="small muted">${this.t(`src_${q.source}`)}</span>
        ${this._can() ? `<button class="btn icon" data-action="remove-queued" data-id="${q.id}"><ha-icon icon="mdi:close"></ha-icon></button>` : ""}</div>`).join("")}
    </div></div>`;
  }

  // ------------------------------------------------------------ zones tab
  _render_zones() {
    const used = new Set(this._zones.map((z) => z.entity_id));
    const q = this._search.toLowerCase();
    const cands = (this._candidates || []).filter((c) =>
      (this._domain === "all" || c.domain === this._domain || (this._domain === "rainbird" && c.platform === "rainbird")) &&
      (!q || c.name.toLowerCase().includes(q) || c.entity_id.includes(q)));
    const rbFree = (this._candidates || []).filter((c) => c.platform === "rainbird" && !used.has(c.entity_id));
    const domains = ["all", "rainbird", "switch", "valve", "input_boolean", "light", "fan"];
    return `<div class="grid" style="grid-template-columns:minmax(280px,380px) minmax(0,1fr);align-items:start" id="zones-grid">
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:devices"></ha-icon>${this.t("devices")}</h2></div><div class="bd">
        <p class="hint">${this.t("devices_hint")}</p>
        <input type="text" placeholder="${this.t("search")}" value="${esc(this._search)}" data-bind="search">
        <div class="chips" style="margin:10px 0">${domains.map((d) => `<button class="chip ${this._domain === d ? "on" : ""}" data-action="domain" data-id="${d}">
          ${d === "all" ? this.t("all_domains") : d === "rainbird" ? "Rain Bird" : d}</button>`).join("")}</div>
        ${rbFree.length && this._can() ? `<button class="btn primary" style="width:100%;justify-content:center;margin-bottom:8px" data-action="add-all-rainbird">
          <ha-icon icon="mdi:plus-box-multiple"></ha-icon>${this.t("add_all_rainbird")} (${rbFree.length})</button>` : ""}
        <div class="device-list" id="device-list">${this._deviceListHtml(cands, used)}</div>
      </div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("configured_zones")}</h2>
        <span class="badge">${this._zones.length}</span></div><div class="bd zone-list">
        ${this._zones.length ? this._zones.map((z) => `<div class="zone-row">
          <input class="z-c" type="color" value="${esc(z.color)}" data-bind="zone:${z.id}:color" ${this._can() ? "" : "disabled"}>
          <input class="z-n" type="text" value="${esc(z.name)}" data-bind="zone:${z.id}:name" placeholder="${this.t("zone_name")}" ${this._can() ? "" : "disabled"}>
          <select class="z-e" data-bind="zone:${z.id}:entity_id" ${this._can() ? "" : "disabled"}>${this._entityOptions(["switch", "valve", "input_boolean", "light", "fan"], z.entity_id)}</select>
          <input class="z-f" type="number" min="0" step="0.1" value="${z.flow_rate ?? ""}" placeholder="${this.t("flow_rate")}" title="${this.t("flow_rate")}" data-bind="zone:${z.id}:flow_rate" ${this._can() ? "" : "disabled"}>
          <label class="switch z-s" title="${this.t("enabled")}"><input type="checkbox" data-bind="zone:${z.id}:enabled" ${z.enabled ? "checked" : ""} ${this._can() ? "" : "disabled"}><span class="tr"></span></label>
          <div class="row z-a" style="gap:2px">${this._can() ? `
            <button class="btn icon" title="${this.t("test")}" data-action="test-zone" data-id="${z.id}"><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>
            <button class="btn icon" title="${this.t("delete")}" data-action="delete-zone" data-id="${z.id}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>` : ""}</div>
        </div>`).join("") : `<div class="empty"><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("no_zones")}</div>`}
      </div></div>
    </div>`;
  }

  _deviceListHtml(cands, used) {
    return cands.map((c) => `<div class="device">
      <ha-icon icon="${esc(c.icon || (c.domain === "valve" ? "mdi:valve" : "mdi:sprinkler"))}" style="color:var(--ski-muted)"></ha-icon>
      <div class="nm"><div>${esc(c.name)}</div><div class="small muted">${esc(c.entity_id)}</div></div>
      ${c.platform === "rainbird" ? `<span class="badge rb">Rain Bird</span>` : ""}
      ${used.has(c.entity_id) ? `<span class="badge green">${this.t("in_use")}</span>`
        : this._can() ? `<button class="btn icon" data-action="add-device" data-id="${esc(c.entity_id)}"><ha-icon icon="mdi:plus-circle-outline"></ha-icon></button>` : ""}
    </div>`).join("") || `<div class="empty">—</div>`;
  }

  _addZone(entityId) {
    const c = (this._candidates || []).find((x) => x.entity_id === entityId);
    const name = (c?.name || this._entityName(entityId)).replace(/^Rain ?Bird\s*/i, "");
    this._config.zones.push({
      id: uid("zone"), name, entity_id: entityId, icon: "mdi:sprinkler", enabled: true, flow_rate: null, notes: "",
      color: PALETTE[this._config.zones.length % PALETTE.length],
    });
  }

  // ------------------------------------------------------------ groups tab
  _render_groups() {
    const counts = {};
    this._groups.forEach((g) => g.zone_ids.forEach((z) => { counts[z] = (counts[z] || 0) + 1; }));
    const can = this._can();
    return `<p class="hint">${this.t("groups_hint")}</p>
    <div class="groups-layout">
      <div class="card pool"><div class="hd"><h2><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("zones")}</h2></div>
        <div class="bd"><div class="dropzone" data-drop="pool" data-accept="zone">
        ${this._zones.length ? this._zones.map((z) => `<div class="zchip" style="--c:${esc(z.color)}" ${can ? `data-drag="${attr({ t: "zone", z: z.id, from: null })}"` : ""}>
          <ha-icon class="grip" icon="mdi:drag-vertical"></ha-icon><span class="swatch" style="background:${esc(z.color)}"></span>
          <span class="nm">${esc(z.name)}</span><span class="small muted">${counts[z.id] ? this.t("in_groups", { n: counts[z.id] }) : ""}</span></div>`).join("")
        : `<div class="empty">${this.t("no_zones")}</div>`}
        </div></div></div>
      <div class="group-grid">
        ${this._groups.map((g) => this._groupCardHtml(g)).join("")}
        ${can ? `<div class="new-group" data-drop="new-group" data-accept="zone" data-action="new-group">
          <div><ha-icon icon="mdi:plus-circle-outline" style="--mdc-icon-size:34px"></ha-icon><div><b>${this.t("new_group")}</b></div>
          <div class="small">${this.t("drop_new_group")}</div></div></div>` : ""}
      </div>
    </div>`;
  }

  _groupCardHtml(g) {
    const can = this._can();
    const free = this._zones.filter((z) => !g.zone_ids.includes(z.id));
    return `<div class="card group-card" style="--c:${esc(g.color)}">
      <div class="hd">
        <input type="color" value="${esc(g.color)}" data-bind="group:${g.id}:color" ${can ? "" : "disabled"}>
        <input type="text" value="${esc(g.name)}" data-bind="group:${g.id}:name" ${can ? "" : "disabled"}>
        ${can ? `<button class="btn icon" title="${this.t("quick_run_group")}" data-action="open-run" data-kind="group" data-id="${g.id}" ${g.zone_ids.length ? "" : "disabled"}><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>
        <button class="btn icon" title="${this.t("delete")}" data-action="delete-group" data-id="${g.id}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>` : ""}
      </div>
      <div class="bd">
        <div class="dropzone ${g.zone_ids.length ? "" : "empty-dz"}" data-drop="group:${g.id}" data-accept="zone">
          ${g.zone_ids.length ? g.zone_ids.map((zid, i) => {
            const z = this._zone(zid);
            if (!z) return "";
            return `<div class="zchip" style="--c:${esc(g.color)}" ${can ? `data-drag="${attr({ t: "zone", z: zid, from: g.id, i })}"` : ""}>
              <span class="ord">${i + 1}</span><span class="swatch" style="background:${esc(z.color)}"></span><span class="nm">${esc(z.name)}</span>
              ${can ? `<button class="btn icon" data-action="ungroup" data-group="${g.id}" data-id="${zid}"><ha-icon icon="mdi:close" style="--mdc-icon-size:16px"></ha-icon></button>` : ""}</div>`;
          }).join("") : this.t("drop_here")}
        </div>
        ${can && free.length ? `<select style="margin-top:8px" data-bind="group-add:${g.id}"><option value="">＋ ${this.t("add_zone_to_group")}</option>
          ${free.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join("")}</select>` : ""}
        <div class="small muted" style="margin-top:8px">${g.zone_ids.length} ${this.t("zones_lc")}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------ programs tab
  _render_programs() {
    if (this._edit) return this._editorHtml();
    const can = this._can();
    return `<div class="row" style="margin-bottom:16px"><div class="spacer"></div>
      ${can ? `<button class="btn primary" data-action="new-program" ${this._groups.length ? "" : "disabled"}><ha-icon icon="mdi:plus"></ha-icon>${this.t("new_program")}</button>` : ""}</div>
      ${!this._groups.length ? `<div class="banner"><ha-icon icon="mdi:information-outline"></ha-icon>${this.t("no_groups_yet")}</div>` : ""}
      <div class="grid cols-2">
      ${this._programs.map((p) => {
        const sim = this._programSim(p);
        const next = this._state.next_runs[p.id];
        const running = this._state.current?.program_id === p.id;
        return `<div class="card prog-card" style="--c:${esc(p.color)}"><div class="stripe"></div><div class="content">
          <div class="row"><h3 style="flex:1">${esc(p.name)}</h3>
            ${running ? `<span class="badge blue">${this.t("st_running")}</span>` : ""}
            ${can ? `<label class="switch"><input type="checkbox" data-bind="progenabled:${p.id}" ${p.enabled ? "checked" : ""}><span class="tr"></span></label>` : ""}</div>
          <div class="meta">
            <span><ha-icon icon="mdi:calendar"></ha-icon>${esc(this._scheduleText(p))}</span>
            <span><ha-icon icon="mdi:clock-outline"></ha-icon>${p.start_times.map((s) => this._startText(s)).join(", ") || "—"}</span>
            <span><ha-icon icon="mdi:timer-sand"></ha-icon>${fmtDur(sim.total)}</span>
            <span><ha-icon icon="mdi:calendar-arrow-right"></ha-icon>${p.enabled ? this._fmtWhen(next) : this.t("program_disabled")}</span>
          </div>
          <div class="chips" style="margin-top:10px">${p.steps.map((s, i) => {
            const g = this._group(s.group_id);
            return g ? `<span class="zpill"><span class="swatch" style="background:${esc(g.color)}"></span>${i + 1}. ${esc(g.name)}
              · ${s.concurrency === 0 ? this.t("all") : s.concurrency === 1 ? this.t("sequential") : `×${s.concurrency}`}</span>` : "";
          }).join("")}</div>
          ${can ? `<div class="row" style="margin-top:12px;gap:6px">
            <button class="btn sm water" data-action="run-program" data-id="${p.id}"><ha-icon icon="mdi:play"></ha-icon>${this.t("run_now")}</button>
            <div class="spacer"></div>
            <button class="btn sm" data-action="edit-program" data-id="${p.id}"><ha-icon icon="mdi:pencil"></ha-icon>${this.t("edit")}</button>
            <button class="btn icon" title="${this.t("duplicate")}" data-action="dup-program" data-id="${p.id}"><ha-icon icon="mdi:content-copy"></ha-icon></button>
            <button class="btn icon" title="${this.t("delete")}" data-action="delete-program" data-id="${p.id}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>` : ""}
        </div></div>`;
      }).join("")}
      </div>
      ${!this._programs.length ? `<div class="card"><div class="empty"><ha-icon icon="mdi:calendar-plus"></ha-icon>${this.t("no_programs")}</div></div>` : ""}`;
  }

  _newProgram() {
    const today = new Date();
    return {
      id: uid("prog"), name: `${this.t("new_program")} ${this._programs.length + 1}`,
      color: PALETTE[this._programs.length % PALETTE.length], enabled: true,
      schedule: { mode: "weekdays", weekdays: [0, 2, 4], interval_days: 2,
        anchor_date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
        month_days: [], dates: [], months: [] },
      start_times: [{ type: "fixed", time: "06:00" }],
      steps: [], budget: 100, zone_delay_s: -1, step_delay_s: -1, ignore_conditions: false, on_busy: "queue",
    };
  }

  _editorHtml() {
    const p = this._edit;
    const s = p.schedule;
    const wd = this.t("wd");
    const months = this.t("months");
    const section = (n, icon, title, body, extra = "") => `<div class="card"><div class="hd"><span class="section-n">${n}</span>
      <h2>${title}</h2>${extra}</div><div class="bd">${body}</div></div>`;

    const general = `<div class="fields">
      <label class="field"><span>${this.t("program_name")}</span><input type="text" value="${esc(p.name)}" data-bind="prog:name"></label>
      <label class="field"><span>${this.t("program_budget")}</span><input type="number" min="0" max="300" value="${p.budget}" data-bind="prog:budget"></label>
      <label class="field"><span>${this.t("on_busy")}</span><select data-bind="prog:on_busy">
        <option value="queue" ${p.on_busy === "queue" ? "selected" : ""}>${this.t("on_busy_queue")}</option>
        <option value="skip" ${p.on_busy === "skip" ? "selected" : ""}>${this.t("on_busy_skip")}</option></select></label>
      </div>
      <div class="row wrap" style="margin-top:14px;gap:20px">
        <div class="row"><input type="color" value="${esc(p.color)}" data-bind="prog:color"> ${this.t("color")}</div>
        <div class="row"><label class="switch"><input type="checkbox" data-bind="prog:enabled" ${p.enabled ? "checked" : ""}><span class="tr"></span></label>${this.t("enabled")}</div>
        <div class="row"><label class="switch"><input type="checkbox" data-bind="prog:ignore_conditions" ${p.ignore_conditions ? "checked" : ""}><span class="tr"></span></label>${this.t("ignore_conditions")}</div>
      </div>`;

    let modeBody = "";
    if (s.mode === "weekdays") {
      modeBody = `<div class="chips">${wd.map((d, i) => `<button class="chip sq ${s.weekdays.includes(i) ? "on" : ""}" data-action="toggle-wd" data-n="${i}">${d}</button>`).join("")}</div>`;
    } else if (s.mode === "interval") {
      modeBody = `<div class="row wrap">${this.t("every")} <input type="number" min="1" max="365" value="${s.interval_days}" data-bind="prog:schedule.interval_days">
        ${this.t("days")} ${this.t("starting")} <input type="date" style="width:170px" value="${esc(s.anchor_date)}" data-bind="prog:schedule.anchor_date"></div>`;
    } else if (s.mode === "monthdays") {
      modeBody = `<div class="chips">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) =>
        `<button class="chip sq ${s.month_days.includes(d) ? "on" : ""}" data-action="toggle-md" data-n="${d}">${d}</button>`).join("")}</div>`;
    } else if (s.mode === "dates") {
      modeBody = `<div class="row wrap"><input type="date" style="width:170px" id="new-date">
        <label class="row small"><input type="checkbox" id="new-date-yearly"> ${this.t("every_year")}</label>
        <button class="btn sm" data-action="add-date"><ha-icon icon="mdi:plus"></ha-icon>${this.t("add_date")}</button></div>
        <div class="chips" style="margin-top:10px">${s.dates.length ? s.dates.map((d) => `<span class="chip">${d.length === 5 ? `<ha-icon icon="mdi:repeat" style="--mdc-icon-size:14px"></ha-icon>` : ""}${esc(d)}
          <button class="btn icon" style="padding:0" data-action="del-date" data-id="${esc(d)}"><ha-icon icon="mdi:close" style="--mdc-icon-size:14px"></ha-icon></button></span>`).join("") : `<span class="muted small">${this.t("no_dates")}</span>`}</div>`;
    }
    const calendar = `<div class="seg" style="margin-bottom:14px">${MODES.map((m) => `<button class="${s.mode === m ? "on" : ""}" data-action="sched-mode" data-id="${m}">${this.t(`mode_${m}`)}</button>`).join("")}</div>
      ${modeBody}
      <div class="sub muted small" style="margin:16px 0 6px">${this.t("active_months")}</div>
      <div class="chips">${months.map((m, i) => `<button class="chip sq ${s.months.includes(i + 1) ? "on" : ""}" data-action="toggle-month" data-n="${i + 1}">${m}</button>`).join("")}</div>`;

    const starts = `${p.start_times.map((st, i) => `<div class="start-row" style="margin-bottom:8px">
        <ha-icon icon="${st.type === "fixed" ? "mdi:clock-outline" : st.type === "sunrise" ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down"}"></ha-icon>
        <select data-bind="start:${i}:type" data-rerender>
          ${["fixed", "sunrise", "sunset"].map((k) => `<option value="${k}" ${st.type === k ? "selected" : ""}>${this.t(k === "fixed" ? "fixed_time" : k)}</option>`).join("")}</select>
        ${st.type === "fixed" ? `<input type="time" value="${esc(st.time || "06:00")}" data-bind="start:${i}:time">`
          : `<input type="number" min="-240" max="240" value="${st.offset || 0}" data-bind="start:${i}:offset" title="${this.t("offset_min")}"><span class="small muted">${this.t("offset_min")}</span>`}
        <button class="btn icon" data-action="del-start" data-n="${i}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join("")}
      ${!p.start_times.length ? `<div class="banner">${this.t("no_starts")}</div>` : ""}
      <button class="btn sm" data-action="add-start"><ha-icon icon="mdi:plus"></ha-icon>${this.t("add_start")}</button>`;

    const sequence = `<div class="dropzone ${p.steps.length ? "" : "empty-dz"}" data-drop="steps" data-accept="group,step" style="gap:10px">
      ${p.steps.length ? p.steps.map((st, i) => this._stepHtml(st, i)).join(`<div class="connector"><ha-icon icon="mdi:arrow-down"></ha-icon></div>`)
        : `<div style="padding:18px"><ha-icon icon="mdi:gesture-tap-hold"></ha-icon> ${this.t("drop_steps")}</div>`}
    </div>`;

    const s2 = this._config.settings;
    const advanced = `<div class="fields">
      <label class="field"><span>${this.t("zone_delay")}</span><input type="number" min="0" value="${p.zone_delay_s >= 0 ? p.zone_delay_s : ""}" placeholder="${this.t("use_default", { n: s2.zone_delay_s })}" data-bind="prog:zone_delay_s"></label>
      <label class="field"><span>${this.t("step_delay")}</span><input type="number" min="0" value="${p.step_delay_s >= 0 ? p.step_delay_s : ""}" placeholder="${this.t("use_default", { n: s2.step_delay_s })}" data-bind="prog:step_delay_s"></label>
    </div>`;

    return `<div class="row" style="margin-bottom:14px">
        <button class="btn ghost" data-action="prog-cancel"><ha-icon icon="mdi:arrow-left"></ha-icon>${this.t("tab_programs")}</button>
        <h2 style="margin:0;font-size:20px;flex:1">${esc(p.name)}</h2></div>
      <div class="editor">
        <div class="stack" style="gap:16px">
          ${section(1, "", this.t("general"), general)}
          ${section(2, "", this.t("calendar"), calendar)}
          ${section(3, "", this.t("start_times"), starts)}
          ${section(4, "", this.t("sequence"), sequence)}
          ${section(5, "", this.t("advanced"), advanced)}
        </div>
        <div class="side">
          <div class="card"><div class="hd"><h3><ha-icon icon="mdi:vector-arrange-below"></ha-icon>${this.t("groups_palette")}</h3></div><div class="bd">
            <p class="hint">${this.t("palette_hint")}</p>
            <div class="stack" style="gap:6px">${this._groups.map((g) => `<div class="palette-item" style="--c:${esc(g.color)}" data-drag="${attr({ t: "group", g: g.id })}">
              <ha-icon class="grip" icon="mdi:drag-vertical" style="color:var(--ski-muted)"></ha-icon>
              <span class="nm">${esc(g.name)} <span class="small muted">· ${g.zone_ids.length}</span></span>
              <button class="btn icon" data-action="add-step" data-id="${g.id}"><ha-icon icon="mdi:plus"></ha-icon></button></div>`).join("")}</div>
          </div></div>
          <div class="card" id="editor-preview">${this._previewHtml()}</div>
        </div>
      </div>
      <div class="sticky-foot">
        <span class="muted small">${this._dirty ? `<ha-icon icon="mdi:circle-medium" style="color:var(--ski-amber)"></ha-icon>${this.t("unsaved")}` : ""}</span>
        <div class="spacer"></div>
        <button class="btn" data-action="prog-cancel">${this.t("cancel")}</button>
        <button class="btn primary" data-action="prog-save"><ha-icon icon="mdi:content-save"></ha-icon>${this.t("save")}</button>
      </div>`;
  }

  _stepHtml(st, i) {
    const g = this._group(st.group_id);
    if (!g) return "";
    const zones = g.zone_ids.map((z) => this._zone(z)).filter(Boolean);
    const conc = st.concurrency;
    const preset = [1, 2, 3, 4, 0];
    return `<div class="step-card" style="--c:${esc(g.color)}" data-drag="${attr({ t: "step", i })}" data-handle-only>
      <div class="shd">
        <ha-icon class="grip" icon="mdi:drag-horizontal-variant"></ha-icon>
        <span class="section-n" style="background:${esc(g.color)}">${i + 1}</span>
        <span class="t">${esc(g.name)} <span class="small muted">· ${zones.length} ${this.t("zones_lc")}</span></span>
        <button class="btn icon" data-action="move-step" data-n="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
        <button class="btn icon" data-action="move-step" data-n="${i}" data-dir="1" ${i === this._edit.steps.length - 1 ? "disabled" : ""}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        <button class="btn icon" data-action="del-step" data-n="${i}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
      </div>
      <div class="sbd">
        <div><div class="sub">${this.t("activation")}</div>
          <div class="row wrap"><div class="seg">${preset.map((n) => `<button class="${conc === n ? "on" : ""}" data-action="step-conc" data-n="${i}" data-v="${n}">
            ${n === 1 ? `${this.t("sequential")}` : n === 0 ? this.t("all") : `${n} ${this.t("at_once")}`}</button>`).join("")}
            <button class="${preset.includes(conc) ? "" : "on"}" data-action="step-conc" data-n="${i}" data-v="5">${this.t("custom")}</button></div>
            ${preset.includes(conc) ? "" : `<input type="number" min="1" max="64" value="${conc}" data-bind="step:${i}:concurrency">`}
          </div></div>
        <div><div class="sub">${this.t("timing")}</div>
          <div class="row wrap"><div class="seg">
            <button class="${st.duration_mode !== "custom" ? "on" : ""}" data-action="step-mode" data-n="${i}" data-v="uniform">${this.t("uniform")}</button>
            <button class="${st.duration_mode === "custom" ? "on" : ""}" data-action="step-mode" data-n="${i}" data-v="custom">${this.t("per_zone")}</button></div>
            <input type="number" min="0" max="600" step="0.5" value="${st.duration}" data-bind="step:${i}:duration"> <span class="muted">${this.t("min")}</span>
            ${st.duration_mode === "custom" ? `<button class="btn sm" data-action="step-apply" data-n="${i}">${this.t("apply_all")}</button>` : ""}
          </div>
          ${st.duration_mode === "custom" ? `<div class="dur-table" style="margin-top:10px">${zones.map((z, zi) => `
            <span class="row"><span class="ord" style="width:20px;height:20px;border-radius:50%;background:${esc(z.color)};color:#fff;font-size:11px;display:grid;place-items:center">${zi + 1}</span>${esc(z.name)}</span>
            <span class="row"><input type="number" min="0" max="600" step="0.5" value="${st.durations[z.id] ?? st.duration}" data-bind="stepdur:${i}:${z.id}"><span class="muted small">${this.t("min")}</span></span>`).join("")}
            <span class="small muted" style="grid-column:1/-1">${this.t("omit_hint")}</span></div>` : ""}
        </div>
      </div></div>`;
  }

  _previewHtml() {
    const p = this._edit;
    const sim = this._programSim(p);
    const total = Math.max(1, sim.total);
    const zoneCount = sim.bars.length;
    const water = sim.bars.reduce((acc, b) => acc + ((this._zone(b.zone_id)?.flow_rate || 0) * b.seconds) / 60, 0);
    const cap = this._config.settings.max_concurrent;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => fmtDur(total * f));
    return `<div class="hd"><h3><ha-icon icon="mdi:chart-gantt"></ha-icon>${this.t("preview")}</h3></div><div class="bd">
      <div class="kpis"><div class="kpi"><b>${fmtDur(sim.total)}</b><span>${this.t("est_duration")}</span></div>
        <div class="kpi"><b>${zoneCount}</b><span>${this.t("zones")}</span></div>
        <div class="kpi"><b>${water ? `${Math.round(water)} L` : "—"}</b><span>${this.t("h_water")}</span></div></div>
      ${sim.bars.length ? `<div class="sub muted small" style="margin:14px 0 8px">${this.t("timeline")}</div>
      <div class="timeline">${sim.bars.map((b) => `<div class="tl-row"><span class="lab">${esc(b.name)}</span>
        <div class="tl-track"><span class="tl-bar" style="--c:${esc(b.color)};left:${(b.start / total) * 100}%;width:${((b.end - b.start) / total) * 100}%"
          title="${esc(b.name)} · ${fmtDur(b.end - b.start)}"></span></div></div>`).join("")}</div>
      <div class="tl-axis"><span>${ticks[0]}</span><span>${ticks[2]}</span><span>${ticks[4]}</span></div>` : ""}
      <p class="hint" style="margin-top:12px">${this.t("sim_hint", { b: Math.round(this._budget() * (p.budget / 100)), c: cap || this.t("unlimited") })}</p>
    </div>`;
  }

  _refreshPreview() {
    const el = this.shadowRoot.getElementById("editor-preview");
    if (el) el.innerHTML = this._previewHtml();
    const foot = this.shadowRoot.querySelector(".sticky-foot .muted");
    if (foot) foot.innerHTML = `<ha-icon icon="mdi:circle-medium" style="color:var(--ski-amber)"></ha-icon>${this.t("unsaved")}`;
  }

  // ------------------------------------------------------------ settings tab
  _render_settings() {
    const s = this._config.settings;
    const can = this._can() ? "" : "disabled";
    const num = (key, label, min = 0, max = 9999, step = 1) => `<label class="field"><span>${label}</span>
      <input type="number" min="${min}" max="${max}" step="${step}" value="${s[key] ?? ""}" data-bind="settings:${key}" ${can}></label>`;
    const ent = (key, label, domains) => `<label class="field"><span>${label}</span>
      <select data-bind="settings:${key}" ${can}>${this._entityOptions(domains, s[key])}</select></label>`;
    const notify = Object.keys(this._hass.services?.notify || {}).map((n) => `notify.${n}`);
    return `<div class="grid cols-2">
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:tune"></ha-icon>${this.t("s_general")}</h2></div><div class="bd">
        <div class="toggle-row"><span class="lbl">${this.t("system_enabled")}</span>
          <label class="switch"><input type="checkbox" data-bind="settings:enabled" ${s.enabled ? "checked" : ""} ${can}><span class="tr"></span></label></div>
        <div class="fields">
          ${num("global_budget", this.t("global_budget"), 0, 300)}
          ${ent("budget_entity", this.t("budget_entity"), ["sensor", "input_number", "number"])}
          ${num("zone_delay_s", this.t("default_zone_delay"), 0, 3600)}
          ${num("step_delay_s", this.t("default_step_delay"), 0, 3600)}
          ${num("max_zone_minutes", this.t("max_zone_minutes"), 1, 720)}
          ${num("history_size", this.t("history_size"), 5, 500)}
        </div></div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:weather-pouring"></ha-icon>${this.t("s_conditions")}</h2></div><div class="bd">
        <label class="field"><span>${this.t("rain_sensors")}</span></label>
        <div class="chips" style="margin:6px 0 8px">${s.rain_sensors.map((e) => `<span class="chip">${esc(this._entityName(e))}
          ${this._can() ? `<button class="btn icon" style="padding:0" data-action="del-rain" data-id="${esc(e)}"><ha-icon icon="mdi:close" style="--mdc-icon-size:14px"></ha-icon></button>` : ""}</span>`).join("")}</div>
        ${this._can() ? `<select data-bind="rain-add">${this._entityOptions(["binary_sensor", "input_boolean", "sensor"], null)}</select>` : ""}
        <div class="fields" style="margin-top:14px">
          ${ent("weather_entity", this.t("weather_entity"), ["weather"])}
          ${ent("freeze_sensor", this.t("freeze_sensor"), ["sensor", "input_number"])}
          ${num("freeze_threshold", this.t("freeze_threshold"), -50, 50, 0.5)}
        </div>
        <label class="field" style="margin-top:14px"><span>${this.t("weather_conditions")}</span></label>
        <div class="chips" style="margin-top:6px">${WEATHER.map((w) => `<button class="chip ${s.weather_conditions.includes(w) ? "on" : ""}" data-action="toggle-weather" data-id="${w}" ${can}>${w}</button>`).join("")}</div>
      </div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:pipe-valve"></ha-icon>${this.t("s_hydraulics")}</h2></div><div class="bd"><div class="fields">
        ${ent("master_entity", this.t("master_entity"), ["switch", "valve", "input_boolean", "light", "fan"])}
        ${num("master_lead_s", this.t("master_lead"), 0, 600)}
        ${num("master_lag_s", this.t("master_lag"), 0, 600)}
        ${num("max_concurrent", this.t("max_concurrent"), 0, 64)}
      </div></div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:bell-outline"></ha-icon>${this.t("s_notifications")} & ${this.t("s_backup")}</h2></div><div class="bd">
        <label class="field"><span>${this.t("notify_service")}</span><select data-bind="settings:notify_service" ${can}>
          <option value="">${this.t("none")}</option>${notify.map((n) => `<option ${n === s.notify_service ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <div class="row wrap" style="margin-top:16px">
          <button class="btn" data-action="export"><ha-icon icon="mdi:download"></ha-icon>${this.t("export")}</button>
          ${this._can() ? `<label class="btn"><ha-icon icon="mdi:upload"></ha-icon>${this.t("import")}<input type="file" accept="application/json" data-bind="import" hidden></label>` : ""}
        </div>
        <p class="hint" style="margin-top:16px">SK Irrigation Manager v${esc(this._version || "")}</p>
      </div></div>
    </div>`;
  }

  // ------------------------------------------------------------ history tab
  _render_history() {
    const hist = this._state.history || [];
    if (!hist.length) return `<div class="card"><div class="empty"><ha-icon icon="mdi:history"></ha-icon>${this.t("no_history")}</div></div>`;
    const cls = { completed: "green", stopped: "amber", skipped: "", error: "red" };
    return `<div class="card"><div class="bd" style="padding-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>${this.t("h_date")}</th><th>${this.t("h_program")}</th><th>${this.t("h_source")}</th><th>${this.t("h_status")}</th>
        <th>${this.t("h_duration")}</th><th>${this.t("h_water")}</th></tr></thead><tbody>
      ${hist.map((h) => {
        const secs = h.start && h.end ? (Date.parse(h.end) - Date.parse(h.start)) / 1000 : 0;
        const water = (h.zones || []).reduce((a, z) => a + ((this._zone(z.zone_id)?.flow_rate || 0) * z.seconds) / 60, 0);
        return `<tr><td class="tnum">${this._fmtWhen(h.start)}</td>
          <td><b>${esc(h.name)}</b>${h.zones?.length ? `<div class="small muted">${h.zones.map((z) => `${esc(this._zone(z.zone_id)?.name || "?")} ${fmtDur(z.seconds)}`).join(" · ")}</div>` : ""}
            ${h.reason && h.status !== "completed" ? `<div class="small muted">${esc(h.reason)}</div>` : ""}</td>
          <td>${this.t(`src_${h.source}`)}</td><td><span class="badge ${cls[h.status] || ""}">${this.t(`stat_${h.status}`)}</span></td>
          <td class="tnum">${h.status === "skipped" ? "—" : fmtDur(secs)}</td><td class="tnum">${water ? `${Math.round(water)} L` : "—"}</td></tr>`;
      }).join("")}</tbody></table></div></div></div>`;
  }

  // ------------------------------------------------------------ dialogs
  _dialogHtml() {
    const d = this._dialog;
    if (d.type === "confirm") {
      return `<div class="scrim" data-action="dlg-cancel"><div class="dialog" data-stop>
        <h2>${esc(d.title || this.t("confirm"))}</h2><div>${esc(d.text)}</div>
        <div class="foot"><button class="btn" data-action="dlg-cancel">${this.t("cancel")}</button>
        <button class="btn danger solid" data-action="dlg-ok">${esc(d.okText || this.t("confirm"))}</button></div></div></div>`;
    }
    const item = d.kind === "zone" ? this._zone(d.id) : this._group(d.id);
    const presets = [1, 3, 5, 10, 15, 20, 30];
    return `<div class="scrim" data-action="dlg-cancel"><div class="dialog" data-stop>
      <h2><ha-icon icon="mdi:play-circle-outline"></ha-icon> ${this.t(d.kind === "zone" ? "quick_run_zone" : "quick_run_group")}: ${esc(item?.name)}</h2>
      <div><div class="sub muted small" style="margin-bottom:6px">${this.t(d.kind === "zone" ? "minutes" : "minutes_per_zone")}</div>
        <div class="chips">${presets.map((m) => `<button class="chip sq ${d.minutes === m ? "on" : ""}" data-action="dlg-min" data-n="${m}">${m}</button>`).join("")}</div>
        <input type="number" min="0.5" max="720" step="0.5" value="${d.minutes}" data-bind="dlg:minutes" style="margin-top:10px"></div>
      ${d.kind === "group" ? `<div><div class="sub muted small" style="margin-bottom:6px">${this.t("simultaneous")}</div>
        <div class="seg">${[1, 2, 3, 4, 0].map((n) => `<button class="${d.concurrency === n ? "on" : ""}" data-action="dlg-conc" data-n="${n}">${n === 1 ? this.t("sequential") : n === 0 ? this.t("all") : n}</button>`).join("")}</div></div>` : ""}
      <div class="foot"><button class="btn" data-action="dlg-cancel">${this.t("cancel")}</button>
        <button class="btn water" data-action="dlg-ok"><ha-icon icon="mdi:play"></ha-icon>${this.t("run")}</button></div>
    </div></div>`;
  }

  _confirm(text, onOk, okText) {
    this._dialog = { type: "confirm", text, onOk, okText };
    this._render();
  }

  // ------------------------------------------------------------ events
  async _onClick(e) {
    if (this._justDragged) return;
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.classList.contains("scrim") && e.target.closest("[data-stop]")) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    const n = el.dataset.n !== undefined ? Number(el.dataset.n) : null;
    const p = this._edit;
    switch (a) {
      case "tab":
        if (this._edit && this._dirty && id !== "programs") { /* keep draft */ }
        this._tab = id;
        try { localStorage.setItem("ski-tab", id); } catch (err) { /* ignore */ }
        if (id === "zones") this._refreshCandidates();
        break;
      case "stop": await this._action("stop"); this._toast(this.t("stopped")); break;
      case "skip": await this._action("skip", id ? { target: id } : {}); return;
      case "run-program": {
        const res = await this._action("run_program", { target: id });
        this._toast(res?.run ? (this._state.current?.id === res.run.id ? this.t("started") : this.t("queued")) : this.t("nothing_to_water"));
        break;
      }
      case "open-run":
        this._dialog = { type: "run", kind: el.dataset.kind, id, minutes: el.dataset.kind === "zone" ? 5 : 10, concurrency: 1 };
        break;
      case "dlg-min": this._dialog.minutes = n; break;
      case "dlg-conc": this._dialog.concurrency = n; break;
      case "dlg-cancel": this._dialog = null; break;
      case "dlg-ok": {
        const d = this._dialog;
        this._dialog = null;
        if (d.type === "confirm") { await d.onOk(); break; }
        const res = await this._action(d.kind === "zone" ? "run_zone" : "run_group",
          { target: d.id, minutes: Number(d.minutes) || 5, concurrency: d.concurrency });
        this._toast(res?.run ? this.t("queued") : this.t("nothing_to_water"));
        break;
      }
      case "rain-delay": await this._action("rain_delay", { hours: Number(el.dataset.hours) }); break;
      case "remove-queued": await this._action("remove_queued", { target: id }); break;
      // zones
      case "domain": this._domain = id; break;
      case "add-device": this._addZone(id); this._queueSave("zones"); break;
      case "add-all-rainbird": {
        const used = new Set(this._zones.map((z) => z.entity_id));
        this._candidates.filter((c) => c.platform === "rainbird" && !used.has(c.entity_id)).forEach((c) => this._addZone(c.entity_id));
        this._queueSave("zones");
        break;
      }
      case "test-zone": await this._action("run_zone", { target: id, minutes: 1 }); this._toast(this.t("queued")); return;
      case "delete-zone":
        this._confirm(this.t("confirm_delete_zone"), async () => {
          this._config.zones = this._zones.filter((z) => z.id !== id);
          this._config.groups.forEach((g) => { g.zone_ids = g.zone_ids.filter((z) => z !== id); });
          await this._ws({ type: `${DOMAIN}/save`, key: "zones", value: this._config.zones }).then((r) => { this._config = r.config; });
          this._render();
        }, this.t("delete"));
        return;
      // groups
      case "new-group": this._createGroup([]); break;
      case "delete-group":
        this._confirm(this.t("confirm_delete_group"), async () => {
          this._config.groups = this._groups.filter((g) => g.id !== id);
          await this._ws({ type: `${DOMAIN}/save`, key: "groups", value: this._config.groups }).then((r) => { this._config = r.config; });
          this._render();
        }, this.t("delete"));
        return;
      case "ungroup": {
        const g = this._group(el.dataset.group);
        g.zone_ids = g.zone_ids.filter((z) => z !== id);
        this._queueSave("groups");
        break;
      }
      // programs
      case "new-program": this._edit = this._newProgram(); this._dirty = true; break;
      case "edit-program": this._edit = clone(this._programs.find((x) => x.id === id)); this._dirty = false; break;
      case "dup-program": {
        const copy = clone(this._programs.find((x) => x.id === id));
        copy.id = uid("prog");
        copy.name = `${copy.name} (${this.t("copy")})`;
        copy.enabled = false;
        this._config.programs.push(copy);
        await this._saveNow("programs");
        break;
      }
      case "delete-program":
        this._confirm(this.t("confirm_delete_program"), async () => {
          this._config.programs = this._programs.filter((x) => x.id !== id);
          await this._saveNow("programs");
          this._render();
        }, this.t("delete"));
        return;
      case "prog-cancel": this._edit = null; this._dirty = false; break;
      case "prog-save": {
        const list = this._programs.filter((x) => x.id !== p.id);
        const idx = this._programs.findIndex((x) => x.id === p.id);
        list.splice(idx >= 0 ? idx : list.length, 0, p);
        this._config.programs = list;
        this._edit = null;
        this._dirty = false;
        await this._saveNow("programs");
        break;
      }
      case "sched-mode": p.schedule.mode = id; this._dirty = true; break;
      case "toggle-wd": this._toggleIn(p.schedule.weekdays, n); break;
      case "toggle-md": this._toggleIn(p.schedule.month_days, n); break;
      case "toggle-month": this._toggleIn(p.schedule.months, n); break;
      case "add-date": {
        const v = this.shadowRoot.getElementById("new-date").value;
        if (!v) return;
        const yearly = this.shadowRoot.getElementById("new-date-yearly").checked;
        const d = yearly ? v.slice(5) : v;
        if (!p.schedule.dates.includes(d)) p.schedule.dates.push(d);
        p.schedule.dates.sort();
        this._dirty = true;
        break;
      }
      case "del-date": p.schedule.dates = p.schedule.dates.filter((d) => d !== id); this._dirty = true; break;
      case "add-start": {
        const last = p.start_times[p.start_times.length - 1];
        let time = "20:00";
        if (last?.type === "fixed") { const [h, m] = last.time.split(":").map(Number); time = `${pad((h + 6) % 24)}:${pad(m)}`; }
        p.start_times.push({ type: "fixed", time });
        this._dirty = true;
        break;
      }
      case "del-start": p.start_times.splice(n, 1); this._dirty = true; break;
      case "add-step": this._addStep(id, p.steps.length); break;
      case "del-step": p.steps.splice(n, 1); this._dirty = true; break;
      case "move-step": {
        const to = n + Number(el.dataset.dir);
        if (to < 0 || to >= p.steps.length) return;
        const [step] = p.steps.splice(n, 1);
        p.steps.splice(to, 0, step);
        this._dirty = true;
        break;
      }
      case "step-conc": p.steps[n].concurrency = Number(el.dataset.v); this._dirty = true; break;
      case "step-mode": {
        const st = p.steps[n];
        st.duration_mode = el.dataset.v;
        if (st.duration_mode === "custom") {
          (this._group(st.group_id)?.zone_ids || []).forEach((z) => { if (st.durations[z] === undefined) st.durations[z] = st.duration; });
        }
        this._dirty = true;
        break;
      }
      case "step-apply": {
        const st = p.steps[n];
        (this._group(st.group_id)?.zone_ids || []).forEach((z) => { st.durations[z] = st.duration; });
        this._dirty = true;
        break;
      }
      // settings
      case "del-rain":
        this._config.settings.rain_sensors = this._config.settings.rain_sensors.filter((x) => x !== id);
        this._queueSave("settings");
        break;
      case "toggle-weather":
        this._toggleIn(this._config.settings.weather_conditions, id);
        this._queueSave("settings");
        break;
      case "export": this._export(); return;
      default: return;
    }
    this._render();
  }

  _toggleIn(arr, v) {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    arr.sort((a, b) => (a > b ? 1 : -1));
    this._dirty = true;
  }

  _addStep(groupId, index) {
    const st = { id: uid("step"), group_id: groupId, concurrency: 1, duration_mode: "uniform", duration: 10, durations: {} };
    this._edit.steps.splice(index, 0, st);
    this._dirty = true;
  }

  _createGroup(zoneIds) {
    const g = { id: uid("group"), name: `${this.t("new_group")} ${this._groups.length + 1}`,
      color: PALETTE[(this._groups.length + 1) % PALETTE.length], icon: "mdi:sprinkler-variant", zone_ids: zoneIds };
    this._config.groups.push(g);
    this._queueSave("groups");
    return g;
  }

  async _saveNow(key) {
    const res = await this._ws({ type: `${DOMAIN}/save`, key, value: this._config[key] });
    this._config = res.config;
    this._toast(this.t("saved"));
    this._render();
  }

  async _refreshCandidates() {
    try {
      const data = await this._hass.callWS({ type: `${DOMAIN}/data` });
      this._candidates = data.candidates;
      if (this._tab === "zones") this._render();
    } catch (err) { /* ignore */ }
  }

  _onInput(e) {
    const el = e.target;
    if (el.dataset.bind === "search") {
      this._search = el.value;
      const used = new Set(this._zones.map((z) => z.entity_id));
      const q = this._search.toLowerCase();
      const cands = (this._candidates || []).filter((c) =>
        (this._domain === "all" || c.domain === this._domain || (this._domain === "rainbird" && c.platform === "rainbird")) &&
        (!q || c.name.toLowerCase().includes(q) || c.entity_id.includes(q)));
      this.shadowRoot.getElementById("device-list").innerHTML = this._deviceListHtml(cands, used);
    }
  }

  async _onChange(e) {
    const el = e.target;
    const bind = el.dataset.bind;
    if (!bind || bind === "search") return;
    const [scope, a, b] = bind.split(":");
    let v;
    if (el.type === "checkbox") v = el.checked;
    else if (el.type === "number") v = el.value === "" ? null : Number(el.value);
    else v = el.value;

    switch (scope) {
      case "system": await this._action("set_enabled", { enabled: v }); this._render(); return;
      case "progenabled": await this._action("set_program_enabled", { target: a, enabled: v }); return;
      case "settings":
        if (v === "" && ["budget_entity", "weather_entity", "freeze_sensor", "master_entity", "notify_service"].includes(a)) v = null;
        setPath(this._config.settings, a, v);
        this._queueSave("settings");
        return;
      case "rain-add":
        if (v && !this._config.settings.rain_sensors.includes(v)) this._config.settings.rain_sensors.push(v);
        this._queueSave("settings");
        break;
      case "zone": {
        const z = this._zone(a);
        if (b === "entity_id" && !v) v = null;
        z[b] = v;
        this._queueSave("zones");
        return;
      }
      case "group": {
        this._group(a)[b] = v;
        this._queueSave("groups", b === "color");
        return;
      }
      case "group-add": {
        if (v) this._group(a).zone_ids.push(v);
        this._queueSave("groups");
        break;
      }
      case "import": {
        const file = el.files?.[0];
        if (!file) return;
        const text = await file.text();
        this._confirm(this.t("import_confirm"), async () => {
          const parsed = JSON.parse(text);
          const res = await this._ws({ type: `${DOMAIN}/import`, config: parsed.config || parsed });
          this._config = res.config;
          this._toast(this.t("imported"));
          this._render();
        });
        return;
      }
      case "dlg": this._dialog[a] = v; return;
      case "prog":
        if ((a === "zone_delay_s" || a === "step_delay_s") && v === null) v = -1;
        setPath(this._edit, a, v);
        this._dirty = true;
        if (a === "name" || el.dataset.rerender !== undefined) break;
        this._refreshPreview();
        return;
      case "step": {
        this._edit.steps[Number(a)][b] = v ?? 0;
        this._dirty = true;
        if (b === "concurrency") break;
        this._refreshPreview();
        return;
      }
      case "stepdur":
        this._edit.steps[Number(a)].durations[b] = v ?? 0;
        this._dirty = true;
        this._refreshPreview();
        return;
      case "start": {
        const st = this._edit.start_times[Number(a)];
        st[b] = v;
        if (b === "type") { if (v === "fixed") { st.time = st.time || "06:00"; delete st.offset; } else { st.offset = st.offset || 0; } }
        this._dirty = true;
        if (b !== "type") { this._refreshPreview(); return; }
        break;
      }
      default: return;
    }
    this._render();
  }

  _export() {
    const blob = new Blob([JSON.stringify({ version: this._version, config: this._config }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sk-irrigation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------ drag & drop
  _onPointerDown(e) {
    if (e.button > 0) return;
    const el = e.target.closest("[data-drag]");
    if (!el || e.target.closest("button, input, select, label, a")) return;
    if (el.hasAttribute("data-handle-only") && !e.target.closest(".grip")) return;
    this._drag = { el, data: JSON.parse(el.dataset.drag), x: e.clientX, y: e.clientY, started: false, pid: e.pointerId };
  }

  _onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.started = true;
      try { d.el.setPointerCapture(d.pid); } catch (err) { /* ignore */ }
      const r = d.el.getBoundingClientRect();
      d.ox = d.x - r.left;
      d.oy = d.y - r.top;
      d.ghost = d.el.cloneNode(true);
      d.ghost.classList.add("drag-ghost");
      d.ghost.style.width = `${r.width}px`;
      this.shadowRoot.appendChild(d.ghost);
      d.el.classList.add("dragging-src");
      d.marker = document.createElement("div");
      d.marker.className = "drop-marker";
    }
    e.preventDefault();
    d.ghost.style.left = `${e.clientX - d.ox}px`;
    d.ghost.style.top = `${e.clientY - d.oy}px`;
    const under = this.shadowRoot.elementFromPoint(e.clientX, e.clientY);
    let target = under?.closest("[data-drop]");
    if (target && !(target.dataset.accept || "").split(",").includes(d.data.t)) target = null;
    if (d.target && d.target !== target) d.target.classList.remove("over");
    d.target = target;
    d.index = null;
    d.marker.remove();
    if (target) {
      target.classList.add("over");
      if (target.dataset.drop.startsWith("group:") || target.dataset.drop === "steps") {
        const items = [...target.querySelectorAll(":scope > [data-drag]")];
        let idx = items.findIndex((it) => { const r = it.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        if (idx < 0) idx = items.length;
        d.index = idx;
        if (items.length) {
          if (idx < items.length) {
            const before = items[idx];
            const prev = before.previousElementSibling;
            target.insertBefore(d.marker, prev && prev.classList.contains("connector") ? prev : before);
          } else target.appendChild(d.marker);
        }
      }
    }
    // auto-scroll near the edges
    const sc = this.shadowRoot.querySelector(".scroller");
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + 50) sc.scrollTop -= 12;
      else if (e.clientY > r.bottom - 50) sc.scrollTop += 12;
    }
  }

  _onPointerUp() {
    const d = this._drag;
    this._drag = null;
    if (!d || !d.started) return;
    this._justDragged = true;
    setTimeout(() => { this._justDragged = false; }, 60);
    this._cleanupDrag(d);
    if (d.target) this._drop(d.data, d.target.dataset.drop, d.index);
  }

  _cancelDrag() {
    const d = this._drag;
    this._drag = null;
    if (d && d.started) this._cleanupDrag(d);
  }

  _cleanupDrag(d) {
    d.ghost?.remove();
    d.marker?.remove();
    d.el.classList.remove("dragging-src");
    d.target?.classList.remove("over");
  }

  _drop(data, target, index) {
    if (data.t === "zone") {
      const from = data.from ? this._group(data.from) : null;
      if (target === "pool") {
        if (from) from.zone_ids = from.zone_ids.filter((z) => z !== data.z);
      } else if (target === "new-group") {
        if (from) from.zone_ids = from.zone_ids.filter((z) => z !== data.z);
        this._createGroup([data.z]);
      } else if (target.startsWith("group:")) {
        const g = this._group(target.slice(6));
        let idx = index ?? g.zone_ids.length;
        const existing = g.zone_ids.indexOf(data.z);
        if (existing >= 0) {
          g.zone_ids.splice(existing, 1);
          if (existing < idx) idx -= 1;
        }
        g.zone_ids.splice(idx, 0, data.z);
        if (from && from !== g) from.zone_ids = from.zone_ids.filter((z) => z !== data.z);
      }
      this._queueSave("groups");
    } else if (data.t === "group" && target === "steps") {
      this._addStep(data.g, index ?? this._edit.steps.length);
    } else if (data.t === "step" && target === "steps") {
      const steps = this._edit.steps;
      let idx = index ?? steps.length;
      const [st] = steps.splice(data.i, 1);
      if (data.i < idx) idx -= 1;
      steps.splice(idx, 0, st);
      this._dirty = true;
    }
    this._render();
  }
}

if (!customElements.get("sk-irrigation-panel")) {
  customElements.define("sk-irrigation-panel", SkIrrigationPanel);
}
