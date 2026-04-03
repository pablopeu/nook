#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


PLUGIN_FILES = [
    "settings.yml",
    "full.liquid",
    "half_horizontal.liquid",
    "half_vertical.liquid",
    "quadrant.liquid",
]


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    plugin_dir = repo_root / "plugin"
    dist_dir = repo_root / "dist"
    dist_dir.mkdir(exist_ok=True)

    output_path = dist_dir / "nook-weather-trmnl.zip"

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as archive:
        for filename in PLUGIN_FILES:
            path = plugin_dir / filename
            if not path.is_file():
                raise FileNotFoundError(f"Missing plugin file: {path}")
            archive.write(path, arcname=filename)

    print(output_path)


if __name__ == "__main__":
    main()
