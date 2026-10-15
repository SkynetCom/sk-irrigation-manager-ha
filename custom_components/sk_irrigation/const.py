"""Constants for SK Irrigation Manager."""
from __future__ import annotations

DOMAIN = "sk_irrigation"
NAME = "SK Irrigation Manager"
VERSION = "1.3.0"

STORAGE_KEY = f"{DOMAIN}.data"
STORAGE_VERSION = 1

PANEL_URL_PATH = "sk-irrigation"
PANEL_COMPONENT = "sk-irrigation-panel"
PANEL_ICON = "mdi:sprinkler-variant"
STATIC_URL = "/sk_irrigation_static"

CONF_SIDEBAR_TITLE = "sidebar_title"
CONF_REQUIRE_ADMIN = "require_admin"
DEFAULT_SIDEBAR_TITLE = "Riego"

SIGNAL_UPDATE = f"{DOMAIN}_update"
SIGNAL_PROGRAMS_CHANGED = f"{DOMAIN}_programs_changed"

# Entity domains that can act as a sprinkler / valve / relay.
SUPPORTED_DOMAINS = ("switch", "valve", "input_boolean", "light", "fan")

# Integrations that need a duration when the valve is opened (the controller
# closes the zone on its own after its internal default otherwise).
RAINBIRD_PLATFORM = "rainbird"

# Schedule modes
MODE_WEEKDAYS = "weekdays"
MODE_INTERVAL = "interval"
MODE_MONTHDAYS = "monthdays"
MODE_ODD = "odd"
MODE_EVEN = "even"
MODE_DATES = "dates"
SCHEDULE_MODES = (MODE_WEEKDAYS, MODE_INTERVAL, MODE_MONTHDAYS, MODE_ODD, MODE_EVEN, MODE_DATES)

# Start time types
START_FIXED = "fixed"
START_SUNRISE = "sunrise"
START_SUNSET = "sunset"

# Duration modes of a program step
DURATION_UNIFORM = "uniform"
DURATION_CUSTOM = "custom"

# Run sources
SOURCE_SCHEDULE = "schedule"
SOURCE_MANUAL = "manual"
SOURCE_SERVICE = "service"

# Run status
STATUS_COMPLETED = "completed"
STATUS_STOPPED = "stopped"
STATUS_SKIPPED = "skipped"
STATUS_ERROR = "error"

RAIN_WEATHER_CONDITIONS = ["rainy", "pouring", "lightning-rainy", "snowy", "snowy-rainy", "hail"]

DEFAULT_SETTINGS = {
    "enabled": True,
    "rain_delay_until": None,
    "rain_sensors": [],
    "weather_entity": None,
    "weather_conditions": RAIN_WEATHER_CONDITIONS,
    "freeze_sensor": None,
    "freeze_threshold": 3.0,
    "budget_entity": None,
    "global_budget": 100,
    "master_entity": None,
    "master_lead_s": 3,
    "master_lag_s": 3,
    "max_concurrent": 0,
    "zone_delay_s": 5,
    "step_delay_s": 10,
    "max_zone_minutes": 120,
    "history_size": 60,
    "notify_service": None,
    "conditions": [],
    "manual_conditions": True,
}

# Custom conditions
COND_STATE = "state"
COND_NUMERIC = "numeric"
COND_TEMPLATE = "template"
COND_TYPES = (COND_STATE, COND_NUMERIC, COND_TEMPLATE)
UNAVAILABLE_STATES = ("unavailable", "unknown", "none", "")
