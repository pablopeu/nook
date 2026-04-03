# Plugin de clima TRMNL basado en `Plantilla.jpg`

## Summary
- Construir este repo para entregar 3 piezas juntas: mockup HTML/CSS para debug rápido, endpoint PHP liviano para consultar WeatherAPI y normalizar datos, y paquete de plugin TRMNL importable en LaraPaper/TRMNL.
- Tomar `Plantilla.jpg` como única fuente visual. No se introduce ninguna variación de diseño.
- Mover los archivos sueltos actuales del root a `references/` sin borrarlos ni renombrarlos.

## Implementation Changes
- Estructura del repo: crear `references/`, `mockup/`, `server/`, `plugin/` y `docs/`. Los archivos actuales (`Plantilla.jpg`, `Plantilla.cdr`, `iconos.txt`, `Iconos TRMNL.html`, `Weather Chum v2.txt`) pasan a `references/`.
- Mockup: crear `mockup/index.html` con CSS/JS propio, blanco y negro, proporciones y divisiones iguales a `Plantilla.jpg`: banda superior `25% / 25% / 50%`, banda media con 12 columnas iguales, banda inferior con 7 columnas iguales.
- Mockup: leer query params `endpoint_base_url`, `mode`, `city`, `country`, `lat`, `lon`, `units` y consumir el mismo JSON que usará el plugin real.
- Endpoint PHP: exponer `GET /weather.php` con `mode=city|coords`, `city`, `country`, `lat`, `lon`, `units=c|f`. Leer `WEATHERAPI_KEY` desde variable de entorno, consultar `forecast.json` de WeatherAPI con 7 días y devolver un JSON ya adaptado al layout.
- Endpoint PHP: validar inputs, normalizar respuestas, cachear por consulta normalizada durante 10 minutos y devolver siempre un payload consistente con `ok`, `error`, `meta`, `current`, `hero`, `hours`, `days`.
- Contrato JSON: `current` incluye temperatura actual, mínima y máxima de hoy, sensación térmica, humedad, presión, hora local y `last_updated`. `hero` contiene el icono grande superior. `hours` contiene 12 entradas horarias. `days` contiene 7 entradas diarias.
- Horas: la franja central usa 12 horas consecutivas empezando en la siguiente hora completa posterior a `last_updated`. Cada item lleva `time_label`, `icon_url` y `condition_text`.
- Icono principal superior: se calcula sobre esa misma ventana de 12 horas y representa la condición predominante. Si hay empate, desempatar por severidad meteorológica y luego por aparición más temprana.
- Días: la franja inferior usa las 7 jornadas devueltas por WeatherAPI, incluyendo hoy. Cada item lleva `day_label` en español de 3 letras (`Lun`, `Mar`, `Mie`, `Jue`, `Vie`, `Sab`, `Dom`), `min`, `max`, `%` de precipitación, `icon_url` y `condition_text`.
- Iconos: implementar una tabla de mapeo de `condition.code` de WeatherAPI a iconos TRMNL tomados de `iconos.txt`, con variantes día/noche cuando corresponda. Fallback a un icono neutro de nubes si no hay match exacto.
- Plugin TRMNL: generar archivos flat `settings.yml`, `full.liquid`, `half_horizontal.liquid`, `half_vertical.liquid`, `quadrant.liquid`, listos para zip/import.
- `settings.yml`: usar `strategy: polling`, `refresh_interval: 15`, `polling_verb: GET`, y `polling_url` dinámico basado en custom fields.
- Custom fields del plugin: `endpoint_base_url` (`url`), `location_mode` (`select`: city / coords), `city` (`string`), `country` (`string`), `lat` (`number`), `lon` (`number`), `units` (`select`: c / f).
- Validaciones TRMNL: `city` y `country` son requeridos solo en modo `city`; `lat` y `lon` solo en modo `coords`, usando `conditional_validation`.
- `full.liquid`: replicar `Plantilla.jpg` exactamente. Superior izquierda: temperatura actual y mínima/máxima del día. Superior centro: icono resumen 12h. Superior derecha: exactamente `Sensación térmica`, `Humedad`, `Presión`. Banda media: 12 iconos horarios con su hora. Banda inferior: 7 columnas con orden visual `min`, `max`, `% precip`, icono, día.
- Layouts resumidos: `half_horizontal` conserva el lenguaje visual con franja superior equivalente, 6 horas y 4 días. `half_vertical` muestra actual, icono principal, las 3 métricas de la derecha, 4 horas y 3 días. `quadrant` muestra actual, min/max de hoy, icono principal y las 3 métricas de la derecha.
- Errores: si faltan parámetros, falla WeatherAPI, no hay clave o faltan datos, devolver `ok: false` y renderizar un estado de error simple y centrado tanto en mockup como en Liquid.

## Test Plan
- Probar ambos modos de consulta: `city+country` y `lat+lon`, además de inputs inválidos, falta de `WEATHERAPI_KEY` y errores remotos.
- Verificar shape del JSON, conteo de 12 horas y 7 días, abreviaturas de días, conversión de unidades y fallback de iconos.
- Verificar que la franja horaria empieza en la hora siguiente a `last_updated` y que el icono grande resume esa misma ventana.
- Comparar visualmente el mockup contra `Plantilla.jpg` al mismo aspect ratio hasta igualar espaciados, bordes y jerarquía tipográfica.
- Importar el ZIP en LaraPaper/TRMNL y validar custom fields, URL dinámica de polling y render correcto en los 4 tamaños sin errores de Liquid.

## Assumptions and References
- `Plantilla.jpg` es la referencia visual válida; el archivo `plantilla.jpg` ya no participa.
- El endpoint PHP se entrega como servicio liviano separado, alojado en el mismo Debian que LaraPaper, sin modificar el código interno de LaraPaper.
- La presión se muestra siempre en `hPa`. Las temperaturas se muestran redondeadas a enteros con `°`.
- La definición del ZIP privado, `settings.yml`, URLs dinámicas y custom fields se validó con la documentación de TRMNL: [private plugins](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins), [dynamic polling URLs](https://help.trmnl.com/en/articles/12689499-dynamic-polling-urls), [custom form builder](https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder).
- El encaje con tu hosting actual se validó con [LaraPaper](https://github.com/usetrmnl/larapaper) y el flujo local de plugins con [trmnlp](https://github.com/usetrmnl/trmnlp). Los datos meteorológicos salen de [WeatherAPI docs](https://www.weatherapi.com/docs/).
