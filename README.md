# TRP 任务台 · Android

天枢架构内部接单客户端：**管理员在本机发布或指派任务，手机端只能接单、交付**。
用微信号登录/注册身份，任务从「待接 → 进行中 → 待验收 → 已完成」流转，
谁接的（微信号）、什么时候接的都写在任务文件里。像滴滴抢单，但发布权只在你手里。

仓库：<https://github.com/Toriesta/trplink.git>

## 视觉

象牙白 `#F4F0E6` 主色、深紫 `#120B21 / #1A1030` 结构、珊瑚 `#FF6E5B` 点缀。
和桌面端 TRP Link 同一套色板：圆角卡片、发丝线、无阴影堆砌、DIN 式数字排版。

## 拿到 APK（推荐：GitHub Actions 免费构建）

1. 把本目录内容推到 `Toriesta/trplink` 的 `main` 分支
2. 打开仓库 **Actions** 页，等 `Android APK` 这一次运行结束（首次约 3–5 分钟）
3. 点进这次运行，在页面底部 **Artifacts** 下载 `trp-tasks-debug-apk`
4. 解压得到 `app-debug.apk`，传到手机点击安装（Android 会提示「允许安装未知来源应用」）

每次 push 都会重新出一个 APK，不需要本地装 Android Studio。

本地也能出包（已装 JDK 17 + Android SDK 34 时）：

```bash
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug      # Windows: gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

## 角色与权限

| 角色 | 在哪 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| 管理员（你） | 本机 `publish_task.py` | 发布任务、指定某人、验收完成 | — |
| 接单人 | 手机 App | 微信号登录/注册、抢单、撤回、提交交付 | 发布任务、改别人接的单、把状态改成已完成 |

首次配置管理员（只需一次）：

```bash
python tools/publish_task.py --admin 你的微信号 --set-admin
```

这个值写进 `config.json`，之后任何发布命令都要带同样的 `--admin`，否则脚本直接拒绝。

## 手机端：微信号登录 → 接单

首次打开默认是**演示数据**（4 条示例任务，只存在手机里）。接真实任务：

1. 打开 App → 底部「设置」→「账号」
2. 输入**微信号** → 点「登录 / 注册」（第一次输入即注册；已存在则登录）
3. 数据源选 **GitHub 仓库**：owner `Toriesta`，repo `trplink`，分支 `main`，路径 `tasks.json`
4. 填一个 fine-grained PAT（只给这个仓库 `Contents: read and write`）→ 保存并同步
5. 回「任务」页抢单；指派给你的单会显示「指定给你」，并直接出现在「我的」页

公开仓库的**读取不需要 token**；写入需要。token 和微信号都只存手机本地。

现在是临时方案：**微信登录 = 自报微信号**，没有微信官方 OAuth（那需要 AppID + 服务器回调）。
将来部署服务器时换成真实微信授权 + 服务端 RBAC，App 侧接口不用改。

## 发布任务（仅管理员）

```bash
# 公开抢单
python tools/publish_task.py --admin 你的微信号 --title "第 16 集粗剪" \
  --reward 400 --deadline 2026-11-25 --tags "剪辑,ODSUS" --checklist "字幕|音效"

# 指派给某个微信号（对方打开就是「我的任务」，不用抢）
python tools/publish_task.py --admin 你的微信号 --title "海外样片" --reward 1500 \
  --assign-to chenchengfang --assign-name 陈成方

# 推到 GitHub（需 GH_TOKEN 环境变量）
python tools/publish_task.py --admin 你的微信号 --title "..." --reward 400 \
  --repo Toriesta/trplink --push
```

指派时会自动把这个微信号写进 `users.json`（工人角色），手机端按微信号找到自己的单。

### GitHub 方案的能力边界

GitHub 的 token 是**仓库级**权限，没法在 GitHub 层做到「这个 key 只能接单不能发布」。
所以这里的权限是**应用层**的：手机端没有发布入口，`claim/submitted` 会校验微信号与任务归属，
发布脚本用 `config.json` 的管理员微信号校验。拿到写 token 的人理论上仍可直接改仓库里的 JSON——
这是临时软件的边界，上服务器后由后端角色校验彻底解决。

字段说明：

| 字段 | 含义 |
| --- | --- |
| `id` | 形如 `T-2611-05`，脚本自动生成 |
| `reward` | 金额（人民币） |
| `deadline` | `YYYY-MM-DD`，≤2 天会标珊瑚色 |
| `priority` | 1 高 / 2 中 / 3 低，决定卡片左侧竖条颜色 |
| `status` | `open` 待接 / `claimed` 进行中 / `submitted` 待验收 / `done` 已完成 |
| `claimedBy` | 接单人**微信号**（App 自动写） |
| `claimedName` | 接单人显示名 |
| `assignedTo` | 指定接单人的微信号；非空时只有此人能接 |
| `checklist` | 交付清单，字符串数组 |

## 目录

```text
mobile-app/
├─ www/                       纯原生 HTML/CSS/JS，无前端框架
│  ├─ index.html              页面骨架
│  ├─ styles.css              全套视觉（象牙白 / 深紫 / 珊瑚）
│  ├─ store.js                数据层：本地演示 + GitHub contents API + 缓存
│  └─ app.js                  界面层：三个 tab、详情抽屉、抢单/提交/撤回
├─ android/                   Capacitor 生成的原生壳（含 Gradle wrapper）
├─ tasks.json                 任务池，GitHub 模式直接读它
├─ users.json                 用户表（微信号 / 显示名 / 角色）
├─ config.json                管理员微信号（发布脚本校验）
├─ tools/
│  ├─ publish_task.py         命令行发布任务（标准库）
│  └─ make_icons.py           生成品牌图标与启动屏（Pillow）
├─ .github/workflows/
│  └─ android.yml             push 后自动构建 APK 并上传 Artifact
├─ capacitor.config.json
└─ package.json
```

## 说明

- 用 Capacitor 而不是原生 Kotlin：界面改动只改 Web 文件，不用碰 Activity；同时还能在浏览器里先预览
- 用 GitHub 仓库当后端：不要服务器、不要数据库，免费额度对个人工具足够；写入走 contents API，天然带提交历史
- 多人同时抢同一单时，`tasks.json` 的 sha 会冲突，App 会提示「刷新后再试」，不会静默覆盖别人接的单
- `debug` 包可直接安装；要做正式发行版需另配签名密钥，本仓库不含任何密钥
