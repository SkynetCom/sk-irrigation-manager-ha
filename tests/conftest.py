"""Load the pure-python modules of the integration without Home Assistant."""
import importlib
import pathlib
import sys
import types

PKG_DIR = pathlib.Path(__file__).resolve().parents[1] / "custom_components" / "sk_irrigation"

pkg = types.ModuleType("ski_pure")
pkg.__path__ = [str(PKG_DIR)]
sys.modules["ski_pure"] = pkg

model = importlib.import_module("ski_pure.model")

# Import the repository's custom_components package before Home Assistant puts
# its own testing_config folder on sys.path, so the loader finds our integration.
sys.path.insert(0, str(PKG_DIR.parents[1]))
try:
    import custom_components  # noqa: F401,E402
except ImportError:  # pragma: no cover
    pass
