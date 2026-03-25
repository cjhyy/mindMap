"""Backend configuration."""

from pathlib import Path

# Project root (mindMap/)
PROJECT_DIR = Path(__file__).parent.parent.parent.resolve()

# Data directory for graph files
DATA_DIR = PROJECT_DIR / "data" / "graphs"
DATA_DIR.mkdir(parents=True, exist_ok=True)
