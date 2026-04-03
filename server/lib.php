<?php

declare(strict_types=1);

const TRMNL_ICON_PREFIX = 'https://trmnl.com/images/plugins/weather/';
const CACHE_TTL_SECONDS = 600;
const FORECAST_DAYS = 7;
const HOURLY_WINDOW_SIZE = 12;
const HERO_WINDOW_SIZE = 4;
const METEOBLUE_FORECAST_URL = 'https://my.meteoblue.com/packages/basic-1h_basic-day_current';
const METEOBLUE_SEARCH_URL = 'https://www.meteoblue.com/en/server/search/query3';
const CACHE_SCHEMA_VERSION = 'meteoblue-v5';

function load_local_env(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#') || !str_contains($trimmed, '=')) {
            continue;
        }

        [$name, $value] = explode('=', $trimmed, 2);
        $name = trim($name);
        $value = trim($value);

        if ($name === '') {
            continue;
        }

        if ((str_starts_with($value, '"') && str_ends_with($value, '"')) || (str_starts_with($value, "'") && str_ends_with($value, "'"))) {
            $value = substr($value, 1, -1);
        }

        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
}

function error_response(string $message, int $status = 400, array $extra = []): void
{
    json_response([
        'ok' => false,
        'error' => array_merge([
            'message' => $message,
            'status' => $status,
        ], $extra),
    ], $status);
    exit;
}

function request_param(string $key): ?string
{
    if (!isset($_GET[$key])) {
        return null;
    }

    $value = trim((string) $_GET[$key]);
    return $value === '' ? null : $value;
}

function validate_request(): array
{
    $mode = request_param('mode') ?? 'city';
    $units = strtolower(request_param('units') ?? 'c');

    if (!in_array($mode, ['city', 'coords'], true)) {
        error_response('Invalid mode. Use city or coords.');
    }

    if (!in_array($units, ['c', 'f'], true)) {
        error_response('Invalid units. Use c or f.');
    }

    if ($mode === 'city') {
        $city = request_param('city');
        $country = request_param('country');

        if ($city === null || $country === null) {
            error_response('City mode requires city and country.');
        }

        return [
            'mode' => $mode,
            'units' => $units,
            'city' => $city,
            'country' => $country,
            'query' => $city . ', ' . $country,
        ];
    }

    $lat = request_param('lat');
    $lon = request_param('lon');

    if ($lat === null || $lon === null) {
        error_response('Coords mode requires lat and lon.');
    }

    if (!is_numeric($lat) || !is_numeric($lon)) {
        error_response('lat and lon must be numeric.');
    }

    return [
        'mode' => $mode,
        'units' => $units,
        'lat' => (float) $lat,
        'lon' => (float) $lon,
        'query' => $lat . ',' . $lon,
    ];
}

function cache_key(array $request): string
{
    return sha1(CACHE_SCHEMA_VERSION . ':' . json_encode($request, JSON_UNESCAPED_SLASHES));
}

function cache_dir(): string
{
    $path = __DIR__ . '/cache';
    if (!is_dir($path)) {
        mkdir($path, 0775, true);
    }

    return $path;
}

function cache_path(string $key): string
{
    return cache_dir() . '/' . $key . '.json';
}

function read_cache(string $key): ?array
{
    $path = cache_path($key);
    if (!is_file($path)) {
        return null;
    }

    if (filemtime($path) < (time() - CACHE_TTL_SECONDS)) {
        return null;
    }

    $raw = file_get_contents($path);
    if ($raw === false) {
        return null;
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function write_cache(string $key, array $payload): void
{
    file_put_contents(
        cache_path($key),
        json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
    );
}

function meteoblue_api_key(): string
{
    $key = getenv('METEOBLUE_API_KEY');
    if (!is_string($key) || trim($key) === '') {
        error_response('METEOBLUE_API_KEY is not configured.', 500);
    }

    return trim($key);
}

function fetch_json(string $url, string $failureMessage): array
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 20,
            'ignore_errors' => true,
            'header' => "User-Agent: nook-weather-plugin/1.0\r\nAccept: application/json\r\n",
        ],
    ]);

    $raw = @file_get_contents($url, false, $context);
    if ($raw === false) {
        error_response($failureMessage, 502);
    }

    $status = 200;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches) === 1) {
        $status = (int) $matches[1];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        error_response($failureMessage . ' Invalid JSON response.', 502);
    }

    if ($status >= 400) {
        $message = $decoded['message'] ?? $failureMessage;
        error_response($message, 502, ['upstream_status' => $status]);
    }

    return $decoded;
}

