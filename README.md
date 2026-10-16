<p align="center">
  <img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/banner.png" alt="SK Irrigation Manager for Home Assistant" width="100%">
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=SkynetCom&repository=sk-irrigation-manager-ha&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open in HACS"></a>
  <a href="https://my.home-assistant.io/redirect/config_flow_start/?domain=sk_irrigation"><img src="https://my.home-assistant.io/badges/config_flow_start.svg" alt="Add integration"></a>
  <br><a href="https://www.paypal.com/donate/?business=gerencia%40skynetcom.com.ar&currency_code=USD&item_name=SK+Irrigation+Manager"><img src="https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-PayPal-ffdd00?logo=paypal&logoColor=003087&labelColor=ffdd00&style=for-the-badge" alt="Buy me a coffee"></a>
</p>

<p align="center">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/releases"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSkynetCom%2Fsk-irrigation-manager-ha%2Fmain%2Fcustom_components%2Fsk_irrigation%2Fmanifest.json&query=%24.version&prefix=v&label=version&color=1e88e5&cacheSeconds=3600" alt="Version"></a>
  <a href="https://hacs.xyz/docs/faq/custom_repositories"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS"></a>
  <img src="https://img.shields.io/badge/Home%20Assistant-2024.11%2B-18bcf2?logo=homeassistant&logoColor=white" alt="Home Assistant">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/actions/workflows/validate.yml"><img src="https://github.com/SkynetCom/sk-irrigation-manager-ha/actions/workflows/validate.yml/badge.svg" alt="Validate"></a>
  <img src="https://img.shields.io/badge/languages-EN%20%7C%20ES-2e9e6b" alt="Languages">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8e44ad" alt="License"></a>
</p>

<p align="center">
  <b>Professional irrigation manager for Home Assistant</b>: its own panel, drag &amp; drop groups,<br>
  programs with multiple start times, simultaneous zones, smart conditions and native <b>Rain Bird</b> support.<br>
  <sub>🇬🇧 English · 🇪🇸 <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/README.es.md">Español</a></sub>
</p>

---

## ✨ Highlights

<table>
<tr>
<td width="33%" valign="top">

### 🧩 Drag &amp; drop
Drag your Home Assistant devices into groups, then build each program's sequence by dragging groups and sprinklers. Works with a mouse and on touch screens.

</td>
<td width="33%" valign="top">

### 🗓️ Flexible programs
Several start times per day (fixed time, sunrise or sunset). Weekdays, every N days, days of the month, odd or even days, specific dates and active months.

</td>
<td width="33%" valign="top">

### 💦 Run them your way
Sequential, or 2, 3, 4… sprinklers at once with a rolling queue. The same duration for all or **one by one**, in the order you choose.

</td>
</tr>
<tr>
<td valign="top">

### 🌦️ Smart conditions
Rain sensors, accumulated mm, weather, frost, solar power or battery, or any Jinja template. They can be **re-checked while watering** and stop the run if they no longer pass.

</td>
<td valign="top">

### 📊 Interactive timeline
See every sprinkler on a Gantt chart and adjust it **by dragging**: the edge changes the duration and the bar changes the order. Zoom for long cycles, with live duration and litres.

</td>
<td valign="top">

### 🛡️ Safe by design
Master valve or pump, a hydraulic limit on simultaneous sprinklers, a maximum time per sprinkler, valves closed after a restart and unavailable sprinklers skipped.

</td>
</tr>
</table>

## 🧭 How it works

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/flow.png" alt="Sprinklers → Groups → Programs → Conditions → Watering" width="100%"></p>

## 📸 Screenshots

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/dashboard.png" alt="Live dashboard" width="100%"></p>

<table>
<tr><th width="50%">Drag &amp; drop groups</th><th width="50%">Program editor with preview</th></tr>
<tr><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/groups.png" alt="Groups"></td><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/program-editor.png" alt="Program editor"></td></tr>
<tr><th>Custom conditions</th><th>Programs (dark theme)</th></tr>
<tr><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/conditions.png" alt="Conditions"></td><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/programs.png" alt="Programs"></td></tr>
</table>

