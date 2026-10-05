import {
  isRateLimitedAuthRoute,
  isSocketIoPath,
  resolveUpstream,
} from './proxy-routing';

describe('proxy routing', () => {
  it.each([
    ['/api/auth', 'auth'],
    ['/api/auth/login', 'auth'],
    ['/api/users', 'auth'],
    ['/api/users/abc', 'auth'],
    ['/api/servers', 'room'],
    ['/api/servers/abc/channels', 'room'],
    ['/api/channels/abc', 'room'],
    ['/api/admin/servers', 'room'],
    ['/api/messages', 'message'],
    ['/api/messages/abc', 'message'],
    ['/socket.io', 'message'],
    ['/socket.io/', 'message'],
    ['/api/config-utilisateur', 'userConfig'],
    ['/api/config-utilisateur/presence', 'userConfig'],
  ] as const)(
    'maps %s to %s',
    (
      pathname: string,
      upstream: 'auth' | 'room' | 'message' | 'userConfig',
    ) => {
      expect(resolveUpstream(pathname)).toBe(upstream);
    },
  );

  it.each([
    '/api',
    '/api/health',
    '/api/authentication',
    '/api/users-extra',
    '/api/room',
    // Anciennes routes de transition, retirées.
    '/api/rooms',
    '/api/rooms/abc',
    '/api/admin/rooms',
    '/api/admin/rooms/abc',
    '/api/servers-extra',
    '/api/channel',
    '/api/internal/channels/abc/access/u1',
    '/api/messages-extra',
    '/socket.io-extra',
    '/api/config-utilisateurs',
  ])('does not proxy unknown path %s', (pathname: string) => {
    expect(resolveUpstream(pathname)).toBeNull();
  });

  it('rate limits public session routes and password verification', () => {
    expect(isRateLimitedAuthRoute('POST', '/api/auth/login')).toBe(true);
    expect(isRateLimitedAuthRoute('post', '/api/auth/register')).toBe(true);
    expect(isRateLimitedAuthRoute('POST', '/api/auth/refresh')).toBe(true);
    expect(isRateLimitedAuthRoute('POST', '/api/auth/logout')).toBe(true);
    expect(isRateLimitedAuthRoute('GET', '/api/auth/login')).toBe(false);
    expect(isRateLimitedAuthRoute('POST', '/api/auth/me')).toBe(false);
    // Vérifient le mot de passe actuel.
    expect(isRateLimitedAuthRoute('PATCH', '/api/auth/me')).toBe(true);
    expect(isRateLimitedAuthRoute('delete', '/api/auth/me')).toBe(true);
    expect(isRateLimitedAuthRoute('GET', '/api/auth/me')).toBe(false);
    expect(isRateLimitedAuthRoute('PATCH', '/api/users/abc')).toBe(false);
  });

  it('recognizes only the Socket.IO path boundary', () => {
    expect(isSocketIoPath('/socket.io')).toBe(true);
    expect(isSocketIoPath('/socket.io/')).toBe(true);
    expect(isSocketIoPath('/socket.io/?EIO=4')).toBe(true);
    expect(isSocketIoPath('/socket.io-other')).toBe(false);
  });
});
