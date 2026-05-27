# 🍳 晚饭工作流 — 个人饮食管理智能体

基于 **@earendil-works/pi-coding-agent** SDK 构建的智能晚饭管理助手。

面向**独居/双人的下班做饭场景**，覆盖「买菜 → 入库 → 计划 → 做饭 → 反馈 → 周末备菜」完整循环。

## ✨ 主要功能

- 🧭 **首次启动引导** — 4 步向导收集饮食目标、厨房配置、常备食材
- 📖 **25 道内置菜谱** — 覆盖快手/一锅出/明火/烤制等多种模式
- 🛒 **4 点购物清单** — 根据已有库存和菜谱推荐买菜
- 🍳 **生成晚饭计划** — 分钟级时间线 + 低能量版本
- 🍽️ **记录晚餐 + 反馈** — AI 越用越懂你
- 🧊 **食材库存管理** — 冷藏/冷冻/储藏/室温分类，过期提醒
- 📊 **工作流仪表盘** — 可视化「买菜→做饭→反馈」全流程
- 💬 **AI 聊天** — 自然语言操作一切（"我今天很累" → 低能量方案）

## 🚀 快速开始

### 1. 安装

```bash
cd diet-agent-service
npm install
```

### 2. 配置 API Key

```bash
# 复制配置模板
cp .env.example .env
```

编辑 `.env`，填写**至少一个**模型供应商的 API Key：

```env
# DeepSeek（推荐，性价比高）
DEEPSEEK_API_KEY=sk-xxx

# 或者 智谱 GLM（国内访问稳定）
ZAI_API_KEY=xxx.xxx

# 或者 OpenAI / Anthropic / OpenRouter
```

> 💡 不设置 `MODEL_PROVIDER` 时会自动检测已配置的 Key，优先级：DeepSeek → GLM → OpenAI → Anthropic → OpenRouter。

### 3. 启动

```bash
# 开发模式（推荐）
npm run dev

# 编译后启动
npm run build && npm start
```

启动成功后打开 👉 **http://localhost:3001**

### 4. 首次使用

首次打开会自动弹出 **欢迎引导**（4 步）：

| 步骤 | 内容 | 例子 |
|------|------|------|
| Step 1 👋 | 饮食目标 + 身高体重 + 忌口 | 减脂、175cm、不吃香菜 |
| Step 2 🍳 | 厨房配置（灶眼、烤箱、厨具、偏好） | 2 灶 + 烤箱 + 炒锅汤锅 |
| Step 3 🧊 | 常备食材 | 鸡蛋、番茄、蒜、面条 |
| Step 4 🎉 | 完成！开始使用 | — |

引导数据会保存到本地数据库，下次打开不再弹出。

## 📋 日常使用流程

```
4 点下班 → 打开页面
    │
    ├─ ① 点击「4 点购物清单」→ 系统根据库存推荐买什么
    │
    ├─ ② 买完回家 → 在库存面板录入食材（或点「→」从购物清单转入）
    │
    ├─ ③ 点击「生成晚饭计划」→ 得到分钟级时间线
    │     └─ 太累？点「我今天很累」→ 低能量方案
    │
    ├─ ④ 按时间线做饭
    │
    └─ ⑤ 记录晚餐 + 打分反馈 → 系统学习偏好
```

## 🧩 支持的模型

| Provider | 环境变量 | 可用模型 | 说明 |
|----------|----------|----------|------|
| **deepseek** | `DEEPSEEK_API_KEY` | `deepseek-v4-flash`, `deepseek-v4-pro` | 推荐性价比高 |
| **zai** | `ZAI_API_KEY` | `glm-4.5-air`, `glm-4.7`, `glm-5-turbo`, `glm-5.1` | 国内直连稳定 |
| **openai** | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini` | OpenAI GPT 系列 |
| **anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` | Anthropic Claude |
| **openrouter** | `OPENROUTER_API_KEY` | 多种模型 | 聚合网关 |

## 🛠 其他用法

### 命令行交互（TUI）

```bash
npm run tui
```

在终端中与 AI 聊天，适合调试和快速操作。

### curl / API 调用

