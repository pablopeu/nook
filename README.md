# nook

Estado actual:

- `references/`: archivos originales reubicados para referencia visual y funcional
- `mockup/`: HTML/CSS/JS del layout basado en `Plantilla.jpg`
- `server/`: endpoint PHP que consulta Meteoblue y normaliza el JSON
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
