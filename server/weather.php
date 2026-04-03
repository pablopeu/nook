<?php

declare(strict_types=1);

require __DIR__ . '/lib.php';

load_local_env(__DIR__ . '/.env.local');

$request = validate_request();
$cacheKey = cache_key($request);
$cached = read_cache($cacheKey);

if (is_array($cached)) {
    json_response($cached);
    exit;
}

$location = resolve_location($request);
$source = fetch_meteoblue($location, $request);
$normalized = normalize_weather($source, $request, $location);
write_cache($cacheKey, $normalized);

json_response($normalized);