> 💡 Want to try the interface without installing anything? Open [`dev/demo.html`](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/dev/demo.html) from a local web server (see [Development](#-development)).

## 🧩 Dashboard cards

The integration ships 4 cards that **load automatically**: no resources to add. Edit a dashboard → **Add card** → search for **"SK Irrigation"**.

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/cards.png" alt="Dashboard cards" width="100%"></p>

| Card | What it shows | Options |
|---|---|---|
| `custom:sk-irrigation-status-card` | Current run with countdown, active sprinklers, skip/stop, next run, conditions, system and rain delay | `title`, `show_controls` |
| `custom:sk-irrigation-programs-card` | Cycles with start times, duration, next run, a warning if it would not run, enable and run now | `title`, `show_run`, `show_disabled` |
| `custom:sk-irrigation-groups-card` | Groups with their live sprinklers and quick group watering | `title`, `group`, `columns`, `minutes`, `concurrency` |
| `custom:sk-irrigation-zones-card` | Sprinkler grid with state, last run and manual watering | `title`, `group`, `columns`, `minutes` |

`columns` sets the number of columns (for example `8` for a full-width card). Leave it empty to fit automatically.

```yaml
type: custom:sk-irrigation-groups-card
title: Front watering
group: Front yard   # name or id; empty = all
minutes: [5, 10, 15]
concurrency: 2
columns: 3
```

## 🚀 Installation

### HACS (recommended)
1. Click the **Open in HACS** button above, or in HACS → ⋮ → **Custom repositories** add
   `https://github.com/SkynetCom/sk-irrigation-manager-ha` with the **Integration** category.
2. Install **SK Irrigation Manager** and **restart Home Assistant**.
3. **Settings → Devices & services → + Add integration → SK Irrigation Manager** (or the **Add integration** button above).
4. **Irrigation** appears in the sidebar. If you don't see it, reload the browser with Ctrl+F5.

### Manual
Copy `custom_components/sk_irrigation` into `config/custom_components/`, restart and continue from step 3.

| Requirement | Version |
|---|---|
| Home Assistant | 2024.11 or later |
| Own icon in the integrations list | 2026.3 or later (older versions show a generic icon) |

## ⚡ Get started in 3 steps

1. **Groups** → drag your sprinklers into groups, or click **Create groups from HA areas**.
2. **Programs** → **New program** → pick days and start times → drag groups into the sequence. For each group, set how many sprinklers run at once, the duration (same for all or one by one) and the start order.
3. **Settings** → add your conditions (rain, weather, energy…) and, if you have one, the master valve or pump.

Done! The **Dashboard** shows the next run, live progress with a countdown and the state of every condition.

The interface is available in **English and Spanish** and follows your Home Assistant language.

## 🌦️ Conditions: examples

| Need | Type | Setup |
|---|---|---|
| Don't water while it rains | State | `sensor.precipitation_description` **is** `no_rain` |
| Don't water after ≥ 5 mm of rain today | Numeric | `sensor.rain_today` **below** `5` · if unavailable → *ignore* |
| Only with the generator off | Numeric | `sensor.grid_power` **below** `50` · ✅ *re-check while watering* |
| Protect the battery | Numeric | `sensor.battery_soc` **above** `20` · ✅ *re-check while watering* |
| Advanced logic | Template | `{{ states('sensor.wind') \| float(0) < 30 and now().hour < 9 }}` |

Conditions can be **global** (they apply to every program) or **for one program only**. Optionally, they also apply to manual runs and services.

## 🔄 Coming from YAML scripts and automations?

| Before (YAML) | Now |
|---|---|
| Script with `repeat: for_each` + a `delay` per sprinkler | One program with an order and a duration per sprinkler |
| Several script calls with different durations | Sequence steps, or a group with **one-by-one** durations |
| `condition:` in the automation and inside the loop | Global or per-program conditions, with **re-checking** |
| `mode: queued` | Built-in run queue |
| "STOP IRRIGATION" script | **Stop all** button / `sk_irrigation.stop_all` service |
| Helper `timer` for the countdown | **Next run** and **Current sprinkler** sensors (`ends_at`, `remaining_seconds`) |

Your configuration can be **exported and imported** as JSON from *Settings → Backup*.

## 🆚 Comparison

| | Irrigation Unlimited | Smart Irrigation | Rain Bird (official) | **SK Irrigation Manager** |
|---|:---:|:---:|:---:|:---:|
| Fully visual configuration | ❌ YAML | ⚠️ Calculation only | ❌ | ✅ |
| Drag &amp; drop groups | ❌ | ❌ | ❌ | ✅ |
| N sprinklers at once per step | ⚠️ | ❌ | ❌ | ✅ |
| Order and duration per sprinkler | ⚠️ YAML | ❌ | ❌ | ✅ |
| Several start times per day, sun, seasons | ✅ | — | ❌ | ✅ |
| Conditions re-checked live | ⚠️ Templates | ❌ | ❌ | ✅ |
| Preview / Gantt | ❌ | ❌ | ❌ | ✅ |
| Water budget | ✅ | ✅ | ❌ | ✅ (including the Smart Irrigation sensor) |
| Exact duration on Rain Bird | — | — | ⚠️ Fixed | ✅ `rainbird.start_irrigation` |

## 🧱 Entities and services

| Entity | Description |
|---|---|
| **Status** (sensor) | `idle`, `running`, `paused`, `rain_delay`, `disabled` + attributes (program, active sprinklers, queue, reasons) |
| **Next run** (sensor) | Date and time of the next run, and its program |
| **Current sprinkler** (sensor) | What is watering now, `ends_at` and `remaining_seconds` |
| **Remaining time** (sensor) | Minutes left in the current run |
| **Active zones** (sensor) | Number of sprinklers watering |
| **Irrigation system** (switch) | Enables or disables all programs |
| **Program …** (switch) | One switch per program |

| Service | Use |
|---|---|
| `sk_irrigation.run_program` | Run a program (`program`: name or id) |
| `sk_irrigation.run_group` | Water a group (`group`, `duration`, `concurrency`) |
| `sk_irrigation.run_zone` | Water one sprinkler (`zone`: name or entity_id, `duration`) |
| `sk_irrigation.skip` | Skip to the next sprinkler |
| `sk_irrigation.stop_all` | Stop everything and clear the queue |
| `sk_irrigation.set_rain_delay` | Pause for N hours (0 = clear) |

```yaml
# Example: extra front watering on hot days
automation:
  - alias: Extra watering on hot days
    triggers:
      - trigger: numeric_state
        entity_id: sensor.outdoor_temperature
        above: 35
    actions:
      - action: sk_irrigation.run_group
        data:
          group: "Front yard"
          duration: 5
          concurrency: 2
```

## 💧 Rain Bird
The official Rain Bird integration opens a zone with a default duration. SK Irrigation Manager recognizes entities from the `rainbird` platform and calls `rainbird.start_irrigation` with each sprinkler's **exact duration**. It also closes the zone when it finishes or is skipped. Several controllers work at once (for example, 24 stations on 3 controllers). If your controller limits how many zones can run together, set the **maximum simultaneous sprinklers** in *Settings*.

## ❓ FAQ

<details><summary><b>Does it work with sprinklers that are not Rain Bird?</b></summary>

Yes: with any `switch`, `valve`, `input_boolean`, `light` or `fan` entity (OpenSprinkler, Shelly, Sonoff, ESPHome, Zigbee, Z-Wave, relays…).
</details>

<details><summary><b>What happens if Home Assistant restarts in the middle of a run?</b></summary>

When it comes back, the integration detects the interrupted run and **closes every valve** for safety. The cycle does not resume automatically.
</details>

<details><summary><b>What if a sprinkler is unavailable?</b></summary>

It is skipped, logged in the history, and the sequence continues with the next one.
</details>

<details><summary><b>Can two programs overlap?</b></summary>

They never run over each other: the second one **waits in the queue** or is **skipped**, depending on the program setting.
</details>

<details><summary><b>I don't see "Irrigation" in the sidebar</b></summary>

Make sure you added the integration (step 3 of the installation) and reload the browser with Ctrl+F5. In the mobile app, close it and open it again.
</details>

## 🛠️ Development

```bash
# UI demo with a mocked backend (no Home Assistant needed)
python3 -m http.server 8765   # then open http://localhost:8765/dev/demo.html (add ?lang=es for Spanish)

# Tests: pure logic + integration with a real HA (pytest-homeassistant-custom-component)
pip install pytest-homeassistant-custom-component
pytest tests
```

Layout: `custom_components/sk_irrigation/` (engine, scheduler, websocket API, entities), `frontend/` (dependency-free web panel), `brand/` (icons for HA 2026.3+), `tests/`, `dev/demo.html`.

Release history in [CHANGELOG.md](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/CHANGELOG.md).

## ☕ Support the project
If SK Irrigation Manager saves you water and time, you can buy me a coffee so I can keep improving it. Thank you!

<p align="center"><a href="https://www.paypal.com/donate/?business=gerencia%40skynetcom.com.ar&currency_code=USD&item_name=SK+Irrigation+Manager"><img src="https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-PayPal-ffdd00?logo=paypal&logoColor=003087&labelColor=ffdd00&style=for-the-badge" alt="Buy me a coffee"></a></p>

## 📄 License
[MIT](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/LICENSE) © SK / SkynetCom
