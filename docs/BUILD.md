# FicForge 三端打包指南

## 前置条件

### 通用

| 工具 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | >= 20 | 前端构建 |
| npm | >= 10 | 依赖管理 |
| TypeScript | ~5.8 | 类型检查（devDep 已包含） |

安装依赖：

```bash
cd src-ui && npm install
cd ../src-engine && npm install
```

### Tauri 桌面端

| 工具 | 版本要求 | 备注 |
|------|----------|------|
| Rust | >= 1.77 | `rustup update stable` |
| Tauri CLI | v2 | devDep 已包含（`@tauri-apps/cli`） |
| 系统依赖 | — | 见下文各平台说明 |

**Linux (Ubuntu/Debian)**：
```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS**：Xcode Command Line Tools（`xcode-select --install`）。

**Windows**：Visual Studio Build Tools + WebView2（Win10+ 已预装）。

### Capacitor Android

| 工具 | 版本要求 | 备注 |
|------|----------|------|
| Android Studio | >= Hedgehog | 含 SDK、Gradle |
| JDK | 17 | Android Studio 自带 |
| Android SDK | compileSdk 35+ | 在 SDK Manager 安装 |

### PWA

无额外依赖。`npm run build` 产出的 `dist/` 即可直接部署为静态站点。

---

## 构建步骤

### 1. 前端构建（三端共用）

```bash
cd src-ui
npm run build    # tsc + vite build → dist/
```

构建产物在 `src-ui/dist/`，约 2.4MB。Tokenizer（gpt-tokenizer, ~970KB）通过动态 import 懒加载，不计入首屏。

### 2. PWA 部署

`dist/` 目录本身即 PWA，包含 `manifest.json` 和图标。部署到任意静态服务器（Nginx、Cloudflare Pages、Vercel 等）。

注意事项：
- 需要 HTTPS（Service Worker 要求）
- 如需离线支持，需额外配置 Service Worker（当前未内置）
- `manifest.json` 中 `start_url: "/"` 要求部署在域名根路径

### 3. Tauri 桌面端

```bash
cd src-ui
npx tauri build    # 自动调用 npm run build + Rust 编译
```

产物位置：
- Linux: `src-tauri/target/release/bundle/appimage/` 或 `deb/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/msi/` 或 `nsis/`

#### Python Sidecar（可选，本地 Embedding）

桌面端可选捆绑 Python sidecar 用于本地 embedding（bge-small-zh）：

```bash
cd src-python
pip install pyinstaller
python build_sidecar.py    # 产出 dist/fanfic-sidecar/
```

Tauri 构建时会自动从 `src-python/dist/fanfic-sidecar/` 复制到 bundle 的 `sidecar/` 目录。若该目录不存在，桌面端仍可正常运行，仅无法使用本地 embedding（可用远端 API 替代）。

#### 注意事项

- `tauri.conf.json` 中 `identifier` 为 `com.ficforge.app`，macOS 上建议改为不以 `.app` 结尾的标识符
- 首次 Rust 编译约 2-5 分钟，后续增量编译很快
- 版本号在 `tauri.conf.json`、`Cargo.toml`、`package.json` 三处，发版时需同步更新

### 4. Capacitor Android

```bash
cd src-ui
npm run build              # 先构建前端
npx cap sync android       # 同步 dist/ → android/
```

然后用 Android Studio 打开 `src-ui/android/` 目录，Build → Generate Signed APK/AAB。

或命令行构建（需本地有 Android SDK）：
```bash
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew.bat assembleRelease
```

产物位置：`android/app/build/outputs/apk/release/app-release-unsigned.apk`

#### APK 签名（必须，否则无法安装）

`assembleRelease` 产出的是 unsigned APK，Android 设备拒绝安装未签名的 APK。用 debug keystore 签名即可侧载：

```bash
# 复制一份（apksigner 会原地修改文件）
cp app-release-unsigned.apk app-signed.apk

# 用 debug keystore 签名（密码固定为 android）
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" \
  $ANDROID_HOME/build-tools/36.1.0/apksigner sign \
  --ks ~/.android/debug.keystore \
  --ks-pass pass:android \
  --key-pass pass:android \
  app-signed.apk

# 验证签名
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" \
  $ANDROID_HOME/build-tools/36.1.0/apksigner verify app-signed.apk
