# Changelog

🇬🇧 English · 🇪🇸 [Español](CHANGELOG.es.md)

## Unreleased
- English is now the primary documentation language (README, changelog and screenshots), with a full Spanish version.
- The sidebar title of a new install and the card names in the card picker follow the Home Assistant language ("Irrigation" / "Riego").

## 1.3.4 — 2026-10-16
- Fixed: if a program editor was open while **importing a configuration**, it kept showing (and could save again)
  the old durations. The editor now refreshes with the imported data.

## 1.3.3 — 2026-10-15
- Available in every country on HACS: the `country` restriction was removed from `hacs.json`.

## 1.3.2 — 2026-10-15
- Fixed: **"Custom element doesn't exist: sk-irrigation-…-card"** when opening a dashboard while Home Assistant
  is starting (for example, right after updating and restarting). The panel files are served earlier, the cards
  are also registered as a **Lovelace resource** (its version updates automatically, which also helps Chromecast)
  and they load through a second fallback URL if the first one failed during startup.

## 1.3.1 — 2026-10-15
- Sprinklers and Groups cards: **Columns** option (empty = automatic) to control the layout.
- Long names on the cards wrap to up to 2 lines instead of being cut, with the full name on hover.

## 1.3.0 — 2026-10-15
- **Interactive timeline** in the program editor: drag a bar's edge to change that sprinkler's duration
  (30 s steps) or the whole bar to change its start order; zoom with horizontal scrolling for long cycles.
- **Dashboard cards** (loaded automatically, no manual resources): Status, Cycles, Groups and Sprinklers,
  with a visual editor and a single shared subscription.
- Conditions: **autocomplete** for the Entity field with the current state, **suggested values** for state
  conditions and a warning for missing entities.
- Quick skip: usage explanation, live state of each rain sensor, a warning for non-binary sensors and the
  current weather highlighted.
- The status and the cards react **instantly** when a sensor used in conditions changes.
- Estimated duration of each cycle available to the cards.
- **Buy me a coffee** donation button (PayPal) in the README, GitHub Sponsor and Settings.

## 1.2.2 — 2026-10-15
- README compatible with the HACS viewer: images with absolute URLs and the flow diagram as an image
  (HACS resolves neither relative paths nor Mermaid). No functional changes.

## 1.2.1 — 2026-10-15
- **Custom entity picker** replacing the native dropdowns: search by name, area, controller or entity_id;
  grouped by HA area; keyboard navigation; multiple selection ("Add sprinkler" can add several at once);
  bottom sheet on phones.
- Used for "Add sprinkler", rain sensors, weather, temperature, budget, master valve, notifications and
  condition entities.
- Sprinkler list: **Suggested** filter by default (Rain Bird, valves and irrigation names), compact area
  filter, "showing N of M" counter and controller name to tell apart zones with the same name.
- The integration's own switches are excluded from the device lists.
- Settings: 2-column grid without gaps on wide screens; wider maximum panel width.
- Fixed: the empty picker looked taller than the others; toasts disappeared on refresh.

## 1.2.0 — 2026-10-15
- **Custom conditions** without YAML: state (is / is not), numeric (above/below, also on attributes) and
  Jinja templates. Global (Settings) and per program; live ✓/✗ indicator with the current value.
- **Re-check before each sprinkler and while watering** option: if it stops passing (e.g. battery or
  generator) the run stops, the pump turns off and the reason is logged in the history.
- Behaviour when the sensor is unavailable: don't water, or ignore the condition.
- Conditions also apply to manual runs and services (configurable); the panel shows the reason.
- `unavailable`/`unknown` sprinklers are skipped and the sequence continues.
- Own icon and logo (`brand/`, HA 2026.3+) shown in HA and HACS; redesigned README with a banner.
- New **Current sprinkler** sensor with `ends_at` and `remaining_seconds` (replaces helper timers).

## 1.1.0 — 2026-10-15
- Simplified flow: **Sprinklers (HA devices) → Groups → Programs**. The Zones tab is removed.
- HA devices are read automatically with their **native area** and dragged straight into groups
  (filters by area, Rain Bird and "ungrouped"; a button to create groups from HA areas).
- In each program, **drag & drop start order** for each group's sprinklers, the same duration for all or
  one by one, and a switch to skip a sprinkler in that program only.

## 1.0.0 — 2026-10-15
- First release: irrigation panel, zones, drag & drop groups, programs with an advanced calendar, multiple
  start times, simultaneous zones per step, fixed or per-sprinkler durations, Gantt preview, rain/weather/frost
  conditions, water budget, master valve, history, services and entities.
