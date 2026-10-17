// SK Irrigation Manager — "Map" tab.
// Each map view has a background (an uploaded drone photo / site plan, or
// satellite imagery) and one or more outlines per sprinkler. The Leaflet map
// lives in a persistent element that the panel re-attaches after each render,
// so live updates only toggle classes instead of rebuilding the map.

const LEAFLET_VERSION = "1.9.4";
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";
const UPLOAD_URL = "/api/sk_irrigation/map_image";
const FILES_PREFIX = "/sk_irrigation_files/";
const MAX_IMAGE_SIDE = 4096;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attr = (o) => esc(JSON.stringify(o));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

let leafletPromise = null;
let leafletCss = null;

function loadLeaflet() {
  if (window.L?.map && window.L?.CRS) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = new URL(`./vendor/leaflet.js?v=${LEAFLET_VERSION}`, import.meta.url).href;
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error("Leaflet could not be loaded")); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

function loadLeafletCss() {
  if (!leafletCss) {
    leafletCss = fetch(new URL(`./vendor/leaflet.css?v=${LEAFLET_VERSION}`, import.meta.url).href)
      .then((r) => r.text()).catch(() => "");
  }
  return leafletCss;
}

// Downscale big drone photos in the browser before uploading them.
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.86));
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function polygonArea(pts) {
  let a = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; });
  return Math.abs(a / 2);
}

