# TRMNL OG 780x480 Snapshot

Esta carpeta congela la versión estable del plugin y mockup ajustada para el TRMNL OG.

Incluye:

- `mockup/`: HTML/CSS/JS del layout archivado
- `plugin/`: paquete privado TRMNL archivado
- `server/`: endpoint PHP compatible con esta versión
- `scripts/build_plugin_zip.py`: genera el ZIP importable de esta snapshot
- `docs/implementation-plan.md`: plan original usado como base

## Reconstrucción

Generar ZIP importable desde esta snapshot:

```bash
python3 versions/trmnl-og-780x480/scripts/build_plugin_zip.py
```

Salida:

```text
versions/trmnl-og-780x480/dist/nook-weather-trmnl.zip
```

Levantar el endpoint archivado:

```bash
cd versions/trmnl-og-780x480/server
METEOBLUE_API_KEY=tu_api_key php -S 0.0.0.0:8080
```

## Nota

La rama `main` queda libre para evolucionar una variante nueva, por ejemplo `800x600`, sin perder esta base reproducible.
