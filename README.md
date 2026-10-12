# AIDriveWorkflow

AIDriveAll 家族的独立工作流平台：审批流程设计 / 发起 / 审批 / 仪表盘 + AI 助手。

- **Workflow 引擎与界面**：自 [AIIgnitePLM](../AIIgnitePLM) 的 Workflow 模块 1:1 移植（引擎、可视化设计器、审批页、移动端门户、80 个内置流程模板）
- **登录 / AI 助手 / 技能 / 设置中心**：参考 [AIDriveNote](../AIDriveNote) 的实现方式复刻（JWT + 可选 SSO、AI 侧栏 SSE 流式 + Function Calling、技能关键词路由、模型/助手/技能/用户管理）

## 功能总览

| 模块 | 说明 |
|---|---|
| **工作流** | 定义管理（版本/发布/归档/克隆/JSON 导入导出）、可视化设计器（拖拽节点/四向连线/网关条件/会签或签/处理人六种解析方式）、实例仪表盘（recharts 统计）、我的审批（批量/快捷审批）、实例详情（画布高亮当前节点/日志时间线）、移动端门户 `/m/*` |
| **内置模板** | 80 个种子流程模板（ECR/ECO 变更、文档审批、设计评审、偏差处理等），启动时指纹比对增量同步 |
| **组织架构** | 部门（树形/主管）、业务角色、用户组织信息 —— 支撑处理人解析 `user / role / department / manager / initiator / expression` |
| **AI 助手** | 全局侧栏（`Ctrl/⌘+J`），7 个工作流工具（查定义/查实例/查待办/发起流程/审批提交），写操作走「预览 → 确认卡片 → 前端落库」模式 |
| **技能** | 关键词加权路由（页面绑定 + 助手绑定），内置 5 个工作流技能（流程查询/待办查询/发起流程/审批处理/设计辅助） |
| **通知** | 任务分配自动通知（铃铛 + 移动端），点击直达待办 |

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + recharts | **3320** |
| 后端 | Python FastAPI + SQLAlchemy 2 (async) + Alembic + JWT | **3325** |
| 数据库 | PostgreSQL（库名 `ai_drive_workflow`） | 5432 |
| AI | Ollama（默认）/ OpenAI / Anthropic / MiniMax，SSE 流式 + 工具调用 | — |

## 项目结构

```
AIDriveWorkflow/
├── backend/               # FastAPI 后端
│   ├── app/
│   │   ├── main.py        # 应用入口（lifespan 种子同步）
│   │   ├── config.py      # pydantic-settings 配置
│   │   ├── models/        # SQLAlchemy 模型（user / org / workflow / ai / notification）
│   │   ├── routers/       # 路由（auth / users / workflow / ai / admin / files / notifications / system）
│   │   ├── services/      # 业务服务（ai / admin_bootstrap 等）
│   │   └── ai_tools/      # AI Function Calling 工具注册与实现
│   ├── alembic/           # 数据库迁移
│   └── tests/             # pytest 测试（SQLite 内存库）
├── frontend/              # React 前端
│   └── src/
│       ├── pages/         # workflow（设计器/审批/实例详情）、settings（AI 模型/助手/技能/用户）
│       ├── mobile/        # 移动端门户 /m/*
│       ├── components/    # 通用组件（含 AI 侧栏）
│       └── services/      # API 客户端
├── scripts/               # 远程部署 / SSO 启用 / 域名配置脚本
├── nginx/                 # 生产 nginx 配置
├── start.sh               # 本地一键启动
├── deploy.sh              # 生产部署 + 健康检查
└── docker-compose.prod.yml
```

## 快速开始

### 环境要求

- Python 3.11+（含 pip）
- Node.js 18+（含 npm）
- PostgreSQL 14+
- （可选）Ollama —— 默认 AI 提供商

### 启动步骤

```bash
# 1. 安装后端依赖
cd backend && pip install -r requirements.txt && cd ..

# 2. 创建数据库（首次）
createdb -h 127.0.0.1 -U postgres ai_drive_workflow

# 3. 一键启动（后端 3325 + 前端 3320）
./start.sh

# 4. 执行数据库迁移（首次或 schema 变更后）
cd backend && alembic upgrade head && cd ..
```

`start.sh` 会自动：无 `.env` 时从 `.env.example` 复制、前端缺依赖时 `npm install`、清理端口占用；启动后自动同步 AI 平台种子数据与 80 个流程模板（指纹比对增量）。

