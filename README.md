# 🍳 晚饭工作流 — 个人饮食管理智能体

基于 **@earendil-works/pi-coding-agent** SDK 构建的智能晚饭管理助手，纯终端 TUI 交互。

面向**独居/双人的下班做饭场景**，覆盖「买菜 → 入库 → 计划 → 做饭 → 反馈 → 周末备菜」完整循环。

## ✨ 主要功能

- 🧭 **首次启动引导** — 交互式配置 API Key、饮食目标、厨房条件、常备食材
- 📖 **25 道内置菜谱** — 覆盖快手/一锅出/明火/烤制等多种模式，按食材和时间智能匹配
- 🛒 **购物建议** — 根据已有库存和菜谱推荐买菜
- 🍳 **生成晚饭计划** — 分钟级时间线 + 低能量版本
- 🍽️ **记录晚餐 + 反馈** — AI 越用越懂你的口味
- 🧊 **食材库存管理** — 冷藏/冷冻/储藏/室温分类，过期提醒
- 🔄 **多模型自动降级** — 支持 5 个供应商，失败自动切换下一个
- 💬 **自然语言交互** — "我今天很累" → 自动触发低能量方案

## 🚀 快速开始

### 1. 安装

```bash
npm install
```

### 2. 启动

```bash
# 方式一：开发模式（推荐）
npm run dev

# 方式二：全局命令
npm link
diet-agent

# 方式三：编译后启动
npm run build && npm start
```

首次启动会自动弹出交互式引导，按提示操作即可。

### 3. 首次使用引导

首次运行自动触发两步引导：

| 步骤 | 内容 | 例子 |
|------|------|------|
| Step 1 🔑 | API Key 配置 — 选择供应商并输入 Key | DeepSeek（推荐）|
| Step 2 👤 | 饮食档案 — 目标、身高体重、忌口、厨房条件、常备食材 | 减脂、175cm、2 灶 |

引导数据保存到本地 SQLite 数据库，`API Key` 保存到 `.env`，下次启动不再弹出。

之后可随时用 `/setup` 重新配置。

## 📋 日常使用流程

```
启动 → npm run dev
    │
    ├─ /shop        → 根据库存生成购物建议
    │
    ├─ "买了鸡腿和西兰花"   → AI 自动录入库存
    │
    ├─ /plan        → 生成晚饭计划（分钟级时间线）
    │   └─ /tired   → 低能量省力版本
    │
    ├─ /log 番茄炒蛋、米饭  → 快速记录晚餐
    │
    └─ "番茄炒蛋不错，8分钟搞定"  → AI 记录反馈，学习偏好
```

## ⌨️ 快捷命令

| 命令 | 作用 |
|------|------|
| `/shop` | 根据库存生成购物建议 |
| `/plan` | 生成晚饭计划 |
| `/tired` | 低能量版本晚饭计划 |
| `/today` | 查看今日饮食总结 |
| `/stock` | 查看当前食材库存（直接显示，不走 AI） |
| `/log 番茄炒蛋、米饭` | 快速记录晚餐 |
| `/prep` | 生成周末备菜建议 |
| `/setup` | 重新配置 API Key + 饮食目标 + 厨房 |
| `/help` | 显示命令列表 |

所有命令也都可以用自然语言触发，比如输入 "帮我安排晚饭" 等同于 `/plan`。

## 🔧 命令行参数

```bash
diet-agent              启动终端聊天（唯一模式）
diet-agent --help       显示帮助
```

指定用户名：

```bash
npm run dev -- myname
```

## ⚙️ 环境变量

在 `.env` 文件中配置。首次启动引导会交互式帮你填写，也可以手动编辑。

### API Key（至少填一个）

| 变量 | 供应商 | 注册地址 |
|------|--------|----------|
| `DEEPSEEK_API_KEY` | DeepSeek（推荐，性价比高）| https://platform.deepseek.com/ |
| `ZAI_API_KEY` | 智谱 GLM（国内稳定）| https://open.bigmodel.cn/ |
| `OPENAI_API_KEY` | OpenAI（GPT 系列）| https://platform.openai.com/ |
| `ANTHROPIC_API_KEY` | Anthropic（Claude 系列）| https://console.anthropic.com/ |
| `OPENROUTER_API_KEY` | OpenRouter（聚合网关）| https://openrouter.ai/ |

自动检测优先级：`MODEL_PROVIDER` 手动指定 > DeepSeek > 智谱 GLM > OpenAI > Anthropic > OpenRouter > SDK 默认。

### 其他配置（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `USER_ID` | `tui_user` | 用户标识 |
| `MODEL_PROVIDER` | 自动检测 | 强制指定供应商 |
| `MODEL_ID` | 供应商默认 | 强制指定模型 ID |
| `MODEL_FALLBACK_ATTEMPTS` | `2` | 模型降级尝试次数 |
| `TOOL_RETRY_COUNT` | `1` | 工具调用重试次数 |
| `ENABLE_REQUEST_LOGS` | 未设置 | 设为 `1` 时启用脱敏后的 LLM 请求诊断日志 |
| `REQUEST_LOG_RETENTION_DAYS` | `7` | 请求诊断日志保留天数 |

## 🧩 支持的模型

