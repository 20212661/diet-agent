# 🍳 晚饭工作流 — 个人饮食管理智能体（终端版）

基于 **@earendil-works/pi-coding-agent** SDK 构建的智能晚饭管理助手。

面向**独居/双人的下班做饭场景**，覆盖「买菜 → 入库 → 计划 → 做饭 → 反馈 → 周末备菜」完整循环。
**纯终端交互**——一个命令进入全屏聊天界面，自然语言操作一切。

## 🖼 系统展示

### 终端聊天界面

![TUI 终端](docs/images/tui.png)

> `diet-agent` 启动后进入全屏终端聊天，`Enter` 发送、`Ctrl+C` 退出。

## ✨ 主要功能

- 🧾 **25 道内置菜谱** — 覆盖快手/一锅出/明火/烤制等多种模式
- 🛒 **购物清单** — 根据已有库存和菜谱推荐买什么
- 🍳 **生成晚饭计划** — 分钟级时间线 + 低能量版本（"我今天很累" → 低能量方案）
- 🍽️ **记录三餐 + 反馈** — AI 越用越懂你
- 🧊 **食材库存管理** — 冷藏/冷冻/储藏/室温分类，过期提醒
- 📅 **一周菜单计划** — 7 天不重复，自动避开忌口、优先用已有食材
- 💬 **自然语言交互** — 终端里直接聊：告诉我你有什么、想吃什么、累不累

## 🚀 快速开始

### 1. 安装

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填写**至少一个**模型供应商的 API Key：

```env
# DeepSeek（推荐，性价比高）
DEEPSEEK_API_KEY=sk-your-deepseek-key-here

# 或者 智谱 GLM（国内访问稳定）
ZAI_API_KEY=your-zai-key-here
```

> 💡 不设置 `MODEL_PROVIDER` 时会自动检测已配置的 Key，优先级：DeepSeek → GLM → OpenAI → Anthropic → OpenRouter。

### 3. 启动

```bash
# 方式一：全局命令（推荐）
npm link          # 首次需要注册
diet-agent        # 进入终端聊天

# 方式二：直接运行
npm start

# 指定用户 ID（多设备/多人区分数据用）
diet-agent my_user
# 或
npm start -- my_user
```

启动后进入全屏终端界面，`Enter` 发送，`Ctrl+C` 退出。首次聊天时告诉助手你的饮食目标、忌口、厨房条件即可，它会自动记录到本地数据库。

## 📋 日常使用

打开终端直接对话，示例：

```
🧑 你：我今天很累，库存有鸡腿和番茄，15 分钟能搞定的晚饭
🤖 饮食助手：（调用工具查库存 + 匹配菜谱，给出时间线）

🧑 你：我晚饭吃了番茄炒蛋和米饭
🤖 饮食助手：✅ 已记录晚餐...

🧑 你：帮我安排这周吃什么
🤖 饮食助手：（生成一周菜单，避开忌口、优先用已有食材）

🧑 你：今天吃得怎么样？
🤖 饮食助手：（汇总今日饮食和热量估算）
```

工作流循环：

```
打开终端
    ├─ ① "我库存有 X、Y、Z" → 自动入库
    ├─ ② "今天做什么" → 生成晚饭计划（含时间线）
    ├─ ③ 太累？"我很累" → 低能量方案
    ├─ ④ 做完 → "我吃了 ..." → 记录
    ├─ ⑤ 反馈 → "这道菜太累/太油/下次还做" → 系统学习偏好
    └─ 周末 → "安排一周菜单" → 周计划 + 备菜建议
```

## 🧩 支持的模型

| Provider | 环境变量 | 说明 |
|----------|----------|------|
| **deepseek** | `DEEPSEEK_API_KEY` | 推荐性价比高 |
| **zai** | `ZAI_API_KEY` | 智谱 GLM，国内直连稳定 |
| **openai** | `OPENAI_API_KEY` | OpenAI GPT 系列 |
| **anthropic** | `ANTHROPIC_API_KEY` | Anthropic Claude |
| **openrouter** | `OPENROUTER_API_KEY` | 聚合网关，多种模型 |

## 🔑 API Key 安全

- `.env` 已在 `.gitignore` 中，**不会**被提交到版本库。`.env.example` 仅为模板（值为空），切勿填入真实 key 后提交。
- 数据本地化：用户画像、库存、菜谱、对话历史全部存在本地 `data/` 目录（同样被 gitignore）。

## 📂 项目结构

```
src/
  tui/
    index.ts                     # TUI 入口（加载日志、读取 userId）
    chat-tui.ts                  # 终端聊天界面（直接调用 Agent，无 HTTP 中转）
  agent/
    createDietAgent.ts           # Agent 创建 + 消息发送（会话按 userId 持久化）
    modelAdapter.ts              # 多模型适配（DeepSeek/GLM/OpenAI...）+ 自动降级
    sessionStore.ts              # userId → Agent session 映射
    systemPrompt.ts              # 分层系统提示词 + 动态用户记忆注入
    prompts/                     # 分层提示词（身份/工具/烹饪/饮食/安全）
  recipes/
    recipeBook.ts                # 内置菜谱管理
    recipeMatcher.ts             # 菜谱匹配算法（多维度评分）
    recipeSeed.json              # 25 道菜谱种子数据
  store/
    sqliteStore.ts               # SQLite 持久化存储
    index.ts                     # 统一存储导出
  tools/                         # Agent 工具定义（15 个）
  types/
    diet.ts                      # TypeScript 类型定义
  utils/
    errors.ts                    # 错误处理
    requestLogger.ts             # LLM API 请求日志（patch fetch）
bin/
  diet.js                        # CLI 入口（npm link 后即 diet-agent 命令）
data/                            # 本地数据（自动创建，已被 gitignore）
  diet-agent.sqlite              # 业务数据持久化
  sessions/<userId>/             # 按 userId 隔离的对话历史（JSONL，重启恢复）
logs/                            # 请求日志（自动创建，已被 gitignore）
```

## 🔧 技术栈

| 组件 | 技术 |
|------|------|
| 终端 UI | @earendil-works/pi-tui |
| AI SDK | @earendil-works/pi-coding-agent |
| 数据库 | SQLite (better-sqlite3) |
| 运行时 | tsx (开发) / tsc + node (生产) |

## 🛠 其他命令

```bash
npm run build       # 编译到 dist/
npm run typecheck   # 类型检查
npm test            # 运行测试（菜谱匹配、工具、存储等 13 项）
```

## ⚠️ 当前限制

1. **热量估算**：未接入食物营养数据库，为粗略估算
2. **单终端会话**：同一 userId 同时只建议开一个终端实例（避免并发写冲突）
3. **API Key 管理**：见上方 [🔑 API Key 安全](#-api-key-安全) 章节