function is_iso2(string $country): bool
{
    return strlen($country) === 2 && ctype_alpha($country);
}

function resolve_location(array $request): array
{
    if ($request['mode'] === 'coords') {
        $coords = [
            'lat' => (float) $request['lat'],
            'lon' => (float) $request['lon'],
            'name' => '',
            'region' => '',
            'country' => '',
            'timezone' => '',
        ];

        $url = METEOBLUE_SEARCH_URL . '?' . http_build_query([
            'query' => $request['lat'] . ' ' . $request['lon'],
            'itemsPerPage' => 1,
            'apikey' => meteoblue_api_key(),
        ]);
        $search = fetch_json($url, 'Could not resolve coordinates.');
        if (($search['results'][0] ?? null) !== null) {
            $result = $search['results'][0];
            $coords['name'] = (string) ($result['name'] ?? '');
            $coords['region'] = (string) ($result['admin1'] ?? '');
            $coords['country'] = (string) ($result['country'] ?? '');
            $coords['timezone'] = (string) ($result['timezone'] ?? '');
        }

        return $coords;
    }

    $country = trim((string) $request['country']);
    $params = [
        'query' => $request['city'],
        'itemsPerPage' => 20,
        'apikey' => meteoblue_api_key(),
    ];

    if (is_iso2($country)) {
        $params['iso2'] = strtoupper($country);
    }

    $search = fetch_json(METEOBLUE_SEARCH_URL . '?' . http_build_query($params), 'Could not resolve location.');
    $results = $search['results'] ?? [];
    if (!is_array($results) || $results === []) {
        error_response('Location not found.', 404);
    }

    $chosen = null;
    $cityLower = strtolower($request['city']);
    $countryLower = strtolower($country);

    foreach ($results as $result) {
        $nameMatches = strtolower((string) ($result['name'] ?? '')) === $cityLower;
        $countryMatches = $country === ''
            || strtolower((string) ($result['country'] ?? '')) === $countryLower
            || strtoupper((string) ($result['iso2'] ?? '')) === strtoupper($country);

        if ($nameMatches && $countryMatches) {
            $chosen = $result;
            break;
        }
    }

    if ($chosen === null) {
        foreach ($results as $result) {
            $countryMatches = $country === ''
                || strtolower((string) ($result['country'] ?? '')) === $countryLower
                || strtoupper((string) ($result['iso2'] ?? '')) === strtoupper($country);

            if ($countryMatches) {
                $chosen = $result;
                break;
            }
        }
    }

    if ($chosen === null) {
        $chosen = $results[0];
    }

    return [
        'lat' => (float) ($chosen['lat'] ?? 0),
        'lon' => (float) ($chosen['lon'] ?? 0),
        'name' => (string) ($chosen['name'] ?? ''),
        'region' => (string) ($chosen['admin1'] ?? ''),
        'country' => (string) ($chosen['country'] ?? ''),
        'timezone' => (string) ($chosen['timezone'] ?? ''),
    ];
}

function fetch_meteoblue(array $location, array $request): array
{
    $params = [
        'lat' => $location['lat'],
        'lon' => $location['lon'],
        'apikey' => meteoblue_api_key(),
    ];

    if ($request['units'] === 'f') {
        $params['temperature'] = 'F';
    }

    return fetch_json(
        METEOBLUE_FORECAST_URL . '?' . http_build_query($params),
        'Could not reach Meteoblue.'
    );
}

function icon_filename(string $name): string
{
    return TRMNL_ICON_PREFIX . $name . '.svg';
}

