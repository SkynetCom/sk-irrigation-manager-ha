// SK Irrigation Manager — Home Assistant panel.
// Dependency-free web component: renders with template strings, uses event
// delegation, and implements pointer-based drag & drop (mouse + touch).
import { I18N } from "./sk-irrigation-i18n.js?v=1.4.0";
import { STYLES } from "./sk-irrigation-styles.js?v=1.4.0";
import { MapMixin } from "./sk-irrigation-map.js?v=1.4.0";

const DOMAIN = "sk_irrigation";
const TABS = [
  ["dashboard", "mdi:view-dashboard-outline"],
  ["groups", "mdi:vector-arrange-below"],
  ["programs", "mdi:calendar-clock"],
  ["map", "mdi:map-outline"],
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
    if (!TABS.some(([k]) => k === this._tab)) this._tab = "dashboard";
    this._edit = null;
    this._dialog = null;
    this._saveTimers = {};
    this._search = "";
    this._domain = "suggested";
    this._skew = 0;
    try {
      this._mapId = localStorage.getItem("ski-map");
      this._mapFollow = localStorage.getItem("ski-map-follow") !== "0";
    } catch (e) { /* ignore */ }
    const sr = this.shadowRoot;
    sr.addEventListener("click", (e) => this._onClick(e));
    sr.addEventListener("change", (e) => this._onChange(e));
    sr.addEventListener("input", (e) => this._onInput(e));
    sr.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    sr.addEventListener("pointermove", (e) => this._onPointerMove(e));
    sr.addEventListener("pointerup", (e) => this._onPointerUp(e));
    sr.addEventListener("pointercancel", () => { if (this._tl) this._tlCancel(); else this._cancelDrag(); });
    sr.addEventListener("keydown", (e) => {
      if (this._pk && (e.target.dataset?.bind === "pk-search" || e.target.dataset?.suggest || e.key === "Escape")) this._pkKey(e);
    });
    // Autocomplete: entity inputs with data-suggest open an inline suggestion list.
    sr.addEventListener("focusin", (e) => {
      const el = e.target;
      if (el.dataset?.suggest && this._can()) this._openPicker(el.dataset.suggest, el, true);
    });
    sr.addEventListener("focusout", (e) => {
      const el = e.target;
      const target = el.dataset?.suggest;
      if (!target) return;
      setTimeout(() => {
        // only close this field's own list (focus may have moved to another entity field)
        if (this._pk?.inline && this._pk.target === target && this.shadowRoot.activeElement !== el) this._closePicker();
      }, 150);
    });
    sr.addEventListener("mousedown", (e) => {
      if (e.target.closest?.(".pk") && !e.target.closest("input")) e.preventDefault();
    });
  }

  // ------------------------------------------------------------ HA hooks
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._lang = (hass.language || "en").startsWith("es") ? "es" : "en";
    const mb = this.shadowRoot.querySelector("ha-menu-button");
    if (mb) mb.hass = hass;
    if (first) this._connect();
    else {
      this._updateEntityStates();
      if (this._tab === "map" && !this._state?.current) {
        const key = this._zones.map((z) => (this._isOn(z.entity_id) ? 1 : 0)).join("");
        if (key !== this._mapOnKey) { this._mapOnKey = key; this._render(); }
      }
    }
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

  // An open program editor keeps its own copy: refresh it when the stored
  // configuration changes underneath it (import, another browser), unless
  // the user has unsaved edits. ``force`` also drops unsaved edits.
  _syncEdit(force = false) {
    if (!this._edit || (this._dirty && !force)) return;
    const fresh = (this._config?.programs || []).find((x) => x.id === this._edit.id);
    this._edit = fresh ? clone(fresh) : null;
    this._dirty = false;
  }

  _onPush(msg) {
    const prevStatus = this._state?.status;
    const prevRun = this._state?.current?.id;
    const prevActive = (this._state?.current?.active || []).map((a) => a.zone_id).join();
    if (msg.config && !Object.keys(this._saveTimers).length) { this._config = msg.config; this._syncEdit(); }
    if (msg.state) this._setState(msg.state);
    if (this._drag || this._dialog) { this._renderToolbar(); return; }
    const activeNow = (this._state?.current?.active || []).map((a) => a.zone_id).join();
    const structural = prevStatus !== this._state.status || prevRun !== this._state.current?.id || prevActive !== activeNow;
    if (this._tab === "dashboard" || this._tab === "history" || (this._tab === "programs" && !this._edit)) {
      if (structural || msg.config || this._tab !== "dashboard") this._render();
    }
    if (this._tab === "map") {
      // own key: the side list must follow every sprinkler change of the run
      const cur = this._state?.current;
      const runKey = cur ? `${cur.id}|${cur.active.map((x) => x.zone_id).join()}|${cur.done.length}` : this._state?.status;
      if (structural || runKey !== this._mapRunKey) { this._mapRunKey = runKey; this._render(); }
      else this._mapRefresh();
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
      const value = key === "layout" ? { zones: this._config.zones, groups: this._config.groups } : this._config[key];
      const res = await this._ws({ type: `${DOMAIN}/save`, key, value });
      if (!Object.keys(this._saveTimers).length) this._config = res.config;
      this._toast(this.t("saved"));
      if (render) this._render();
    }, 500);
  }

  _toast(text) {
    clearTimeout(this._toastTimer);
    const el = this._toastEl || (this._toastEl = document.createElement("div"));
    el.className = "toast";
    el.textContent = text;
    this.shadowRoot.appendChild(el);
    this._toastTimer = setTimeout(() => { el.remove(); this._toastTimer = null; }, text.length > 40 ? 5000 : 2400);
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
    return (program.steps || []).map((step, si) => {
      const g = this._group(step.group_id);
      if (!g) return null;
      const skip = new Set(step.skip || []);
      const zones = this._stepOrder(step, g).filter((zid) => !skip.has(zid)).map((zid) => this._zone(zid))
        .filter((z) => z && z.enabled && z.entity_id).map((z) => {
        let minutes = step.duration_mode === "custom" ? (step.durations?.[z.id] ?? step.duration) : step.duration;
        minutes = Math.min(Number(minutes) || 0, maxMin);
        return { zone_id: z.id, name: z.name, color: z.color, seconds: Math.round(minutes * 60 * factor) };
      }).filter((z) => z.seconds > 0);
      return { label: g.name, color: g.color, concurrency: step.concurrency, zones, si };
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
    if (this._toastEl?.textContent && this._toastEl.isConnected === false && this._toastTimer) sr.appendChild(this._toastEl);
    const newScroller = sr.querySelector(".scroller");
    if (newScroller) newScroller.scrollTop = scroll;
    const mb = sr.querySelector("ha-menu-button");
    if (mb) { mb.hass = this._hass; mb.narrow = this._narrow; }
    if (this._tab === "settings" || (this._tab === "programs" && this._edit)) this._scheduleCondCheck();
    if (this._pk && this._pkEl) sr.appendChild(this._pkEl);
    if (this._tab === "map" && this._config) this._mapAttach();
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
    this._ticks = (this._ticks || 0) + 1;
    if (this._ticks % 10 === 0 && this.shadowRoot.querySelector("[data-cond-res]")) this._checkConditions();
    const now = this._now();
    this.shadowRoot.querySelectorAll("[data-end], [data-mode=elapsed]").forEach((el) => {
      const end = Date.parse(el.dataset.end);
      const start = Date.parse(el.dataset.start);
      const total = Math.max(1, end - start);
      const pct = Math.min(100, Math.max(0, ((now - start) / total) * 100));
      if (el.dataset.mode === "elapsed") { el.textContent = Number.isNaN(start) ? "" : fmtClock((now - start) / 1000); return; }
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
        <div style="margin-top:12px"><button class="btn primary" data-action="tab" data-id="groups">${this.t("tab_groups")}</button></div></div></div>`;
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
    const label = (r) => esc(this._reasonText(r));
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

  // ------------------------------------------------------------ sprinklers & groups
  // Sprinklers are the HA devices themselves: dragging a device into a group
  // creates its sprinkler record on the fly, so there is no separate setup step.
  _devices() {
    const byEntity = new Map((this._candidates || []).map((c) => [c.entity_id, { ...c }]));
    this._zones.forEach((z) => {
      if (z.entity_id && !byEntity.has(z.entity_id)) {
        byEntity.set(z.entity_id, { entity_id: z.entity_id, name: z.name, domain: z.entity_id.split(".")[0], platform: null, area: null, missing: true });
      }
    });
    return [...byEntity.values()];
  }

  _zoneByEntity(entityId) { return this._zones.find((z) => z.entity_id === entityId); }

  _ensureZone(entityId) {
    return this._zoneByEntity(entityId) || this._addZone(entityId);
  }

  _addZone(entityId) {
    const c = (this._candidates || []).find((x) => x.entity_id === entityId);
    const name = (c?.name || this._entityName(entityId)).replace(/^Rain ?Bird\s*/i, "") || entityId;
    const zone = {
      id: uid("zone"), name, entity_id: entityId, icon: "mdi:sprinkler", enabled: true, flow_rate: null, notes: "",
      color: PALETTE[this._config.zones.length % PALETTE.length],
    };
    this._config.zones.push(zone);
    return zone;
  }

  _groupCounts() {
    const counts = {};
    this._groups.forEach((g) => g.zone_ids.forEach((z) => { counts[z] = (counts[z] || 0) + 1; }));
    return counts;
  }

  _filteredDevices() {
    const q = this._search.toLowerCase();
    const counts = this._groupCounts();
    const f = this._domain;
    return this._devices().filter((c) => {
      const zone = this._zoneByEntity(c.entity_id);
      if (f === "suggested" && !this._isSuggested(c)) return false;
      if (f === "rainbird" && c.platform !== "rainbird") return false;
      if (f === "unassigned" && zone && counts[zone.id]) return false;
      if (f.startsWith("area:") && c.area !== f.slice(5)) return false;
      if (f.startsWith("domain:") && c.domain !== f.slice(7)) return false;
      const name = (zone?.name || c.name).toLowerCase();
      return !q || name.includes(q) || c.entity_id.includes(q) || (c.area || "").toLowerCase().includes(q);
    });
  }

  _poolItemsHtml() {
    const counts = this._groupCounts();
    const can = this._can();
    const items = this._filteredDevices();
    if (!items.length) return `<div class="empty">—</div>`;
    return items.map((c) => {
      const z = this._zoneByEntity(c.entity_id);
      const n = z ? counts[z.id] || 0 : 0;
      return `<div class="zchip dev ${n ? "" : "free"}" ${can ? `data-drag="${attr({ t: "dev", e: c.entity_id })}"` : ""}>
        <ha-icon class="grip" icon="mdi:drag-vertical"></ha-icon>
        <span class="swatch" style="background:${z ? esc(z.color) : "rgba(127,127,127,.35)"}"></span>
        <div class="nm" title="${esc(c.entity_id)}"><div>${esc(z?.name || c.name)}</div>
          <div class="small muted sub">${c.platform === "rainbird" ? `<span class="badge rb">Rain Bird</span>` : ""}
            ${c.missing ? `<span class="badge red">${this.t("missing")}</span>` : ""}
            ${z && !z.enabled ? `<span class="badge">${this.t("program_disabled")}</span>` : ""}
            <span class="sub-txt">${esc([this._entityMeta(c.entity_id).device, c.area].filter(Boolean).join(" · ") || c.entity_id)}</span></div></div>
        ${n ? `<span class="badge green" title="${this.t("in_groups", { n })}">${n}</span>` : ""}
        ${can ? `<button class="btn icon" title="${this.t("edit_sprinkler")}" data-action="edit-dev" data-id="${esc(c.entity_id)}"><ha-icon icon="mdi:pencil-outline" style="--mdc-icon-size:18px"></ha-icon></button>` : ""}
      </div>`;
    }).join("");
  }

  _render_groups() {
    const can = this._can();
    const devices = this._devices();
    const areas = [...new Set(devices.map((d) => d.area).filter(Boolean))].sort();
    const filters = [["suggested", this.t("suggested")], ["all", this.t("all_domains")], ["unassigned", this.t("unassigned")]];
    if (devices.some((d) => d.platform === "rainbird")) filters.push(["rainbird", "Rain Bird"]);
    const areaSel = this._domain.startsWith("area:") ? this._domain.slice(5) : null;
    const shown = this._filteredDevices().length;
    return `<p class="hint">${this.t("groups_hint")}</p>
    <div class="groups-layout">
      <div class="card pool"><div class="hd"><h2><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("sprinklers_pool")}</h2>
        <span class="badge">${devices.length}</span></div>
        <div class="bd">
          <input type="text" placeholder="${this.t("search")}" value="${esc(this._search)}" data-bind="search">
          <div class="chips" style="margin:10px 0">${filters.map(([k, label]) => `<button class="chip ${this._domain === k ? "on" : ""}" data-action="domain" data-id="${esc(k)}">${esc(label)}</button>`).join("")}
            ${areas.length ? `<button class="chip ${areaSel ? "on" : ""}" data-action="pick" data-pick="area-filter"><ha-icon icon="mdi:home-outline" style="--mdc-icon-size:14px"></ha-icon>${esc(areaSel || this.t("area"))}<ha-icon icon="mdi:menu-down" style="--mdc-icon-size:16px"></ha-icon></button>` : ""}</div>
          <div class="small muted" style="margin:-4px 0 8px">${this.t("showing_n", { n: shown, total: devices.length })}</div>
          ${can && areas.length ? `<button class="btn" style="width:100%;justify-content:center;margin-bottom:10px" data-action="groups-from-areas">
            <ha-icon icon="mdi:home-group-plus"></ha-icon>${this.t("from_areas")}</button>` : ""}
          <div class="dropzone" id="pool-list" data-drop="pool" data-accept="zone">${this._poolItemsHtml()}</div>
        </div></div>
      <div class="group-grid">
        ${this._groups.map((g) => this._groupCardHtml(g)).join("")}
        ${can ? `<div class="new-group" data-drop="new-group" data-accept="zone,dev" data-action="new-group">
          <div><ha-icon icon="mdi:plus-circle-outline" style="--mdc-icon-size:34px"></ha-icon><div><b>${this.t("new_group")}</b></div>
          <div class="small">${this.t("drop_new_group")}</div></div></div>` : ""}
      </div>
    </div>`;
  }

  _groupCardHtml(g) {
    const can = this._can();
    const inGroup = new Set(g.zone_ids.map((z) => this._zone(z)?.entity_id));
    const free = this._devices().filter((d) => !inGroup.has(d.entity_id));
    return `<div class="card group-card" style="--c:${esc(g.color)}">
      <div class="hd">
        <input type="color" value="${esc(g.color)}" data-bind="group:${g.id}:color" ${can ? "" : "disabled"}>
        <input type="text" value="${esc(g.name)}" data-bind="group:${g.id}:name" ${can ? "" : "disabled"}>
        ${can ? `<button class="btn icon" title="${this.t("quick_run_group")}" data-action="open-run" data-kind="group" data-id="${g.id}" ${g.zone_ids.length ? "" : "disabled"}><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>
        <button class="btn icon" title="${this.t("delete")}" data-action="delete-group" data-id="${g.id}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>` : ""}
      </div>
      <div class="bd">
        <div class="dropzone ${g.zone_ids.length ? "" : "empty-dz"}" data-drop="group:${g.id}" data-accept="zone,dev">
          ${g.zone_ids.length ? g.zone_ids.map((zid, i) => {
            const z = this._zone(zid);
            if (!z) return "";
            return `<div class="zchip" style="--c:${esc(g.color)}" ${can ? `data-drag="${attr({ t: "zone", z: zid, from: g.id, i })}"` : ""}>
              <span class="ord">${i + 1}</span><span class="swatch" style="background:${esc(z.color)}"></span><span class="nm">${esc(z.name)}</span>
              ${can ? `<button class="btn icon" data-action="ungroup" data-group="${g.id}" data-id="${zid}"><ha-icon icon="mdi:close" style="--mdc-icon-size:16px"></ha-icon></button>` : ""}</div>`;
          }).join("") : this.t("drop_here")}
        </div>
        ${can && free.length ? `<button class="btn sm add-zone" data-action="pick" data-pick="group-add:${g.id}">
          <ha-icon icon="mdi:plus"></ha-icon>${this.t("add_zone_to_group")}</button>` : ""}
        <div class="small muted" style="margin-top:8px">${g.zone_ids.length} ${this.t("zones_lc")}</div>
      </div></div>`;
  }

  _groupsFromAreas() {
    const byArea = {};
    this._devices().forEach((d) => { if (d.area && !d.missing) (byArea[d.area] = byArea[d.area] || []).push(d.entity_id); });
    let created = 0;
    Object.entries(byArea).forEach(([area, entities]) => {
      let g = this._groups.find((x) => x.name.toLowerCase() === area.toLowerCase());
      if (!g) { g = this._createGroup([], area); created += 1; }
      entities.forEach((e) => { const z = this._ensureZone(e); if (!g.zone_ids.includes(z.id)) g.zone_ids.push(z.id); });
    });
    this._queueSave("layout");
    this._toast(this.t("areas_created", { n: created }));
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
            ${p.conditions?.length ? `<span><ha-icon icon="mdi:shield-check-outline"></ha-icon>${p.conditions.length} ${this.t("conditions_lc")}</span>` : ""}
          </div>
          ${(this._state.program_blocks?.[p.id] || []).length ? `<div class="badge amber" style="margin-top:8px;white-space:normal">
            <ha-icon icon="mdi:alert-outline" style="--mdc-icon-size:14px"></ha-icon>${this.t("now_blocked")}: ${esc(this._state.program_blocks[p.id].map((r) => this._reasonText(r)).join(", "))}</div>` : ""}
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
      steps: [], budget: 100, zone_delay_s: -1, step_delay_s: -1, ignore_conditions: false, on_busy: "queue", conditions: [],
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
          ${section(4, "", this.t("conditions_title"), `<p class="hint">${this.t("prog_cond_hint")}</p>${this._condEditorHtml("prog")}`)}
          <div class="card tl-card"><div class="hd"><span class="section-n">5</span><h2>${this.t("tl_title")}</h2>
            <span class="badge blue"><ha-icon icon="mdi:gesture-swipe-horizontal" style="--mdc-icon-size:14px"></ha-icon>${this.t("tl_badge")}</span>
            <div class="seg tl-zoom"><button data-action="tl-zoom" data-v="-1" title="${this.t("zoom_out")}"><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></button>
              <button class="${this._tlZoom ? "" : "on"}" data-action="tl-zoom" data-v="0" title="${this.t("zoom_fit")}"><ha-icon icon="mdi:arrow-expand-horizontal"></ha-icon></button>
              <button data-action="tl-zoom" data-v="1" title="${this.t("zoom_in")}"><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></button></div></div>
            <div class="bd" id="tl-body">${this._timelineHtml()}</div></div>
          ${section(6, "", this.t("sequence"), sequence)}
          ${section(7, "", this.t("advanced"), advanced)}
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

  _stepOrder(st, g) {
    const ordered = (st.order || []).filter((z) => g.zone_ids.includes(z));
    return ordered.concat(g.zone_ids.filter((z) => !ordered.includes(z)));
  }

  _stepHtml(st, i) {
    const g = this._group(st.group_id);
    if (!g) return "";
    const order = this._stepOrder(st, g).map((z) => this._zone(z)).filter(Boolean);
    const skip = new Set(st.skip || []);
    const custom = st.duration_mode === "custom";
    const conc = st.concurrency;
    const preset = [1, 2, 3, 4, 0];
    let n = 0;
    return `<div class="step-card" style="--c:${esc(g.color)}" data-drag="${attr({ t: "step", i })}" data-handle-only>
      <div class="shd">
        <ha-icon class="grip" icon="mdi:drag-horizontal-variant"></ha-icon>
        <span class="section-n" style="background:${esc(g.color)}">${i + 1}</span>
        <span class="t">${esc(g.name)} <span class="small muted">· ${order.length - skip.size} ${this.t("zones_lc")}</span></span>
        <button class="btn icon" data-action="move-step" data-n="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
        <button class="btn icon" data-action="move-step" data-n="${i}" data-dir="1" ${i === this._edit.steps.length - 1 ? "disabled" : ""}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        <button class="btn icon" data-action="del-step" data-n="${i}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
      </div>
      <div class="sbd">
        <div><div class="sub">${this.t("activation")}</div>
          <div class="row wrap"><div class="seg">${preset.map((v) => `<button class="${conc === v ? "on" : ""}" data-action="step-conc" data-n="${i}" data-v="${v}">
            ${v === 1 ? this.t("sequential") : v === 0 ? this.t("all") : `${v} ${this.t("at_once")}`}</button>`).join("")}
            <button class="${preset.includes(conc) ? "" : "on"}" data-action="step-conc" data-n="${i}" data-v="5">${this.t("custom")}</button></div>
            ${preset.includes(conc) ? "" : `<input type="number" min="1" max="64" value="${conc}" data-bind="step:${i}:concurrency">`}
          </div></div>
        <div><div class="sub">${this.t("timing")}</div>
          <div class="row wrap"><div class="seg">
            <button class="${custom ? "" : "on"}" data-action="step-mode" data-n="${i}" data-v="uniform">${this.t("uniform")}</button>
            <button class="${custom ? "on" : ""}" data-action="step-mode" data-n="${i}" data-v="custom">${this.t("per_zone")}</button></div>
            ${custom ? `<input type="number" min="0" max="600" step="0.5" value="${st.duration}" data-bind="step:${i}:duration" title="${this.t("apply_all")}">
              <button class="btn sm" data-action="step-apply" data-n="${i}"><ha-icon icon="mdi:arrow-down-bold-box-outline"></ha-icon>${this.t("apply_all")}</button>`
              : `<input type="number" min="0" max="600" step="0.5" value="${st.duration}" data-bind="step:${i}:duration"> <span class="muted">${this.t("min")} ${this.t("each")}</span>`}
          </div></div>
        <div><div class="sub">${this.t("order_timing")}</div>
          <p class="hint" style="margin:0 0 8px">${this.t("order_hint")}</p>
          <div class="dropzone srows" data-drop="steporder:${i}" data-accept="szone">
          ${order.map((z) => {
            const off = skip.has(z.id);
            if (!off) n += 1;
            const minutes = custom ? (st.durations[z.id] ?? st.duration) : st.duration;
            return `<div class="srow ${off ? "off" : ""}" data-drag="${attr({ t: "szone", s: i, z: z.id })}" data-handle-only>
              <ha-icon class="grip" icon="mdi:drag-vertical"></ha-icon>
              <span class="ord" style="background:${off ? "rgba(127,127,127,.4)" : esc(g.color)}">${off ? "–" : n}</span>
              <span class="swatch" style="background:${esc(z.color)}"></span>
              <span class="nm">${esc(z.name)}</span>
              ${custom && !off ? `<input type="number" min="0" max="600" step="0.5" value="${minutes}" data-bind="stepdur:${i}:${z.id}"><span class="muted small">${this.t("min")}</span>`
                : `<span class="muted small tnum" style="min-width:64px;text-align:right">${off ? this.t("omitted") : `${minutes} ${this.t("min")}`}</span>`}
              <label class="switch" title="${this.t("include")}"><input type="checkbox" data-bind="stepskip:${i}:${z.id}" ${off ? "" : "checked"}><span class="tr"></span></label>
            </div>`;
          }).join("")}
          </div>
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
    return `<div class="hd"><h3><ha-icon icon="mdi:chart-gantt"></ha-icon>${this.t("preview")}</h3></div><div class="bd">
      <div class="kpis"><div class="kpi"><b>${fmtDur(sim.total)}</b><span>${this.t("est_duration")}</span></div>
        <div class="kpi"><b>${zoneCount}</b><span>${this.t("zones")}</span></div>
        <div class="kpi"><b>${water ? `${Math.round(water)} L` : "—"}</b><span>${this.t("h_water")}</span></div></div>
      <p class="hint" style="margin-top:12px">${this.t("sim_hint", { b: Math.round(this._budget() * (p.budget / 100)), c: cap || this.t("unlimited") })}</p>
    </div>`;
  }

  // ------------------------------------------------------------ interactive timeline
  // Gantt of the program being edited. Drag a bar's right edge to change that
  // sprinkler's time (30 s steps); drag the bar sideways to change its start
  // order inside its group. The scale stays fixed while dragging.
  _tlTicks(total) {
    const nice = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
    // ~7 ticks when fitted; with zoom, one tick every ~90 px
    const target = this._tlZoom ? 90 / (this._tlZoom / 60) : total / 7;
    const step = nice.find((n) => n >= target) || 14400;
    const out = [];
    for (let t = 0; t <= total + 1; t += step) out.push(t);
    return { step, out };
  }

  _tlFactor() {
    return (this._budget() / 100) * ((this._edit.budget ?? 100) / 100);
  }

  _timelineHtml() {
    const p = this._edit;
    const s = this._config.settings;
    const plan = this._programPlan(p);
    const zd = p.zone_delay_s >= 0 ? p.zone_delay_s : s.zone_delay_s;
    const sd = p.step_delay_s >= 0 ? p.step_delay_s : s.step_delay_s;
    const sim = simulate(plan, s.max_concurrent, zd, sd);
    this._tlData = { plan, sim };
    if (!sim.bars.length) return `<div class="empty small">${this.t("tl_empty")}</div>`;
    const total = Math.max(60, sim.total);
    const { step, out } = this._tlTicks(total);
    const pct = (sec) => (sec / total) * 100;
    const gridBg = `background-size:${pct(step)}% 100%`;
    const can = this._can();
    let html = "";
    plan.forEach((ps, pi) => {
      const conc = ps.concurrency === 0 ? this.t("all") : ps.concurrency === 1 ? this.t("sequential") : `${ps.concurrency} ${this.t("at_once")}`;
      html += `<div class="tl2-step" style="--c:${esc(ps.color)}"><span class="dot" style="background:${esc(ps.color)}"></span>
        ${pi + 1}. ${esc(ps.label)} <span class="muted">· ${conc}</span></div>`;
      sim.bars.filter((b) => b.step === pi).forEach((b) => {
        const secs = b.end - b.start;
        html += `<div class="tl2-row"><span class="tl2-lab" title="${esc(b.name)}"><span>${esc(b.name)}</span></span>
          <div class="tl2-track" style="${gridBg}">
            <div class="tl2-bar ${can ? "" : "ro"}" ${can ? `data-tl="move"` : ""} data-si="${ps.si}" data-z="${esc(b.zone_id)}" data-total="${total}"
              data-start="${b.start}" data-secs="${secs}" style="--c:${esc(b.color)};left:${pct(b.start)}%;width:${pct(secs)}%"
              title="${esc(b.name)} · ${fmtDur(secs)} (${fmtDur(b.start)} → ${fmtDur(b.end)})">
              <span class="tl2-txt">${fmtDur(secs)}</span>
              ${can ? `<i class="tl2-h" data-tl="resize"></i>` : ""}
            </div>
          </div></div>`;
      });
    });
    const axis = out.map((t) => `<span style="left:${pct(t)}%">${t === 0 ? "0" : fmtDur(t)}</span>`).join("");
    const zoom = this._tlZoom || 0; // px per minute, 0 = fit to width
    const width = zoom ? `style="--tlw:${Math.round((total / 60) * zoom)}px"` : "";
    return `<p class="hint">${this.t("tl_hint")}</p>
      <div class="tl2-scroll"><div class="tl2 ${zoom ? "zoomed" : ""}" ${width}>${html}
        <div class="tl2-row axis"><span></span><div class="tl2-axis">${axis}</div></div></div></div>`;
  }

  _tlDown(e, handle) {
    const bar = handle.closest(".tl2-bar");
    const rect = bar.parentElement.getBoundingClientRect();
    this._tl = { mode: handle.dataset.tl, bar, si: Number(bar.dataset.si), z: bar.dataset.z, x: e.clientX, w: rect.width,
      total: Number(bar.dataset.total), start: Number(bar.dataset.start), secs: Number(bar.dataset.secs), moved: false };
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    bar.classList.add("dragging");
    e.preventDefault();
  }

  _tlMove(e) {
    const d = this._tl;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    const dsec = (dx / d.w) * d.total;
    const txt = d.bar.querySelector(".tl2-txt");
    if (d.mode === "resize") {
      d.newSecs = Math.max(30, Math.round((d.secs + dsec) / 30) * 30);
      d.bar.style.width = `${(d.newSecs / d.total) * 100}%`;
      if (txt) txt.textContent = fmtDur(d.newSecs);
      d.bar.dataset.tip = fmtDur(d.newSecs);
    } else {
      d.newStart = Math.max(0, d.start + dsec);
      d.bar.style.transform = `translateX(${dx}px)`;
      d.bar.dataset.tip = `${fmtDur(d.newStart)} →`;
    }
  }

  _tlUp() {
    const d = this._tl;
    this._tl = null;
    d.bar.classList.remove("dragging");
    delete d.bar.dataset.tip;
    if (!d.moved) { d.bar.style.transform = ""; return; }
    const st = this._edit.steps[d.si];
    const g = st && this._group(st.group_id);
    if (!g) return;
    if (d.mode === "resize") {
      const factor = this._tlFactor() || 1;
      const minutes = Math.max(0.5, Math.round((d.newSecs / 60 / factor) * 2) / 2);
      if (st.duration_mode !== "custom") {
        st.duration_mode = "custom";
        g.zone_ids.forEach((z) => { if (st.durations[z] === undefined) st.durations[z] = st.duration; });
        this._toast(this.t("tl_mode_switched", { g: g.name }));
      }
      st.durations[d.z] = minutes;
    } else {
      const { plan, sim } = this._tlData;
      const others = sim.bars.filter((b) => plan[b.step].si === d.si && b.zone_id !== d.z).sort((a, b) => a.start - b.start);
      const before = others.find((b) => b.start > d.newStart);
      const order = this._stepOrder(st, g).filter((z) => z !== d.z);
      const idx = before ? order.indexOf(before.zone_id) : order.length;
      order.splice(idx < 0 ? order.length : idx, 0, d.z);
      st.order = order;
    }
    this._dirty = true;
    this._render();
  }

  _tlCancel() {
    const d = this._tl;
    this._tl = null;
    if (d) { d.bar.classList.remove("dragging"); d.bar.style.transform = ""; this._refreshPreview(); }
  }

  _refreshPreview() {
    const el = this.shadowRoot.getElementById("editor-preview");
    if (el) el.innerHTML = this._previewHtml();
    const tl = this.shadowRoot.getElementById("tl-body");
    if (tl && !this._tl) tl.innerHTML = this._timelineHtml();
    const foot = this.shadowRoot.querySelector(".sticky-foot .muted");
    if (foot) foot.innerHTML = `<ha-icon icon="mdi:circle-medium" style="color:var(--ski-amber)"></ha-icon>${this.t("unsaved")}`;
  }

  // ------------------------------------------------------------ conditions
  // Visual builder for custom conditions (state / numeric / template). Used for
  // global conditions (settings) and per-program conditions (editor draft).
  _condList(scope) {
    if (scope === "settings") return (this._config.settings.conditions = this._config.settings.conditions || []);
    return (this._edit.conditions = this._edit.conditions || []);
  }

  _reasonText(r) {
    const i = r.indexOf(":");
    const k = i < 0 ? r : r.slice(0, i);
    const v = i < 0 ? "" : r.slice(i + 1);
    if (k === "condition") return v;
    if (k === "rain_sensor") return `${this.t("blocking_rain_sensor")}: ${this._entityName(v)}`;
    if (k === "rain_delay" || !v) return this.t(`blocking_${k}`);
    return `${this.t(`blocking_${k}`)}: ${v}`;
  }

  _condBadge(r) {
    if (!r) return `<span class="badge">…</span>`;
    const detail = r.detail ? `<span class="small muted">${esc(r.detail.replace(/^= /, ""))}</span>` : "";
    return r.ok
      ? `<span class="badge green"><ha-icon icon="mdi:check" style="--mdc-icon-size:14px"></ha-icon>${this.t("cond_ok")}</span>${detail}`
      : `<span class="badge amber"><ha-icon icon="mdi:close" style="--mdc-icon-size:14px"></ha-icon>${this.t("cond_fail")}</span>${detail}`;
  }

  _valueSuggestions(c) {
    const st = c.entity_id && this._hass.states[c.entity_id];
    if (!st) return [];
    const domain = c.entity_id.split(".")[0];
    let vals = [];
    if (Array.isArray(st.attributes.options)) vals = st.attributes.options.map(String);
    else if (["binary_sensor", "input_boolean", "switch", "light", "fan"].includes(domain)) vals = ["on", "off"];
    else if (domain === "weather") vals = ["sunny", "clear-night", "partlycloudy", "cloudy", "fog", "rainy", "pouring", "lightning-rainy", "snowy", "windy"];
    if (!vals.includes(st.state) && !["unavailable", "unknown"].includes(st.state)) vals.unshift(st.state);
    (c.states || []).forEach((v) => { if (!vals.includes(v)) vals.push(v); });
    return vals.slice(0, 24);
  }

  _condEditorHtml(scope) {
    const list = this._condList(scope);
    const res = this._condResults || {};
    const can = this._can();
    const types = ["state", "numeric", "template"];
    return `<div class="stack" style="gap:10px">
      ${list.map((c, i) => {
        const b = `cond:${scope}:${i}`;
        let body;
        if (c.type === "template") {
          body = `<textarea rows="3" spellcheck="false" data-bind="${b}:template" placeholder="{{ states('sensor.lluvia_hoy') | float(0) < 5 }}">${esc(c.template)}</textarea>
            <div class="small muted">${this.t("cond_template_hint")}</div>`;
        } else {
          const entity = `<label class="field" style="flex:2;min-width:220px"><span>${this.t("cond_entity")}</span>
            <div class="pk-field"><input type="text" value="${esc(c.entity_id || "")}" data-bind="${b}:entity_id" data-suggest="cond:${scope}:${i}"
              placeholder="${this.t("type_to_search")}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn icon" title="${this.t("search")}" data-action="pick" data-pick="cond:${scope}:${i}" data-domains="" data-title="${this.t("cond_entity")}"><ha-icon icon="mdi:magnify"></ha-icon></button></div></label>`;
          const known = c.entity_id && this._hass.states[c.entity_id];
          const entHint = c.entity_id ? `<div class="ent-hint ${known ? "" : "bad"}">${known
            ? `<ha-icon icon="mdi:link-variant"></ha-icon>${esc(this._entityName(c.entity_id))} · <b>${esc(this._stateText(c.entity_id))}</b>`
            : `<ha-icon icon="mdi:alert-outline"></ha-icon>${this.t("entity_not_found")}`}</div>` : "";
          const vals = c.type === "state" ? this._valueSuggestions(c) : [];
          const valChips = vals.length ? `<div class="row wrap val-sugg"><span class="small muted">${this.t("possible_values")}</span>
            ${vals.map((v) => `<button type="button" class="chip ${(c.states || []).includes(v) ? "on" : ""}" data-action="cond-val" data-scope="${scope}" data-n="${i}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>` : "";
          const attrib = `<label class="field" style="flex:1;min-width:120px"><span>${this.t("cond_attribute")}</span>
            <input type="text" value="${esc(c.attribute || "")}" data-bind="${b}:attribute" spellcheck="false"></label>`;
          body = c.type === "numeric"
            ? `<div class="row wrap" style="align-items:flex-end">${entity}${attrib}
                <label class="field"><span>${this.t("cond_above")}</span><input type="number" step="any" value="${c.above ?? ""}" data-bind="${b}:above"></label>
                <label class="field"><span>${this.t("cond_below")}</span><input type="number" step="any" value="${c.below ?? ""}" data-bind="${b}:below"></label></div>${entHint}`
            : `<div class="row wrap" style="align-items:flex-end">${entity}${attrib}
                <label class="field"><span>&nbsp;</span><select data-bind="${b}:operator">
                  <option value="is" ${c.operator !== "not" ? "selected" : ""}>${this.t("op_is")}</option>
                  <option value="not" ${c.operator === "not" ? "selected" : ""}>${this.t("op_not")}</option></select></label>
                <label class="field" style="flex:1;min-width:160px"><span>${this.t("cond_states")}</span>
                  <input type="text" value="${esc((c.states || []).join(", "))}" data-bind="${b}:states" placeholder="no_rain"></label></div>${entHint}${valChips}`;
        }
        return `<div class="cond-card">
          <div class="row wrap">
            <input type="text" class="cond-label" value="${esc(c.label)}" placeholder="${this.t("cond_label")}" data-bind="${b}:label">
            <div class="seg">${types.map((tp) => `<button class="${c.type === tp ? "on" : ""}" data-action="cond-type" data-scope="${scope}" data-n="${i}" data-v="${tp}">${this.t(`cond_${tp}`)}</button>`).join("")}</div>
            ${can ? `<button class="btn icon" title="${this.t("delete")}" data-action="del-cond" data-scope="${scope}" data-n="${i}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>` : ""}
          </div>
          <div class="cond-res row" data-cond-res="${esc(c.id)}">${this._condBadge(res[c.id])}</div>
          ${body}
          <div class="row wrap" style="gap:18px">
            <div class="row"><label class="switch"><input type="checkbox" data-bind="${b}:recheck" ${c.recheck ? "checked" : ""}><span class="tr"></span></label>
              <span class="small">${this.t("cond_recheck")}</span></div>
            ${c.type === "template" ? "" : `<div class="row small"><span class="muted">${this.t("cond_unavail")}</span>
              <select style="width:auto;min-height:32px;padding:4px 8px" data-bind="${b}:unavailable">
                <option value="fail" ${c.unavailable !== "pass" ? "selected" : ""}>${this.t("unavail_fail")}</option>
                <option value="pass" ${c.unavailable === "pass" ? "selected" : ""}>${this.t("unavail_pass")}</option></select></div>`}
          </div>
        </div>`;
      }).join("")}
      ${list.length ? "" : `<div class="muted small">${this.t("no_conditions")}</div>`}
      ${can ? `<div><button class="btn sm" data-action="add-cond" data-scope="${scope}"><ha-icon icon="mdi:plus"></ha-icon>${this.t("add_condition")}</button></div>` : ""}
    </div>`;
  }

  _scheduleCondCheck() {
    clearTimeout(this._condTimer);
    this._condTimer = setTimeout(() => this._checkConditions(), 350);
  }

  async _checkConditions() {
    let conds = [];
    if (this._tab === "settings" && this._config) conds = this._config.settings.conditions || [];
    else if (this._tab === "programs" && this._edit) conds = this._edit.conditions || [];
    if (!conds.length) return;
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/check_conditions`, conditions: conds });
      this._condResults = Object.fromEntries(res.map((r) => [r.id, r]));
      this.shadowRoot.querySelectorAll("[data-cond-res]").forEach((el) => {
        el.innerHTML = this._condBadge(this._condResults[el.dataset.condRes]);
      });
    } catch (err) { /* ignore */ }
  }

  // ------------------------------------------------------------ entity picker
  // Searchable popover that replaces native <select>s: grouped by HA area,
  // shows device + entity_id to tell identical names apart, keyboard friendly,
  // optional multi-select. Lives outside the main template so typing in its
  // search box never triggers a full re-render.
  _entityMeta(id) {
    const ent = this._hass.entities?.[id];
    const dev = ent?.device_id ? this._hass.devices?.[ent.device_id] : null;
    const areaId = ent?.area_id || dev?.area_id;
    return {
      area: (areaId && this._hass.areas?.[areaId]?.name) || null,
      device: dev ? dev.name_by_user || dev.name : null,
      platform: ent?.platform || null,
    };
  }

  _entityItems(domains) {
    return Object.keys(this._hass.states)
      .filter((id) => (!domains.length || domains.includes(id.split(".")[0])) && this._hass.entities?.[id]?.platform !== DOMAIN)
      .map((id) => {
        const m = this._entityMeta(id);
        return { id, name: this._entityName(id), sub: [m.device, id].filter(Boolean).join(" · "), group: m.area,
          icon: this._hass.states[id].attributes.icon, rb: m.platform === "rainbird", state: this._stateText(id) };
      });
  }

  _stateText(id) {
    const st = this._hass.states[id];
    if (!st) return null;
    const unit = st.attributes.unit_of_measurement;
    return `${st.state}${unit ? ` ${unit}` : ""}`;
  }

  _isSuggested(c) {
    return c.platform === "rainbird" || c.domain === "valve" ||
      /sprink|riego|regad|aspers|irrig|valv|goteo|drip|rain ?bird|opensprinkler/i.test(`${c.name} ${c.entity_id}`);
  }

  _pickerSpec(target) {
    const [kind, a] = target.split(":");
    if (kind === "group-add") {
      const g = this._group(a);
      const inGroup = new Set(g.zone_ids.map((z) => this._zone(z)?.entity_id));
      const items = this._devices().filter((d) => !inGroup.has(d.entity_id)).map((d) => {
        const z = this._zoneByEntity(d.entity_id);
        const m = this._entityMeta(d.entity_id);
        return { id: d.entity_id, name: z?.name || d.name, sub: [m.device, d.entity_id].filter(Boolean).join(" · "),
          group: d.area || m.area, rb: d.platform === "rainbird", suggested: this._isSuggested(d), color: z?.color };
      });
      return { title: `${this.t("add_zone_to_group")} — ${g.name}`, multi: true, items,
        chips: [["suggested", this.t("suggested")], ["all", this.t("all_domains")], ["rainbird", "Rain Bird"]],
        chip: items.some((i) => i.suggested) ? "suggested" : "all" };
    }
    if (kind === "rain-add") {
      return { title: this.t("rain_sensors"), multi: true,
        items: this._entityItems(["binary_sensor", "input_boolean"]).filter((i) => !this._config.settings.rain_sensors.includes(i.id)) };
    }
    if (kind === "notify") {
      return { title: this.t("notify_service"), items: Object.keys(this._hass.services?.notify || {})
        .map((n) => ({ id: `notify.${n}`, name: n.replace(/_/g, " "), sub: `notify.${n}`, icon: "mdi:bell-outline" })) };
    }
    if (kind === "area-filter") {
      const areas = [...new Set(this._devices().map((d) => d.area).filter(Boolean))].sort();
      return { title: this.t("area"), items: areas.map((n) => ({ id: n, name: n, icon: "mdi:home-outline",
        sub: `${this._devices().filter((d) => d.area === n).length} ${this.t("devices_lc")}` })) };
    }
    const domains = (this._pkDomains || "").split(",").filter(Boolean);
    return { title: this._pkTitle || this.t("cond_entity"), items: this._entityItems(domains) };
  }

  _openPicker(target, anchor, inline = false) {
    this._pkDomains = anchor.dataset.domains || "";
    this._pkTitle = anchor.dataset.title || "";
    const spec = this._pickerSpec(target);
    if (!inline) anchor.scrollIntoView({ block: "nearest" });
    const r = anchor.getBoundingClientRect();
    this._pk = { target, ...spec, query: inline ? anchor.value.trim() : "", sel: new Set(), idx: 0, rect: r,
      chip: spec.chip || "all", inline };
    this._renderPicker();
    if (!inline) setTimeout(() => this.shadowRoot.querySelector(".pk input")?.focus(), 30);
  }

  _closePicker() {
    this._pk = null;
    this._pkEl?.remove();
  }

  _pkFiltered() {
    const p = this._pk;
    const tokens = p.query.toLowerCase().split(/\s+/).filter(Boolean);
    return p.items.filter((i) => {
      if (p.chip === "suggested" && !i.suggested) return false;
      if (p.chip === "rainbird" && !i.rb) return false;
      const hay = `${i.name} ${i.sub || ""} ${i.group || ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).sort((x, y) => (x.group || "~").localeCompare(y.group || "~") || x.name.localeCompare(y.name, undefined, { numeric: true }));
  }

  _pkListHtml() {
    const p = this._pk;
    const list = this._pkFiltered();
    p.flat = list.slice(0, 400);
    if (!list.length) return `<div class="empty small">${this.t("no_results")}</div>`;
    let last;
    return p.flat.map((i, n) => {
      const head = i.group !== last ? `<div class="pk-group">${i.group ? `<ha-icon icon="mdi:home-outline"></ha-icon>${esc(i.group)}` : this.t("no_area")}</div>` : "";
      last = i.group;
      const on = p.sel.has(i.id);
      return `${head}<div class="pk-item ${n === p.idx ? "hl" : ""} ${on ? "on" : ""}" data-action="pk-pick" data-id="${esc(i.id)}" data-n="${n}">
        ${p.multi ? `<span class="pk-check"><ha-icon icon="${on ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline"}"></ha-icon></span>`
          : i.color ? `<span class="swatch" style="background:${esc(i.color)}"></span>` : `<ha-icon class="pk-ic" icon="${esc(i.icon || "mdi:checkbox-blank-circle-outline")}"></ha-icon>`}
        <div class="pk-txt"><div class="pk-nm">${esc(i.name)}</div>${i.sub ? `<div class="pk-sub">${esc(i.sub)}</div>` : ""}</div>
        ${i.state != null ? `<span class="pk-state">${esc(i.state)}</span>` : ""}
        ${i.rb ? `<span class="badge rb">Rain Bird</span>` : ""}
      </div>`;
    }).join("") + (list.length > p.flat.length ? `<div class="empty small">${this.t("refine_search", { n: list.length })}</div>` : "");
  }

  _renderPicker() {
    const p = this._pk;
    if (!p) return;
    if (!this._pkEl) { this._pkEl = document.createElement("div"); this._pkEl.className = "pk-root"; }
    const narrow = window.innerWidth < 640 && !p.inline;
    const w = Math.min(p.inline ? Math.max(380, p.rect.width) : 460, window.innerWidth - 24);
    const vh = window.innerHeight;
    const below = vh - p.rect.bottom > 360 || p.rect.top < 360;
    const left = Math.max(12, Math.min(p.rect.left, window.innerWidth - w - 12));
    const top = Math.max(12, Math.min(p.rect.bottom + 6, vh - 372));
    const bottom = Math.max(12, Math.min(vh - p.rect.top + 6, vh - 372));
    const pos = narrow ? "left:8px;right:8px;bottom:8px;max-height:78vh"
      : `left:${left}px;width:${w}px;${below ? `top:${top}px` : `bottom:${bottom}px`}`;
    if (p.inline) {
      this._pkEl.innerHTML = `<div class="pk inline" style="${pos}" role="listbox">
        <div class="pk-list" id="pk-list">${this._pkListHtml()}</div></div>`;
      if (!this._pkEl.isConnected) this.shadowRoot.appendChild(this._pkEl);
      return;
    }
    this._pkEl.innerHTML = `<div class="pk-scrim ${narrow ? "dim" : ""}" data-action="pk-close"></div>
      <div class="pk" style="${pos}" role="dialog">
        <div class="pk-title">${esc(p.title)}<span class="spacer"></span><button class="btn icon" data-action="pk-close"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="pk-search"><ha-icon icon="mdi:magnify"></ha-icon><input type="text" data-bind="pk-search" placeholder="${this.t("search_hint")}" value="${esc(p.query)}" autocomplete="off" spellcheck="false"></div>
        ${p.chips ? `<div class="chips pk-chips">${p.chips.map(([k, l]) => `<button class="chip ${p.chip === k ? "on" : ""}" data-action="pk-chip" data-id="${k}">${esc(l)}</button>`).join("")}</div>` : ""}
        <div class="pk-list" id="pk-list">${this._pkListHtml()}</div>
        ${p.multi ? `<div class="pk-ft"><span class="muted small" id="pk-count">${this.t("selected_n", { n: p.sel.size })}</span><span class="spacer"></span>
          <button class="btn" data-action="pk-close">${this.t("cancel")}</button>
          <button class="btn primary" data-action="pk-done" ${p.sel.size ? "" : "disabled"}><ha-icon icon="mdi:plus"></ha-icon>${this.t("add")}</button></div>` : ""}
      </div>`;
    if (!this._pkEl.isConnected) this.shadowRoot.appendChild(this._pkEl);
  }

  _refreshPickerList(keepScroll = true) {
    const list = this.shadowRoot.getElementById("pk-list");
    if (!list) return;
    const top = list.scrollTop;
    list.innerHTML = this._pkListHtml();
    if (keepScroll) list.scrollTop = top;
    const count = this.shadowRoot.getElementById("pk-count");
    if (count) count.textContent = this.t("selected_n", { n: this._pk.sel.size });
    const done = this.shadowRoot.querySelector("[data-action=pk-done]");
    if (done) done.disabled = !this._pk.sel.size;
  }

  _pkKey(e) {
    const p = this._pk;
    if (!p) return;
    if (e.key === "Escape") { this._closePicker(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      p.idx = Math.max(0, Math.min((p.flat?.length || 1) - 1, p.idx + (e.key === "ArrowDown" ? 1 : -1)));
      this._refreshPickerList();
      this.shadowRoot.querySelector(".pk-item.hl")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = p.flat?.[p.idx];
      if (item) this._pkSelect(item.id);
      else if (p.multi && p.sel.size) this._pkApply([...p.sel]);
    }
  }

  _pkSelect(id) {
    const p = this._pk;
    if (!p.multi) { this._pkApply([id]); return; }
    if (p.sel.has(id)) p.sel.delete(id); else p.sel.add(id);
    this._refreshPickerList();
  }

  _pkApply(values) {
    const target = this._pk.target;
    this._closePicker();
    const [kind, a, b] = target.split(":");
    const s = this._config.settings;
    if (kind === "settings") { s[a] = values[0] ?? null; this._queueSave("settings"); }
    else if (kind === "notify") { s.notify_service = values[0] ?? null; this._queueSave("settings"); }
    else if (kind === "rain-add") { values.forEach((v) => { if (!s.rain_sensors.includes(v)) s.rain_sensors.push(v); }); this._queueSave("settings"); }
    else if (kind === "group-add") {
      const g = this._group(a);
      values.forEach((e) => { const z = this._ensureZone(e); if (!g.zone_ids.includes(z.id)) g.zone_ids.push(z.id); });
      this._queueSave("layout");
      this._toast(this.t("added_n", { n: values.length }));
    } else if (kind === "area-filter") { this._domain = values[0] ? `area:${values[0]}` : "suggested"; }
    else if (kind === "cond") {
      this._condList(a)[Number(b)].entity_id = values[0] ?? null;
      if (a === "settings") this._queueSave("settings"); else this._dirty = true;
    }
    this._render();
  }

  _pickField(target, value, label, domains, placeholder) {
    const can = this._can();
    const name = value ? (target === "notify" ? value.replace(/^notify\./, "").replace(/_/g, " ") : this._entityName(value)) : "";
    return `<label class="field"><span>${label}</span><div class="pk-field">
      <button type="button" class="pk-btn ${value ? "" : "is-empty"}" data-action="pick" data-pick="${target}" data-domains="${domains}" data-title="${esc(label)}" ${can ? "" : "disabled"}>
        <span class="pk-btn-txt">${value ? `<b>${esc(name)}</b><small>${esc(value)}${target !== "notify" && this._hass.states[value] ? ` · ${esc(this._stateText(value))}` : ""}</small>` : esc(placeholder || this.t("choose"))}</span>
        <ha-icon icon="mdi:menu-down"></ha-icon></button>
      ${value && can ? `<button type="button" class="btn icon" title="${this.t("clear")}" data-action="pk-clear" data-pick="${target}"><ha-icon icon="mdi:close"></ha-icon></button>` : ""}
    </div></label>`;
  }

  // ------------------------------------------------------------ settings tab
  _render_settings() {
    const s = this._config.settings;
    const can = this._can() ? "" : "disabled";
    const num = (key, label, min = 0, max = 9999, step = 1) => `<label class="field"><span>${label}</span>
      <input type="number" min="${min}" max="${max}" step="${step}" value="${s[key] ?? ""}" data-bind="settings:${key}" ${can}></label>`;
    const ent = (key, label, domains) => this._pickField(`settings:${key}`, s[key], label, domains.join(","), this.t("none"));
    const notify = Object.keys(this._hass.services?.notify || {}).map((n) => `notify.${n}`);
    return `<div class="grid settings-grid">
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
        <p class="hint">${this.t("skip_hint")}</p>
        <label class="field"><span>${this.t("rain_sensors")}</span></label>
        <div class="stack" style="gap:6px;margin:6px 0 8px">${s.rain_sensors.map((e) => {
          const st = this._hass.states[e];
          const binary = ["binary_sensor", "input_boolean"].includes(e.split(".")[0]);
          const wet = st && ["on", "wet", "rain", "raining", "true"].includes(st.state);
          const badge = !st ? `<span class="badge red">${this.t("entity_not_found")}</span>`
            : !binary ? `<span class="badge red" title="${esc(this.t("not_binary_hint"))}"><ha-icon icon="mdi:alert-outline" style="--mdc-icon-size:13px"></ha-icon>${this.t("not_binary")}</span>`
            : wet ? `<span class="badge amber"><ha-icon icon="mdi:weather-pouring" style="--mdc-icon-size:13px"></ha-icon>${this.t("raining_now")}</span>`
            : `<span class="badge green"><ha-icon icon="mdi:weather-sunny" style="--mdc-icon-size:13px"></ha-icon>${this.t("dry_now")}</span>`;
          return `<div class="rain-row"><div class="pk-txt"><div class="pk-nm">${esc(this._entityName(e))}</div>
            <div class="pk-sub">${esc(e)}${st ? ` · ${esc(this._stateText(e))}` : ""}</div></div>${badge}
            ${this._can() ? `<button class="btn icon" title="${this.t("delete")}" data-action="del-rain" data-id="${esc(e)}"><ha-icon icon="mdi:close"></ha-icon></button>` : ""}</div>
            ${st && !binary ? `<div class="small warn-line">${this.t("not_binary_hint")}</div>` : ""}`;
        }).join("")}</div>
        ${this._can() ? `<button class="btn sm" data-action="pick" data-pick="rain-add"><ha-icon icon="mdi:plus"></ha-icon>${this.t("add_sensor")}</button>` : ""}
        <div class="fields" style="margin-top:14px">
          ${ent("weather_entity", this.t("weather_entity"), ["weather"])}
          ${ent("freeze_sensor", this.t("freeze_sensor"), ["sensor", "input_number"])}
          ${num("freeze_threshold", this.t("freeze_threshold"), -50, 50, 0.5)}
        </div>
        <label class="field" style="margin-top:14px"><span>${this.t("weather_conditions")}</span></label>
        <div class="chips" style="margin-top:6px">${WEATHER.map((w) => `<button class="chip ${s.weather_conditions.includes(w) ? "on" : ""} ${this._hass.states[s.weather_entity]?.state === w ? "now" : ""}" data-action="toggle-weather" data-id="${w}" ${can}
          title="${this._hass.states[s.weather_entity]?.state === w ? esc(this.t("current_weather")) : ""}">${w}</button>`).join("")}</div>
        <p class="hint" style="margin-top:12px">${this.t("skip_scope_hint")}</p>
      </div></div>
      <div class="card" style="grid-column:1/-1"><div class="hd"><h2><ha-icon icon="mdi:shield-check-outline"></ha-icon>${this.t("s_custom_conditions")}</h2></div><div class="bd">
        <p class="hint">${this.t("custom_cond_hint")}</p>
        <div class="toggle-row"><span class="lbl">${this.t("manual_conditions")}</span>
          <label class="switch"><input type="checkbox" data-bind="settings:manual_conditions" ${s.manual_conditions !== false ? "checked" : ""} ${can}><span class="tr"></span></label></div>
        ${this._condEditorHtml("settings")}
      </div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:pipe-valve"></ha-icon>${this.t("s_hydraulics")}</h2></div><div class="bd"><div class="fields">
        ${ent("master_entity", this.t("master_entity"), ["switch", "valve", "input_boolean", "light", "fan"])}
        ${num("master_lead_s", this.t("master_lead"), 0, 600)}
        ${num("master_lag_s", this.t("master_lag"), 0, 600)}
        ${num("max_concurrent", this.t("max_concurrent"), 0, 64)}
      </div></div></div>
      <div class="card"><div class="hd"><h2><ha-icon icon="mdi:bell-outline"></ha-icon>${this.t("s_notifications")} & ${this.t("s_backup")}</h2></div><div class="bd">
        ${this._pickField("notify", s.notify_service, this.t("notify_service"), "", this.t("none"))}
        <div class="row wrap" style="margin-top:16px">
          <button class="btn" data-action="export"><ha-icon icon="mdi:download"></ha-icon>${this.t("export")}</button>
          ${this._can() ? `<label class="btn"><ha-icon icon="mdi:upload"></ha-icon>${this.t("import")}<input type="file" accept="application/json" data-bind="import" hidden></label>` : ""}
        </div>
        <div class="donate"><div><b>☕ ${this.t("donate_title")}</b><div class="small muted">${this.t("donate_text")}</div></div>
          <a class="btn donate-btn" href="https://www.paypal.com/donate/?business=gerencia%40skynetcom.com.ar&currency_code=USD&item_name=SK+Irrigation+Manager" target="_blank" rel="noopener"><ha-icon icon="mdi:coffee"></ha-icon>${this.t("donate_btn")}</a></div>
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
            ${h.reason && h.status !== "completed" ? `<div class="small muted">${esc(h.reason.split(", condition:").map((r) => this._reasonText(r)).join(", "))}</div>` : ""}</td>
          <td>${this.t(`src_${h.source}`)}</td><td><span class="badge ${cls[h.status] || ""}">${this.t(`stat_${h.status}`)}</span></td>
          <td class="tnum">${h.status === "skipped" ? "—" : fmtDur(secs)}</td><td class="tnum">${water ? `${Math.round(water)} L` : "—"}</td></tr>`;
      }).join("")}</tbody></table></div></div></div>`;
  }

  // ------------------------------------------------------------ dialogs
  _dialogHtml() {
    const d = this._dialog;
    if (d.type === "zone") {
      const dev = this._devices().find((x) => x.entity_id === d.entity_id) || {};
      const z = d.draft;
      return `<div class="scrim" data-action="dlg-cancel"><div class="dialog" data-stop>
        <h2 class="row"><ha-icon icon="mdi:sprinkler"></ha-icon>${this.t("edit_sprinkler")}</h2>
        <div class="small muted">${esc(d.entity_id)}${dev.area ? ` · ${esc(dev.area)}` : ""}${dev.platform === "rainbird" ? ` · Rain Bird` : ""}</div>
        <div class="row"><input type="color" value="${esc(z.color)}" data-bind="dlgz:color">
          <input type="text" value="${esc(z.name)}" data-bind="dlgz:name" placeholder="${this.t("zone_name")}"></div>
        <div class="row wrap"><label class="field" style="flex:1"><span>${this.t("flow_rate")}</span>
          <input type="number" min="0" step="0.1" value="${z.flow_rate ?? ""}" data-bind="dlgz:flow_rate" style="max-width:none"></label>
          <div class="row" style="margin-top:18px"><label class="switch"><input type="checkbox" data-bind="dlgz:enabled" ${z.enabled ? "checked" : ""}><span class="tr"></span></label>${this.t("enabled")}</div></div>
        <div class="foot" style="justify-content:space-between;flex-wrap:wrap">
          <div class="row" style="gap:6px">
            <button class="btn sm" data-action="zone-test"><ha-icon icon="mdi:play-circle-outline"></ha-icon>${this.t("test")}</button>
            ${d.isNew ? "" : `<button class="btn sm danger" data-action="zone-delete"><ha-icon icon="mdi:delete-outline"></ha-icon>${this.t("remove_sprinkler")}</button>`}</div>
          <div class="row" style="gap:6px"><button class="btn" data-action="dlg-cancel">${this.t("cancel")}</button>
          <button class="btn primary" data-action="zone-save">${this.t("save")}</button></div>
        </div></div></div>`;
    }
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
    if (a.startsWith("map-")) { await this._mapAction(a, el); return; }
    switch (a) {
      case "pick": this._openPicker(el.dataset.pick, el); return;
      case "pk-close": this._closePicker(); return;
      case "pk-pick": this._pk.idx = n; this._pkSelect(id); return;
      case "pk-done": this._pkApply([...this._pk.sel]); return;
      case "pk-chip": this._pk.chip = id; this._pk.idx = 0; this._renderPicker(); return;
      case "pk-clear": this._pk = { target: el.dataset.pick }; this._pkApply([]); return;
      case "tab":
        if (this._edit && this._dirty && id !== "programs") { /* keep draft */ }
        this._tab = id;
        try { localStorage.setItem("ski-tab", id); } catch (err) { /* ignore */ }
        if (id === "groups") this._refreshCandidates();
        break;
      case "stop": await this._action("stop"); this._toast(this.t("stopped")); break;
      case "skip": await this._action("skip", id ? { target: id } : {}); return;
      case "run-program": {
        const res = await this._action("run_program", { target: id });
        if (res?.blocked) { this._toast(`${this.t("blocked")}: ${res.blocked.map((r) => this._reasonText(r)).join(", ")}`); break; }
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
        if (res?.blocked) { this._toast(`${this.t("blocked")}: ${res.blocked.map((r) => this._reasonText(r)).join(", ")}`); break; }
        this._toast(res?.run ? this.t("queued") : this.t("nothing_to_water"));
        break;
      }
      case "rain-delay": await this._action("rain_delay", { hours: Number(el.dataset.hours) }); break;
      case "remove-queued": await this._action("remove_queued", { target: id }); break;
      // sprinklers
      case "domain": this._domain = id; break;
      case "edit-dev": {
        const z = this._zoneByEntity(id);
        this._dialog = { type: "zone", entity_id: id, isNew: !z,
          draft: z ? clone(z) : { name: (this._devices().find((d) => d.entity_id === id)?.name || id).replace(/^Rain ?Bird\s*/i, ""),
            color: PALETTE[this._zones.length % PALETTE.length], flow_rate: null, enabled: true } };
        break;
      }
      case "zone-save": {
        const d = this._dialog;
        this._dialog = null;
        const z = this._ensureZone(d.entity_id);
        Object.assign(z, { name: d.draft.name || z.name, color: d.draft.color, flow_rate: d.draft.flow_rate, enabled: d.draft.enabled });
        this._queueSave("layout");
        break;
      }
      case "zone-test": {
        const d = this._dialog;
        const z = this._zoneByEntity(d.entity_id);
        if (!z) { this._ensureZone(d.entity_id); await this._saveNow("layout"); }
        const res = await this._action("run_zone", { target: d.entity_id, minutes: 1 });
        this._toast(res?.blocked ? `${this.t("blocked")}: ${res.blocked.map((r) => this._reasonText(r)).join(", ")}` : this.t("queued"));
        return;
      }
      case "zone-delete": {
        const d = this._dialog;
        const z = this._zoneByEntity(d.entity_id);
        this._dialog = null;
        if (z) {
          this._config.zones = this._zones.filter((x) => x.id !== z.id);
          this._config.groups.forEach((g) => { g.zone_ids = g.zone_ids.filter((x) => x !== z.id); });
          this._queueSave("layout");
        }
        break;
      }
      case "groups-from-areas": this._groupsFromAreas(); break;
      case "tl-zoom": {
        const levels = [0, 4, 8, 16, 32, 64];
        const v = Number(el.dataset.v);
        let i = levels.indexOf(this._tlZoom || 0);
        i = v === 0 ? 0 : Math.max(0, Math.min(levels.length - 1, i + v));
        this._tlZoom = levels[i];
        const body = this.shadowRoot.getElementById("tl-body");
        if (body) body.innerHTML = this._timelineHtml();
        this.shadowRoot.querySelectorAll(".tl-zoom button").forEach((b) => b.classList.toggle("on", b.dataset.v === "0" && !this._tlZoom));
        return;
      }
      case "cond-val": {
        const scope = el.dataset.scope;
        const c = this._condList(scope)[n];
        c.states = c.states || [];
        const v = el.dataset.v;
        c.states = c.states.includes(v) ? c.states.filter((x) => x !== v) : [...c.states, v];
        if (scope === "settings") this._queueSave("settings"); else this._dirty = true;
        this._scheduleCondCheck();
        break;
      }
      // conditions
      case "add-cond":
      case "del-cond":
      case "cond-type": {
        const scope = el.dataset.scope;
        const list = this._condList(scope);
        if (a === "add-cond") {
          list.push({ id: uid("cond"), type: "state", label: "", entity_id: null, attribute: null, operator: "is",
            states: [], above: null, below: null, template: "", recheck: false, unavailable: "fail" });
        } else if (a === "del-cond") list.splice(n, 1);
        else list[n].type = el.dataset.v;
        if (scope === "settings") this._queueSave("settings"); else this._dirty = true;
        break;
      }
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
        this._queueSave("layout");
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

  _createGroup(zoneIds, name) {
    const g = { id: uid("group"), name: name || `${this.t("new_group")} ${this._groups.length + 1}`,
      color: PALETTE[(this._groups.length + 1) % PALETTE.length], icon: "mdi:sprinkler-variant", zone_ids: zoneIds };
    this._config.groups.push(g);
    this._queueSave("layout");
    return g;
  }

  async _saveNow(key) {
    const value = key === "layout" ? { zones: this._config.zones, groups: this._config.groups } : this._config[key];
    const res = await this._ws({ type: `${DOMAIN}/save`, key, value });
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
    if (el.dataset.suggest && this._pk?.inline) {
      this._pk.query = el.value.trim();
      this._pk.idx = 0;
      this._refreshPickerList(false);
      return;
    }
    if (el.dataset.bind === "pk-search" && this._pk) {
      this._pk.query = el.value;
      this._pk.idx = 0;
      this._refreshPickerList(false);
      return;
    }
    if (el.dataset.bind === "search") {
      this._search = el.value;
      const list = this.shadowRoot.getElementById("pool-list");
      if (list) list.innerHTML = this._poolItemsHtml();
    }
  }

  async _onChange(e) {
    const el = e.target;
    const bind = el.dataset.bind;
    if (!bind || bind === "search" || bind === "pk-search") return;
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
      case "group": {
        this._group(a)[b] = v;
        this._queueSave("groups", b === "color");
        return;
      }
      case "group-add": {
        if (v) this._group(a).zone_ids.push(this._ensureZone(v).id);
        this._queueSave("layout");
        break;
      }
      case "stepskip": {
        const st = this._edit.steps[Number(a)];
        st.skip = (st.skip || []).filter((z) => z !== b);
        if (!v) st.skip.push(b);
        this._dirty = true;
        break;
      }
      case "dlgz": this._dialog.draft[a] = v; return;
      case "map": {
        const view = this._mapView();
        if (!view) return;
        view[a] = a === "max_native_zoom" ? Number(v) : v;
        this._queueSave("maps", true);
        return;
      }
      case "map-image": await this._mapUpload(el.files?.[0]); el.value = ""; return;
      case "cond": {
        const [, scope, idx, field] = bind.split(":");
        const c = this._condList(scope)[Number(idx)];
        if (field === "entity_id" && v && !this._hass.states[String(v).trim()] && !String(v).includes(".")) {
          el.value = c.entity_id || "";  // free text that isn't an entity: keep the previous one
          return;
        }
        if (field === "states") v = String(v).split(",").map((x) => x.trim()).filter(Boolean);
        if (["entity_id", "attribute"].includes(field)) v = String(v).trim() || null;
        c[field] = v;
        if (scope === "settings") this._queueSave("settings"); else { this._dirty = true; this._refreshPreview(); }
        this._scheduleCondCheck();
        return;
      }
      case "import": {
        const file = el.files?.[0];
        if (!file) return;
        const text = await file.text();
        el.value = "";
        let parsed;
        try { parsed = JSON.parse(text); } catch (err) { this._toast(this.t("import_invalid")); return; }
        const incoming = parsed.config || parsed;
        // A file with only "maps" adds those maps to the current configuration.
        const mapsOnly = Array.isArray(incoming.maps) && !incoming.zones && !incoming.groups && !incoming.programs;
        this._confirm(mapsOnly ? this.t("import_maps_confirm", { n: incoming.maps.length }) : this.t("import_confirm"), async () => {
          let config = await this._mapsForImport(incoming);
          if (mapsOnly) config = this._mergeImportedMaps(config.maps);
          const res = await this._ws({ type: `${DOMAIN}/import`, config });
          this._config = res.config;
          this._syncEdit(true);
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

  async _export() {
    const config = await this._mapsForExport(clone(this._config));
    const blob = new Blob([JSON.stringify({ version: this._version, config }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sk-irrigation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------ drag & drop
  _onPointerDown(e) {
    if (e.button > 0) return;
    const tlHandle = e.target.closest("[data-tl]");
    if (tlHandle) { this._tlDown(e, tlHandle); return; }
    const el = e.target.closest("[data-drag]");
    if (!el || e.target.closest("button, input, select, label, a")) return;
    if (el.hasAttribute("data-handle-only") && !e.target.closest(".grip")) return;
    this._drag = { el, data: JSON.parse(el.dataset.drag), x: e.clientX, y: e.clientY, started: false, pid: e.pointerId };
  }

  _onPointerMove(e) {
    if (this._tl) { this._tlMove(e); return; }
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
    d.cx = e.clientX;
    d.cy = e.clientY;
    d.ghost.style.left = `${e.clientX - d.ox}px`;
    d.ghost.style.top = `${e.clientY - d.oy}px`;
    const under = this.shadowRoot.elementFromPoint(e.clientX, e.clientY);
    let target = under?.closest("[data-drop]");
    if (target && !(target.dataset.accept || "").split(",").includes(d.data.t)) target = null;
    if (target && d.data.t === "szone" && target.dataset.drop !== `steporder:${d.data.s}`) target = null;
    if (d.target && d.target !== target) d.target.classList.remove("over");
    d.target = target;
    d.index = null;
    d.marker.remove();
    if (target) {
      target.classList.add("over");
      if (target.dataset.drop.startsWith("group:") || target.dataset.drop.startsWith("steporder:") || target.dataset.drop === "steps") {
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
    if (this._tl) { this._tlUp(); return; }
    const d = this._drag;
    this._drag = null;
    if (!d || !d.started) return;
    this._justDragged = true;
    setTimeout(() => { this._justDragged = false; }, 60);
    this._cleanupDrag(d);
    if (d.data.t === "mapzone") { if (d.target) this._mapPlaceFromClient(d.data.z, d.cx, d.cy); return; }
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
    if (data.t === "dev") {
      if (target === "pool") return;
      data = { t: "zone", z: this._ensureZone(data.e).id, from: null };
    }
    if (data.t === "szone" && target === `steporder:${data.s}`) {
      const st = this._edit.steps[data.s];
      const order = this._stepOrder(st, this._group(st.group_id));
      let idx = index ?? order.length;
      const cur = order.indexOf(data.z);
      order.splice(cur, 1);
      if (cur < idx) idx -= 1;
      order.splice(idx, 0, data.z);
      st.order = order;
      this._dirty = true;
      this._render();
      return;
    }
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
      this._queueSave("layout");
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

Object.defineProperties(SkIrrigationPanel.prototype, Object.getOwnPropertyDescriptors(MapMixin));

if (!customElements.get("sk-irrigation-panel")) {
  customElements.define("sk-irrigation-panel", SkIrrigationPanel);
}