```

> **注意**：debug keystore 签名仅适用于个人侧载。上架 Google Play 需要创建正式 release keystore（`keytool -genkey ...`），并在 `android/app/build.gradle` 中配置 `signingConfigs`。

#### 注意事项

- `capacitor.config.json` 中 `appId` 为 `com.ficforge.app`
- `android/app/build.gradle` 中 `versionCode` 和 `versionName` 需手动更新
- Android 端无 Python sidecar，embedding 依赖远端 API
- 最低 SDK 版本由 `android/variables.gradle` 中 `minSdkVersion` 控制
- `JAVA_HOME` 必须指向 Android Studio 内置的 JBR，系统 PATH 里的 java 不可用
- Gradle wrapper（`gradlew.bat`）版本由 Android Studio 管理，Capacitor sync 后如有提示需升级则按提示操作

#### Capacitor 原生插件依赖（重要）

`src-engine/` 中使用的 Capacitor 插件（如 `@capacitor/filesystem`）必须同时在 **`src-ui/package.json`** 的 `dependencies` 中声明。原因：`npx cap sync` 根据 `src-ui/` 的依赖树决定注册哪些原生插件到 Android/iOS 项目。如果插件仅在 `src-engine/` 的 devDependencies 中，JS 代码通过 Vite alias 能 import 到，但原生端没有对应实现，运行时会报 `"XXX plugin is not implemented on android"` 错误。

当前需要在 `src-ui/package.json` 中声明的 Capacitor 插件：

| 插件 | 用途 |
|------|------|
| `@capacitor/filesystem` | CapacitorAdapter 文件 I/O |

添加新的 Capacitor 插件后，务必重新执行 `npx cap sync android` 并检查 `android/capacitor.settings.gradle` 中包含对应插件。

---

## 版本同步清单

发版前需更新以下文件中的版本号：

| 文件 | 字段 |
|------|------|
| `src-ui/package.json` | `version` |
| `src-engine/package.json` | `version` |
| `src-ui/src-tauri/tauri.conf.json` | `version` |
| `src-ui/src-tauri/Cargo.toml` | `version` |
| `src-ui/android/app/build.gradle` | `versionCode` + `versionName` |

---

## 复制产物到 release/

```bash
# 清理旧产物
rm -rf release/pwa/* release/desktop/* release/android/*

# PWA
cp -r src-ui/dist/* release/pwa/

# Desktop（注意：bundle 目录保留历史版本，只复制当前版本）
cp src-ui/src-tauri/target/release/bundle/nsis/FicForge_0.2.0_x64-setup.exe release/desktop/
cp src-ui/src-tauri/target/release/bundle/msi/FicForge_0.2.0_x64_en-US.msi release/desktop/

# Android（已签名的 APK）
cp app-signed.apk release/android/FicForge_0.2.0_android.apk
```

> **注意**：Tauri 的 `target/release/bundle/nsis/` 和 `msi/` 目录会累积历史版本的安装包。使用通配符 `*.exe` 会把旧版本也复制进去。务必指定版本号精确复制。

---

## 构建产物体积参考（v0.2.0）

| 平台 | 产物 | 大小 |
|------|------|------|
| PWA / Capacitor web assets | `dist/` | ~2.4 MB |
| PWA 首屏加载（不含 tokenizer） | JS + CSS | ~1.3 MB (gzip ~390 KB) |
| Tauri Windows (NSIS, 含 sidecar) | `.exe` 安装包 | ~106 MB |
| Tauri Windows (MSI, 含 sidecar) | `.msi` 安装包 | ~137 MB |
| Tauri Windows (无 sidecar) | 安装包 | ~15 MB |
| Android APK (signed) | `.apk` | ~4 MB |

### 首屏加载明细

| Chunk | 大小 | gzip | 加载时机 |
|-------|------|------|----------|
| index (主 bundle) | 872 KB | 248 KB | 首屏 |
| vendor-motion | 126 KB | 41 KB | 首屏 modulepreload |
| vendor-markdown | 126 KB | 39 KB | 首屏 modulepreload |
| vendor-yaml | 105 KB | 32 KB | 首屏 modulepreload |
| vendor-tokenizer | 973 KB | 443 KB | **按需**（生成时动态加载） |
| CSS | 38 KB | 7 KB | 首屏 |

---

## 常见问题

**Q: `npm run build` 报 gray-matter eval 警告**
A: 已知问题，gray-matter 内部使用 eval 加载 YAML 引擎。不影响功能和安全（仅解析本地文件）。

**Q: Tauri build 报 identifier 以 .app 结尾**
A: 警告级别，macOS 上 `.app` 与应用包扩展名冲突。正式发版前建议改为 `com.ficforge.desktop`。

**Q: Capacitor sync 后 Android Studio 报 Gradle 版本不匹配**
A: 在 Android Studio 中按提示升级 Gradle wrapper 即可。

**Q: gpt-tokenizer 在移动端何时加载？**
A: 用户首次触发生成（续写/提取 facts/RAG 检索）时通过 `ensureTokenizer()` 动态加载。加载一次后缓存在内存中，后续调用为同步。