function meteoblue_icon_group(int $pictocode, bool $hourly): string
{
    if ($hourly) {
        return match (true) {
            in_array($pictocode, [1, 2, 3], true) => 'clear',
            in_array($pictocode, [4, 5, 6, 7, 8, 9], true) => 'partly_cloudy',
            in_array($pictocode, [10, 11, 12], true) => 'thunder_rain',
            in_array($pictocode, [13, 14, 15], true) => 'haze',
            in_array($pictocode, [16, 17, 18], true) => 'fog',
            in_array($pictocode, [19, 20, 21, 22], true) => 'cloudy',
            in_array($pictocode, [23, 25], true) => 'rain',
            $pictocode === 24 || $pictocode === 26 => 'snow',
            in_array($pictocode, [27, 28, 30], true) => 'thunder_rain',
            $pictocode === 29 => 'thunder_snow',
            in_array($pictocode, [31, 33], true) => 'sprinkle',
            in_array($pictocode, [32, 34], true) => 'snow',
            $pictocode === 35 => 'mix',
            default => 'cloudy',
        };
    }

    return match (true) {
        $pictocode === 1 => 'clear',
        in_array($pictocode, [2, 3], true) => 'partly_cloudy',
        in_array($pictocode, [4, 20], true) => 'cloudy',
        $pictocode === 5 => 'fog',
        in_array($pictocode, [6, 12, 14, 16], true) => 'rain',
        $pictocode === 7 => 'sprinkle',
        in_array($pictocode, [8, 21, 22, 23, 24, 25], true) => 'thunder_rain',
        in_array($pictocode, [9, 10, 13, 15, 17], true) => 'snow',
        $pictocode === 11 => 'mix',
        default => 'cloudy',
    };
}

function meteoblue_pictocode_description(int $pictocode, bool $hourly): string
{
    static $hourlyDescriptions = [
        1 => 'Clear, cloudless sky',
        2 => 'Clear, few cirrus',
        3 => 'Clear with cirrus',
        4 => 'Clear with few low clouds',
        5 => 'Clear with few low clouds and few cirrus',
        6 => 'Clear with few low clouds and cirrus',
        7 => 'Partly cloudy',
        8 => 'Partly cloudy and few cirrus',
        9 => 'Partly cloudy and cirrus',
        10 => 'Mixed with some thunderstorm clouds possible',
        11 => 'Mixed with few cirrus with some thunderstorm clouds possible',
        12 => 'Mixed with cirrus with some thunderstorm clouds possible',
        13 => 'Clear but hazy',
        14 => 'Clear but hazy with few cirrus',
        15 => 'Clear but hazy with cirrus',
        16 => 'Fog or low stratus clouds',
        17 => 'Fog or low stratus clouds with few cirrus',
        18 => 'Fog or low stratus clouds with cirrus',
        19 => 'Mostly cloudy',
        20 => 'Mostly cloudy and few cirrus',
        21 => 'Mostly cloudy and cirrus',
        22 => 'Overcast',
        23 => 'Overcast with rain',
        24 => 'Overcast with snow',
        25 => 'Overcast with heavy rain',
        26 => 'Overcast with heavy snow',
        27 => 'Rain, thunderstorms likely',
        28 => 'Light rain, thunderstorms likely',
        29 => 'Storm with heavy snow',
        30 => 'Heavy rain, thunderstorms likely',
        31 => 'Mixed with showers',
        32 => 'Mixed with snow showers',
        33 => 'Overcast with light rain',
        34 => 'Overcast with light snow',
        35 => 'Overcast with mixture of snow and rain',
    ];

    static $dailyDescriptions = [
        1 => 'Clear, cloudless sky',
        2 => 'Clear and few clouds',
        3 => 'Partly cloudy',
        4 => 'Overcast',
        5 => 'Fog',
        6 => 'Overcast with rain',
        7 => 'Mixed with showers',
        8 => 'Showers, thunderstorms likely',
        9 => 'Overcast with snow',
        10 => 'Mixed with snow showers',
        11 => 'Mostly cloudy with a mixture of snow and rain',
        12 => 'Overcast with occasional rain',
        13 => 'Overcast with occasional snow',
        14 => 'Mostly cloudy with rain',
        15 => 'Mostly cloudy with snow',
        16 => 'Mostly cloudy with occasional rain',
        17 => 'Mostly cloudy with occasional snow',
        20 => 'Mostly cloudy',
        21 => 'Mostly clear with a chance of local thunderstorms',
        22 => 'Partly cloudy with a chance of local thunderstorms',
        23 => 'Partly cloudy with local thunderstorms and showers possible',
        24 => 'Cloudy with thunderstorms and heavy showers',
        25 => 'Mostly cloudy with thunderstorms and showers',
    ];

    $descriptions = $hourly ? $hourlyDescriptions : $dailyDescriptions;
    return $descriptions[$pictocode] ?? ('Pictocode ' . $pictocode);
}

