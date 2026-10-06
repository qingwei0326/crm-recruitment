# 前端设计规范

面向招生 CRM 的日常高频操作：安静、紧凑、可信赖，信息密度优先，不做装饰性设计。

## 设计令牌（`tailwind.config.js`）

| 令牌 | 值 | 用途 |
|---|---|---|
| `bg-surface-page` | `#f5f7fb` | 后台页面底色（暗色模式用 `dark:bg-gray-950`） |
| `text-2xs` / `text-3xs` | 11px / 10px | 表格、徽标等紧凑元数据文字 |
| `shadow-panel` / `shadow-panel-dark` | 轻阴影（亮 / 暗） | 后台面板（`dark:shadow-panel-dark`） |
| `rounded-panel` | 12px | 面板、卡片、弹层、底部抽屉 |

- 控件（按钮、输入框、下拉）使用 `rounded` / `rounded-md` / `rounded-lg`（4–8px）。
- 不要再使用 `rounded-xl` / `rounded-2xl`，也不要用 `text-[10px]`、`text-[11px]`、`bg-[#f5f7fb]`、`shadow-[0_2px_10px…]`。ESLint（`no-restricted-syntax`）会直接报错。
- 小于 10px 的文字不要使用。
- 颜色：中性灰为底，蓝色为主操作，绿 / 琥珀 / 红为成功 / 警告 / 危险；任何一种色相不得占据整个界面。
- 暗色模式：`darkMode: 'class'`，保证对比度，不使用大面积纯黑。

## 动效

只使用简短的功能性过渡。`index.css` 中的 `prefers-reduced-motion` 规则已全局生效，组件无需额外处理。

## 反馈与状态组件

- **加载 / 空 / 错误**：用 `components/AsyncState`（`ContentSkeleton`、`EmptyState`、`ErrorState`）。放在已有容器内时加 `bare`；错误重试按钮文案用 `retryLabel` 定制。不要手写"加载中… / 暂无… / 加载失败"。
- **确认与输入**：用 `useConfirm()` / `usePrompt()`（`components/ConfirmDialog`），删除类操作用 `tone: 'danger'`。禁止 `window.alert/confirm/prompt`（ESLint 会报错）。
- **操作结果提示**：用 `useToast()`。

## 页面骨架

后台页面使用 `components/admin/AdminPagePrimitives`（`adminPageMainClass`、`AdminPageContainer`、`AdminSurface`、`AdminPageIntro`），保持页面间一致。

## 移动端

- 可点击控件最小 40px。
- 页面不出现横向滚动；顶部栏支持安全区（`useSafeArea`）。
