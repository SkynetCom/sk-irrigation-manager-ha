"""Background images for the Map tab (drone photos or site plans)."""
from __future__ import annotations

from http import HTTPStatus
import logging
import os
from pathlib import Path
import uuid

from aiohttp import web

from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN, FILES_URL
from .model import map_image_files

_LOGGER = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 25 * 1024 * 1024
_SIGNATURES = {b"\xff\xd8\xff": ".jpg", b"\x89PNG": ".png", b"RIFF": ".webp"}


def files_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.path(DOMAIN))


def maps_dir(hass: HomeAssistant) -> Path:
    return files_dir(hass) / "maps"


async def async_register_files(hass: HomeAssistant) -> None:
    """Serve uploaded map images and accept new uploads."""
    folder = maps_dir(hass)
    await hass.async_add_executor_job(lambda: folder.mkdir(parents=True, exist_ok=True))
    await hass.http.async_register_static_paths([
        StaticPathConfig(FILES_URL, str(files_dir(hass)), cache_headers=True)
    ])
    hass.http.register_view(MapImageView(hass))


def _extension(head: bytes) -> str | None:
    for sig, ext in _SIGNATURES.items():
        if head.startswith(sig):
            return ext if ext != ".webp" or head[8:12] == b"WEBP" else None
    return None


class MapImageView(HomeAssistantView):
    """POST a JPEG/PNG/WebP image; answers with the URL it is served from."""

    url = "/api/sk_irrigation/map_image"
    name = "api:sk_irrigation:map_image"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        hass = self.hass
        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json_message("Admin required", HTTPStatus.UNAUTHORIZED)
        reader = await request.multipart()
        field = await reader.next()
        if field is None:
            return self.json_message("No file", HTTPStatus.BAD_REQUEST)
        data = bytearray()
        while chunk := await field.read_chunk(256 * 1024):
            data.extend(chunk)
            if len(data) > MAX_IMAGE_BYTES:
                return self.json_message("Image too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        ext = _extension(bytes(data[:16]))
        if not ext:
            return self.json_message("Unsupported image type", HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        name = f"{uuid.uuid4().hex}{ext}"
        path = maps_dir(hass) / name

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bytes(data))

        await hass.async_add_executor_job(_write)
        return self.json({"url": f"{FILES_URL}/maps/{name}"})


async def async_cleanup_images(hass: HomeAssistant, maps: list[dict]) -> None:
    """Delete uploaded images that no map uses any more."""
    keep = map_image_files(maps)
    folder = maps_dir(hass)

    def _clean() -> None:
        if not folder.is_dir():
            return
        for entry in os.scandir(folder):
            if entry.is_file() and entry.name not in keep:
                try:
                    os.remove(entry.path)
                except OSError:
                    _LOGGER.debug("Could not delete %s", entry.path)

    await hass.async_add_executor_job(_clean)
