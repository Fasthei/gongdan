# 生产上线前复测清单

面向 **合并 `main` / 触发 CI 部署生产** 前的必做项。部署完成后 5 分钟内完成「部署后冒烟」。

**生产后端基址（参考）：** `https://gongdan-b5fzbtgteqd5gzfb.eastasia-01.azurewebsites.net`  
（若变更 App Service 域名，请同步更新本文与 GitHub Secrets。）

---

## 一、合并前（阻断）

- [ ] **后端**（`ticket-system/backend`）：`npm run build` 通过  
- [ ] **前端**（`ticket-system/frontend`）：`npm run build` 通过（与 CI 一致）  
- [ ] **数据库**：若修改 `schema.prisma`，迁移已提交；生产执行策略已确认（`migrate deploy` 等）

---

## 二、上线前人工复测（按本次需求勾选）

### 认证与通用

- [ ] 管理员登录、刷新会话、受保护页面可访问  
- [ ] 若改动 `axios` / 拦截器 / 登录相关：**登录页、401 处理、登出** 已手测  

### 本次变更功能（按需增删）

- [ ] 逐条对照需求/工单完成自测  

### 回归最小集（易回归缺陷）

- [ ] 工单列表可加载  
- [ ] 客户列表可加载  
- [ ] 知识库对话：发送一条消息有正常响应（含流式/SSE 若适用）  
- [ ] **API 密钥管理**（工程师后台）：`GET /api/api-keys` 在浏览器 Network 中为 **200**、响应时间 **小于 3 秒**（非 OPTIONS 挂起、非长时间 pending）  
- [ ] 若本次涉及 **API Key / 模块鉴权**：在可访问生产的终端执行（密钥勿写入仓库）：

```bash
cd ticket-system
BASE_URL="https://gongdan-b5fzbtgteqd5gzfb.eastasia-01.azurewebsites.net" \
API_KEY="<从管理员界面创建或已有测试密钥>" \
./scripts/api-key-integration-test.sh
```

---

## 三、部署后冒烟（Azure 部署成功之后立即做）

- [ ] **健康检查**：`GET {后端}/api/health` 返回 200 且 body 正常  
- [ ] **浏览器**：打开生产前端，再走一遍本次功能路径  
- [ ] （可选）在 GitHub **Actions** 手动运行 workflow **Post-deploy smoke**，确认 Secrets 已配置（见该 workflow 文件内说明）

---

## 四、已知风险速查

| 现象 | 可能原因 |
|------|----------|
| OPTIONS 预检挂起、XHR ~20s 超时 | CORS 重复、网关/SWA 反代、App Service 未响应；结合 Azure 平台 CORS / EasyAuth 与后端 `enableCors` 排查 |
| API 密钥列表空白且请求失败 | 同上 + 确认请求带 **Admin JWT**，非仅用 `X-Api-Key` 调管理接口 |