function icon_name_for_group(string $group, bool $isDay): string
{
    return match ($group) {
        'clear' => $isDay ? 'wi-day-sunny' : 'wi-night-clear',
        'partly_cloudy' => $isDay ? 'wi-day-cloudy' : 'wi-night-alt-partly-cloudy',
        'cloudy' => $isDay ? 'wi-cloudy' : 'wi-night-cloudy',
        'fog' => $isDay ? 'wi-day-fog' : 'wi-night-fog',
        'haze' => $isDay ? 'wi-day-haze' : 'wi-night-fog',
        'sprinkle' => $isDay ? 'wi-day-sprinkle' : 'wi-night-alt-sprinkle',
        'rain' => $isDay ? 'wi-day-rain' : 'wi-night-alt-rain',
        'mix' => $isDay ? 'wi-day-rain-mix' : 'wi-night-alt-rain-mix',
        'snow' => $isDay ? 'wi-day-snow' : 'wi-night-alt-snow',
        'thunder_rain' => $isDay ? 'wi-day-thunderstorm' : 'wi-night-alt-thunderstorm',
        'thunder_snow' => $isDay ? 'wi-day-snow-thunderstorm' : 'wi-night-alt-snow-thunderstorm',
        default => $isDay ? 'wi-cloudy' : 'wi-night-cloudy',
    };
}

function severity_for_group(string $group): int
{
    return match ($group) {
        'thunder_snow' => 10,
        'thunder_rain' => 9,
        'snow' => 7,
        'mix' => 6,
        'rain' => 5,
        'sprinkle' => 4,
        'fog' => 3,
        'haze' => 2,
        'cloudy' => 2,
        'partly_cloudy' => 1,
        'clear' => 0,
        default => 0,
    };
}

function spanish_condition_label(string $group, string $text): string
{
    return match ($group) {
        'thunder_snow' => 'Nieve y tormenta',
        'thunder_rain' => 'Tormentas',
        'snow' => 'Nieve',
        'mix' => 'Agua y nieve',
        'rain' => str_contains(strtolower($text), 'heavy') ? 'Lluvias intensas' : 'Lluvias',
        'sprinkle' => 'Lloviznas',
        'fog' => 'Niebla',
        'haze' => 'Bruma',
        'cloudy' => 'Nublado',
        'partly_cloudy' => 'Parcial nublado',
        'clear' => 'Despejado',
        default => 'Variable',
    };
}

function icon_payload_from_meteoblue(int $pictocode, bool $isDay, bool $hourly, ?string $text = null): array
{
    $group = meteoblue_icon_group($pictocode, $hourly);
    $description = $text ?? meteoblue_pictocode_description($pictocode, $hourly);

    return [
        'code' => $pictocode,
        'group' => $group,
        'severity' => severity_for_group($group),
        'url' => icon_filename(icon_name_for_group($group, $isDay)),
        'text' => $description,
        'text_es' => spanish_condition_label($group, $description),
    ];
}

function format_temperature(float $value): int
{
    return (int) round($value);
}

function degrees_unit(array $request): string
{
    return $request['units'] === 'f' ? 'F' : 'C';
}

function parse_local_datetime(string $value): DateTimeImmutable
{
    return new DateTimeImmutable($value, new DateTimeZone('UTC'));
}

