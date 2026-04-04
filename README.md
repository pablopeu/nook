# nook

Estado actual:

- `references/`: archivos originales reubicados para referencia visual y funcional
- `mockup/`: base activa del layout, ahora preparada como variante `800x600` estirada para seguir ajustando
- `server/`: endpoint PHP que consulta Meteoblue y normaliza el JSON
- `workers/nook-weather-worker/`: port del endpoint a Cloudflare Workers
- `plugin/`: paquete privado TRMNL con `settings.yml` y plantillas Liquid
- `scripts/`: utilidades de build, incluido el ZIP importable del plugin
- `versions/trmnl-og-780x480/`: snapshot reproducible de la versión estable actual
- `docs/`: plan de implementación

## Mockup

Levantar el mockup con datos demo:

```bash
cd mockup
python3 -m http.server 8123
```

Abrir:

```text
http://127.0.0.1:8123/index.html?demo=1
```

Si el endpoint está disponible, el mockup puede consumirlo directamente:

```text
http://127.0.0.1:8123/index.html?endpoint_base_url=http://127.0.0.1:8080/weather.php&mode=city&city=Buenos%20Aires&country=Argentina&units=c
```

## Endpoint

El endpoint está en [weather.php](/home/pablo/nook/server/weather.php) y usa `METEOBLUE_API_KEY`.

Podés guardarla localmente en `server/.env.local` sin trackearla en Git:

```bash
cp server/.env.example server/.env.local
```

Ejemplo de arranque:

```bash
cd server
METEOBLUE_API_KEY=tu_api_key php -S 0.0.0.0:8080
```

Ejemplos:

```text
http://127.0.0.1:8080/weather.php?mode=city&city=Buenos%20Aires&country=Argentina&units=c
http://127.0.0.1:8080/weather.php?mode=coords&lat=-34.6037&lon=-58.3816&units=f
```

Nota:

- Meteoblue entrega 7 filas diarias y 169 horas. El endpoint usa la serie horaria para construir los 7 bloques inferiores desde hoy y las próximas 12 horas del bloque central.

## Cloudflare Workers

El port del endpoint a Workers quedó en:

- `workers/nook-weather-worker/package.json`
- `workers/nook-weather-worker/wrangler.jsonc`
- `workers/nook-weather-worker/src/index.js`
- `workers/nook-weather-worker/README.md`

Rutas soportadas por el Worker:

- `/`
- `/weather`
- `/weather.php`
- `/server/weather.php`

Eso permite reutilizar el `polling_url` actual del plugin.

## Plugin TRMNL

El paquete privado quedó en:

- `plugin/settings.yml`
- `plugin/full.liquid`
- `plugin/half_horizontal.liquid`
- `plugin/half_vertical.liquid`
- `plugin/quadrant.liquid`

Generar el ZIP importable:

```bash
python3 scripts/build_plugin_zip.py
```

Salida:

```text
dist/nook-weather-trmnl.zip
```

El campo `Endpoint Base URL` del plugin debe apuntar a la base pública de tu servidor, por ejemplo:

```text
http://192.168.68.130:8123
```

Si usás Cloudflare Workers, el valor pasa a ser la base pública del Worker:

```text
https://nook-weather-worker.<tu-subdominio>.workers.dev
```
