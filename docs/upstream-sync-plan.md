# Upstream Sync 执行计划

> 将 upstream `op7418/CodePilot` (v0.47.0) 合并到本地 fork (v0.10.11)
>
> 编写日期：2026-04-05
> **执行完成：2026-04-07**
>
> **实际策略调整**：原计划基于 53 commits 差距做 `git merge`，实际 fetch 后发现 upstream 已到 v0.47.0（432 commits, 1419 files, +173K 行）。改为基于 upstream/main 创建分支，cherry-pick 本地 5 个 commit，大幅减少冲突处理量。

---

## 1. 概况

| 项目 | 数值 |
|---|---|
| 公共祖先 | `31879e0` (v0.10.11) |
| upstream 领先 | **53 commits** (v0.10.11 → v0.19.1) |
| 本地 fork 领先 | **5 commits** (mobile responsive、auth、Electron 修复等) |
| upstream 变更文件 | **163 files** (+19,976 / −4,446 行) |
| 本地 fork 变更文件 | **39 files** |
| 预计冲突文件 | **25 files**（双方均修改） |
| 仅 upstream 修改 | **~120 files**（直接接受） |
| 仅本地修改 | **~8 files**（直接保留） |

### upstream 主要新增功能

- i18n 国际化 (中/英)
- 多 Provider 重构（17+ provider 支持、模型切换 UI）
- 聊天分屏 (Split Screen)
- Skills.sh Marketplace 集成
- 图片生成 (Gemini Image Gen) + Gallery + 批量任务
- electron-updater 自动更新
- Token 用量统计页
- Stream Session Manager
- macOS code signing 热更新修复
- Error Boundary
- 性能优化 (memo, base64 cleanup)

### 本地 fork 主要改动

- Mobile responsive layout + 密码认证
- Electron dev 启动兼容性 (Linux、非 3000 端口)
- Mobile hydration crash 修复
- Standalone build 静态文件自动拷贝

---

## 2. 策略选择：Merge（推荐）

| 方式 | 优点 | 缺点 |
|---|---|---|
| **`git merge`** ✅ | 不改历史，翻车可回退；冲突集中处理一次 | 产生一个 merge commit |
| `git rebase` | 线性历史 | 改写历史，5 个本地 commit 逐个 rebase 需多次解冲突 |
| `git cherry-pick` | 精准选取 | 53 个 commit 太多，选取成本高 |

**结论：用 `git merge upstream/main`**，在独立分支上操作，确认无误再合回 `main`。

---

## 3. 执行步骤

### Phase 0: 准备

```bash
cd /home/alex_chen/CodePilot

# 0-1. 保存当前未提交改动
git stash push -u -m "wip before upstream sync"

# 0-2. 拉最新 upstream
git fetch upstream --tags

# 0-3. 基于 main 创建同步分支
git switch -c sync/upstream-2026-04-05
```

### Phase 1: 合并

```bash
# 1-1. 执行 merge
git merge upstream/main

# 1-2. 如果出现冲突，先查看全貌
git status
git diff --name-only --diff-filter=U   # 仅列出冲突文件
```

### Phase 2: 冲突解决（按分类处理）

下表列出所有预计冲突的文件及处理策略：

#### 2a. 构建/依赖 — 必须手动合并

| 文件 | 策略 | 说明 |
|---|---|---|
| `package.json` | **手动合并** | upstream 新增大量依赖 (`@google/genai`, `electron-updater`, i18n 等)；保留我们的 `scripts.electron:dev` 端口逻辑和版本号，接受 upstream 新依赖 |
| `package-lock.json` | **删除后重新生成** | 合并后运行 `rm package-lock.json && npm install` 重新生成 |
| `electron/main.ts` | **手动合并** | upstream 加了 updater、preload 改动；我们改了 no-sandbox 和端口逻辑。两边都要保留 |

#### 2b. 核心业务逻辑 — 需仔细审查

| 文件 | 策略 | 说明 |
|---|---|---|
| `src/lib/claude-client.ts` | **手动合并** | upstream 大幅重构（+1151 行），我们有小幅改动。以 upstream 为主，检查我们的改动是否仍需保留 |
| `src/lib/permission-registry.ts` | **手动合并** | upstream 扩展了权限系统，我们有 auth 相关改动 |
| `src/types/index.ts` | **手动合并** | upstream 新增大量类型 (+249)，我们也有新增。两边合并 |
| `src/app/api/chat/route.ts` | **手动合并** | upstream 重构了聊天 API (+155)，我们有 auth/permission 改动 |
| `src/app/api/chat/permission/route.ts` | **手动合并** | 双方都改了权限路由 |
| `src/hooks/useSSEStream.ts` | **手动合并** | upstream 改了 SSE 流处理，我们也有修复 |

#### 2c. UI 组件 — 以 upstream 为主，迁移我们的 mobile 改动