function next_full_hour(DateTimeImmutable $dateTime): DateTimeImmutable
{
    return $dateTime
        ->setTime((int) $dateTime->format('H'), 0, 0)
        ->modify('+1 hour');
}

function spanish_day_label(string $date): string
{
    $labels = [
        'Mon' => 'Lun',
        'Tue' => 'Mar',
        'Wed' => 'Mie',
        'Thu' => 'Jue',
        'Fri' => 'Vie',
        'Sat' => 'Sab',
        'Sun' => 'Dom',
    ];

    $day = parse_local_datetime($date . ' 00:00')->format('D');
    return $labels[$day] ?? $day;
}

function build_hour_rows(array $source): array
{
    $data = (array) ($source['data_1h'] ?? []);
    $times = $data['time'] ?? [];
    if (!is_array($times) || $times === []) {
        error_response('Meteoblue response is missing hourly forecast data.', 502);
    }

    $rows = [];
    $count = count($times);

    for ($index = 0; $index < $count; $index++) {
        $time = (string) $times[$index];
        $dateTime = parse_local_datetime($time);
        $pictocode = (int) ($data['pictocode'][$index] ?? 19);
        $isDay = ((int) ($data['isdaylight'][$index] ?? 1)) === 1;
        $icon = icon_payload_from_meteoblue($pictocode, $isDay, true);

        $rows[] = [
            'datetime' => $dateTime,
            'datetime_string' => $time,
            'date' => $dateTime->format('Y-m-d'),
            'time' => $dateTime->format('H:i'),
            'temperature' => format_temperature((float) ($data['temperature'][$index] ?? 0)),
            'feels_like' => format_temperature((float) ($data['felttemperature'][$index] ?? ($data['temperature'][$index] ?? 0))),
            'humidity' => (int) round((float) ($data['relativehumidity'][$index] ?? 0)),
            'pressure_hpa' => format_temperature((float) ($data['sealevelpressure'][$index] ?? 0)),
            'precipitation_chance' => (int) round((float) ($data['precipitation_probability'][$index] ?? 0)),
            'condition_text' => $icon['text'],
            'condition_text_es' => $icon['text_es'],
            'condition_code' => $icon['code'],
            'icon_group' => $icon['group'],
            'icon_url' => $icon['url'],
            'severity' => $icon['severity'],
            'is_day' => $isDay,
        ];
    }

    return $rows;
}

function find_current_hour_row(array $hourRows, string $currentTime): ?array
{
    foreach ($hourRows as $row) {
        if ($row['datetime_string'] === $currentTime) {
            return $row;
        }
    }

    $currentPrefix = substr($currentTime, 0, 13);
    foreach ($hourRows as $row) {
        if (substr($row['datetime_string'], 0, 13) === $currentPrefix) {
            return $row;
        }
    }

    foreach ($hourRows as $row) {
        if ($row['datetime_string'] > $currentTime) {
            return $row;
        }
    }

    return $hourRows[0] ?? null;
}

function predominant_hour_icon(array $rows): array
{
    if ($rows === []) {
        return [
            'icon_url' => icon_filename('wi-cloudy'),
            'condition_text' => 'Cloudy',
            'condition_text_es' => 'Nublado',
            'icon_group' => 'cloudy',
            'severity' => 2,
        ];
    }

    $scores = [];
    foreach ($rows as $index => $row) {
        $group = $row['icon_group'];
        if (!isset($scores[$group])) {
            $scores[$group] = [
                'count' => 0,
                'severity' => (int) $row['severity'],
                'first_index' => $index,
                'row' => $row,
            ];
        }

        $scores[$group]['count']++;
    }

    uasort($scores, static function (array $left, array $right): int {
        if ($left['count'] !== $right['count']) {
            return $right['count'] <=> $left['count'];
        }

        if ($left['severity'] !== $right['severity']) {
            return $right['severity'] <=> $left['severity'];
        }

        return $left['first_index'] <=> $right['first_index'];
    });

    $winner = reset($scores);
    return is_array($winner) ? $winner['row'] : [
        'icon_url' => icon_filename('wi-cloudy'),
        'condition_text' => 'Cloudy',
        'condition_text_es' => 'Nublado',
        'icon_group' => 'cloudy',
        'severity' => 2,
    ];
}

