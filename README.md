# AIDriveWorkflow

AIDriveAll 家族的独立工作流平台（审批流程设计 / 发起 / 审批 / 仪表盘 + AI 助手）。

- **Workflow 引擎与界面**：自 [AIIgnitePLM](../AIIgnitePLM) 的 Workflow 模块 1:1 移植（引擎、可视化设计器、审批页、移动端门户、80 个内置流程模板）
- **登录 / AI 助手 / 技能 / 设置中心**：参考 [AIDriveNote](../AIDriveNote) 的实现方式复刻（JWT + 可选 SSO、AI 侧栏 SSE 流式 + Function Calling、技能关键词路由、模型/助手/技能/用户管理）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS 4，端口 **3320** |
| 后端 | Python FastAPI + SQLAlchemy 2 (async) + Alembic + JWT，端口 **3325** |
| 数据库 | PostgreSQL（库名 `ai_drive_workflow`） |
| AI | Ollama（默认）/ OpenAI / Anthropic / MiniMax，SSE 流式 + 工具调用 |

## 启动

```bash
# 1. 创建数据库（首次）
createdb -h 127.0.0.1 -U postgres ai_drive_workflow

# 2. 一键启动（后端 3325 + 前端 3320，自动迁移种子）
./start.sh
```

- 前端：<http://localhost:3320>
- 后端 API 文档：<http://localhost:3325/docs>（`API_DOCS_ENABLED=true` 时）
- 首个注册用户建议在 `backend/.env` 配置 `ADMIN_EMAIL` 后启动自动提权，或在设置中手动提权

## 功能

- **工作流**：定义管理（版本/发布/归档/克隆/JSON 导入导出）、可视化设计器（拖拽节点/四向连线/网关条件/会签或签/处理人六种解析方式）、实例仪表盘（recharts 统计）、我的审批（批量/快捷审批）、实例详情（画布高亮当前节点/日志时间线）、移动端门户 `/m/*`
- **内置模板**：80 个种子流程模板（ECR/ECO 变更、文档审批、设计评审、偏差处理等），启动时指纹比对增量同步
- **组织架构**：部门（树形/主管）、业务角色、用户组织信息 —— 支撑处理人解析 `user / role / department / manager / initiator / expression`
- **AI 助手**：全局侧栏（Ctrl/⌘+J）、7 个工作流工具（查定义/查实例/查待办/发起流程/审批提交），写操作走「预览 → 确认卡片 → 前端落库」模式
- **技能**：关键词加权路由（页面绑定 + 助手绑定），内置 5 个工作流技能（流程查询/待办查询/发起流程/审批处理/设计辅助）
- **通知**：任务分配自动通知（铃铛 + 移动端），点击直达待办

## 移植说明（与 AIIgnitePLM 的差异）

1. 用户表从 `sys_users` 改为 AIDriveNote 风格的 `users`（email/password_hash/role），新增 `departments / roles / user_roles` 组织表
2. `workflow_integration.py` 精简重建：`ENTITY_TYPE_REGISTRY` 默认为空注册表（保留扩展机制），业务实体状态回写、审批详情富化（`entity_detail_enrichers`）等 PLM 业务耦合已剥离；实体详情卡改由流程实例变量渲染
3. 处理人解析移除 `project_role`（无项目管理模块）；`plan_task` 节点完成联动已移除
4. 电子签名存 `users.signature_image`（`backend/uploads/signatures/`），不再依赖文档模块
5. `/api/v1/workflow-integration/check` 保留鉴权（无 PLM 业务页面调用免鉴权场景）
6. 通知表 `notifications` + 独立 API + 铃铛组件

## 环境变量（backend/.env）

参见 `backend/.env.example`。SSO 对接 AIDriveAll 门户：`SSO_ENABLED=true`、`SSO_SECRET_KEY`（与门户 SECRET_KEY 相同）、`SSO_ISSUER=aidriveall`，Cookie 名固定 `aidrive_token`（契约见 AIDriveAll 文档）。

## 生产部署

```bash
docker compose -f docker-compose.prod.yml up -d --build
bash deploy.sh   # 健康检查
```

生产网关在 `AIDriveAll/deploy/nginx/aidrive-gateway.conf` 中已配置 `/workflow/` → 3320。
