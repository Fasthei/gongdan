# SaaS 技术支持工单管理系统

## 项目结构
- `backend/` - NestJS REST API
- `frontend/` - React + Vite SPA

## 快速启动

### 后端
```bash
cd backend
npm install
cp .env.example .env
# 编辑 .env 填入实际配置
npx prisma migrate dev
npm run start:dev
```

### 前端
```bash
cd frontend
npm install
npm run dev
```

## 部署
部署到 Azure App Service（后端）+ Azure Static Web Apps（前端）