function adjust_hero_icon(array $hero, array $rows): array
{
    if ($rows === []) {
        return $hero;
    }

    $maxPrecipitation = max(array_column($rows, 'precipitation_chance'));
    $group = (string) ($hero['icon_group'] ?? 'cloudy');

    if (in_array($group, ['fog', 'haze', 'snow', 'mix', 'thunder_snow'], true)) {
        return $hero;
    }

    if ($maxPrecipitation >= 75) {
        $group = 'thunder_rain';
    } elseif ($maxPrecipitation >= 55) {
        $group = 'rain';
    } elseif ($maxPrecipitation >= 40) {
        $group = 'sprinkle';
    } elseif (in_array($group, ['rain', 'sprinkle', 'thunder_rain'], true)) {
        $group = 'cloudy';
    }

    $isDay = true;
    foreach ($rows as $row) {
        if (isset($row['is_day'])) {
            $isDay = (bool) $row['is_day'];
            break;
        }
    }

    $text = match ($group) {
        'thunder_rain' => 'Tormentas',
        'rain' => 'Lluvias',
        'sprinkle' => 'Lloviznas',
        'partly_cloudy' => 'Parcial nublado',
        default => 'Nublado',
    };

    return array_merge($hero, [
        'icon_group' => $group,
        'icon_url' => icon_filename(icon_name_for_group($group, $isDay)),
        'severity' => severity_for_group($group),
        'condition_text_es' => $text,
    ]);
}

function build_hour_window(array $hourRows, string $currentTime): array
{
    $start = next_full_hour(parse_local_datetime($currentTime));
    $items = [];

    foreach ($hourRows as $row) {
        if ($row['datetime'] < $start) {
            continue;
        }

        $items[] = [
            'time' => $row['time'],
            'time_label' => $row['datetime']->format('G:i'),
            'temperature' => $row['temperature'],
            'precipitation_chance' => $row['precipitation_chance'],
            'condition_text' => $row['condition_text'],
            'condition_text_es' => $row['condition_text_es'],
            'condition_code' => $row['condition_code'],
            'icon_group' => $row['icon_group'],
            'icon_url' => $row['icon_url'],
            'severity' => $row['severity'],
        ];

        if (count($items) >= HOURLY_WINDOW_SIZE) {
            break;
        }
    }

    return $items;
}

function rows_for_date(array $hourRows, string $date): array
{
    return array_values(array_filter($hourRows, static fn (array $row): bool => $row['date'] === $date));
}

function build_day_rows(array $hourRows, string $currentTime): array
{
    $startOfToday = parse_local_datetime(substr($currentTime, 0, 10) . ' 00:00');
    $days = [];

    for ($offset = 0; $offset < FORECAST_DAYS; $offset++) {
        $date = $startOfToday->modify('+' . $offset . ' day')->format('Y-m-d');
        $rows = rows_for_date($hourRows, $date);

        if ($rows === []) {
            $days[] = [
                'date' => $date,
                'day_label' => spanish_day_label($date),
                'min' => null,
                'max' => null,
                'precipitation_chance' => null,
                'condition_text' => 'Forecast unavailable',
                'condition_text_es' => 'Sin pronóstico',
                'condition_code' => null,
                'icon_group' => 'cloudy',
                'icon_url' => icon_filename('wi-cloudy'),
                'available' => false,
            ];
            continue;
        }

        $icon = predominant_hour_icon($rows);
        $precipitationChance = max(array_column($rows, 'precipitation_chance'));
        $iconGroup = (string) $icon['icon_group'];

        if (in_array($iconGroup, ['clear', 'partly_cloudy', 'cloudy'], true)) {
            if ($precipitationChance >= 70) {
                $iconGroup = 'rain';
            } elseif ($precipitationChance >= 40) {
                $iconGroup = 'sprinkle';
            }
        }

        $days[] = [
            'date' => $date,
            'day_label' => spanish_day_label($date),
            'min' => min(array_column($rows, 'temperature')),
            'max' => max(array_column($rows, 'temperature')),
            'precipitation_chance' => $precipitationChance,
            'condition_text' => $icon['condition_text'],
            'condition_text_es' => spanish_condition_label($iconGroup, (string) $icon['condition_text']),
            'condition_code' => $icon['condition_code'] ?? null,
            'icon_group' => $iconGroup,
            'icon_url' => icon_filename(icon_name_for_group($iconGroup, true)),
            'available' => true,
        ];
    }

    return $days;
}

