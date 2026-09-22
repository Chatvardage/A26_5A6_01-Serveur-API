import { AuthRateLimitService } from './auth-rate-limit.service';
import { GatewayConfigService } from './gateway-config.service';

describe('AuthRateLimitService', () => {
  const config = {
    authRateLimitWindowMs: 1000,
    authRateLimitMax: 2,
  } as GatewayConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Date.now when no timestamp is supplied', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const service = new AuthRateLimitService(config);

    expect(service.consume('ip:login')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 2000,
      retryAfterSeconds: 1,
    });
  });

  it('allows requests up to the limit and then blocks', () => {
    const service = new AuthRateLimitService(config);

    expect(service.consume('ip:login', 1000)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 2000,
      retryAfterSeconds: 1,
    });
    expect(service.consume('ip:login', 1200)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetAt: 2000,
      retryAfterSeconds: 1,
    });
    expect(service.consume('ip:login', 1300)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetAt: 2000,
      retryAfterSeconds: 1,
    });
  });

  it('starts a fresh bucket once the window expires', () => {
    const service = new AuthRateLimitService(config);
    service.consume('ip:login', 1000);
    service.consume('ip:login', 1100);

    expect(service.consume('ip:login', 2000)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 3000,
      retryAfterSeconds: 1,
    });
  });
});
