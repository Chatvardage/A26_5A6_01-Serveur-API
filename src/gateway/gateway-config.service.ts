import { Injectable } from '@nestjs/common';

export interface GatewayConfig {
  port: number;
  authServiceUrl: string;
  roomServiceUrl: string;
  messageServiceUrl: string;
  userConfigServiceUrl: string;
  proxyTimeoutMs: number;
  maxProxyBodyBytes: number;
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  corsOrigins: string[];
  trustProxy: boolean;
  authCacheTtlMs: number;
}

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];

  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim();
  // Refuse aussi les zéros initiaux ("0080") : souvent une faute de frappe.
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} doit être un entier positif : "${raw}"`);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} doit être un entier positif : "${raw}"`);
  }

  return value;
}

function nonNegativeInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim();
  return normalized === '0' ? 0 : positiveInteger(environment, name, fallback);
}

function portNumber(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = positiveInteger(environment, name, fallback);
  if (value > 65_535) {
    throw new Error(`${name} doit être compris entre 1 et 65535 : "${value}"`);
  }
  return value;
}

function serviceUrl(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const raw = environment[name] ?? fallback;
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} doit être une URL HTTP(S) valide : "${raw}"`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} doit utiliser HTTP ou HTTPS : "${raw}"`);
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(
      `${name} ne doit pas contenir de chemin, paramètres ou fragment : "${raw}"`,
    );
  }

  return parsed.origin;
}

function booleanValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = environment[name];
  if (raw === undefined) {
    return fallback;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  throw new Error(`${name} doit valoir true ou false : "${raw}"`);
}

export function resolveGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const corsOrigins = (environment.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of corsOrigins) {
    if (origin === 'null') {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `CORS_ORIGINS contient une origine invalide : "${origin}"`,
      );
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      throw new Error(
        `CORS_ORIGINS contient une origine invalide : "${origin}"`,
      );
    }
  }

  return {
    port: portNumber(environment, 'PORT', 3000),
    authServiceUrl: serviceUrl(
      environment,
      'AUTH_SERVICE_URL',
      'http://localhost:3001',
    ),
    roomServiceUrl: serviceUrl(
      environment,
      'ROOM_SERVICE_URL',
      'http://localhost:3003',
    ),
    messageServiceUrl: serviceUrl(
      environment,
      'MESSAGE_SERVICE_URL',
      'http://localhost:3004',
    ),
    userConfigServiceUrl: serviceUrl(
      environment,
      'USER_CONFIG_SERVICE_URL',
      'http://localhost:3005',
    ),
    proxyTimeoutMs: positiveInteger(environment, 'PROXY_TIMEOUT_MS', 5000),
    maxProxyBodyBytes: positiveInteger(
      environment,
      'MAX_PROXY_BODY_BYTES',
      1024 * 1024,
    ),
    authRateLimitWindowMs: positiveInteger(
      environment,
      'AUTH_RATE_LIMIT_WINDOW_MS',
      60_000,
    ),
    authRateLimitMax: positiveInteger(environment, 'AUTH_RATE_LIMIT_MAX', 10),
    corsOrigins,
    trustProxy: booleanValue(environment, 'TRUST_PROXY', false),
    // Durée de mémorisation d'une identité validée par Auth (routes
    // User-Config) ; 0 = appel à Auth à chaque requête.
    authCacheTtlMs: nonNegativeInteger(
      environment,
      'AUTH_CACHE_TTL_MS',
      10_000,
    ),
  };
}

@Injectable()
export class GatewayConfigService implements GatewayConfig {
  readonly port!: number;
  readonly authServiceUrl!: string;
  readonly roomServiceUrl!: string;
  readonly messageServiceUrl!: string;
  readonly userConfigServiceUrl!: string;
  readonly proxyTimeoutMs!: number;
  readonly maxProxyBodyBytes!: number;
  readonly authRateLimitWindowMs!: number;
  readonly authRateLimitMax!: number;
  readonly corsOrigins!: string[];
  readonly trustProxy!: boolean;
  readonly authCacheTtlMs!: number;

  constructor() {
    Object.assign(this, resolveGatewayConfig());
  }
}
