export type UpstreamService = 'auth' | 'room' | 'message' | 'userConfig';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveUpstream(pathname: string): UpstreamService | null {
  if (
    matchesPrefix(pathname, '/api/auth') ||
    matchesPrefix(pathname, '/api/users')
  ) {
    return 'auth';
  }

  // Serveurs et salons (façon Discord). Les anciennes routes `/api/rooms` et
  // `/api/admin/rooms` n'existent plus. `/api/internal/*` n'est
  // volontairement PAS relayé : route entre microservices, protégée par
  // INTERNAL_SERVICE_TOKEN.
  if (
    matchesPrefix(pathname, '/api/servers') ||
    matchesPrefix(pathname, '/api/channels') ||
    matchesPrefix(pathname, '/api/admin/servers')
  ) {
    return 'room';
  }

  if (
    matchesPrefix(pathname, '/api/messages') ||
    matchesPrefix(pathname, '/socket.io')
  ) {
    return 'message';
  }

  if (matchesPrefix(pathname, '/api/config-utilisateur')) {
    return 'userConfig';
  }

  return null;
}

/**
 * Routes où Auth vérifie un mot de passe (Argon2, volontairement lent) :
 * connexion, inscription, et modification ou suppression de son compte, qui
 * exigent le mot de passe actuel — sans limite, un jeton volé permettait de
 * le deviner par essais successifs.
 * Les appels publics refresh/logout avec token opaque sont également limités.
 */
export function isRateLimitedAuthRoute(
  method: string,
  pathname: string,
): boolean {
  const verbe = method.toUpperCase();
  if (verbe === 'POST') {
    return [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/refresh',
      '/api/auth/logout',
    ].includes(pathname);
  }
  return (
    (verbe === 'PATCH' || verbe === 'DELETE') && pathname === '/api/auth/me'
  );
}

export function isSocketIoPath(pathname: string): boolean {
  return matchesPrefix(pathname, '/socket.io');
}
