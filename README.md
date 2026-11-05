# Friends Live · 四人在线 · 双路投屏

## 已保存的个人设置

网页自动记住当前浏览器上次选择的视频码率、目标帧率、发送音量、接收音量和自定义背景；刷新或重新打开网站后恢复。清除网站数据、换浏览器或使用新的无痕会话不会继承设置。

- 帧率支持 30 / 40 / 60 FPS 和「无上限」。首次默认 40 FPS。「无上限」同时移除屏幕捕获约束及 WebRTC 发送编码器中的网站帧率上限，仍由浏览器、设备和网络决定实际帧率，不保证无限帧率。
- 发送音量（0–100%）同时控制发给朋友的系统音轨与麦克风；使用独立 GainNode，不把声音回放给自己，也不重复混音。麦克风开关与音量独立。
- 接收音量（0–100%）只控制自己听到的所有朋友的声音，不改变他们的发送音量。
- 「自定义背景」支持 10 MB 以内 JPG / PNG / WebP 图片，在浏览器内缩放压缩并保存，只作用于自己，不上传图片到服务器或 GitHub。「恢复黑色背景」可清除已保存背景。

新增功能已通过浏览器测试：刷新后设置与背景恢复、恢复黑色背景、无上限时捕获请求和发送编码参数不含帧率上限、发送音量 0% 的实际音频采样静音及恢复、接收音量应用到全部音频元素。四人在线和两路投屏回归测试一并通过。

