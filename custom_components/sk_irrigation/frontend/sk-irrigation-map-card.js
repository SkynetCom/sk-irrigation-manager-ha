// SK Irrigation Manager — map card (view only).
// Loaded on demand by sk-irrigation-cards.js the first time a map card is
// shown, so dashboards without it never download Leaflet. It reuses the Map
// tab code through a small adapter that reads the shared card store.
import { I18N } from "./sk-irrigation-i18n.js?v=1.7.0";
import { MAP_STYLES } from "./sk-irrigation-styles.js?v=1.7.0";
import { MapMixin } from "./sk-irrigation-map.js?v=1.7.0";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const MAP_CARD_CSS = `
  :host {
    --ski-card: var(--ha-card-background, var(--card-background-color, #fff));
    --ski-text: var(--primary-text-color, #1b2733);
    --ski-muted: var(--secondary-text-color, #66727f);
    --ski-line: var(--divider-color, rgba(0,0,0,.09));
    --ski-primary: var(--primary-color, #03a9f4);
    --ski-green: #2e9e6b;
    --ski-amber: #f2a900;
  }
  ${MAP_STYLES}
  ha-card.map { padding: 0; }
  ha-card.map .hd { padding: 12px 14px 10px; margin: 0; flex-wrap: wrap; row-gap: 8px; }
  .mchips { display: flex; gap: 6px; flex-wrap: wrap; }
  .mchip { border: 1px solid var(--ski-line); background: transparent; color: var(--ski-text); border-radius: 99px; padding: 4px 11px;
    font: inherit; font-size: 12.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .mchip.on { background: var(--ski-primary); border-color: var(--ski-primary); color: var(--text-primary-color, #fff); }
  .mchip ha-icon { --mdc-icon-size: 15px; }
  .mchip.follow:not(.on) { color: var(--ski-muted); }
  .map-el { height: var(--ski-map-h, 360px); min-height: 0; }
  @media (max-width: 600px) { .map-el { height: min(var(--ski-map-h, 360px), 60vh); min-height: 0; } }
  .mstrip { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--ski-line); font-size: 13px; min-width: 0; }
  .mstrip ha-icon { --mdc-icon-size: 20px; color: var(--ski-muted); flex: none; }
  .mstrip.on ha-icon { color: var(--ski-green); }
  .mstrip .grow { flex: 1; min-width: 0; }
  .mstrip .ln { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mstrip .tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mstrip .bar { margin-top: 5px; }
  .map-legend { padding: 8px 14px; gap: 10px 14px; }
  .map-pop .small { font-size: 12.5px; }
  .map-pop .muted { color: #66727f; }
  .map-pop .st { display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; font-weight: 600; }
  .map-pop .st i { width: 12px; height: 9px; border-radius: 3px; border: 2px solid; display: inline-block; }
`;

// The Map tab code expects a panel; this adapter gives it the store's data.
export class SkMapView {
  constructor(card, store) {
    this.card = card;
    this.store = store;
    this._mapOptions = { scrollWheelZoom: false };
  }
  get shadowRoot() { return this.card.shadowRoot; }
  get _hass() { return this.card._hass; }
  get _config() { return this.store.config; }
  get _state() { return this.store.state; }
  get _zones() { return this.store.config?.zones || []; }
  get _lang() { return this.card._lang; }
  _zone(id) { return this._zones.find((z) => z.id === id); }
  _can() { return false; }
  _isOn(id) { return this.card._isOn(id); }
  _now() { return this.store.now(); }
  t(key, vars) {
    let s = (I18N[this._lang] || I18N.en)[key] ?? I18N.en[key] ?? key;
    if (vars && typeof s === "string") Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  }
  _render() { this.card._render(); }
  _tick() { this.card._tick(); }
  _fmtWhen(iso) { return this.card._when(iso); }
  _toast() {}
  _mapSaveSoon() {}
  _mapClick() {}

  // view only: a tap shows what the sprinkler is doing, with no controls
  _mapZoneClick(zid, partIndex, e) {
    const z = this._zone(zid);
    if (!z) return;
    const st = this._mapZoneStates()[zid]?.st || "idle";
    const stat = this._state?.zone_stats?.[zid];
    const lg = { on: "map_lg_on", next: "map_lg_next", done: "map_lg_done", queued: "map_lg_idle", off: "map_lg_off", idle: "map_lg_idle" }[st];
    const colors = { on: "#00e676", next: "#e08a00", done: "#2e9e6b", queued: "#1565c0", off: "#8a96a3", idle: "#1565c0" };
    const html = `<div class="map-pop"><b>${esc(z.name)}</b>
      <span class="st"><i style="border-color:${colors[st]}"></i>${this.t(lg)}</span>
      <div class="small muted">${this.t("last_watered")}: ${stat?.last ? this._fmtWhen(stat.last) : this.t("never")}</div></div>`;
    this._L.popup({ className: "ski-popup", maxWidth: 300, minWidth: 200 }).setLatLng(e.latlng).setContent(html).openOn(this._lmap);
  }

  // dashboard columns change width (sidebar, rotation, edit mode): keep the
  // photo fitted to the card until the viewer pans or zooms it
  _mapBuild(view, sig, imageUrl) {
    MapMixin._mapBuild.call(this, view, sig, imageUrl);
    const map = this._lmap;
    this._userMoved = false;
    map.on("dragstart", () => { this._userMoved = true; });
    map.on("zoomstart", () => { if (!this._fitting) this._userMoved = true; });
    if (!this._resizeObs && window.ResizeObserver) {
      let last = 0;
      this._resizeObs = new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (!w || Math.abs(w - last) < 2) return;
        last = w;
        this._mapFit();
      });
      this._resizeObs.observe(this._mapHost);
    }
  }

  _mapFit() {
    const map = this._lmap;
    if (!map) return;
    map.invalidateSize();
    if (!this._mapImage || this._userMoved || !this._mapDims) return;
    this._fitting = true;
    map.fitBounds(this._L.latLngBounds([0, 0], [this._mapDims.h, this._mapDims.w]), { animate: false });
    this._fitting = false;
  }

  // maps this card shows: one fixed map (by id or name) or all of them
  maps() {
    const all = this._config?.maps || [];
    const ref = String(this.card._config.map || "").trim().toLowerCase();
    if (!ref) return all;
    return all.filter((m) => m.id.toLowerCase() === ref || String(m.name || "").toLowerCase() === ref);
  }

  // the Map tab code always reads this._maps: limit it to the card's maps
  get _maps() { return this.maps(); }
}
Object.entries(Object.getOwnPropertyDescriptors(MapMixin)).forEach(([k, d]) => {
  // keep the adapter's own versions (view only, data from the store)
  if (!Object.prototype.hasOwnProperty.call(SkMapView.prototype, k)) Object.defineProperty(SkMapView.prototype, k, d);
});
