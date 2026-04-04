# Cloudflare Worker

Este Worker reemplaza el endpoint PHP y conserva el mismo contrato JSON para el mockup y el plugin TRMNL.

Rutas soportadas:

- `/`
- `/weather`
- `/weather.php`
- `/server/weather.php`

Eso permite reutilizar el `polling_url` actual del plugin sin cambiar la ruta final.

## Requisitos

- Node.js 20+
- una cuenta de Cloudflare
- `METEOBLUE_API_KEY` como secret del Worker

## Instalar dependencias

```bash
cd workers/nook-weather-worker
npm install
```

Para desarrollo local podés copiar:

```bash
cp .dev.vars.example .dev.vars
```

## Login en Cloudflare

```bash
npx wrangler login
```

## Guardar la API key como secret

```bash
npx wrangler secret put METEOBLUE_API_KEY
```

## Desarrollo local

```bash
npm run dev
```

Ejemplo:

```text
http://127.0.0.1:8787/server/weather.php?mode=city&city=Buenos%20Aires&country=AR&units=c
```

## Verificación local rápida

Modo ciudad:

```text
http://127.0.0.1:8787/server/weather.php?mode=city&city=Buenos%20Aires&country=AR&units=c
```

Modo coordenadas:

```text
http://127.0.0.1:8787/server/weather.php?mode=coords&lat=-34.6037&lon=-58.3816&units=f
```

## Deploy

```bash
npm run deploy
```

Cloudflare te va a devolver una URL `https://<nombre>.workers.dev`.

## Integración con el plugin TRMNL

En `Endpoint Base URL` del plugin poné solo la base del Worker:

```text
https://nook-weather-worker.<tu-subdominio>.workers.dev
```

El plugin ya agrega `/server/weather.php?...`, y el Worker acepta esa ruta.

## Dominio propio

Si después querés usar un dominio tuyo, agregalo en Cloudflare y apuntá el plugin a esa base pública:

```text
https://weather.tudominio.com
```
