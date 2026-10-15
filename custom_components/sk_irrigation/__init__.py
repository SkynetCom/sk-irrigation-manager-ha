"""SK Irrigation Manager for Home Assistant."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import (
    CONF_REQUIRE_ADMIN,
    CONF_SIDEBAR_TITLE,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .engine import IrrigationEngine
from .services import async_register_services, async_unregister_services
from .store import IrrigationStore
from .websocket_api import async_register_websocket

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.SWITCH]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = IrrigationStore(hass)
    await store.async_load()
    engine = IrrigationEngine(hass, store)
    await engine.async_start()

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data["engine"] = engine
    entry.runtime_data = engine

    if not domain_data.get("static_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=False)
        ])
        domain_data["static_registered"] = True
    if not domain_data.get("ws_registered"):
        async_register_websocket(hass)
        domain_data["ws_registered"] = True

    async_register_services(hass)
    await _async_register_panel(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_register_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    options = {**entry.data, **entry.options}
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=options.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/sk-irrigation-panel.js?v={VERSION}",
        embed_iframe=False,
        require_admin=options.get(CONF_REQUIRE_ADMIN, False),
        config={"version": VERSION},
    )


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        engine: IrrigationEngine = entry.runtime_data
        await engine.async_stop()
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        async_unregister_services(hass)
        hass.data[DOMAIN].pop("engine", None)
    return unloaded
