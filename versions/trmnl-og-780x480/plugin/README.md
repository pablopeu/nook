# TRMNL private plugin

Contenido del paquete privado:

- `settings.yml`
- `full.liquid`
- `half_horizontal.liquid`
- `half_vertical.liquid`
- `quadrant.liquid`

## Uso

1. Configurar el endpoint PHP del repo.
2. Generar el ZIP importable:

```bash
python3 scripts/build_plugin_zip.py
```

3. Importar `dist/nook-weather-trmnl.zip` desde la pantalla de Private Plugins de TRMNL.

## Campo requerido

`Endpoint Base URL` debe apuntar a la base pública donde vive este repo o el endpoint.

Ejemplos:

- `https://weather.example.com`
- `http://192.168.68.130:8123`

El plugin construye automáticamente:

```text
<base>/server/weather.php?mode=...
```

## Notas

- Las keys de Meteoblue no van dentro del plugin; quedan del lado del servidor.
- El layout `full` replica el mockup aprobado.
- Los otros 3 tamaños usan el mismo contrato JSON pero resumido.
