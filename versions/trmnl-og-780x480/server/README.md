# Weather endpoint

`weather.php` expone un JSON normalizado para el mockup y para el futuro plugin TRMNL.

## Requisitos

- PHP 8.2 o superior
- Variable de entorno `METEOBLUE_API_KEY`

Alternativa local sin exponer la key al repo:

```bash
cp .env.example .env.local
```

## Ejecutar localmente

```bash
cd server
METEOBLUE_API_KEY=tu_api_key php -S 0.0.0.0:8080
```

## Ejemplos

Modo ciudad:

```text
http://localhost:8080/weather.php?mode=city&city=Buenos%20Aires&country=Argentina&units=c
```

Modo coordenadas:

```text
http://localhost:8080/weather.php?mode=coords&lat=-34.6037&lon=-58.3816&units=c
```

## Respuesta

El contrato devuelve:

- `meta`: ubicación, unidades y request resuelto
- `current`: temperatura actual, mínima, máxima, sensación, humedad, presión
- `hero`: icono predominante en la ventana de 12 horas
- `hours`: 12 horas consecutivas desde la hora completa siguiente a `last_updated`
- `days`: 7 días con mínima, máxima, precipitación e icono predominante

La fuente actual es Meteoblue:

- forecast: `basic-1h_basic-day_current`
- búsqueda de ciudad/país: `Location Search API`