### 访问地址

| 服务 | 地址 |
|---|---|
| 前端 | <http://localhost:3320> |
| 后端 API 文档 | <http://localhost:3325/docs>（`API_DOCS_ENABLED=true` 时） |
| 健康检查 | <http://localhost:3325/health> |
| AI 设置页 | <http://localhost:3320/settings/ai> |
| 运行日志 | `.runtime-logs/backend-start.log`、`.runtime-logs/frontend-start.log` |

> **管理员**：首个注册用户建议在 `backend/.env` 配置 `ADMIN_EMAIL` 后重启，该邮箱注册即自动提权管理员；也可在设置中手动提权。

## 环境变量（backend/.env）

完整示例见 `backend/.env.example`：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | 异步连接串（asyncpg） | `postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/ai_drive_workflow` |
| `DATABASE_URL_SYNC` | 同步连接串（Alembic 用） | 同上去掉 `+asyncpg` |
| `SECRET_KEY` | JWT 签名密钥（≥32 字符） | 示例占位值，生产必须更换 |
| `CORS_ORIGINS` | 允许的跨域来源 | `http://localhost:3320` |
| `ADMIN_EMAIL` | 该邮箱注册自动提权管理员 | 空 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 访问令牌有效期 | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 刷新令牌有效期 | `14` |
| `DEBUG` / `API_DOCS_ENABLED` | 调试 / Swagger 开关 | `false` / `true` |
| `AI_PROVIDER` | `ollama` / `openai` / `anthropic` / `minimax` | `ollama` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Ollama 地址与模型 | `http://localhost:11434` / `qwen2.5` |
| `OPENAI_API_KEY` 等 | 云端模型密钥（也可在 `/settings/ai/models` 页面配置） | 空 |
| `SSO_ENABLED` | 对接 AIDriveAll 门户单点登录 | `false` |

**SSO 对接**：`SSO_ENABLED=true`、`SSO_SECRET_KEY`（与门户 SECRET_KEY 相同）、`SSO_ISSUER=aidriveall`，Cookie 名固定 `aidrive_token`（契约见 AIDriveAll 文档）。也可运行 `bash scripts/enable-sso.sh` 交互配置。

## 测试

```bash
# 后端（SQLite 内存库，无需 PostgreSQL）
cd backend && python -m pytest

# 前端
cd frontend && npm test        # vitest
npm run type-check             # TypeScript 类型检查
```

## 生产部署

```bash
# 1. 准备环境变量（compose 必填 POSTGRES_PASSWORD / DATABASE_URL / DATABASE_URL_SYNC / SECRET_KEY）
cp backend/.env.example .env && vim .env

# 2. 构建启动 + 自动迁移 + 健康检查
docker compose -f docker-compose.prod.yml up -d --build
bash deploy.sh
```

- 容器拓扑：`postgres:16-alpine` + backend（仅绑定 `127.0.0.1:3325`）+ frontend（`3320:80`，nginx 反代 API）
- 数据卷：`postgres_data`（数据库）、`uploads_data`（签名图片等上传文件）
- 子路径部署：构建时传 `VITE_BASE_PATH=/workflow`、`NGINX_SUBPATH=1`，配合 `frontend/nginx.subpath.conf`
- 公网网关：`AIDriveAll/deploy/nginx/aidrive-gateway.conf` 中已配置 `/workflow/` → 3320；远程部署见 `scripts/deploy-remote.sh`

## 移植说明（与 AIIgnitePLM 的差异）

1. 用户表从 `sys_users` 改为 AIDriveNote 风格的 `users`（email/password_hash/role），新增 `departments / roles / user_roles` 组织表
2. `workflow_integration.py` 精简重建：`ENTITY_TYPE_REGISTRY` 默认为空注册表（保留扩展机制），业务实体状态回写、审批详情富化（`entity_detail_enrichers`）等 PLM 业务耦合已剥离；实体详情卡改由流程实例变量渲染
3. 处理人解析移除 `project_role`（无项目管理模块）；`plan_task` 节点完成联动已移除
4. 电子签名存 `users.signature_image`（`backend/uploads/signatures/`），不再依赖文档模块
5. `/api/v1/workflow-integration/check` 保留鉴权（无 PLM 业务页面调用免鉴权场景）
6. 通知表 `notifications` + 独立 API + 铃铛组件