```bash
# AI 聊天（核心接口）
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"daily_user","message":"今天想做快的，10 分钟能搞定的"}'

# 查看用户画像
curl http://localhost:3001/api/users/daily_user/profile

# 查看厨房配置
curl http://localhost:3001/api/users/daily_user/kitchen

# 查看今日工作流总览
curl http://localhost:3001/api/users/daily_user/workflow/today

# 保存食材库存
curl -X POST http://localhost:3001/api/users/daily_user/ingredients \
  -H "Content-Type: application/json" \
  -d '{"availableIngredients":[{"name":"鸡腿","status":"available","storage":"fridge"}]}'

# 记录晚餐
curl -X POST http://localhost:3001/api/users/daily_user/meals \
  -H "Content-Type: application/json" \
  -d '{"mealType":"dinner","foods":[{"name":"番茄炒蛋","amount":"1 份"}]}'
```

### 运行测试

```bash
npm test
```

## 📂 项目结构

```
src/
  index.ts                       # Express HTTP 服务 (REST API)
  agent/
    createDietAgent.ts           # Agent 创建 + 消息发送
    modelAdapter.ts              # 多模型适配（DeepSeek/GLM/OpenAI...）
    sessionStore.ts              # userId → Agent session 映射
    systemPrompt.ts              # 系统提示词
    prompts/                     # 分层提示词
      baseIdentityPrompt.ts      # 基础身份
      cookingPrompt.ts           # 烹饪相关
      dietPrompt.ts              # 饮食相关
      toolUsagePrompt.ts         # 工具使用指导
      safetyPrompt.ts            # 安全约束
  recipes/
    recipeBook.ts                # 内置菜谱管理
    recipeMatcher.ts             # 菜谱匹配算法
    recipeSeed.json              # 25 道菜谱种子数据
  store/
    sqliteStore.ts               # SQLite 持久化存储
    memoryStore.ts               # 内存存储（备用）
  tools/                         # Agent 工具定义
    generateCookingPlan.ts       # 生成做饭计划（含时间线）
    generateMealPlan.ts          # 生成饮食计划
    getIngredientInventory.ts    # 获取食材库存
    getKitchenProfile.ts         # 获取厨房配置
    getTodaySummary.ts           # 今日总结
    getUserProfile.ts            # 获取用户画像
    logCookingFeedback.ts        # 记录烹饪反馈
    logMeal.ts                   # 记录用餐
    markIngredientUsed.ts        # 标记食材已用
    searchRecipes.ts             # 搜索菜谱
    updateIngredientInventory.ts # 更新库存
    updateKitchenProfile.ts      # 更新厨房配置
    updateUserProfile.ts         # 更新用户画像
  tui/
    chat-tui.ts                  # 终端聊天界面
  types/
    diet.ts                      # TypeScript 类型定义
  utils/
    errors.ts                    # 错误处理
    requestLogger.ts             # API 请求日志
public/                          # 前端（纯 HTML/CSS/JS）
  index.html                     # 仪表盘 + 引导向导
  styles.css                     # 样式
  app.js                         # 前端逻辑
data/                            # SQLite 数据库（自动创建）
```

## 🔧 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Express 5 + TypeScript (ESM) |
| AI SDK | @earendil-works/pi-coding-agent |
| 数据库 | SQLite (better-sqlite3) |
| 前端 | 原生 HTML/CSS/JS（无框架） |
| 运行时 | tsx (开发) / tsc + node (生产) |

## 📡 API 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/chat` | AI 聊天（核心） |
| GET/POST | `/api/users/:id/profile` | 用户画像 |
| GET/POST | `/api/users/:id/kitchen` | 厨房配置 |
| GET/POST | `/api/users/:id/ingredients` | 食材库存 |
| PATCH | `/api/users/:id/ingredients/status` | 更新食材状态 |
| GET | `/api/users/:id/meals/today` | 今日饮食 |
| POST | `/api/users/:id/meals` | 记录用餐 |
| POST | `/api/users/:id/cooking-plan` | 生成做饭计划 |
| POST | `/api/users/:id/cooking-feedback` | 记录烹饪反馈 |
| GET | `/api/users/:id/workflow/today` | 今日工作流总览 |
| POST | `/api/users/:id/workflow/shopping-plan` | 生成购物清单 |
| POST | `/api/users/:id/workflow/weekend-prep` | 周末备菜 |

## ⚠️ 当前限制

1. **单用户设计**：当前 userId 为字符串标识，无鉴权
2. **热量估算**：未接入食物营养数据库，为粗略估算
3. **会话无持久化**：Agent session 在内存中，重启后丢失（但用户数据在 SQLite 中持久化）
4. **API Key 明文**：.env 中存储，注意不要提交到版本控制
