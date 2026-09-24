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
    ['/api/rooms', 'room'],
    ['/api/rooms/abc', 'room'],
    ['/api/admin/rooms', 'room'],
    ['/api/admin/rooms/abc', 'room'],
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
    '/api/admin/rooms-extra',
    '/api/servers-extra',
    '/api/channel',
    '/api/internal/channels/abc/access/u1',
    '/api/messages-extra',
    '/socket.io-extra',
    '/api/config-utilisateurs',
  ])('does not proxy unknown path %s', (pathname: string) => {
    expect(resolveUpstream(pathname)).toBeNull();
  });

  it('rate limits only POST login and register', () => {
    expect(isRateLimitedAuthRoute('POST', '/api/auth/login')).toBe(true);
    expect(isRateLimitedAuthRoute('post', '/api/auth/register')).toBe(true);
    expect(isRateLimitedAuthRoute('GET', '/api/auth/login')).toBe(false);
    expect(isRateLimitedAuthRoute('POST', '/api/auth/me')).toBe(false);
  });

  it('recognizes only the Socket.IO path boundary', () => {
    expect(isSocketIoPath('/socket.io')).toBe(true);
    expect(isSocketIoPath('/socket.io/')).toBe(true);
    expect(isSocketIoPath('/socket.io/?EIO=4')).toBe(true);
    expect(isSocketIoPath('/socket.io-other')).toBe(false);
  });
});
