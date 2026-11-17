# TRP 任务台 · Android

天枢架构内部接单客户端：**发布方把任务写进 GitHub 仓库，手机端刷新就能接单**。
像滴滴抢单一样，任务从「待接 → 进行中 → 待验收 → 已完成」流转，谁接的、什么时候接的都写在任务文件里。

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

## 手机端怎么连到任务池

首次打开默认是**演示数据**（4 条示例任务，只存在手机里）。要接真实任务：

1. 打开 App → 底部「设置」
2. 数据源选 **GitHub 仓库**
3. owner 填 `Toriesta`，repo 填 `trplink`，分支 `main`，路径 `tasks.json`
4. 填「我的名字」（例如 `陈成方`），接单时会记下这个名字
5. 点「保存并同步」

公开仓库的**读取不需要 token**；抢单、提交会写回 `tasks.json`，需要在设置里填一个
fine-grained PAT，只给这个仓库 `Contents: read and write`。token 只存手机本地。

## 发布任务

在电脑上发布一条：

```bash
python tools/publish_task.py --title "第 16 集粗剪" --reward 400 \
  --deadline 2026-11-25 --tags "剪辑,ODSUS" --checklist "字幕|音效"

# 直接推到 GitHub（需 GH_TOKEN 环境变量）
python tools/publish_task.py --title "..." --reward 400 --repo Toriesta/trplink --push
```

也可以直接在 GitHub 网页编辑 `tasks.json`，手机端下拉或点右上角刷新即可看到。

字段说明：

| 字段 | 含义 |
| --- | --- |
| `id` | 形如 `T-2611-05`，脚本自动生成 |
| `reward` | 金额（人民币） |
| `deadline` | `YYYY-MM-DD`，≤2 天会标珊瑚色 |
| `priority` | 1 高 / 2 中 / 3 低，决定卡片左侧竖条颜色 |
| `status` | `open` 待接 / `claimed` 进行中 / `submitted` 待验收 / `done` 已完成 |
| `claimedBy` | 接单人名字（App 自动写） |
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
