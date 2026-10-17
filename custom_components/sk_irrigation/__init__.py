"""SK Irrigation Manager for Home Assistant."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_REQUIRE_ADMIN,
    CONF_SIDEBAR_TITLE,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
    default_sidebar_title,
)
from .engine import IrrigationEngine
from .maps import async_register_files
from .services import async_register_services, async_unregister_services
from .store import IrrigationStore
from .websocket_api import async_register_websocket

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.SWITCH]
CARDS_BASE_URL = f"{STATIC_URL}/sk-irrigation-cards.js"
CARDS_URL = f"{CARDS_BASE_URL}?v={VERSION}"
# The global module uses its own URL: if the browser already tried CARDS_URL
# while HA was starting (404 before our static path existed), it caches that
# failure, and this second URL still loads once the integration is ready.
CARDS_GLOBAL_URL = f"{CARDS_URL}&load=global"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register static files as early as possible (before the config entry)."""
    await _async_register_static(hass)
    return True


async def _async_register_static(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if not domain_data.get("static_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=False)
        ])
        domain_data["static_registered"] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_register_static(hass)
    store = IrrigationStore(hass)
    await store.async_load()
    engine = IrrigationEngine(hass, store)
    await engine.async_start()

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data["engine"] = engine
    entry.runtime_data = engine

    if not domain_data.get("ws_registered"):
        async_register_websocket(hass)
        await async_register_files(hass)
        domain_data["ws_registered"] = True

    async_register_services(hass)
    await _async_register_panel(hass, entry)
    # Dashboard cards: loaded globally (card picker) and registered as a Lovelace
    # resource so dashboards opened while HA is still starting also find them.
    frontend.add_extra_js_url(hass, CARDS_GLOBAL_URL)
    await _async_register_card_resource(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_register_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    options = {**entry.data, **entry.options}
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=options.get(CONF_SIDEBAR_TITLE) or default_sidebar_title(hass.config.language),
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/sk-irrigation-panel.js?v={VERSION}",
        embed_iframe=False,
        require_admin=options.get(CONF_REQUIRE_ADMIN, False),
        config={"version": VERSION},
    )


def _lovelace_resources(hass: HomeAssistant):
    """Return the Lovelace storage resource collection, or None (YAML mode / not loaded)."""
    data = hass.data.get("lovelace")
    resources = getattr(data, "resources", None) if data is not None else None
    if resources is None or getattr(data, "resource_mode", "storage") != "storage":
        return None
    if not hasattr(resources, "async_create_item"):
        return None
    return resources


async def _async_register_card_resource(hass: HomeAssistant) -> None:
    """Create or update the dashboard resource that points to our cards."""
    try:
        resources = _lovelace_resources(hass)
        if resources is None:
            _LOGGER.debug("Lovelace resources not in storage mode; relying on extra_module_url")
            return
        if not getattr(resources, "loaded", True):
            await resources.async_load()
            resources.loaded = True
        for item in resources.async_items():
            if str(item.get("url", "")).split("?")[0] == CARDS_BASE_URL:
                if item.get("url") != CARDS_URL:
                    await resources.async_update_item(item["id"], {"res_type": "module", "url": CARDS_URL})
                return
        await resources.async_create_item({"res_type": "module", "url": CARDS_URL})
    except Exception:  # noqa: BLE001 - never block setup because of the dashboard resource
        _LOGGER.warning("Could not register the SK Irrigation dashboard cards resource", exc_info=True)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Integration deleted: drop the dashboard resource we created."""
    try:
        resources = _lovelace_resources(hass)
        if resources is None:
            return
        if not getattr(resources, "loaded", True):
            await resources.async_load()
            resources.loaded = True
        for item in list(resources.async_items()):
            if str(item.get("url", "")).split("?")[0] == CARDS_BASE_URL:
                await resources.async_delete_item(item["id"])
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Could not remove dashboard resource", exc_info=True)


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        engine: IrrigationEngine = entry.runtime_data
        await engine.async_stop()
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        frontend.remove_extra_js_url(hass, CARDS_GLOBAL_URL)
        async_unregister_services(hass)
        hass.data[DOMAIN].pop("engine", None)
    return unloaded
