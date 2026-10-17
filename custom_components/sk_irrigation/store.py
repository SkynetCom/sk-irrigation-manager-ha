"""Persistent storage for SK Irrigation Manager."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .model import normalize_all

SAVE_DELAY = 2


class IrrigationStore:
    """Wraps a HA Store holding config, history and zone statistics."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.config: dict = normalize_all({})
        self.history: list[dict] = []
        self.zone_stats: dict[str, dict] = {}
        self.interrupted = False

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.config = normalize_all(data.get("config", {}))
        self.history = data.get("history", [])
        self.zone_stats = data.get("zone_stats", {})
        self.interrupted = bool(data.get("interrupted", False))

    def _data(self) -> dict:
        return {
            "config": self.config,
            "history": self.history,
            "zone_stats": self.zone_stats,
            "interrupted": self.interrupted,
        }

    def schedule_save(self) -> None:
        self._store.async_delay_save(self._data, SAVE_DELAY)

    async def async_update(self, key: str, value: Any) -> None:
        draft = dict(self.config)
        if key == "layout":
            # zones + groups saved together so new sprinklers and their group
            # membership land in a single, consistent write.
            draft.update({k: value[k] for k in ("zones", "groups") if k in value})
        elif key in ("zones", "groups", "programs", "settings", "maps"):
            draft[key] = value
        else:
            raise ValueError(f"Unknown key {key}")
        # Re-normalise everything so deleted zones/groups vanish from references.
        self.config = normalize_all(draft)
        await self._store.async_save(self._data())

    async def async_replace(self, config: dict) -> None:
        self.config = normalize_all(config)
        await self._store.async_save(self._data())

    def add_history(self, entry: dict) -> None:
        self.history.insert(0, entry)
        del self.history[self.config["settings"]["history_size"]:]
        self.schedule_save()

    def update_zone_stat(self, zone_id: str, end_iso: str, seconds: int) -> None:
        stat = self.zone_stats.setdefault(zone_id, {"last": None, "last_seconds": 0, "total_seconds": 0})
        stat["last"] = end_iso
        stat["last_seconds"] = seconds
        stat["total_seconds"] = stat.get("total_seconds", 0) + seconds
        self.schedule_save()

    def set_interrupted(self, value: bool) -> None:
        self.interrupted = value
        self.schedule_save()
