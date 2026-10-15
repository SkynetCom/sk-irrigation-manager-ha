"""Config flow for SK Irrigation Manager."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import CONF_REQUIRE_ADMIN, CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE, DOMAIN, NAME


def _schema(defaults: dict) -> vol.Schema:
    return vol.Schema({
        vol.Optional(CONF_SIDEBAR_TITLE, default=defaults.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE)): str,
        vol.Optional(CONF_REQUIRE_ADMIN, default=defaults.get(CONF_REQUIRE_ADMIN, False)): bool,
    })


class SKIrrigationConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single instance config flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title=NAME, data=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SKIrrigationOptionsFlow()


class SKIrrigationOptionsFlow(OptionsFlow):
    """Options: sidebar title and access."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="init", data_schema=_schema(current))
