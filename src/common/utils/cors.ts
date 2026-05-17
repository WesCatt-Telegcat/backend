type AllowedOrigin = true | string[];

function parseOrigins(value?: string) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveCorsOrigins(): AllowedOrigin {
  if (process.env.CORS_ALLOW_ALL === 'true') {
    return true;
  }

  const origins = parseOrigins(process.env.CORS_ORIGINS);

  if (origins.length > 0) {
    return origins;
  }

  return true;
}