| 供应商 | 环境变量 | 默认模型 | 说明 |
|--------|----------|----------|------|
| **deepseek** | `DEEPSEEK_API_KEY` | deepseek-chat | 推荐性价比高 |
| **zai** | `ZAI_API_KEY` | glm-5-turbo | 国内直连稳定 |
| **openai** | `OPENAI_API_KEY` | gpt-4o | OpenAI GPT 系列 |
| **anthropic** | `ANTHROPIC_API_KEY` | claude-sonnet-4-5 | Anthropic Claude |
| **openrouter** | `OPENROUTER_API_KEY` | deepseek/deepseek-chat | 聚合网关，可访问多种模型 |

## 🛠 AI 工具一览

助手内置 15 个工具，AI 根据对话自动调用：

| 工具 | 说明 |
|------|------|
| `generate_cooking_plan` | 根据食材、时间、精力生成分钟级做饭计划 |
| `generate_meal_plan` | 按饮食目标生成多天早午晚餐模板 |
| `search_recipes` | 按食材/时间/精力搜索匹配菜谱 |
| `log_meal` | 记录某一餐吃了什么 |
| `log_cooking_feedback` | 记录评分、耗时、是否太累、下次还想做吗 |
| `get_ingredient_inventory` | 查询食材库存（可用/快过期/全部） |
| `update_ingredient_inventory` | 新增或替换食材 |
| `mark_ingredient_used` | 标记食材已用/过期/丢弃 |
| `get_user_profile` | 查询用户饮食画像 |
| `update_user_profile` | 更新饮食目标、身高体重、忌口等 |
| `get_kitchen_profile` | 查询厨房配置 |
| `update_kitchen_profile` | 更新灶眼、烤箱、厨具、偏好 |
| `get_today_summary` | 查询今日（或指定日期）饮食记录和热量汇总 |
| `search_food_api` | 通过 FatSecret 查询食物营养数据 |
| `get_skill` | 按 slug 加载可复用工作流 |

## 📂 项目结构

```
src/
  tui/
    index.ts                     # 入口：dotenv → onboarding → chat-tui
    onboarding.ts                # 首次引导 + /setup 重配置（API Key + 饮食档案）
    chat-tui.ts                  # TUI 聊天界面（基于 @earendil-works/pi-tui）
  agent/
    createDietAgent.ts           # Agent 创建 + 消息发送 + 多模型降级
    modelAdapter.ts              # 多模型适配、工具参数修复、降级策略
    sessionStore.ts              # userId → Agent session 映射
    systemPrompt.ts              # 系统提示词（含用户记忆注入）
    prompts/                     # 分层提示词
      baseIdentityPrompt.ts      # 基础身份
      cookingPrompt.ts           # 烹饪相关
      dietPrompt.ts              # 饮食相关
      toolUsagePrompt.ts         # 工具使用指导
      safetyPrompt.ts            # 安全约束
      skillUsagePrompt.ts        # Skill 加载规则
  recipes/
    recipeBook.ts                # 内置菜谱管理
    recipeMatcher.ts             # 菜谱匹配算法（按食材/时间/精力）
    recipeCatalog.ts             # 内置菜谱 + 用户菜谱 + 热量校准统一入口
    recipeSeed.json              # 25 道菜谱种子数据
  store/
    index.ts                     # 统一导出
    sqliteStore.ts               # SQLite 持久化（WAL 模式）
  tools/                         # 15 个 Agent 工具定义
    generateCookingPlan.ts
    generateMealPlan.ts
    getIngredientInventory.ts
    getKitchenProfile.ts
    getTodaySummary.ts
    getUserProfile.ts
    logCookingFeedback.ts
    logMeal.ts
    markIngredientUsed.ts
    searchRecipes.ts
    updateIngredientInventory.ts
    updateKitchenProfile.ts
    updateUserProfile.ts
    searchFoodApi.ts
    getSkill.ts
  types/
    diet.ts                      # TypeScript 类型定义
  tests/
    core.test.ts                 # 单元测试
bin/
  diet.js                        # CLI 入口（通过 tsx 启动 src/tui/index.ts）
data/                            # SQLite 数据库 + Agent sessions（自动创建）
```

## 🔧 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript (ESM) |
| AI SDK | @earendil-works/pi-coding-agent |
| TUI 框架 | @earendil-works/pi-tui |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| 开发运行 | tsx |
| 生产构建 | tsc + node |

## 🧪 开发命令

```bash
npm run dev          # 开发模式启动
npm run build        # 编译 TypeScript
npm start            # 运行编译产物
npm run typecheck    # 类型检查
npm test             # 运行测试
```

## ⚠️ 当前限制

1. **单用户设计**：userId 为字符串标识，无鉴权
2. **热量估算**：支持 FatSecret 查询和用户校准，但汇总仍为粗略估算；存在未知项时会显示覆盖率
3. **会话存储**：Agent session 文件保存在 `data/sessions/`，用户业务数据保存在 SQLite
4. **API Key 明文**：存储在 `.env` 中，注意不要提交到版本控制

## 🧪 请求诊断日志

请求日志默认关闭。需要诊断模型调用时，在 `.env` 中设置：

```bash
ENABLE_REQUEST_LOGS=1
REQUEST_LOG_RETENTION_DAYS=7
```

日志写入 `logs/api-requests/`，启动时会清理超过保留期的文件。日志会脱敏认证信息、健康备注和过敏信息，并记录延迟、token、供应商返回的缓存命中 token。成本估算只有在配置 `LLM_*_COST_PER_MILLION` 后才会计算。本地 Prompt hash 只用于稳定前缀，不代表供应商缓存已经命中。