| 文件 | 策略 | 说明 |
|---|---|---|
| `src/components/chat/ChatView.tsx` | **以 theirs 为主** | upstream 大改 (+452)，我们的 mobile 改动需要手动移植到新结构上 |
| `src/components/chat/MessageInput.tsx` | **以 theirs 为主** | upstream 重构 (+562)，我们改动较小 |
| `src/components/chat/MessageList.tsx` | **以 theirs 为主** | upstream 改动小，我们也改动小，手动合并 |
| `src/components/layout/AppShell.tsx` | **以 theirs 为主** | upstream 大改 (+479)，我们的 mobile layout 逻辑需重新适配 |
| `src/components/layout/ChatListPanel.tsx` | **以 theirs 为主** | upstream 大改 (+453) |
| `src/components/layout/ConnectionStatus.tsx` | **以 theirs 为主** | 我们改动小 |
| `src/components/layout/ImportSessionDialog.tsx` | **以 theirs 为主** | 我们改动小 |
| `src/components/layout/InstallWizard.tsx` | **以 theirs 为主** | upstream 大改 (+144) |
| `src/components/plugins/McpManager.tsx` | **以 theirs 为主** | 我们改动小 |
| `src/components/plugins/McpServerList.tsx` | **以 theirs 为主** | 我们改动小 |

#### 2d. 设置页 — 以 upstream 为主，合并我们的 provider 改动

| 文件 | 策略 | 说明 |
|---|---|---|
| `src/components/settings/ProviderManager.tsx` | **以 theirs 为主** | upstream 重大重构 (+976)，我们的改动需要重新适配 |
| `src/components/settings/ProviderForm.tsx` | **手动合并** | 双方都有改动 |
| `src/components/settings/GeneralSection.tsx` | **以 theirs 为主** | upstream 加了大量设置项 (+154) |
| `src/components/settings/CliSettingsSection.tsx` | **以 theirs 为主** | upstream 改了 CLI 设置 |
| `src/components/settings/SettingsLayout.tsx` | **以 theirs 为主** | upstream 加了 usage stats tab |

#### 2e. 页面路由 — 以 upstream 为主

| 文件 | 策略 | 说明 |
|---|---|---|
| `src/app/chat/[id]/page.tsx` | **以 theirs 为主** | upstream 加了分屏 |
| `src/app/chat/page.tsx` | **以 theirs 为主** | 小改 |
| `src/app/extensions/page.tsx` | **以 theirs 为主** | upstream 重构了扩展页 |
| `src/app/layout.tsx` | **手动合并** | 我们有 auth provider 包裹，upstream 加了 i18n provider |

#### 2f. 仅本地修改的文件 — 保留（不会冲突）

| 文件 | 说明 |
|---|---|
| `.cursorrules` | 本地 lessons，保留 |
| `src/app/login/page.tsx` | 我们新增的登录页，保留 |
| `src/app/global-error.tsx` | 我们的错误页（upstream 换了 ErrorBoundary 组件方案），保留 |
| `src/app/globals.css` | 我们的样式改动，保留 |
| `src/lib/auth.ts` | 我们的认证模块，保留 |
| `src/lib/platform.ts` | 我们的平台兼容修改，保留 |
| `src/middleware.ts` | 我们的 auth middleware，保留 |
| `src/components/layout/MobileNav.tsx` | 我们的移动端导航，保留 |

### Phase 3: 冲突解决的具体操作

```bash
# 3-1. 对于"以 theirs 为主"的文件，批量接受 upstream 版本
git checkout --theirs \
  src/components/chat/ChatView.tsx \
  src/components/chat/MessageInput.tsx \
  src/components/chat/MessageList.tsx \
  src/components/layout/AppShell.tsx \
  src/components/layout/ChatListPanel.tsx \
  src/components/layout/ConnectionStatus.tsx \
  src/components/layout/ImportSessionDialog.tsx \
  src/components/layout/InstallWizard.tsx \
  src/components/plugins/McpManager.tsx \
  src/components/plugins/McpServerList.tsx \
  src/components/settings/ProviderManager.tsx \
  src/components/settings/GeneralSection.tsx \
  src/components/settings/CliSettingsSection.tsx \
  src/components/settings/SettingsLayout.tsx \
  src/app/chat/[id]/page.tsx \
  src/app/chat/page.tsx \
  src/app/extensions/page.tsx
git add \
  src/components/chat/ChatView.tsx \
  src/components/chat/MessageInput.tsx \
  src/components/chat/MessageList.tsx \
  src/components/layout/AppShell.tsx \
  src/components/layout/ChatListPanel.tsx \
  src/components/layout/ConnectionStatus.tsx \
  src/components/layout/ImportSessionDialog.tsx \
  src/components/layout/InstallWizard.tsx \
  src/components/plugins/McpManager.tsx \
  src/components/plugins/McpServerList.tsx \
  src/components/settings/ProviderManager.tsx \
  src/components/settings/GeneralSection.tsx \
  src/components/settings/CliSettingsSection.tsx \
  src/components/settings/SettingsLayout.tsx \
  src/app/chat/[id]/page.tsx \
  src/app/chat/page.tsx \
  src/app/extensions/page.tsx

# 3-2. 手动合并的文件，逐个打开编辑器处理
#      搜索 <<<<<<< 标记，逐块决策
code package.json
code electron/main.ts
code src/lib/claude-client.ts
code src/lib/permission-registry.ts
code src/types/index.ts
code src/app/api/chat/route.ts
code src/app/api/chat/permission/route.ts
code src/hooks/useSSEStream.ts
code src/components/settings/ProviderForm.tsx
code src/app/layout.tsx

# 3-3. package-lock.json 不要手动合并
git checkout --theirs package-lock.json
git add package-lock.json
```

