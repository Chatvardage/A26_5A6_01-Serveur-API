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

  if (
    matchesPrefix(pathname, '/api/rooms') ||
    matchesPrefix(pathname, '/api/admin/rooms')
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

export function isRateLimitedAuthRoute(
  method: string,
  pathname: string,
): boolean {
  return (
    method.toUpperCase() === 'POST' &&
    (pathname === '/api/auth/login' || pathname === '/api/auth/register')
  );
}

export function isSocketIoPath(pathname: string): boolean {
  return matchesPrefix(pathname, '/socket.io');
}
