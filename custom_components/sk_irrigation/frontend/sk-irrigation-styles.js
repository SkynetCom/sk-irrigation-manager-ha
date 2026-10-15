// Styles for the SK Irrigation panel. Built on Home Assistant theme variables
// so the panel follows light/dark and custom themes.
export const STYLES = `
:host {
  --ski-bg: var(--primary-background-color, #f4f6f8);
  --ski-card: var(--card-background-color, #fff);
  --ski-text: var(--primary-text-color, #1b2733);
  --ski-muted: var(--secondary-text-color, #66727f);
  --ski-line: var(--divider-color, rgba(0,0,0,.09));
  --ski-primary: var(--primary-color, #03a9f4);
  --ski-water: #1e88e5;
  --ski-green: #2e9e6b;
  --ski-amber: #f2a900;
  --ski-red: var(--error-color, #db4437);
  --ski-radius: 14px;
  --ski-shadow: var(--ha-card-box-shadow, 0 1px 2px rgba(0,0,0,.06), 0 2px 10px rgba(0,0,0,.04));
  display: flex; flex-direction: column; height: 100vh; background: var(--ski-bg); color: var(--ski-text);
  font-family: var(--paper-font-body1_-_font-family, var(--ha-font-family-body, Roboto, system-ui, sans-serif));
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; color: inherit; }
.scroller { flex: 1; overflow: auto; position: relative; -webkit-overflow-scrolling: touch; }
.toolbar { flex: none; z-index: 5; display: flex; align-items: center; gap: 8px;
  height: var(--header-height, 56px); padding: 0 12px; background: var(--app-header-background-color, var(--ski-primary));
  color: var(--app-header-text-color, #fff); border-bottom: var(--app-header-border-bottom, none); }
.toolbar .title { font-size: 20px; font-weight: 400; display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .pill { background: rgba(255,255,255,.18); padding: 4px 12px; border-radius: 99px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.toolbar .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.toolbar .pill.running .dot { animation: pulse 1.4s infinite; background: #9cf7c7; }
.tabs { flex: none; z-index: 4; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none;
  background: var(--app-header-background-color, var(--ski-primary)); color: var(--app-header-text-color, #fff); padding: 0 8px; }
.tabs::-webkit-scrollbar { display: none; }
.tab { border: 0; background: none; padding: 12px 16px 10px; cursor: pointer; opacity: .75; border-bottom: 3px solid transparent;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 500; font-size: 14px; letter-spacing: .2px; }
.tab ha-icon { --mdc-icon-size: 18px; }
.tab.active { opacity: 1; border-bottom-color: currentColor; }
.tab:hover { opacity: 1; }
main { max-width: 1320px; margin: 0 auto; padding: 20px 16px 120px; font-size: 14px; }
.grid { display: grid; gap: 16px; }
.cols-2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
.cols-main { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
@media (max-width: 900px) { .cols-main { grid-template-columns: 1fr; } }
.card { background: var(--ski-card); border-radius: var(--ski-radius); box-shadow: var(--ski-shadow); border: 1px solid var(--ski-line); overflow: hidden; }
.card > .hd { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.card > .hd h2, .card > .hd h3 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; display: flex; align-items: center; gap: 8px; }
.card > .hd h2 ha-icon, .card > .hd h3 ha-icon { color: var(--ski-muted); --mdc-icon-size: 20px; }
.card > .bd { padding: 4px 16px 16px; }
.muted { color: var(--ski-muted); }
.small { font-size: 12.5px; }
.hint { color: var(--ski-muted); font-size: 13px; line-height: 1.45; margin: 0 0 12px; }
.row { display: flex; align-items: center; gap: 10px; }
.row.wrap { flex-wrap: wrap; }
.spacer { flex: 1; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.btn { border: 1px solid var(--ski-line); background: var(--ski-card); border-radius: 10px; padding: 7px 14px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; transition: background .15s, border-color .15s, transform .05s; white-space: nowrap; }
.btn:hover { background: rgba(127,127,127,.08); }
.btn:active { transform: translateY(1px); }
.btn ha-icon { --mdc-icon-size: 18px; }
.btn.primary { background: var(--ski-primary); border-color: var(--ski-primary); color: var(--text-primary-color, #fff); }
.btn.primary:hover { filter: brightness(1.06); }
.btn.water { background: var(--ski-water); border-color: var(--ski-water); color: #fff; }
.btn.danger { color: var(--ski-red); border-color: color-mix(in srgb, var(--ski-red) 40%, transparent); }
.btn.danger.solid { background: var(--ski-red); color: #fff; }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.sm { padding: 4px 10px; font-size: 13px; border-radius: 8px; }
.btn.icon { padding: 6px; border-radius: 50%; border-color: transparent; background: transparent; }
.btn.icon:hover { background: rgba(127,127,127,.12); }
.btn[disabled] { opacity: .45; pointer-events: none; }
.toolbar .btn { color: inherit; border-color: rgba(255,255,255,.35); background: rgba(255,255,255,.08); }
.toolbar .btn.danger { background: var(--ski-red); border-color: var(--ski-red); color: #fff; }
input[type=text], input[type=number], input[type=time], input[type=date], select, textarea {
  background: var(--input-fill-color, rgba(127,127,127,.06)); border: 1px solid var(--ski-line); border-radius: 9px;
  padding: 8px 10px; min-height: 38px; width: 100%; outline: none; font-size: 14px; transition: border-color .15s, box-shadow .15s; }
input:focus, select:focus, textarea:focus { border-color: var(--ski-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ski-primary) 18%, transparent); }
input[type=number] { max-width: 110px; }
input[type=color] { width: 34px; height: 34px; padding: 0; border: 1px solid var(--ski-line); border-radius: 50%; overflow: hidden; cursor: pointer; background: none; flex: none; }
input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
input[type=color]::-webkit-color-swatch { border: none; border-radius: 50%; }
label.field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--ski-muted); font-weight: 500; }
label.field > span { padding-left: 2px; }
.fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.switch { position: relative; width: 40px; height: 22px; flex: none; display: inline-block; }
.switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.switch .tr { position: absolute; inset: 0; border-radius: 99px; background: rgba(127,127,127,.35); transition: .2s; cursor: pointer; }
.switch .tr::after { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.switch input:checked + .tr { background: var(--ski-green); }
.switch input:checked + .tr::after { transform: translateX(18px); }
.toggle-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.toggle-row .lbl { flex: 1; }
.seg { display: inline-flex; border: 1px solid var(--ski-line); border-radius: 10px; overflow: hidden; background: rgba(127,127,127,.05); flex-wrap: wrap; }
.seg button { border: 0; background: none; padding: 7px 12px; cursor: pointer; font-size: 13px; font-weight: 500; border-right: 1px solid var(--ski-line); white-space: nowrap; }
.seg button:last-child { border-right: 0; }
.seg button.on { background: var(--ski-primary); color: var(--text-primary-color, #fff); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--ski-line); border-radius: 99px; padding: 5px 12px; font-size: 13px; cursor: pointer; background: var(--ski-card); user-select: none; display: inline-flex; align-items: center; gap: 6px; }
.chip.on { background: color-mix(in srgb, var(--ski-primary) 14%, transparent); border-color: var(--ski-primary); color: var(--ski-primary); font-weight: 600; }
.chip.sq { border-radius: 8px; min-width: 38px; justify-content: center; padding: 6px 4px; }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: rgba(127,127,127,.12); color: var(--ski-muted); white-space: nowrap; }
.badge.green { background: color-mix(in srgb, var(--ski-green) 15%, transparent); color: var(--ski-green); }
.badge.blue { background: color-mix(in srgb, var(--ski-water) 15%, transparent); color: var(--ski-water); }
.badge.amber { background: color-mix(in srgb, var(--ski-amber) 18%, transparent); color: #b07800; }
.badge.red { background: color-mix(in srgb, var(--ski-red) 14%, transparent); color: var(--ski-red); }
.badge.rb { background: #00693c; color: #fff; }
.empty { text-align: center; color: var(--ski-muted); padding: 28px 12px; font-size: 14px; }
.empty ha-icon { --mdc-icon-size: 40px; opacity: .5; display: block; margin: 0 auto 8px; }
.banner { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-radius: 10px; font-size: 14px; margin-bottom: 16px;
  background: color-mix(in srgb, var(--ski-amber) 14%, transparent); }

/* hero */
.hero { padding: 20px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ski-water) 12%, var(--ski-card)), var(--ski-card) 70%); }
.hero.running { background: linear-gradient(135deg, color-mix(in srgb, var(--ski-water) 22%, var(--ski-card)), color-mix(in srgb, var(--ski-green) 8%, var(--ski-card))); }
.ring { --p: 0; width: 112px; height: 112px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: conic-gradient(var(--ski-water) calc(var(--p) * 1%), rgba(127,127,127,.15) 0); position: relative; }
.ring::before { content: ""; position: absolute; inset: 9px; border-radius: 50%; background: var(--ski-card); }
.ring > div { position: relative; text-align: center; line-height: 1.1; }
.ring .big { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ring ha-icon { --mdc-icon-size: 46px; color: var(--ski-water); }
.hero .info { flex: 1; min-width: 220px; }
.hero .info h1 { margin: 0 0 4px; font-size: 24px; font-weight: 600; }
.hero .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.active-zone { display: grid; grid-template-columns: 10px 1fr auto auto; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid var(--ski-line); }
.active-zone .swatch, .swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.bar { height: 6px; border-radius: 99px; background: rgba(127,127,127,.15); overflow: hidden; margin-top: 6px; }
.bar > i { display: block; height: 100%; background: var(--ski-water); border-radius: inherit; transition: width 1s linear; }
.tnum { font-variant-numeric: tabular-nums; }
.steps-track { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.steps-track .st { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.steps-track .st > b { min-width: 90px; }
.zpill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; font-size: 12px; border: 1px solid var(--ski-line); }
.zpill.done { opacity: .55; text-decoration: line-through; }
.zpill.active { background: var(--ski-water); color: #fff; border-color: var(--ski-water); animation: glow 1.6s infinite; }

/* zone tiles */
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.tile { border: 1px solid var(--ski-line); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; position: relative; background: var(--ski-card); border-left: 4px solid var(--c, var(--ski-green)); }
.tile .nm { font-weight: 600; font-size: 14px; display: flex; gap: 6px; align-items: center; }
.tile .nm ha-icon { --mdc-icon-size: 20px; color: var(--c); }
.tile.on { background: color-mix(in srgb, var(--ski-water) 10%, var(--ski-card)); }
.state-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(127,127,127,.4); display: inline-block; }
.state-dot.on { background: var(--ski-water); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ski-water) 25%, transparent); animation: pulse 1.4s infinite; }

/* lists */
.list-row { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--ski-line); }
.list-row:first-child { border-top: 0; }
.prog-card { display: flex; gap: 0; }
.prog-card .stripe { width: 6px; flex: none; background: var(--c); }
.prog-card .content { flex: 1; padding: 14px 16px; min-width: 0; }
.prog-card h3 { margin: 0; font-size: 17px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--ski-muted); margin-top: 6px; }
.meta span { display: inline-flex; align-items: center; gap: 5px; }
.meta ha-icon { --mdc-icon-size: 16px; }

/* zones tab */
.device { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-top: 1px solid var(--ski-line); font-size: 14px; }
.device:first-child { border-top: 0; }
.device .nm { flex: 1; min-width: 0; }
.device .nm div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.device-list { max-height: 560px; overflow: auto; }
.zone-row { display: grid; grid-template-columns: 34px minmax(0,1fr) 120px auto auto; grid-template-areas: "c n n s a" ". e e f f";
  gap: 8px 10px; align-items: center; padding: 12px 0; border-top: 1px solid var(--ski-line); }
.zone-row:first-of-type { border-top: 0; }
.zone-row .z-c { grid-area: c; } .zone-row .z-n { grid-area: n; } .zone-row .z-s { grid-area: s; } .zone-row .z-a { grid-area: a; }
.zone-row .z-e { grid-area: e; } .zone-row .z-f { grid-area: f; max-width: none; }
.zone-list { container-type: inline-size; }
@container (min-width: 760px) { .zone-row { grid-template-columns: 34px minmax(140px,1fr) minmax(180px,1.3fr) 120px auto auto; grid-template-areas: "c n e f s a"; } }

/* drag & drop */
[data-drag] { touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
[data-drag][data-handle-only] { touch-action: auto; cursor: default; user-select: auto; -webkit-user-select: auto; }
[data-handle-only] .grip { touch-action: none; cursor: grab; padding: 4px; margin: -4px; }
.zchip { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--ski-line); background: var(--ski-card); font-size: 14px; }
.zchip .grip { color: var(--ski-muted); --mdc-icon-size: 18px; }
.zchip .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zchip .ord { width: 22px; height: 22px; border-radius: 50%; background: var(--c, var(--ski-green)); color: #fff; font-size: 12px; font-weight: 700; display: grid; place-items: center; flex: none; }
.zchip:hover { border-color: color-mix(in srgb, var(--ski-primary) 50%, var(--ski-line)); }
.dropzone { min-height: 56px; display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 12px; border: 2px dashed transparent; transition: border-color .15s, background .15s; }
.dropzone.empty-dz { border-color: var(--ski-line); align-items: center; justify-content: center; color: var(--ski-muted); font-size: 13px; }
.dropzone.over { border-color: var(--ski-primary); background: color-mix(in srgb, var(--ski-primary) 7%, transparent); }
.drop-marker { height: 3px; border-radius: 3px; background: var(--ski-primary); margin: -1px 4px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ski-primary) 20%, transparent); }
.drag-ghost { position: fixed; z-index: 1000; pointer-events: none; opacity: .92; transform: rotate(2deg) scale(1.03); box-shadow: 0 12px 28px rgba(0,0,0,.25); border-radius: 10px; }
.dragging-src { opacity: .35; }
.groups-layout { display: grid; grid-template-columns: 300px minmax(0,1fr); gap: 16px; align-items: start; }
@media (max-width: 800px) { .groups-layout { grid-template-columns: 1fr; } }
.groups-layout .pool { position: sticky; top: 0; max-height: calc(100vh - 140px); overflow: auto; }
.group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.group-card { border-top: 4px solid var(--c); }
.group-card .hd input[type=text] { font-weight: 600; font-size: 15px; background: transparent; border-color: transparent; padding: 4px 6px; min-height: 32px; }
.group-card .hd input[type=text]:hover { border-color: var(--ski-line); }
.new-group { border: 2px dashed var(--ski-line); border-radius: var(--ski-radius); min-height: 150px; display: grid; place-items: center; color: var(--ski-muted); text-align: center; padding: 16px; cursor: pointer; }
.new-group.over { border-color: var(--ski-primary); color: var(--ski-primary); background: color-mix(in srgb, var(--ski-primary) 6%, transparent); }

/* program editor */
.editor { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 1000px) { .editor { grid-template-columns: 1fr; } }
.editor .side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 16px; }
.section-n { width: 26px; height: 26px; border-radius: 50%; background: var(--ski-primary); color: var(--text-primary-color, #fff); font-size: 13px; font-weight: 700; display: grid; place-items: center; flex: none; }
.step-card { border: 1px solid var(--ski-line); border-left: 4px solid var(--c); border-radius: 12px; background: var(--ski-card); }
.step-card .shd { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.step-card .shd .t { flex: 1; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.step-card .sbd { padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.step-card .sub { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: var(--ski-muted); font-weight: 600; margin-bottom: 6px; }
.dur-table { display: grid; max-width: 480px; grid-template-columns: 1fr 150px; gap: 6px 12px; align-items: center; font-size: 14px; }
.dur-table input { max-width: 110px; }
.connector { display: flex; justify-content: center; color: var(--ski-muted); --mdc-icon-size: 20px; margin: -4px 0; }
.palette-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--ski-line); border-left: 4px solid var(--c); background: var(--ski-card); font-size: 14px; }
.palette-item .nm { flex: 1; }
.timeline { position: relative; }
.tl-row { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; font-size: 12px; height: 22px; }
.tl-row .lab { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ski-muted); }
.tl-track { position: relative; height: 14px; background: rgba(127,127,127,.08); border-radius: 4px; }
.tl-bar { position: absolute; top: 0; bottom: 0; border-radius: 4px; background: var(--c); opacity: .9; min-width: 2px; }
.tl-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ski-muted); margin: 4px 0 0 118px; }
.sticky-foot { position: sticky; bottom: 0; z-index: 3; margin-top: 16px; padding: 12px 16px; display: flex; gap: 10px; align-items: center;
  background: var(--ski-card); border: 1px solid var(--ski-line); border-radius: var(--ski-radius); box-shadow: 0 -4px 18px rgba(0,0,0,.08); }
.start-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.start-row select { width: auto; }
.start-row input[type=time] { width: 130px; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.kpi { border: 1px solid var(--ski-line); border-radius: 12px; padding: 10px; text-align: center; }
.kpi b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 12px; color: var(--ski-muted); }

/* history table */
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-weight: 600; color: var(--ski-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .4px; padding: 8px; border-bottom: 1px solid var(--ski-line); }
td { padding: 10px 8px; border-bottom: 1px solid var(--ski-line); vertical-align: top; }
.table-wrap { overflow-x: auto; }

/* dialog + toast */
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 900; display: grid; place-items: center; padding: 16px; animation: fade .15s; }
.dialog { background: var(--ski-card); border-radius: 18px; width: min(440px, 100%); box-shadow: 0 20px 60px rgba(0,0,0,.3); padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.dialog h2 { margin: 0; font-size: 19px; }
.dialog .foot { display: flex; justify-content: flex-end; gap: 8px; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 950; background: #323232; color: #fff; padding: 10px 18px; border-radius: 10px; font-size: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.25); animation: rise .2s; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
@keyframes glow { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ski-water) 45%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translate(-50%, 10px); } }
`;