function normalize_weather(array $source, array $request, array $location): array
{
    $metadata = (array) ($source['metadata'] ?? []);
    $current = (array) ($source['data_current'] ?? []);
    if ($metadata === [] || $current === []) {
        error_response('Meteoblue response is missing expected data.', 502);
    }

    $hourRows = build_hour_rows($source);
    $currentTime = (string) ($current['time'] ?? '');
    if ($currentTime === '') {
        error_response('Meteoblue response is missing current time.', 502);
    }

    $currentHour = find_current_hour_row($hourRows, $currentTime);
    if ($currentHour === null) {
        error_response('Could not match current Meteoblue hour.', 502);
    }

    $todayRows = rows_for_date($hourRows, substr($currentTime, 0, 10));
    $hours = build_hour_window($hourRows, $currentTime);
    $heroHours = array_slice($hours, 0, HERO_WINDOW_SIZE);
    $hero = adjust_hero_icon(predominant_hour_icon($heroHours), $heroHours);
    $days = build_day_rows($hourRows, $currentTime);

    $currentIcon = icon_payload_from_meteoblue(
        (int) ($currentHour['condition_code'] ?? ($current['pictocode_detailed'] ?? $current['pictocode'] ?? 19)),
        ((int) ($current['isdaylight'] ?? 1)) === 1,
        true
    );

    return [
        'ok' => true,
        'error' => null,
        'meta' => [
            'source' => 'meteoblue',
            'generated_at' => gmdate('c'),
            'cache_ttl_seconds' => CACHE_TTL_SECONDS,
            'units' => degrees_unit($request),
            'available_forecast_days' => FORECAST_DAYS,
            'request' => $request,
            'location' => [
                'name' => $location['name'] !== '' ? $location['name'] : (string) ($metadata['name'] ?? ''),
                'region' => (string) ($location['region'] ?? ''),
                'country' => (string) ($location['country'] ?? ''),
                'lat' => (float) ($location['lat'] ?? $metadata['latitude'] ?? 0),
                'lon' => (float) ($location['lon'] ?? $metadata['longitude'] ?? 0),
                'tz_id' => (string) ($location['timezone'] ?? ''),
                'localtime' => $currentTime,
            ],
        ],
        'current' => [
            'temperature' => format_temperature((float) ($current['temperature'] ?? $currentHour['temperature'])),
            'min' => $todayRows === [] ? null : min(array_column($todayRows, 'temperature')),
            'max' => $todayRows === [] ? null : max(array_column($todayRows, 'temperature')),
            'feels_like' => (int) $currentHour['feels_like'],
            'humidity' => (int) $currentHour['humidity'],
            'pressure_hpa' => (int) $currentHour['pressure_hpa'],
            'condition_text' => $currentIcon['text'],
            'condition_text_es' => $currentIcon['text_es'],
            'condition_code' => $currentIcon['code'],
            'icon_group' => $currentIcon['group'],
            'icon_url' => $currentIcon['url'],
            'last_updated' => $currentTime,
        ],
        'hero' => [
            'icon_url' => (string) ($hero['icon_url'] ?? icon_filename('wi-cloudy')),
            'condition_text' => (string) ($hero['condition_text'] ?? 'Cloudy'),
            'condition_text_es' => (string) ($hero['condition_text_es'] ?? 'Nublado'),
            'window_start' => $heroHours[0]['time'] ?? null,
            'window_end' => $heroHours[count($heroHours) - 1]['time'] ?? null,
        ],
        'hours' => $hours,
        'days' => $days,
    ];
}
