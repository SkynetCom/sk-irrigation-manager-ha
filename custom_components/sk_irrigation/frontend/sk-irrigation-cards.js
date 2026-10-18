// SK Irrigation Manager — Lovelace cards.
// Loaded globally by the integration (no manual resource needed). All cards on
// a dashboard share one websocket subscription through a tiny store.
const DOMAIN = "sk_irrigation";
const CARD_VERSION = "1.5.1";

const T = {
  es: {
    title: "Riego", programs: "Ciclos de riego", groups: "Grupos", zones: "Aspersores",
    st_idle: "En espera", st_running: "Regando", st_paused: "Pausado por condiciones", st_rain_delay: "Retraso por lluvia",
    st_disabled: "Sistema desactivado", remaining: "restante", next: "Próximo riego", none: "Sin riegos programados",
    step: "Paso", of: "de", skip: "Saltar", stop: "Detener", run: "Regar", run_now: "Regar ahora", system: "Sistema",
    rain_delay: "Retraso 24 h", clear_delay: "Quitar retraso", all_clear: "Condiciones OK", disabled: "Desactivado",
    running: "Regando", blocked: "No se ejecutaría", minutes: "min", queued: "En cola", not_run: "No se ejecutó",
    today: "Hoy", tomorrow: "Mañana", loading: "Cargando…", not_loaded: "SK Irrigation Manager no está cargado.",
    sprinklers: "aspersores", last: "Último", never: "Nunca", open_panel: "Abrir panel", min_each: "min c/u",
    rain_sensor: "Sensor de lluvia", weather: "Clima", freeze: "Helada", condition: "Condición",
  },
  en: {
    title: "Irrigation", programs: "Irrigation cycles", groups: "Groups", zones: "Sprinklers",
    st_idle: "Idle", st_running: "Watering", st_paused: "Paused by conditions", st_rain_delay: "Rain delay",
    st_disabled: "System disabled", remaining: "remaining", next: "Next run", none: "No scheduled runs",
    step: "Step", of: "of", skip: "Skip", stop: "Stop", run: "Water", run_now: "Run now", system: "System",
    rain_delay: "Delay 24 h", clear_delay: "Clear delay", all_clear: "Conditions OK", disabled: "Disabled",
    running: "Watering", blocked: "Would not run", minutes: "min", queued: "Queued", not_run: "Not run",
    today: "Today", tomorrow: "Tomorrow", loading: "Loading…", not_loaded: "SK Irrigation Manager is not loaded.",
    sprinklers: "sprinklers", last: "Last", never: "Never", open_panel: "Open panel", min_each: "min each",
    rain_sensor: "Rain sensor", weather: "Weather", freeze: "Frost", condition: "Condition",
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const fmtClock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
const fmtDur = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
};

const LABELS = {
  es: { title: "Título", show_controls: "Mostrar controles (sistema y retraso por lluvia)", show_run: "Botón regar ahora",
    show_disabled: "Mostrar ciclos desactivados", group: "Grupo (nombre o id, vacío = todos)", concurrency: "Aspersores a la vez (0 = todos)",
    minutes: "Minutos del riego manual", columns: "Columnas (vacío = automático)" },
  en: { title: "Title", show_controls: "Show controls (system and rain delay)", show_run: "Run now button",
    show_disabled: "Show disabled cycles", group: "Group (name or id, empty = all)", concurrency: "Sprinklers at once (0 = all)",
    minutes: "Manual run minutes", columns: "Columns (empty = auto)" },
};
const computeLabel = (s) => {
  const lang = (document.querySelector("home-assistant")?.hass?.language || navigator.language || "en").startsWith("es") ? "es" : "en";
  return LABELS[lang][s.name] || s.name;
};

// ------------------------------------------------------------------ store
class SkStore {
  constructor() { this.listeners = new Set(); this.config = null; this.state = null; this.skew = 0; }
  attach(hass) {
    this.hass = hass;
    if (!this.loading && !this.config) this._load();
  }
  async _load() {
    this.loading = true;
    try {
      const d = await this.hass.callWS({ type: `${DOMAIN}/data` });
      this.config = d.config;
      this._setState(d.state);
      this.error = null;
      this.hass.connection.subscribeMessage((m) => {
        if (m.config) this.config = m.config;
        if (m.state) this._setState(m.state);
        this._emit();
      }, { type: `${DOMAIN}/subscribe` });
    } catch (err) {
      this.error = err;
      setTimeout(() => { this.loading = false; this._load(); }, 15000);
    }
    this.loading = false;
    this._emit();
  }
  _setState(st) { this.state = st; this.skew = Date.parse(st.now) - Date.now(); }
  now() { return Date.now() + this.skew; }
  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  _emit() { this.listeners.forEach((cb) => cb()); }
  async action(action, extra = {}) {
    const res = await this.hass.callWS({ type: `${DOMAIN}/action`, action, ...extra });
    if (res?.state) { this._setState(res.state); this._emit(); }
    return res;
  }
  zone(id) { return this.config?.zones.find((z) => z.id === id); }
  group(id) { return this.config?.groups.find((g) => g.id === id); }
}
const store = window.__skIrrigationStore || (window.__skIrrigationStore = new SkStore());

const CSS = `
  :host { display: block; }
  ha-card { padding: 14px 16px 12px; overflow: hidden; }
  .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .hd ha-icon { color: var(--state-icon-color, var(--primary-color)); }
  .hd .t { flex: 1; font-size: 16px; font-weight: 600; }
  .pill { font-size: 12px; padding: 3px 10px; border-radius: 99px; background: rgba(127,127,127,.12); color: var(--secondary-text-color); white-space: nowrap; }
  .pill.running { background: color-mix(in srgb, #1e88e5 16%, transparent); color: #1e88e5; }
  .pill.paused, .pill.rain_delay { background: color-mix(in srgb, #f2a900 18%, transparent); color: #b07800; }
  .pill.disabled { background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #db4437); }
  .muted { color: var(--secondary-text-color); }
  .small { font-size: 12.5px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .wrap { flex-wrap: wrap; }
  .spacer { flex: 1; }
  .hero { display: flex; gap: 16px; align-items: center; }
  .ring { --p: 0; width: 84px; height: 84px; border-radius: 50%; flex: none; display: grid; place-items: center; position: relative;
    background: conic-gradient(#1e88e5 calc(var(--p) * 1%), rgba(127,127,127,.15) 0); }
  .ring::before { content: ""; position: absolute; inset: 7px; border-radius: 50%; background: var(--ha-card-background, var(--card-background-color, #fff)); }
  .ring > div { position: relative; text-align: center; line-height: 1.05; }
  .ring b { font-size: 17px; font-variant-numeric: tabular-nums; }
  .ring ha-icon { --mdc-icon-size: 36px; color: #1e88e5; }
  .name { font-size: 18px; font-weight: 600; }
  .bar { height: 5px; border-radius: 9px; background: rgba(127,127,127,.15); overflow: hidden; margin-top: 4px; }
  .bar > i { display: block; height: 100%; background: #1e88e5; border-radius: inherit; transition: width 1s linear; }
  .az { display: grid; grid-template-columns: 9px 1fr auto auto; gap: 8px; align-items: center; padding: 8px 0 0; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
  .tnum { font-variant-numeric: tabular-nums; }
  button.b { border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: transparent; color: var(--primary-text-color); border-radius: 9px;
    padding: 5px 11px; font: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  button.b:hover { background: rgba(127,127,127,.08); }
  button.b ha-icon { --mdc-icon-size: 17px; }
  button.b.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.b.danger { background: var(--error-color, #db4437); border-color: var(--error-color, #db4437); color: #fff; }
  button.i { border: 0; background: none; padding: 6px; border-radius: 50%; cursor: pointer; color: var(--secondary-text-color); display: inline-flex; }
  button.i:hover { background: rgba(127,127,127,.12); color: var(--primary-text-color); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .badge { display: inline-flex; gap: 4px; align-items: center; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
  .badge.amber { background: color-mix(in srgb, #f2a900 18%, transparent); color: #b07800; }
  .badge.green { background: color-mix(in srgb, #2e9e6b 15%, transparent); color: #2e9e6b; }
  .badge.blue { background: color-mix(in srgb, #1e88e5 15%, transparent); color: #1e88e5; }
  .badge ha-icon { --mdc-icon-size: 13px; }
  .reasons { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 10px; }
  .list-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--divider-color, rgba(0,0,0,.08)); }
  .list-row:first-child { border-top: 0; }
  .grow { flex: 1; min-width: 0; }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .switch { position: relative; width: 36px; height: 20px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .switch span { position: absolute; inset: 0; border-radius: 99px; background: rgba(127,127,127,.35); cursor: pointer; transition: .2s; }
  .switch span::after { content: ""; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: .2s; }
  .switch input:checked + span { background: #2e9e6b; }
  .switch input:checked + span::after { transform: translateX(16px); }
  .grps { display: grid; gap: 10px; align-items: start; }
  .grp { border: 1px solid var(--divider-color, rgba(0,0,0,.1)); border-left: 4px solid var(--c); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .zc { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 3px 9px; border-radius: 99px; border: 1px solid var(--divider-color, rgba(0,0,0,.1)); }
  .zc.on { background: #1e88e5; border-color: #1e88e5; color: #fff; }
  .zc.on .dot { background: #fff !important; }
  .mins { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
  .tile { border: 1px solid var(--divider-color, rgba(0,0,0,.1)); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; border-left: 4px solid var(--c); }
  .tile.on { background: color-mix(in srgb, #1e88e5 10%, transparent); }
  .tile { min-width: 0; }
  .tile .nm { font-weight: 600; font-size: 13.5px; min-height: 2.5em; }
  .on-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(127,127,127,.4); }
  .on-dot.on { background: #1e88e5; box-shadow: 0 0 0 3px color-mix(in srgb, #1e88e5 25%, transparent); }
  .empty { color: var(--secondary-text-color); text-align: center; padding: 12px 0; font-size: 13.5px; }
  .toast { margin-top: 8px; font-size: 12.5px; color: var(--secondary-text-color); }
`;

// ------------------------------------------------------------------ base
class SkBaseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this.shadowRoot.addEventListener("change", (e) => this._change(e));
  }
  setConfig(config) { this._config = config || {}; this._render(); }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._lang = (hass.language || "en").startsWith("es") ? "es" : "en";
    store.attach(hass);
    if (first) this._render(); else this._liveStates();
  }
  t(k) { return (T[this._lang] || T.en)[k] ?? T.en[k] ?? k; }
  connectedCallback() {
    this._unsub = store.subscribe(() => this._render());
    this._timer = setInterval(() => this._tick(), 1000);
    this._render();
  }
  disconnectedCallback() { this._unsub?.(); clearInterval(this._timer); }
  getCardSize() { return 3; }
  _isOn(id) { const s = this._hass?.states[id]; return !!s && ["on", "open", "opening"].includes(s.state); }
  _when(iso) {
    if (!iso) return "—";
    const d = new Date(iso), now = new Date(store.now());
    const tm = d.toLocaleTimeString(this._hass.language, { hour: "2-digit", minute: "2-digit" });
    const diff = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 86400000);
    if (diff === 0) return `${this.t("today")} ${tm}`;
    if (diff === 1) return `${this.t("tomorrow")} ${tm}`;
    return `${d.toLocaleDateString(this._hass.language, { weekday: "short", day: "numeric", month: "short" })} ${tm}`;
  }
  _reason(r) {
    const i = r.indexOf(":");
    const k = i < 0 ? r : r.slice(0, i), v = i < 0 ? "" : r.slice(i + 1);
    if (k === "condition") return v;
    if (k === "rain_sensor") return `${this.t("rain_sensor")}: ${this._hass.states[v]?.attributes.friendly_name || v}`;
    if (k === "weather") return `${this.t("weather")}: ${v}`;
    if (k === "freeze") return `${this.t("freeze")}: ${v}`;
    return this.t(`st_${k}`) !== `st_${k}` ? this.t(`st_${k}`) : r;
  }
  _render() {
    if (!this._hass || !this._config) return;
    let body;
    if (store.error && !store.config) body = `<div class="empty">${this.t("not_loaded")}</div>`;
    else if (!store.config || !store.state) body = `<div class="empty">${this.t("loading")}</div>`;
    else body = this.body();
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>${body}${this._msg ? `<div class="toast">${esc(this._msg)}</div>` : ""}</ha-card>`;
    this._tick();
  }
  _liveStates() {
    this.shadowRoot.querySelectorAll("[data-entity]").forEach((el) => el.classList.toggle("on", this._isOn(el.dataset.entity)));
  }
  _tick() {
    const now = store.now();
    this.shadowRoot.querySelectorAll("[data-end]").forEach((el) => {
      const end = Date.parse(el.dataset.end), start = Date.parse(el.dataset.start);
      const pct = Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
      if (el.dataset.mode === "clock") el.textContent = fmtClock((end - now) / 1000);
      else if (el.dataset.mode === "bar") el.style.width = `${pct}%`;
      else el.style.setProperty("--p", pct.toFixed(1));
    });
  }
  async _run(action, extra) {
    try {
      const res = await store.action(action, extra);
      this._flash(res?.blocked ? `${this.t("not_run")}: ${res.blocked.map((r) => this._reason(r)).join(", ")}`
        : res?.run && store.state.current?.id !== res.run.id ? this.t("queued") : "");
    } catch (err) { this._flash(err.message || String(err)); }
  }
  _flash(msg) {
    this._msg = msg;
    this._render();
    clearTimeout(this._msgT);
    if (msg) this._msgT = setTimeout(() => { this._msg = ""; this._render(); }, 5000);
  }
  _click() {}
  _change() {}
  _cols(fallbackMin) {
    const n = Math.round(Number(this._config.columns) || 0);
    return n > 0 ? `grid-template-columns:repeat(${Math.min(n, 12)},minmax(0,1fr))` : `grid-template-columns:repeat(auto-fill,minmax(${fallbackMin}px,1fr))`;
  }
  header(icon, title, extra = "") {
    return `<div class="hd"><ha-icon icon="${icon}"></ha-icon><span class="t">${esc(title)}</span>${extra}</div>`;
  }
}

// ------------------------------------------------------------------ status card
class SkStatusCard extends SkBaseCard {
  static getStubConfig() { return { show_controls: true }; }
  static getConfigForm() {
    return { computeLabel, schema: [
      { name: "title", selector: { text: {} } },
      { name: "show_controls", selector: { boolean: {} } },
    ] };
  }
  getCardSize() { return 4; }
  body() {
    const st = store.state, s = store.config.settings, cur = st.current;
    const pill = `<span class="pill ${st.status}">${this.t(`st_${st.status}`)}</span>`;
    let html = this.header("mdi:sprinkler-variant", this._config.title || this.t("title"), pill);
    if (cur) {
      html += `<div class="hero">
        <div class="ring" data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="ring"><div>
          <b data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="clock"></b><div class="small muted">${this.t("remaining")}</div></div></div>
        <div class="grow"><div class="name ellipsis">${esc(cur.name)}</div>
          <div class="small muted">${this.t("step")} ${cur.step_index + 1} ${this.t("of")} ${cur.steps.length} · ${cur.zones} ${this.t("sprinklers")}</div></div></div>
        ${cur.active.map((a) => {
          const z = store.zone(a.zone_id) || { name: a.entity_id, color: "#1e88e5" };
          return `<div class="az"><span class="dot" style="background:${esc(z.color)}"></span>
            <div class="grow"><div class="ellipsis small"><b>${esc(z.name)}</b></div><div class="bar"><i data-start="${a.started}" data-end="${a.ends}" data-mode="bar"></i></div></div>
            <span class="tnum small" data-start="${a.started}" data-end="${a.ends}" data-mode="clock"></span>
            <button class="i" title="${this.t("skip")}" data-a="skip" data-id="${a.zone_id}"><ha-icon icon="mdi:skip-next"></ha-icon></button></div>`;
        }).join("")}
        <div class="actions"><button class="b" data-a="skip"><ha-icon icon="mdi:skip-next"></ha-icon>${this.t("skip")}</button>
          <button class="b danger" data-a="stop"><ha-icon icon="mdi:stop"></ha-icon>${this.t("stop")}</button></div>`;
    } else {
      const nxt = st.next;
      html += `<div class="hero"><div class="ring"><div><ha-icon icon="mdi:sprinkler-variant"></ha-icon></div></div>
        <div class="grow"><div class="small muted">${this.t("next")}</div>
          <div class="name ellipsis">${nxt ? esc(nxt.name) : this.t("none")}</div>
          ${nxt ? `<div class="small">${this._when(nxt.at)} · ${fmtDur(st.program_estimates?.[nxt.program_id])}</div>` : ""}</div>
        ${nxt ? `<button class="b primary" data-a="run" data-id="${nxt.program_id}"><ha-icon icon="mdi:play"></ha-icon>${this.t("run_now")}</button>` : ""}</div>`;
    }
    const reasons = st.blocking.filter((r) => r !== "system_disabled");
    html += `<div class="reasons">${reasons.length
      ? reasons.map((r) => `<span class="badge amber"><ha-icon icon="mdi:alert-outline"></ha-icon>${esc(this._reason(r))}</span>`).join("")
      : `<span class="badge green"><ha-icon icon="mdi:check"></ha-icon>${this.t("all_clear")}</span>`}</div>`;
    if (this._config.show_controls !== false) {
      const delay = s.rain_delay_until && Date.parse(s.rain_delay_until) > store.now();
      html += `<div class="actions" style="align-items:center">
        <label class="row small"><span class="switch"><input type="checkbox" data-c="system" ${s.enabled ? "checked" : ""}><span></span></span>${this.t("system")}</label>
        <span class="spacer"></span>
        <button class="b" data-a="delay" data-h="${delay ? 0 : 24}"><ha-icon icon="mdi:weather-pouring"></ha-icon>${this.t(delay ? "clear_delay" : "rain_delay")}</button></div>`;
    }
    return html;
  }
  _click(e) {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    const a = el.dataset.a;
    if (a === "skip") this._run("skip", el.dataset.id ? { target: el.dataset.id } : {});
    else if (a === "stop") this._run("stop");
    else if (a === "run") this._run("run_program", { target: el.dataset.id });
    else if (a === "delay") this._run("rain_delay", { hours: Number(el.dataset.h) });
  }
  _change(e) {
    if (e.target.dataset.c === "system") this._run("set_enabled", { enabled: e.target.checked });
  }
}

// ------------------------------------------------------------------ programs card
class SkProgramsCard extends SkBaseCard {
  static getStubConfig() { return { show_run: true }; }
  static getConfigForm() {
    return { computeLabel, schema: [
      { name: "title", selector: { text: {} } },
      { name: "show_run", selector: { boolean: {} } },
      { name: "show_disabled", selector: { boolean: {} } },
    ] };
  }
  getCardSize() { return 1 + (store.config?.programs.length || 2); }
  body() {
    const st = store.state;
    let progs = store.config.programs;
    if (this._config.show_disabled === false) progs = progs.filter((p) => p.enabled);
    return this.header("mdi:calendar-clock", this._config.title || this.t("programs")) + (progs.length ? progs.map((p) => {
      const running = st.current?.program_id === p.id;
      const blocks = st.program_blocks?.[p.id] || [];
      const times = p.start_times.map((s) => (s.type === "fixed" ? s.time : `${s.type === "sunrise" ? "☀︎↑" : "☀︎↓"}${s.offset ? ` ${s.offset > 0 ? "+" : ""}${s.offset}′` : ""}`)).join(" · ");
      return `<div class="list-row"><span class="dot" style="background:${esc(p.color)}"></span>
        <div class="grow"><div class="ellipsis"><b>${esc(p.name)}</b> ${running ? `<span class="badge blue">${this.t("running")}</span>` : ""}</div>
          <div class="small muted ellipsis">${esc(times)} · ${fmtDur(st.program_estimates?.[p.id])} · ${p.enabled ? this._when(st.next_runs[p.id]) : this.t("disabled")}</div>
          ${blocks.length ? `<div class="small" style="color:#b07800">⚠ ${this.t("blocked")}: ${esc(blocks.map((r) => this._reason(r)).join(", "))}</div>` : ""}</div>
        <label class="switch"><input type="checkbox" data-c="prog" data-id="${p.id}" ${p.enabled ? "checked" : ""}><span></span></label>
        ${this._config.show_run !== false ? `<button class="i" title="${this.t("run_now")}" data-a="run" data-id="${p.id}"><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>` : ""}
      </div>`;
    }).join("") : `<div class="empty">${this.t("none")}</div>`);
  }
  _click(e) {
    const el = e.target.closest("[data-a=run]");
    if (el) this._run("run_program", { target: el.dataset.id });
  }
  _change(e) {
    if (e.target.dataset.c === "prog") this._run("set_program_enabled", { target: e.target.dataset.id, enabled: e.target.checked });
  }
}

// ------------------------------------------------------------------ groups card
class SkGroupsCard extends SkBaseCard {
  static getStubConfig() { return { minutes: [5, 10, 15] }; }
  static getConfigForm() {
    return { computeLabel, schema: [
      { name: "title", selector: { text: {} } },
      { name: "group", selector: { text: {} } },
      { name: "columns", selector: { number: { min: 1, max: 6, mode: "box" } } },
      { name: "concurrency", selector: { number: { min: 0, max: 8, mode: "box" } } },
    ] };
  }
  getCardSize() { return 2 + (store.config?.groups.length || 2) * 2; }
  body() {
    let groups = store.config.groups;
    if (this._config.group) {
      const ref = String(this._config.group).toLowerCase();
      groups = groups.filter((g) => g.id === this._config.group || g.name.toLowerCase() === ref);
    }
    const mins = this._config.minutes || [5, 10, 15];
    const cols = Number(this._config.columns) > 1;
    return this.header("mdi:vector-arrange-below", this._config.title || this.t("groups")) + (groups.length ? `<div class="grps" style="${cols ? this._cols(240) : "grid-template-columns:1fr"}">` + groups.map((g) => {
      const zones = g.zone_ids.map((z) => store.zone(z)).filter(Boolean);
      const open = this._open === g.id;
      return `<div class="grp" style="--c:${esc(g.color)}">
        <div class="row"><b class="grow clamp2" title="${esc(g.name)}">${esc(g.name)}</b><span class="small muted">${zones.length} ${this.t("sprinklers")}</span>
          <button class="i" title="${this.t("run")}" data-a="toggle" data-id="${g.id}"><ha-icon icon="${open ? "mdi:close" : "mdi:play-circle-outline"}"></ha-icon></button></div>
        <div class="chips">${zones.map((z) => `<span class="zc ${this._isOn(z.entity_id) ? "on" : ""}" data-entity="${esc(z.entity_id || "")}"><span class="dot" style="background:${esc(z.color)}"></span>${esc(z.name)}</span>`).join("")}</div>
        ${open ? `<div class="mins"><span class="small muted">${this.t("run")}:</span>${mins.map((m) => `<button class="b" data-a="rungroup" data-id="${g.id}" data-m="${m}">${m} ${this.t("min_each")}</button>`).join("")}</div>` : ""}
      </div>`;
    }).join("") + "</div>" : `<div class="empty">—</div>`);
  }
  _click(e) {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    if (el.dataset.a === "toggle") { this._open = this._open === el.dataset.id ? null : el.dataset.id; this._render(); }
    if (el.dataset.a === "rungroup") {
      this._open = null;
      this._run("run_group", { target: el.dataset.id, minutes: Number(el.dataset.m), concurrency: Number(this._config.concurrency ?? 1) });
    }
  }
  _liveStates() {
    this.shadowRoot.querySelectorAll("[data-entity]").forEach((el) => el.classList.toggle("on", this._isOn(el.dataset.entity)));
  }
}

// ------------------------------------------------------------------ sprinklers card
class SkZonesCard extends SkBaseCard {
  static getStubConfig() { return { minutes: 5 }; }
  static getConfigForm() {
    return { computeLabel, schema: [
      { name: "title", selector: { text: {} } },
      { name: "group", selector: { text: {} } },
      { name: "columns", selector: { number: { min: 1, max: 12, mode: "box" } } },
      { name: "minutes", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "min" } } },
    ] };
  }
  getCardSize() { return 2 + Math.ceil((store.config?.zones.length || 4) / 3) * 2; }
  body() {
    let zones = store.config.zones;
    if (this._config.group) {
      const ref = String(this._config.group).toLowerCase();
      const g = store.config.groups.find((x) => x.id === this._config.group || x.name.toLowerCase() === ref);
      zones = g ? g.zone_ids.map((z) => store.zone(z)).filter(Boolean) : [];
    }
    const stats = store.state.zone_stats || {};
    const mins = Number(this._config.minutes) || 5;
    return this.header("mdi:sprinkler", this._config.title || this.t("zones")) + (zones.length ? `<div class="tiles" style="${this._cols(130)}">${zones.map((z) => {
      const s = stats[z.id];
      return `<div class="tile ${this._isOn(z.entity_id) ? "on" : ""}" style="--c:${esc(z.color)}" data-entity="${esc(z.entity_id || "")}">
        <div class="row" style="align-items:flex-start"><span class="nm grow clamp2" title="${esc(z.name)}">${esc(z.name)}</span><span class="on-dot ${this._isOn(z.entity_id) ? "on" : ""}" data-entity="${esc(z.entity_id || "")}"></span></div>
        <div class="small muted ellipsis">${this.t("last")}: ${s?.last ? this._when(s.last) : this.t("never")}</div>
        <button class="b" data-a="run" data-id="${z.id}" ${z.enabled && z.entity_id ? "" : "disabled"}><ha-icon icon="mdi:play"></ha-icon>${mins} ${this.t("minutes")}</button></div>`;
    }).join("")}</div>` : `<div class="empty">—</div>`);
  }
  _click(e) {
    const el = e.target.closest("[data-a=run]");
    if (el) this._run("run_zone", { target: el.dataset.id, minutes: Number(this._config.minutes) || 5 });
  }
}

// The card picker is built before the cards get `hass`, so follow the page language.
const PICKER_ES = (document.documentElement.lang || navigator.language || "").startsWith("es");
const CARDS = PICKER_ES ? [
  ["sk-irrigation-status-card", SkStatusCard, "SK Riego · Estado", "Riego en curso, próximo riego, condiciones y controles rápidos."],
  ["sk-irrigation-programs-card", SkProgramsCard, "SK Riego · Ciclos", "Programas/ciclos con próximo riego, duración, activar y regar ahora."],
  ["sk-irrigation-groups-card", SkGroupsCard, "SK Riego · Grupos", "Grupos con sus aspersores en vivo y riego rápido del grupo."],
  ["sk-irrigation-zones-card", SkZonesCard, "SK Riego · Aspersores", "Grilla de aspersores con estado en vivo y riego manual."],
] : [
  ["sk-irrigation-status-card", SkStatusCard, "SK Irrigation · Status", "Current run, next run, conditions and quick controls."],
  ["sk-irrigation-programs-card", SkProgramsCard, "SK Irrigation · Programs", "Programs/cycles with next run, duration, enable and run now."],
  ["sk-irrigation-groups-card", SkGroupsCard, "SK Irrigation · Groups", "Groups with their live sprinklers and quick group watering."],
  ["sk-irrigation-zones-card", SkZonesCard, "SK Irrigation · Sprinklers", "Sprinkler grid with live state and manual watering."],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({ type: tag, name, description, preview: true,
      documentationURL: PICKER_ES
        ? "https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/README.es.md#-tarjetas-para-dashboards"
        : "https://github.com/SkynetCom/sk-irrigation-manager-ha#-dashboard-cards" });
  }
}
console.info(`%c SK-IRRIGATION-CARDS %c ${CARD_VERSION} `, "background:#1257c4;color:#fff;font-weight:700", "background:#2e9e6b;color:#fff");
