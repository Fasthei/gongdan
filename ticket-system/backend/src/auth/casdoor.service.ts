import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomBytes, createHmac } from 'crypto';

export interface CasdoorUserInfo {
  sub: string;              // Casdoor 唯一用户 ID
  name: string;             // Casdoor 用户名
  email?: string;
  displayName?: string;
  groups?: string[];        // 角色组
  roles?: string[];         // Casdoor 角色（备选）
}

export interface MappedRole {
  type: 'engineer' | 'operator';
  role: 'ENGINEER' | 'ADMIN' | 'OPERATOR';
  level?: 'L1' | 'L2' | 'L3';
}

@Injectable()
export class CasdoorService {
  private readonly logger = new Logger(CasdoorService.name);
  private readonly endpoint: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly organization: string;
  private readonly application: string;
  private readonly redirectUri: string;
  private readonly stateSecret: string;

  constructor(private config: ConfigService) {
    this.endpoint = this.requireConfig('CASDOOR_ENDPOINT').replace(/\/$/, '');
    this.clientId = this.requireConfig('CASDOOR_CLIENT_ID');
    this.clientSecret = this.requireConfig('CASDOOR_CLIENT_SECRET');
    this.organization = this.requireConfig('CASDOOR_ORGANIZATION');
    this.application = this.requireConfig('CASDOOR_APPLICATION');
    this.redirectUri = this.requireConfig('CASDOOR_REDIRECT_URI');
    // state 签名密钥：复用 JWT_SECRET（已在 env 必填）
    this.stateSecret = this.config.get<string>('JWT_SECRET') || 'casdoor-state-fallback';
  }

  private requireConfig(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`${key} is required for Casdoor integration`);
    return v;
  }

  /** 生成带 HMAC 签名的 state，callback 端校验 */
  private signState(): string {
    const nonce = randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = createHmac('sha256', this.stateSecret).update(payload).digest('hex').slice(0, 16);
    return `${payload}.${sig}`;
  }

  private verifyState(state: string): boolean {
    const parts = state.split('.');
    if (parts.length !== 3) return false;
    const [nonce, ts, sig] = parts;
    const expected = createHmac('sha256', this.stateSecret).update(`${nonce}.${ts}`).digest('hex').slice(0, 16);
    if (sig !== expected) return false;
    // 10 分钟内有效
    const age = Date.now() - parseInt(ts, 10);
    return age >= 0 && age < 10 * 60 * 1000;
  }

  buildAuthorizeUrl(): { url: string; state: string } {
    const state = this.signState();
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'read profile email',
      state,
    });
    return {
      url: `${this.endpoint}/login/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForUser(code: string, state: string): Promise<CasdoorUserInfo> {
    if (!this.verifyState(state)) {
      throw new UnauthorizedException('Casdoor state 校验失败');
    }

    // 1. 用 code 换 access_token
    let accessToken: string;
    try {
      const tokenResp = await axios.post(
        `${this.endpoint}/api/login/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        },
      );
      accessToken = tokenResp.data?.access_token;
      if (!accessToken) {
        this.logger.error('Casdoor token response missing access_token', tokenResp.data);
        throw new UnauthorizedException('Casdoor 换取 token 失败');
      }
    } catch (err: any) {
      this.logger.error(`Casdoor token exchange failed: ${err?.message}`, err?.response?.data);
      throw new UnauthorizedException('Casdoor 换取 token 失败');
    }

    // 2. 用 token 换 userinfo
    try {
      const userResp = await axios.get(`${this.endpoint}/api/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      const u = userResp.data || {};
      return {
        sub: u.sub || u.id,
        name: u.preferred_username || u.name,
        email: u.email,
        displayName: u.displayName || u.name,
        groups: Array.isArray(u.groups) ? u.groups : (u.groups ? [u.groups] : []),
        roles: Array.isArray(u.roles) ? u.roles : [],
      };
    } catch (err: any) {
      this.logger.error(`Casdoor userinfo failed: ${err?.message}`, err?.response?.data);
      throw new UnauthorizedException('获取 Casdoor 用户信息失败');
    }
  }

  /**
   * 将 Casdoor 用户的 groups / roles 映射到本系统角色。
   * 识别以下 group/role 名（大小写不敏感，支持带 gongdan- 前缀）：
   *   admin          → Engineer(role=ADMIN)
   *   operator       → Operator(role=OPERATOR)
   *   engineer-l3    → Engineer(role=ENGINEER, level=L3)
   *   engineer-l2    → Engineer(role=ENGINEER, level=L2)
   *   engineer-l1 / engineer → Engineer(role=ENGINEER, level=L1)
   */
  mapRole(user: CasdoorUserInfo): MappedRole {
    // Casdoor group 格式通常为 "built-in/admin" 或 "gongdan-admin"，统一规整
    const labels = [...(user.groups || []), ...(user.roles || [])]
      .map(x => (x || '').toLowerCase())
      .map(x => x.includes('/') ? x.split('/').pop()! : x)        // 去掉 org 前缀
      .map(x => x.replace(/^gongdan[-_]/, ''));                    // 去掉 gongdan 前缀

    if (labels.includes('admin')) {
      return { type: 'engineer', role: 'ADMIN', level: 'L3' };
    }
    if (labels.includes('operator')) {
      return { type: 'operator', role: 'OPERATOR' };
    }
    if (labels.includes('engineer-l3')) return { type: 'engineer', role: 'ENGINEER', level: 'L3' };
    if (labels.includes('engineer-l2')) return { type: 'engineer', role: 'ENGINEER', level: 'L2' };
    if (labels.includes('engineer-l1') || labels.includes('engineer')) {
      return { type: 'engineer', role: 'ENGINEER', level: 'L1' };
    }
    throw new UnauthorizedException(
      'Casdoor 用户未分配到本系统角色组 (admin / operator / engineer-l1|l2|l3)',
    );
  }
}