公开源码：[Whitebg123/friends-live](https://github.com/Whitebg123/friends-live)

[在 Render 一键部署](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FWhitebg123%2Ffriends-live)

点击上方链接，登录自己的 Render 账号，核对免费单实例服务后部署。项目自带 render.yaml，不需要设置密码或填写密钥。GitHub 仓库用于保存代码；实际网站网址会在 Render 部署完成后生成。

黑底、灰白文字，无装饰首页。输入昵称即登录到同一个共享空间，没有密码、邀请码或房主分享授权。四人都可以申请分享，最多两人同时独立投屏，互不影响，最多同时在线 4 人，同时最多 2 人投屏。聊天同步显示为画面弹幕，并支持独立的浏览器弹幕画中画小窗。

## 本地运行

安装 Node.js 22.12+ 或 24，随后在本目录打开 PowerShell：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

打开 http://localhost:3000 ，输入昵称进入。朋友访问同一个部署网址即可。屏幕捕获仍必须由本人点击「开始投屏」并在浏览器原生选择器授权，不能自动绕过授权。停止本地服务按 Ctrl+C。

没有 Node/npm 时，执行 `winget install --id OpenJS.NodeJS.LTS --exact`，安装后重新打开 PowerShell。开发时分别运行 `npm.cmd run dev` 和 `npm.cmd run dev:ui`，访问 Vite 地址。

## 弹幕小窗（无需安装程序）

在新版桌面 Chrome / Edge 中进入网站，点击「弹幕小窗」。网页使用 Document Picture-in-Picture API 请求 320×180 的置顶窗口，显示最近六条聊天消息并自动滚动。可以拖到屏幕边角，在无边框游戏时查看；具体游戏是否遮挡它仍需实测。最小尺寸和标题栏由浏览器决定。

这是真实的浏览器画中画，不是页面内模拟浮层。必须通过 HTTPS 或 localhost 使用，必须由本人点击打开。浏览器不支持时明确提示，不会用普通弹窗冒充置顶小窗。网页保持打开，关闭主网页、刷新或退出会结束画中画。

**浏览器画中画不提供可靠的桌面半透明、鼠标穿透控制。当前版本使用黑底白字，不能承诺透过窗口看到游戏。** 它可以置顶，但和你要求的系统级半透明浮窗存在这个区别；不需要安装本地小程序。没有实现游戏进程注入或反作弊绕过。

文档：[Document PiP API](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API)、[窗口尺寸与限制](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)。

## 上传 GitHub

在 https://github.com/new 创建空仓库，名字可用 `friends-live`，不要勾选 README、License、.gitignore。在本目录打开 PowerShell：

```powershell
$repoUrl = Read-Host '粘贴你刚创建的 GitHub 仓库 HTTPS 地址'
git init
git branch -M main
git add .
git commit -m "Build two-way screen sharing with chat and PiP"
git remote add origin $repoUrl
git push -u origin main
git rev-parse HEAD
```

按 Git 窗口完成账号登录，不需要绑定 Codex。Git 未安装时：`winget install --id Git.Git --exact`，安装后重开终端。缺少作者身份时，按 Git 提示设置当前仓库的 `user.name` 和 `user.email`。已有仓库请合并修改，不强推。

如果你已上传上一版，用本版本完整文件覆盖源码，并删除 Render 中旧的 SITE_PASSWORD 环境变量（新代码不再读取它）。在原仓库执行 `git add .`、`git commit -m "Add simultaneous sharing, chat and PiP"`、`git push` 即可更新。

## Render

1. 在 https://dashboard.render.com 选择 New → Blueprint，授权自己的 GitHub 仓库，使用本项目根目录 `render.yaml`。
2. 创建单个 Free Node Web Service，不设网站密码。`PUBLIC_ORIGIN` 可以先留空；部署后可填实际 `https://你的服务名.onrender.com`（末尾没有 `/`）。三个 TURN 变量不用时留空或删除。
3. 等待部署，访问 `https://你的服务名.onrender.com/health`，应返回 `{"ok":true}`。
4. 双方直接打开相同的网址，各自输入昵称进入。

手动建 Web Service 时：

| 设置 | 值 |
| --- | --- |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check | `/health` |
| NODE_ENV | `production` |
| Instances | 1 |

Node 监听 `0.0.0.0` 和 Render 自动提供的 PORT，HTTP/WSS 共用一个服务。没有数据库，不要扩容多实例。免费服务冷启动时等待即可，没有防休眠请求。参考：[Render Node 部署](https://render.com/docs/deploy-node-express-app)、[WebSocket](https://render.com/docs/websocket)。

## 配置

| 环境变量 | 作用 |
| --- | --- |
| PORT | 本地默认 3000，Render 自动注入 |
| NODE_ENV | 部署时 production |
| PUBLIC_ORIGIN | 可选，精确匹配网页 Origin，用于校验 WebSocket 来源 |
| TURN_URLS | 可选，外部 TURN 地址，多个用英文逗号分隔 |
| TURN_USERNAME | 外部 TURN 用户名 |
| TURN_CREDENTIAL | 外部 TURN 凭据 |

不再存在 SITE_PASSWORD。任何知道网址的人都能用昵称进入空闲席位；昵称仅为显示名称，不验证真实身份。服务端仍生成高熵会话令牌用于恢复身份、限制对自己的投屏控制；另一个人无法通过冒用昵称接管现有会话。第五人不能加入。

## 媒体与聊天

- 每对在线成员各自建立双向 WebRTC 连接，固定协商双向视频、系统音频、麦克风三个 transceiver；每位分享者分别给其他在线成员上传视频；4 人在线时最多上传 3 份，每条连接默认上限 15 Mbps，总上行可能约 45 Mbps。每对成员按随机会话 ID 的固定顺序选择 Offer 发起者只负责避免协商冲突，不限制另一人的投屏权限。
- 默认捕获目标 1920×1080 / 40 FPS，`contentHint="motion"`。视频上限默认每方向 15 Mbps，可改 8/25/40 Mbps；实际画质与帧率取决于设备和网络，不保证实际稳定达到目标帧率。
- 每个画面下显示对应发送/接收的真实分辨率、FPS、区间视频码率。底部显示 ICE RTT 和 P2P/TURN；没有统计时显示 `—`。
- 系统音轨和麦克风独立传输、独立播放，自己的预览静音。双方可以同时说话，没有投屏时也能语音。系统音频取决于浏览器和分享源；未捕获会提示，音频读取失败时可退回仅视频。
- STUN 无法保证所有网络直连；失败可点击重连，仍失败时配置外部 TURN。不要在此 Render 服务中部署 TURN。TURN 需支持双方使用的网络，凭据对认证后的浏览器可见，应控制供应商额度与有效期。
- 刷新恢复昵称和会话；刷新后要重新授权分享自己的屏幕。另一个人的分享不因你停止自己的投屏而结束。断线席位保留 30 秒；明确退出立即释放。先进入的人退出不踢走另一人。
- 聊天每条最多 300 字，每人每 10 秒最多 8 条。使用服务端身份和时间戳，不信任前端冒用的昵称。React 按文本渲染内容，不执行 HTML。聊天历史内存保留最近 100 条，全部退出或服务重启后清空；没有数据库和录屏功能。
- 网页弹幕可以单独开关；画中画内为紧凑的消息列表。浏览器切到后台时，实际画中画刷新速度仍可能受浏览器资源策略影响。

## 验证

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:browser
```

浏览器测试使用本机 Microsoft Edge；其他平台先执行 `npx.cmd playwright install chromium`。测试包括无密码昵称进入、第五人拒绝、两人同时投屏、双向音轨接收、聊天/弹幕、独立停止、刷新、媒体重连和移动布局。测试媒体是 canvas 和振荡器产生的合成视频/音频，经过真实 RTCPeerConnection 传输，不代表已验证真实桌面授权、真实系统声音和跨网络质量。

实际 PiP API 在可用的浏览器中测试开窗与聊天同步；无边框游戏遮挡、长期稳定性、真实跨网络 1080p60、不同浏览器最小尺寸及冷启动需要人工实测。测试截图保存在 `test-results/`（Git 忽略）。

## 文件

```text
server/index.js       单共享空间、会话、两人限制、聊天、信令
src/live.js           多连接管理、捕获、音频和重连
src/peer.js           每位远端成员独立的 WebRTC 协商与统计
src/main.jsx          昵称登录、双画面、聊天、弹幕、文档画中画
src/style.css         纯黑灰界面和响应布局
test/server.test.js   服务端集成测试
test/browser.test.js  四浏览器实际 WebRTC 流程
render.yaml          单实例部署
.env.example         可选配置（没有密码）
package*.json        依赖与锁定文件
```

源码支持 GitHub 托管及 Render 单服务部署。发布代码不会自动创建 Render 服务；按上方 Blueprint 步骤连接仓库即可。可选 PUBLIC_ORIGIN 和 TURN 变量部署后在 Render Environment 中按需添加，初次部署无需填写任何密码或密钥。

本次本机验证：构建成功；11 项服务端测试通过，四浏览器综合测试通过（合计 12 项）。Edge 实际文档画中画开窗并同步接收到新聊天消息。真实游戏覆盖、真实屏幕捕获与跨网络质量仍待人工实测。

本版重要变化：4 人同时在线，最多两路同时投屏；页面显示全部成员，停止一路不会停止另一路。帧率选择默认 40 FPS，可选 30/40/60 FPS；15 Mbps 是每条连接的视频码率上限，与帧率独立。测试媒体为 640×360 / 20 FPS 的合成视频，另行断言浏览器捕获请求目标为 40 FPS；不冒充四台真实设备的 1080p40 实测。
