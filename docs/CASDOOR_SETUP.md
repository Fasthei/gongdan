# 统一认证中心 (Casdoor) 接入指南

工单系统 Staff（运营/工程师/管理员）登录统一走"统一认证中心"(Casdoor)；客户仍用 `customerCode` 本地登录。

> **跨系统共享**：工单、销售、超级运营中心（socp-employee）**共用** Casdoor `built-in` 组织的用户和角色组。在 Casdoor 新增一个员工、分配到一个角色组，即同时获得三套系统的登录权限。

---

## 1. Casdoor 环境参数（已由管理员完成配置，此处仅作说明）

| 配置项 | 值 |
|--------|-----|
| Endpoint | `https://casdoor.ashyglacier-8207efd2.eastasia.azurecontainerapps.io` |
| Organization | `built-in` |
| Application（工单） | `ticket-platform` |
| Client ID | `5ffdddd7b36f45e456e1` |
| Client Secret | 见 Casdoor 控制台或 Azure App Settings |
| Redirect URIs 白名单 | `http://localhost:5173/staff/auth/callback`<br>`http://localhost:3000/staff/auth/callback`<br>`http://localhost:4173/staff/auth/callback`<br>`^https://[a-zA-Z0-9-]+\.(?:[a-zA-Z0-9-]+\.)?azurestaticapps\.net/staff/auth/callback$`（正则，匹配任意 Azure Static Web Apps 域名） |

---

## 2. 共享角色组（Organization: built-in）

以下 group 已在 Casdoor 创建，三套系统按需映射：

| Group name      | 中文       | 工单系统映射                         | 销售 | 超级运营中心 |
|-----------------|-----------|--------------------------------------|------|-------------|
| `admin`         | 平台管理员 | Engineer(role=ADMIN, level=L3)       | 管理员 | 管理员 |
| `operator`      | 运营      | Operator                              | —    | 运营 |
| `sales`         | 销售      | —（登录会被拒绝）                    | 销售 | — |
| `engineer-l1`   | 工程师 L1 | Engineer(role=ENGINEER, level=L1)    | —    | — |
| `engineer-l2`   | 工程师 L2 | Engineer(role=ENGINEER, level=L2)    | —    | — |
| `engineer-l3`   | 工程师 L3 | Engineer(role=ENGINEER, level=L3)    | —    | — |
| `cloud-admin`   | 云管理员  | —                                    | —    | — |

> 工单系统匹配不敏感（大小写、`built-in-` 前缀皆可），未被识别的 group 在工单系统登录时会返回 `401`。

---

## 3. 后端环境变量（Azure App Settings）

在 `ticket-system/backend` 部署目标（Azure Container Apps / App Service）里设置：

```env
CASDOOR_ENDPOINT=https://casdoor.ashyglacier-8207efd2.eastasia.azurecontainerapps.io
CASDOOR_CLIENT_ID=5ffdddd7b36f45e456e1
CASDOOR_CLIENT_SECRET=<从 Casdoor 控制台 Application/ticket-platform 复制>
CASDOOR_ORGANIZATION=built-in
CASDOOR_APPLICATION=ticket-platform
CASDOOR_REDIRECT_URI=https://<你的前端生产域名>/staff/auth/callback
```

> `CASDOOR_REDIRECT_URI` 必须与前端回调 URL 完全一致，且被上表的白名单（或正则）匹配。

---

## 4. 数据库迁移

```bash
cd ticket-system/backend
npx prisma migrate deploy        # 应用 20260415120000_casdoor_integration
npx prisma generate
```

迁移内容：
- `Engineer.passwordHash` / `Operator.passwordHash` 改为可空
- 新增 `Engineer.casdoorId` / `Operator.casdoorId`（唯一索引）

---

## 5. 已有员工账号自动绑定

首次通过 Casdoor 登录时：
1. 先按 `casdoorId` 精确匹配（第二次后都走这里）
2. 未命中则按 `email` 绑定老账号，写入 `casdoorId` 保留历史工单
3. 仍未命中则自动建档（`createdBy = 'casdoor'`）

历史 `passwordHash` 不会被清空，便于审计和紧急回退。

---

## 6. 登录流程

1. `/staff/login` → 点"使用统一认证中心登录"
2. 前端调 `GET /api/auth/staff/casdoor/authorize-url` 取授权 URL
3. 浏览器跳转 Casdoor 托管登录页
4. 回调 `/staff/auth/callback?code=&state=`
5. 前端 `AuthCallback` POST `/api/auth/staff/casdoor/callback { code, state }`
6. 后端：state 校验 → code 换 token → userinfo → group 映射 → upsert → 本系统 JWT（15m / 7d）

---

## 7. 角色变更生效时机

Casdoor 调整 group 后，**下次登录时**本系统同步更新 `Engineer.role/level`。已下发的 access token 最长 15 分钟内仍有效；要立即失效需在 `AuthRefreshSession` 表撤销或调 `/auth/logout`。

---

## 8. 紧急回退

`POST /api/auth/staff-login`（用户名+密码）端点保留未删除，前端已不再调用，仅供极端情况使用。需手动在 DB 设置 bcrypt 密码。

---

## 9. 跨系统共享认证的实现方式

所有三套后端都使用同一 Casdoor OAuth2 流程，但各自可以有独立的 Application（不同 clientId/secret、不同 redirectUri），只要都指向同一 `built-in` organization，用户和 group 就是共享的：

- 工单：`ticket-platform` ✅（本文档）
- 超级运营中心员工端：`socp-employee`
- 销售：待你在 Casdoor 控制台单独创建或复用

> 用户只需在 Casdoor 登录一次，浏览器带上 Casdoor session cookie 后，在三套系统间切换时都能静默完成 OAuth，无需重新输密码。