### Phase 4: 验证

```bash
# 4-1. 确认没有遗留冲突标记
git diff --check

# 4-2. 重新安装依赖
rm -rf node_modules
npm install

# 4-3. 类型检查
npx tsc --noEmit

# 4-4. Lint
npm run lint

# 4-5. 构建测试
npm run build

# 4-6. 启动 Electron 应用测试
npm run electron:dev
```

### Phase 5: 功能验证清单

- [ ] 应用能正常启动，无白屏
- [ ] 基础聊天功能正常（发消息、收回复）
- [ ] Provider 设置页能正常配置
- [ ] 我们的密码登录功能仍然工作
- [ ] Mobile responsive 布局仍然正常
- [ ] 新增的 i18n 切换功能工作
- [ ] MCP 页面正常
- [ ] Skills 页面正常
- [ ] Gallery 页面正常（新功能）
- [ ] Split Screen 功能正常（新功能）
- [ ] 自动更新功能正常（新功能）
- [ ] 用量统计页正常（新功能）

### Phase 6: 完成合并

```bash
# 6-1. 提交 merge
git commit

# 6-2. 恢复之前 stash 的改动
git stash pop

# 6-3. 切回 main 并合并同步分支
git switch main
git merge sync/upstream-2026-04-05

# 6-4. 推送（确认无误后）
git push origin main
```

---

## 4. 合并后需要额外处理的事项

### 4a. Mobile 适配重做

upstream 的 UI 组件结构大幅变化，我们原来在以下组件上做的 mobile responsive 改动大概率需要在新组件结构上重新实现：

- `AppShell.tsx` — upstream 已重构，我们的 mobile layout 逻辑需迁移
- `ChatListPanel.tsx` — upstream 已重构
- `MobileNav.tsx` — 我们独有的组件，检查是否仍能集成到 upstream 的新 NavRail 结构中

### 4b. Auth 系统集成

upstream 删除了 `src/lib/auth.ts` 和 `src/middleware.ts`，走了不同的认证路线。我们需要：

1. 确认我们的 password auth 中间件与 upstream 新的 API 路由兼容
2. 新增的 API 路由（media、skills/marketplace 等）是否需要加 auth 保护
3. `src/app/layout.tsx` 中我们的 auth provider 与 upstream 的 `I18nProvider` 共存

### 4c. 版本号决策

合并后 `package.json` 版本号需要决定：
- 选项 A：跟 upstream 走 `0.19.1`（保持同步）
- 选项 B：基于 upstream 版本追加我们的标识，如 `0.19.1-fork.1`
- 选项 C：保留我们独立的版本线，如 `0.11.0`

---

## 5. 风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| UI 组件冲突太多导致合并耗时 | 🟡 中 | 大部分 UI 文件直接取 theirs，减少手动合并量 |
| Mobile responsive 功能丢失 | 🟡 中 | 合并后专门做一轮 mobile 适配 |
| Auth 系统与新 API 路由不兼容 | 🟠 中高 | 新增路由需逐个检查是否缺少 auth |
| `claude-client.ts` 合并出错导致核心功能异常 | 🔴 高 | 重点文件，需逐行审查 |
| 依赖版本冲突 | 🟡 中 | 删 lockfile 重装，跑完整 build 验证 |

---

## 6. 回退方案

合并全程在 `sync/upstream-2026-04-05` 分支上操作，`main` 不受影响。

```bash
# 如果合并过程中想完全放弃
git merge --abort
git switch main
git branch -D sync/upstream-2026-04-05

# 如果合并已提交但发现问题，回退 main
git switch main
git reset --hard origin/main
```

---

## 7. 预计耗时

| 阶段 | 预计时间 |
|---|---|
| Phase 0-1: 准备 + merge | 5 min |
| Phase 2-3: 冲突解决 | 1-2 hr |
| Phase 4: 构建验证 | 15 min |
| Phase 5: 功能验证 | 30 min |
| Phase 6: 完成 | 5 min |
| **合计** | **~2-3 hr** |
