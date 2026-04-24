import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

type AnyReq = Record<string, any>;

function makeContext(req: AnyReq): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = AnyReq>() => req as unknown as T,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [] as any,
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http' as any,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let findUnique: jest.Mock;
  let prisma: { customer: { findUnique: jest.Mock } };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    findUnique = jest.fn();
    prisma = { customer: { findUnique } };
    guard = new JwtAuthGuard(prisma as any);
  });

  it('API key + X-Customer-Code + customer found → injects CUSTOMER user', async () => {
    findUnique.mockResolvedValue({ id: 'cust-uuid-1', customerCode: 'ACME' });
    const req: AnyReq = {
      path: '/api/tickets',
      url: '/api/tickets',
      headers: { 'x-customer-code': 'ACME' },
      apiClient: { id: 'ak-1', allowedModules: ['ticket'] },
    };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { customerCode: 'ACME' } });
    expect(req.user).toEqual({
      id: 'customer:cust-uuid-1',
      customerId: 'cust-uuid-1',
      customerCode: 'ACME',
      role: 'CUSTOMER',
      apiKeyId: 'ak-1',
    });
  });

  it('API key + X-Customer-Code + customer not found → UnauthorizedException', async () => {
    findUnique.mockResolvedValue(null);
    const req: AnyReq = {
      path: '/api/tickets',
      url: '/api/tickets',
      headers: { 'x-customer-code': 'NOPE' },
      apiClient: { id: 'ak-1', allowedModules: ['ticket'] },
    };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(makeContext(req)),
    ).rejects.toMatchObject({ message: 'unknown customer code' });
    expect(req.user).toBeUndefined();
  });

  it('API key without X-Customer-Code → legacy ADMIN injection', async () => {
    const req: AnyReq = {
      path: '/api/tickets',
      url: '/api/tickets',
      headers: {},
      apiClient: { id: 'ak-2', allowedModules: ['ticket'] },
    };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'api-key:ak-2',
      role: 'ADMIN',
      apiKeyId: 'ak-2',
    });
  });

  it('API key with empty X-Customer-Code (whitespace) → legacy ADMIN injection', async () => {
    const req: AnyReq = {
      path: '/api/tickets',
      url: '/api/tickets',
      headers: { 'x-customer-code': '   ' },
      apiClient: { id: 'ak-3', allowedModules: ['ticket'] },
    };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect((req.user as any).role).toBe('ADMIN');
  });

  it('API key request to forbidden admin path → UnauthorizedException (even with customer code)', async () => {
    const req: AnyReq = {
      path: '/api/api-keys',
      url: '/api/api-keys',
      headers: { 'x-customer-code': 'ACME' },
      apiClient: { id: 'ak-1', allowedModules: ['ticket'] },
    };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('JWT path (no apiClient) → delegates to super.canActivate, Prisma untouched', async () => {
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockResolvedValue(true as any);

    const req: AnyReq = {
      path: '/api/tickets',
      url: '/api/tickets',
      headers: { authorization: 'Bearer x.y.z' },
    };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(superSpy).toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    superSpy.mockRestore();
  });

  describe('handleRequest', () => {
    it('returns req.user when apiClient synthetic user was injected', () => {
      const req: AnyReq = {
        apiClient: { id: 'ak-1' },
        user: { id: 'customer:1', role: 'CUSTOMER' },
      };
      const ctx = makeContext(req);
      expect(guard.handleRequest(null, null, null, ctx)).toEqual(req.user);
    });

    it('throws when no user and no apiClient', () => {
      const ctx = makeContext({});
      expect(() => guard.handleRequest(null, null, null, ctx)).toThrow(
        UnauthorizedException,
      );
    });

    it('returns JWT user on normal JWT success', () => {
      const ctx = makeContext({});
      const jwtUser = { id: 'eng-1', role: 'ENGINEER' };
      expect(guard.handleRequest(null, jwtUser, null, ctx)).toBe(jwtUser);
    });
  });
});
