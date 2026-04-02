## 变更说明

<!-- 简要描述本 PR 做什么、为何需要 -->

## 影响范围

- [ ] 仅前端 (`ticket-system/frontend`)
- [ ] 仅后端 (`ticket-system/backend`)
- [ ] 前后端均有
- [ ] 工作流 / 基础设施 / 文档

## 上线前复测（合并 `main` 前勾选）

依据 [docs/PRE_RELEASE_CHECKLIST.md](../docs/PRE_RELEASE_CHECKLIST.md)：

- [ ] 本地/分支 `npm run build`（前端 + 后端按改动选择）已通过  
- [ ] 已按清单完成「本次变更功能」自测  
- [ ] 已按清单完成「回归最小集」中与本次相关的项  
- [ ] 若涉及鉴权/API Key/axios：已额外验证登录与 API 密钥页等  

**部署后**：合并并等待 CI 部署完成后，在 5 分钟内完成清单「三、部署后冒烟」。

## 关联 Issue / 讨论

<!-- 可填 #编号 或留空 -->