export const MapMixin = {
  // ------------------------------------------------------------ data
  get _maps() { return this._config?.maps || (this._config ? (this._config.maps = []) : []); },

  _mapView() {
    const maps = this._maps;
    let v = maps.find((m) => m.id === this._mapId);
    if (!v) { v = maps[0] || null; this._mapId = v?.id || null; }
    return v;
  },

  _mapSaveSoon() { this._queueSave("maps"); },

  // live state of every sprinkler: on / next / done / queued (in this run) / off / idle
  _mapZoneStates() {
    const out = {};
    const cur = this._state?.current;
    if (cur) {
      const order = cur.steps.flatMap((s) => s.zones.map((z) => z.zone_id));
      const done = new Set((cur.done || []).map((d) => d.zone_id));
      const active = Object.fromEntries((cur.active || []).map((a) => [a.zone_id, a]));
      const next = order.find((z) => !done.has(z) && !active[z]);
      const inRun = new Set(order);
      this._zones.forEach((z) => {
        if (active[z.id]) out[z.id] = { st: "on", started: active[z.id].started, ends: active[z.id].ends };
        else if (done.has(z.id)) out[z.id] = { st: "done" };
        else if (z.id === next) out[z.id] = { st: "next" };
        else if (inRun.has(z.id)) out[z.id] = { st: "queued" };
        else out[z.id] = { st: "off" };
      });
    } else {
      this._zones.forEach((z) => {
        const s = z.entity_id && this._hass.states[z.entity_id];
        out[z.id] = this._isOn(z.entity_id) ? { st: "on", started: s?.last_changed, manual: true } : { st: "idle" };
      });
    }
    return out;
  },

  // ------------------------------------------------------------ html
  _render_map() {
    const can = this._can();
    const maps = this._maps;
    const view = this._mapView();
    const states = this._mapZoneStates();
    const editing = this._mapEdit && can && view;
    const chips = maps.map((m) => {
      const live = Object.keys(m.shapes || {}).some((z) => states[z]?.st === "on");
      return `<button class="chip ${m.id === view?.id ? "on" : ""}" data-action="map-view" data-id="${m.id}">
        ${live ? `<span class="live-dot"></span>` : `<ha-icon icon="${m.kind === "satellite" ? "mdi:satellite-variant" : "mdi:image-outline"}" style="--mdc-icon-size:16px"></ha-icon>`}${esc(m.name)}</button>`;
    }).join("");
    if (!view) {
      return `<div class="card"><div class="empty map-empty">
        <ha-icon icon="mdi:map-marker-radius-outline"></ha-icon>
        <h2>${this.t("map_empty_title")}</h2><p class="hint">${this.t("map_empty_text")}</p>
        ${can ? `<div class="row wrap" style="justify-content:center">
          <button class="btn primary" data-action="map-new" data-kind="image"><ha-icon icon="mdi:image-plus"></ha-icon>${this.t("map_new_image")}</button>
          <button class="btn" data-action="map-new" data-kind="satellite"><ha-icon icon="mdi:satellite-variant"></ha-icon>${this.t("map_new_satellite")}</button></div>` : ""}
      </div></div>`;
    }
    const placed = new Set(Object.keys(view.shapes || {}));
    const unplaced = this._zones.filter((z) => !placed.has(z.id));
    return `<div class="grid cols-main map-layout">
      <div class="card map-card">
        <div class="map-bar">
          <div class="chips">${chips}
            ${can ? `<button class="chip add" data-action="map-new" data-kind="image" title="${this.t("map_add")}"><ha-icon icon="mdi:plus" style="--mdc-icon-size:16px"></ha-icon>${this.t("map_add")}</button>` : ""}</div>
          <span class="spacer"></span>
          ${can ? `<button class="btn sm ${editing ? "primary" : ""}" data-action="map-edit"><ha-icon icon="${editing ? "mdi:check" : "mdi:vector-polygon"}"></ha-icon>${editing ? this.t("map_done") : this.t("map_edit")}</button>` : ""}
        </div>
        ${editing ? `<div class="map-hint">${this.t("map_edit_hint")}</div>` : ""}
        <div id="ski-map-slot" class="map-slot" data-drop="map" data-accept="mapzone"></div>
        ${editing ? `<div class="map-tray"><span class="small muted">${unplaced.length ? this.t("map_unplaced") : this.t("map_all_placed")}</span>
          ${unplaced.map((z) => `<span class="zchip mini" data-drag="${attr({ t: "mapzone", z: z.id })}" data-action="map-place" data-id="${z.id}" title="${this.t("map_place_tip")}">
            <span class="swatch" style="background:${esc(z.color)}"></span>${esc(z.name)}</span>`).join("")}</div>` : ""}
        <div class="map-legend">
          <span><i class="lg on"></i>${this.t("map_lg_on")}</span><span><i class="lg next"></i>${this.t("map_lg_next")}</span>
          <span><i class="lg done"></i>${this.t("map_lg_done")}</span><span><i class="lg idle"></i>${this.t("map_lg_idle")}</span>
          <span><i class="lg off"></i>${this.t("map_lg_off")}</span>
        </div>
      </div>
      <div class="stack" style="gap:16px">
        ${editing ? this._mapSettingsHtml(view) : ""}
        ${editing && this._mapSel && view.shapes?.[this._mapSel] ? this._mapSelHtml(view) : ""}
        ${this._mapRunHtml(view, states)}
      </div>
    </div>`;
  },

  _mapSettingsHtml(view) {
    const image = view.kind === "image";
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:map-outline"></ha-icon>${this.t("map_settings")}</h2></div><div class="bd stack">
      <label class="field"><span>${this.t("map_name")}</span><input type="text" value="${esc(view.name)}" data-bind="map:name"></label>
      <div class="field"><span>${this.t("map_background")}</span><div class="seg">
        <button class="${image ? "on" : ""}" data-action="map-kind" data-id="image"><ha-icon icon="mdi:image-outline"></ha-icon>${this.t("map_bg_image")}</button>
        <button class="${image ? "" : "on"}" data-action="map-kind" data-id="satellite"><ha-icon icon="mdi:satellite-variant"></ha-icon>${this.t("map_bg_satellite")}</button></div></div>
      ${image ? `<label class="btn"><ha-icon icon="mdi:upload"></ha-icon>${view.image ? this.t("map_replace_image") : this.t("map_upload_image")}
          <input type="file" accept="image/*" data-bind="map-image" hidden></label>
        <p class="hint" style="margin:0">${this.t("map_image_hint")}</p>`
      : `<label class="field"><span>${this.t("map_detail")}</span><select data-bind="map:max_native_zoom">
          ${[16, 17, 18, 19, 20].map((z) => `<option value="${z}" ${view.max_native_zoom === z ? "selected" : ""}>${z}</option>`).join("")}</select></label>
        <p class="hint" style="margin:0">${this.t("map_detail_hint")}</p>
        <button class="btn" data-action="map-center"><ha-icon icon="mdi:crop-free"></ha-icon>${this.t("map_save_view")}</button>`}
      <button class="btn danger" data-action="map-delete"><ha-icon icon="mdi:delete-outline"></ha-icon>${this.t("map_delete")}</button>
    </div></div>`;
  },

  _mapSelHtml(view) {
    const z = this._zone(this._mapSel);
    const parts = view.shapes[this._mapSel] || [];
    return `<div class="card"><div class="hd"><h2><span class="swatch" style="background:${esc(z?.color)}"></span>${esc(z?.name || "")}</h2>
      <button class="btn icon" data-action="map-unselect" title="${this.t("close")}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="bd stack">
      ${parts.map((p, i) => `<div class="list-row"><ha-icon icon="mdi:vector-polygon" style="--mdc-icon-size:18px;color:var(--ski-muted)"></ha-icon>
        <span style="flex:1">${this.t("map_area")} ${i + 1} · ${p.length} ${this.t("map_points")}</span>
        <button class="btn icon" data-action="map-part-del" data-n="${i}" title="${this.t("delete")}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
      <button class="btn" data-action="map-part-add"><ha-icon icon="mdi:shape-polygon-plus"></ha-icon>${this.t("map_add_area")}</button>
      <p class="hint" style="margin:0">${this.t("map_sel_hint")}</p>
    </div></div>`;
  },

  _mapRunHtml(view, states) {
    const cur = this._state?.current;
    const zones = Object.fromEntries(this._zones.map((z) => [z.id, z]));
    const onMap = new Set(Object.keys(view.shapes || {}));
    if (!cur) {
      const nxt = this._state?.next;
      const manual = this._zones.filter((z) => states[z.id]?.st === "on");
      return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:water-outline"></ha-icon>${this.t(`st_${this._state?.status || "idle"}`)}</h2></div><div class="bd stack">
        ${manual.map((z) => `<div class="list-row run-row on"><span class="swatch" style="background:${esc(z.color)}"></span><b style="flex:1">${esc(z.name)}</b>
          <span class="small tnum" data-start="${esc(states[z.id].started || "")}" data-mode="elapsed"></span></div>`).join("")}
        <div class="muted">${nxt ? `${this.t("next_run")}: <b>${esc(nxt.name)}</b> · ${this._fmtWhen(nxt.at)}` : this.t("no_next_run")}</div>
        <div class="small muted">${this.t("map_placed_count", { n: onMap.size, m: this._zones.length })}</div>
      </div></div>`;
    }
    const order = cur.steps.flatMap((s) => s.zones);
    return `<div class="card"><div class="hd"><h2><ha-icon icon="mdi:water"></ha-icon>${this.t("now_watering")}</h2></div>
      <div class="bd"><b class="run-name">${esc(cur.name)}</b>
        <div class="bar" style="margin:8px 0 4px"><i data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="bar"></i></div>
        <div class="small muted">${this.t("remaining")}: <span data-start="${cur.started}" data-end="${cur.planned_end}" data-mode="clock"></span></div></div>
      <div class="run-list">${order.map((o, i) => {
        const s = states[o.zone_id] || {};
        const z = zones[o.zone_id];
        const right = s.st === "on" ? `<span class="tnum" data-start="${s.started}" data-end="${s.ends}" data-mode="clock"></span>`
          : s.st === "done" ? `✓ ${Math.round(o.seconds / 60)} min` : `${Math.round(o.seconds / 60)} min`;
        return `<div class="run-row ${s.st}" ${onMap.has(o.zone_id) ? `data-action="map-focus" data-id="${o.zone_id}"` : ""}>
          <span class="n">${i + 1}</span><span class="nm">${esc(z?.name || o.zone_id)}</span>
          ${onMap.has(o.zone_id) ? "" : `<ha-icon icon="mdi:map-marker-off-outline" title="${this.t("map_not_on_map")}" style="--mdc-icon-size:15px;color:var(--ski-muted)"></ha-icon>`}
          <span class="t">${right}</span></div>`;
      }).join("")}</div></div>`;
  },

  // ------------------------------------------------------------ leaflet lifecycle
  async _mapAttach() {
    const slot = this.shadowRoot.getElementById("ski-map-slot");
    if (!slot) return;
    if (!this._mapHost) {
      this._mapHost = document.createElement("div");
      this._mapHost.className = "map-host";
      this._mapHost.innerHTML = `<style></style><div class="map-el"></div><div class="map-overlay"></div>`;
    }
    slot.appendChild(this._mapHost);
    let L;
    try {
      // the stylesheet must be in place before Leaflet measures tooltips and panes
      const [lib, css] = await Promise.all([loadLeaflet(), loadLeafletCss()]);
      L = lib;
      if (!this._mapHost.firstElementChild.textContent) this._mapHost.firstElementChild.textContent = css;
    } catch (err) {
      this._mapHost.querySelector(".map-overlay").innerHTML = `<div class="map-msg">${esc(err.message)}</div>`;
      return;
    }
    if (!this._mapHost.isConnected) return;
    this._L = L;
    const view = this._mapView();
    if (!view) return;
    const sig = [view.id, view.kind, view.image, view.image_w, view.image_h, view.max_native_zoom].join("|");
    if (!this._lmap || this._mapSig !== sig) this._mapBuild(view, sig);
    else this._lmap.invalidateSize();
    this._mapDrawShapes();
    this._mapOverlay(view);
  },

  _mapBuild(view, sig) {
    const L = this._L;
    if (this._lmap) { this._lmap.remove(); this._lmap = null; }
    const el = this._mapHost.querySelector(".map-el");
    el.innerHTML = "";
    this._mapSig = sig;
    this._mapImage = view.kind === "image";
    if (this._mapImage) {
      const w = view.image_w || 1000;
      const h = view.image_h || 700;
      this._mapDims = { w, h };
      const bounds = L.latLngBounds([0, 0], [h, w]);
      const map = L.map(el, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5,
        attributionControl: false, maxBounds: bounds.pad(0.3) });
      if (view.image) L.imageOverlay(view.image, bounds).addTo(map);
      map.fitBounds(bounds);
      this._lmap = map;
    } else {
      const center = view.center || [this._hass.config?.latitude ?? 0, this._hass.config?.longitude ?? 0];
      const map = L.map(el, { maxZoom: 21 }).setView(center, view.zoom || 18);
      L.tileLayer(SATELLITE_URL, { maxNativeZoom: view.max_native_zoom || 18, maxZoom: 21, attribution: SATELLITE_ATTRIBUTION }).addTo(map);
      this._lmap = map;
    }
    this._lmap.on("click", (e) => this._mapClick(e));
    this._mapLayers = {};
    this._mapHandles = null;
    this._mapLiveKey = null;
    setTimeout(() => this._lmap?.invalidateSize(), 50);
  },

  _mapOverlay(view) {
    const ov = this._mapHost.querySelector(".map-overlay");
    if (view.kind === "image" && !view.image) {
      ov.innerHTML = `<div class="map-msg"><ha-icon icon="mdi:image-plus"></ha-icon><b>${this.t("map_no_image")}</b>
        ${this._can() ? `<label class="btn primary"><ha-icon icon="mdi:upload"></ha-icon>${this.t("map_upload_image")}
          <input type="file" accept="image/*" data-bind="map-image" hidden></label>` : ""}</div>`;
    } else if (this._mapPlacing) {
      ov.innerHTML = `<div class="map-banner">${this.t("map_placing", { name: esc(this._zone(this._mapPlacing)?.name || "") })}
        <button class="btn sm" data-action="map-place-cancel">${this.t("cancel")}</button></div>`;
    } else ov.innerHTML = "";
  },

  // coordinates: image maps store [y, x] as 0..1 fractions (top-left origin), satellite maps [lat, lon]
  _toLatLng(p) {
    if (!this._mapImage) return this._L.latLng(p[0], p[1]);
    const { w, h } = this._mapDims;
    return this._L.latLng(h * (1 - p[0]), w * p[1]);
  },

  _fromLatLng(ll) {
    if (!this._mapImage) return [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))];
    const { w, h } = this._mapDims;
    return [Number((1 - ll.lat / h).toFixed(5)), Number((ll.lng / w).toFixed(5))];
  },

  _mapDrawShapes() {
    const L = this._L;
    const map = this._lmap;
    const view = this._mapView();
    if (!map || !view) return;
    Object.values(this._mapLayers || {}).forEach((ly) => { ly.parts.forEach((p) => p.remove()); ly.label?.remove(); });
    (this._mapHandles || []).forEach((h) => h.remove());
    this._mapHandles = [];
    this._mapLayers = {};
    this._mapLiveKey = null;
    const editing = this._mapEdit && this._can();
    Object.entries(view.shapes || {}).forEach(([zid, parts]) => {
      const z = this._zone(zid);
      if (!z) return;
      const layers = parts.map((pts, i) => {
        const poly = L.polygon(pts.map((p) => this._toLatLng(p)), {
          className: `ski-z${editing && this._mapSel === zid ? " sel" : ""}`, color: z.color, fillColor: z.color, weight: 3,
        }).addTo(map);
        poly.on("click", (e) => { L.DomEvent.stop(e); this._mapZoneClick(zid, i, e); });
        return poly;
      });
      // label on the biggest area
      let best = layers[0];
      let bestA = -1;
      layers.forEach((ly) => {
        const a = polygonArea(ly.getLatLngs()[0].map((ll) => map.latLngToLayerPoint(ll)));
        if (a > bestA) { bestA = a; best = ly; }
      });
      const label = L.tooltip({ permanent: true, direction: "center", className: "ski-lbl", interactive: false })
        .setLatLng(best.getBounds().getCenter()).setContent(esc(z.name));
      if (!editing || this._mapSel !== zid) label.addTo(map);
      this._mapLayers[zid] = { parts: layers, label, center: best.getBounds().getCenter() };
    });
    this._mapRefresh(true);
    if (editing && this._mapSel) this._mapShowHandles();
  },

  // live classes, badges and ripples, without rebuilding the map
  _mapRefresh(force = false) {
    if (!this._lmap || !this._mapLayers) return;
    const L = this._L;
    const states = this._mapZoneStates();
    const editing = this._mapEdit && this._can();
    Object.entries(this._mapLayers).forEach(([zid, ly]) => {
      const st = states[zid]?.st || "idle";
      ly.parts.forEach((p) => {
        const el = p.getElement();
        if (!el) return;
        ["on", "next", "done", "queued", "off", "idle"].forEach((c) => el.classList.toggle(c, c === st));
        el.classList.toggle("sel", !!editing && this._mapSel === zid);
      });
    });
    const live = Object.entries(states).filter(([zid, s]) => s.st === "on" && this._mapLayers[zid]);
    const key = live.map(([zid, s]) => `${zid}@${s.started}`).join() + (editing ? "e" : "");
    if (!force && key === this._mapLiveKey) return;
    this._mapLiveKey = key;
    (this._mapLive || []).forEach((m) => m.remove());
    this._mapLive = [];
    live.forEach(([zid, s]) => {
      const ly = this._mapLayers[zid];
      const z = this._zone(zid);
      const ripple = L.marker(ly.center, { interactive: false, keyboard: false,
        icon: L.divIcon({ className: "ski-ripple", html: "<i></i><i></i><i></i>", iconSize: [80, 80] }) }).addTo(this._lmap);
      this._mapLive.push(ripple);
      if (editing) return;
      const timing = s.ends
        ? `<span data-start="${s.started}" data-mode="elapsed"></span> <small>· ${this.t("map_left")} <span data-start="${s.started}" data-end="${s.ends}" data-mode="clock"></span></small>`
        : `<span data-start="${esc(s.started || "")}" data-mode="elapsed"></span>`;
      const ring = s.ends ? `<span class="mring" data-start="${s.started}" data-end="${s.ends}" data-mode="ring"></span>` : `<span class="mring full"></span>`;
      const badge = L.tooltip({ permanent: true, direction: "top", offset: [0, -24], className: "ski-badge", interactive: false })
        .setLatLng(ly.center)
        .setContent(`${ring}<span class="bt"><b>${esc(z?.name || zid)}</b><span class="tm">${this.t("map_since")} ${timing}</span></span>`)
        .addTo(this._lmap);
      this._mapLive.push(badge);
    });
    this._tick();
  },

  // ------------------------------------------------------------ interaction
  _mapZoneClick(zid, partIndex, e) {
    if (this._mapEdit && this._can()) {
      this._mapSel = zid;
      this._render();
      return;
    }
    const z = this._zone(zid);
    if (!z) return;
    const st = this._mapZoneStates()[zid]?.st;
    const stat = this._state?.zone_stats?.[zid];
    const can = this._can() && z.enabled && z.entity_id;
    const html = `<div class="map-pop"><b>${esc(z.name)}</b>
      <div class="small muted">${esc(z.entity_id || "")}</div>
      <div class="small muted">${this.t("last_watered")}: ${stat?.last ? this._fmtWhen(stat.last) : this.t("never")}</div>
      ${can ? (st === "on" && this._state?.current
        ? `<div class="row"><button class="btn sm" data-mpop="skip"><ha-icon icon="mdi:skip-next"></ha-icon>${this.t("skip")}</button></div>`
        : `<div class="row">${[5, 10, 15].map((m, i) => `<button class="btn sm ${i ? "" : "water"}" data-mpop="run" data-min="${m}"><ha-icon icon="mdi:play"></ha-icon>${m} min</button>`).join("")}</div>`) : ""}
    </div>`;
    const pop = this._L.popup({ className: "ski-popup", maxWidth: 340, minWidth: 270 }).setLatLng(e.latlng).setContent(html).openOn(this._lmap);
    const root = pop.getElement();
    root?.querySelectorAll("[data-mpop]").forEach((b) => b.addEventListener("click", async () => {
      this._lmap.closePopup();
      if (b.dataset.mpop === "skip") await this._action("skip", { target: zid });
      else {
        const res = await this._action("run_zone", { target: zid, minutes: Number(b.dataset.min) });
        if (res?.blocked?.length) this._toast(res.blocked.map((r) => this._reasonText(r)).join(" · "));
        else this._toast(this.t("started"));
      }
    }));
  },

  _mapClick(e) {
    if (this._mapPlacing) {
      const zid = this._mapPlacing;
      this._mapPlacing = null;
      this._mapPlaceAt(zid, e.latlng);
      return;
    }
    if (this._mapEdit && this._mapSel) {
      this._mapSel = null;
      this._render();
    }
  },

  // a small square around a point, sized to the current zoom
  _mapSquare(latlng) {
    const map = this._lmap;
    const c = map.latLngToContainerPoint(latlng);
    const r = Math.max(18, map.getSize().x * 0.035);
    return [[-r, -r], [r, -r], [r, r], [-r, r]].map(([dx, dy]) => this._fromLatLng(map.containerPointToLatLng([c.x + dx, c.y + dy])));
  },

  _mapPlaceAt(zid, latlng) {
    const view = this._mapView();
    if (!view || !this._lmap) return;
    view.shapes = view.shapes || {};
    (view.shapes[zid] = view.shapes[zid] || []).push(this._mapSquare(latlng));
    this._mapSel = zid;
    this._mapSaveSoon();
    this._render();
  },

  _mapPlaceFromClient(zid, x, y) {
    if (!this._lmap) return;
    const r = this._lmap.getContainer().getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    this._mapPlaceAt(zid, this._lmap.containerPointToLatLng([x - r.left, y - r.top]));
  },

  // vertex, midpoint and move handles for the selected sprinkler
  _mapShowHandles() {
    const L = this._L;
    const map = this._lmap;
    (this._mapHandles || []).forEach((h) => h.remove());
    this._mapHandles = [];
    const zid = this._mapSel;
    const ly = this._mapLayers?.[zid];
    // always read the live config: a save replaces this._config with the server copy
    const parts = () => this._mapView()?.shapes?.[zid] || [];
    if (!ly || !parts().length) return;
    const icon = (cls, size, html = "") => L.divIcon({ className: cls, iconSize: [size, size], html });
    const commit = () => { this._mapSaveSoon(); };
    parts().forEach((pts, pi) => {
      const poly = ly.parts[pi];
      const sync = () => poly.setLatLngs(parts()[pi].map((p) => this._toLatLng(p)));
      pts.forEach((p, vi) => {
        const m = L.marker(this._toLatLng(p), { draggable: true, icon: icon("ski-vx", 16), zIndexOffset: 1000 }).addTo(map);
        m.on("drag", (ev) => { parts()[pi][vi] = this._fromLatLng(ev.target.getLatLng()); sync(); });
        m.on("dragend", () => { commit(); this._mapShowHandles(); });
        m.on("dblclick contextmenu", (ev) => {
          L.DomEvent.stop(ev);
          if (parts()[pi].length <= 3) return;
          parts()[pi].splice(vi, 1);
          sync(); commit(); this._mapShowHandles();
        });
        this._mapHandles.push(m);
        // midpoint to the next vertex: drag it to add a corner
        const q = pts[(vi + 1) % pts.length];
        const a = this._toLatLng(p), b = this._toLatLng(q);
        const mid = L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { draggable: true, icon: icon("ski-mid", 12), zIndexOffset: 900 }).addTo(map);
        let inserted = false;
        mid.on("drag", (ev) => {
          if (!inserted) { parts()[pi].splice(vi + 1, 0, this._fromLatLng(ev.target.getLatLng())); inserted = true; }
          parts()[pi][vi + 1] = this._fromLatLng(ev.target.getLatLng());
          sync();
        });
        mid.on("dragend", () => { commit(); this._mapShowHandles(); });
        this._mapHandles.push(mid);
      });
      // move the whole area
      const center = poly.getBounds().getCenter();
      const mv = L.marker(center, { draggable: true, icon: icon("ski-move", 30, "✥"), zIndexOffset: 1100 }).addTo(map);
      let start = null;
      let orig = null;
      mv.on("dragstart", (ev) => { start = map.latLngToContainerPoint(ev.target.getLatLng()); orig = parts()[pi].map((x) => map.latLngToContainerPoint(this._toLatLng(x))); });
      mv.on("drag", (ev) => {
        const now = map.latLngToContainerPoint(ev.target.getLatLng());
        const dx = now.x - start.x, dy = now.y - start.y;
        parts()[pi] = orig.map((pt) => this._fromLatLng(map.containerPointToLatLng([pt.x + dx, pt.y + dy])));
        sync();
      });
      mv.on("dragend", () => { commit(); this._mapShowHandles(); });
      this._mapHandles.push(mv);
    });
  },

  _mapFocus(zid) {
    const ly = this._mapLayers?.[zid];
    if (!ly || !this._lmap) return;
    const b = ly.parts.reduce((acc, p) => acc.extend(p.getBounds()), this._L.latLngBounds(ly.parts[0].getBounds().getSouthWest(), ly.parts[0].getBounds().getNorthEast()));
    this._lmap.flyToBounds(b.pad(1.2), { maxZoom: this._mapImage ? 1 : 20, duration: 0.6 });
  },

  // ------------------------------------------------------------ actions (called from the panel)
  async _mapAction(a, el) {
    const view = this._mapView();
    const id = el.dataset.id;
    switch (a) {
      case "map-view":
        this._mapId = id; this._mapSel = null; this._mapPlacing = null;
        try { localStorage.setItem("ski-map", id); } catch (err) { /* ignore */ }
        break;
      case "map-new": {
        const kind = el.dataset.kind === "satellite" ? "satellite" : "image";
        const m = { id: uid("map"), name: `${this.t("map")} ${this._maps.length + 1}`, kind, image: "", image_w: 0, image_h: 0,
          center: kind === "satellite" ? [this._hass.config?.latitude ?? 0, this._hass.config?.longitude ?? 0] : null,
          zoom: 18, max_native_zoom: 18, shapes: {} };
        this._maps.push(m);
        this._mapId = m.id; this._mapEdit = true; this._mapSel = null;
        this._mapSaveSoon();
        break;
      }
      case "map-edit":
        this._mapEdit = !this._mapEdit; this._mapSel = null; this._mapPlacing = null;
        break;
      case "map-kind": {
        if (!view || view.kind === id) return;
        const apply = () => {
          view.kind = id; view.shapes = {}; this._mapSel = null;
          if (id === "satellite" && !view.center) view.center = [this._hass.config?.latitude ?? 0, this._hass.config?.longitude ?? 0];
          this._mapSaveSoon();
          this._render();
        };
        if (Object.keys(view.shapes || {}).length) this._confirm(this.t("map_kind_confirm"), apply);
        else apply();
        return;
      }
      case "map-center":
        if (!view || !this._lmap) return;
        view.center = this._fromLatLng(this._lmap.getCenter());
        view.zoom = Math.round(this._lmap.getZoom());
        this._mapSaveSoon();
        return;
      case "map-delete":
        this._confirm(this.t("map_delete_confirm", { name: view.name }), () => {
          this._config.maps = this._maps.filter((m) => m.id !== view.id);
          this._mapId = null; this._mapSel = null;
          this._mapSaveSoon();
          this._render();
        });
        return;
      case "map-place":
        this._mapPlacing = id;
        this._mapOverlay(view);
        return;
      case "map-place-cancel":
        this._mapPlacing = null;
        this._mapOverlay(view);
        return;
      case "map-unselect": this._mapSel = null; break;
      case "map-part-add": {
        if (!this._lmap) return;
        (view.shapes[this._mapSel] = view.shapes[this._mapSel] || []).push(this._mapSquare(this._lmap.getCenter()));
        this._mapSaveSoon();
        break;
      }
      case "map-part-del": {
        const parts = view.shapes[this._mapSel] || [];
        parts.splice(Number(el.dataset.n), 1);
        if (!parts.length) { delete view.shapes[this._mapSel]; this._mapSel = null; }
        this._mapSaveSoon();
        break;
      }
      case "map-focus": this._mapFocus(id); return;
      default: return;
    }
    this._render();
  },

  async _mapUpload(file) {
    const view = this._mapView();
    if (!file || !view) return;
    this._toast(this.t("map_uploading"));
    try {
      const { blob, w, h } = await prepareImage(file);
      const url = await this._mapUploadBlob(blob);
      view.kind = "image";
      view.image = url;
      view.image_w = w;
      view.image_h = h;
      this._mapSaveSoon();
      this._render();
    } catch (err) {
      this._toast(`${this.t("map_upload_error")}: ${err.message || err}`);
    }
  },

  async _mapUploadBlob(blob) {
    const fd = new FormData();
    fd.append("file", blob, "map.jpg");
    const res = await this._hass.fetchWithAuth(UPLOAD_URL, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).url;
  },

  // Backup: embed uploaded images so an export restores on another install.
  async _mapsForExport(config) {
    for (const m of config.maps || []) {
      if (!m.image || !m.image.startsWith(FILES_PREFIX)) continue;
      try {
        const blob = await (await fetch(m.image)).blob();
        m.image_data = await blobToDataUrl(blob);
      } catch (err) { /* keep the url only */ }
    }
    return config;
  },

  // Maps imported on their own: shapes may be keyed by entity_id instead of the
  // sprinkler id, so a map file works on any installation with those devices.
  _mergeImportedMaps(maps) {
    const byEntity = Object.fromEntries(this._zones.filter((z) => z.entity_id).map((z) => [z.entity_id, z.id]));
    const ids = new Set(this._zones.map((z) => z.id));
    const fixed = maps.map((m) => ({ ...m, shapes: Object.fromEntries(Object.entries(m.shapes || {})
      .map(([k, v]) => [ids.has(k) ? k : byEntity[k], v]).filter(([k]) => k)) }));
    const replaced = new Set(fixed.map((m) => m.id));
    return { ...clone(this._config), maps: [...this._maps.filter((m) => !replaced.has(m.id)), ...fixed] };
  },

  async _mapsForImport(config) {
    for (const m of config.maps || []) {
      if (typeof m.image_data === "string" && m.image_data.startsWith("data:image/")) {
        const blob = await (await fetch(m.image_data)).blob();
        m.image = await this._mapUploadBlob(blob);
      }
      delete m.image_data;
    }
    return config;
  },
};
