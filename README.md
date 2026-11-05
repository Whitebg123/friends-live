# Friends Live · 多人投屏

## 聊天表情与云端共享表情库

点击聊天标题旁的「表情」可插入普通 emoji，也可从共享图片库点击发送表情包。成员上传后，所有在线成员的表情库会实时更新；聊天、画面弹幕和弹幕画中画均可显示图片。支持 PNG / JPG / GIF / WebP（保留 GIF 动图），单张最大 2 MB，共享库最多 200 张，重复上传相同文件不会重复保存。表情库没有删除按钮，管理员可在存储控制台删除图片；已删除图片的旧聊天链接会失效。

**永久云存储需要配置 Supabase Storage。本次没有创建 Supabase 项目，也没有配置实际存储账号；默认状态会明确提示未启用，并禁用上传。** 普通 emoji、文字聊天和投屏不受影响。测试使用模拟 Supabase API 验证端到端流程，尚未针对实际 Supabase 项目完成联网实测。

Render 免费服务的本地文件会在重启或部署时丢失，因此图片不保存在它的本地磁盘或内存里。参考：[Render 免费服务限制](https://render.com/docs/free)、[Supabase Storage 上传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)。

### 启用云端表情库（管理员一次性配置）

1. 在自己的 https://supabase.com/dashboard 创建或选择项目，进入 Storage 创建一个名为 `friends-live-emojis` 的 **Private bucket**。这个 bucket 专门用于本网站，不要共用已有私人文件 bucket。限制单文件 2 MB，允许 `image/png`、`image/jpeg`、`image/gif`、`image/webp`。
2. 在项目设置中取得 Project URL 和服务端的 legacy `service_role` API key。不要使用 anon / publishable key，也不要把 service_role key 贴进聊天、前端代码或 GitHub。
3. 在朋友 Render 账号的现有 friends-live 服务 → Environment 中新增：

   ```text
   SUPABASE_URL=https://你的项目标识.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=你自己的service_role密钥
   EMOJI_BUCKET=friends-live-emojis
   ```

   前两项必填，第三项与默认同名时可以不填。直接在 Render 中粘贴密钥，不要加 `VITE_` 前缀，不需要公开 bucket 或给匿名用户开放写权限。
4. 保存并重新部署，进入网站点击「表情」。上传一张小图片，让另一个成员确认共享库出现，并点击发送。

图片由服务器验证文件签名后上传，上传和列表需要当前登录会话，每分钟每人最多上传 10 次、全站最多 20 次。云端密钥只在服务器使用。图片通过网站同源 URL 代理显示，不发送云端密钥到浏览器；**知道图片链接的人能查看该图片**。表情库是全站共享，属于独立存储数据，不随房间聊天历史清空，重启后重新从云端读取。

Supabase 的配额、暂停机制和可用性以自己的套餐为准，本代码不包含付费开通或防休眠操作。可在 Supabase Storage 控制台管理、备份或删除上传内容。

## 已保存的个人设置

网页自动记住当前浏览器的画质档位、接收总音量和自定义背景。每个成员的两路接收音量按会话记忆；同一成员刷新恢复会话时继续沿用。清除网站数据、换浏览器或使用新的无痕会话不会继承设置。

- 顶部「画质」是唯一的画质入口，默认「最高」（1080p / 40 Mbps），也可切到「高帧率」（720p / 20 Mbps）或「省带宽」（540p / 8 Mbps）。码率均为每位观看者的发送上限；各档均不设置帧率上限。「高帧率」和「省带宽」会优先保持帧率，牺牲部分清晰度；实际帧率仍取决于浏览器、设备和网络。
- 自己的投屏卡片不显示麦克风状态或音量滑块。顶部「开启麦克风」仍可独立语音，停止投屏不会关麦。系统声音与麦克风作为不同音轨发送；自己的预览始终静音，不受旧发送音量设置影响。
- 每个朋友的画面下方可独立调节其麦克风和系统声音。接收总音量作用于所有接收音轨；这两级音量都只影响自己听到的声音，不改变别人听到的内容。两级音量相乘，例如总音量 50% × 某一路 60% = 30%。
- 「自定义背景」支持 10 MB 以内 JPG / PNG / WebP 图片，在浏览器内缩放压缩并保存，只作用于自己，不上传图片到服务器或 GitHub。「恢复黑色背景」可清除已保存背景。

浏览器测试验证了背景和音量设置的恢复、固定的发送画质参数，以及系统声音和麦克风可以分别静音。停止投屏仍可继续用麦克风。

公开源码：[Whitebg123/friends-live](https://github.com/Whitebg123/friends-live)

[在 Render 一键部署](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FWhitebg123%2Ffriends-live)

点击上方链接，登录自己的 Render 账号，核对免费单实例服务后部署。项目自带 render.yaml，不需要设置密码或填写密钥。GitHub 仓库用于保存代码；实际网站网址会在 Render 部署完成后生成。

黑底、灰白文字。输入昵称进入同一个共享空间，没有密码、邀请码或房主分享授权。网站不设房间人数或同时投屏人数的固定上限，仍保留防止请求过快的保护。聊天同步显示为画面弹幕，并支持独立的浏览器画中画小窗。

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

点击画面「全屏」后，左下角出现聊天框。输入消息并按 Enter 或点击「发送弹幕」即可发送；可以收起再展开，不需要退出全屏。聊天记录与主页面同步。

正在分享的每个画面右下角有「直播小窗」按钮。点击后，可把该成员的画面放到浏览器的置顶窗口中播放；声音沿用主页面的两路接收音量。开启小窗或切换画面时只播放此后收到的弹幕，不重播旧消息。小窗里点「查看聊天」，或者在主页面点「弹幕小窗」，可切换为纯聊天并查看历史。浏览器同一时间只开一个画中画窗口。停止分享或成员离开时，小窗会提示状态。

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

不再存在 SITE_PASSWORD。任何知道网址的人都能用昵称进入；昵称仅为显示名称，不验证真实身份。服务端仍生成高熵会话令牌用于恢复身份、限制对自己的投屏控制；另一个人无法通过冒用昵称接管现有会话。

## 媒体与聊天

自己的投屏预览和直播小窗只有视频轨道，并始终静音。屏幕捕获请求会排除当前网页作为共享源；如果浏览器支持，会请求从捕获的系统声音中排除本站声音。[屏幕捕获标准：restrictOwnAudio](https://www.w3.org/TR/screen-capture/#dom-mediatrackconstraintset-restrictownaudio)

如果实际捕获了系统音轨，但浏览器未报告正在排除本站声音，网站会先静音当前网页的接收声音，再发送系统音轨，避免把朋友的声音循环录进去。停止投屏或系统音轨结束后自动恢复，也可以点击「只分享画面并恢复收听」，保留视频和麦克风，仅停掉系统音轨。此保护不控制其他软件或其他浏览器标签页的声音。

- 每对在线成员各自建立双向 WebRTC 连接。成员加入或离开时只新建或关闭受影响的连接，其他画面不会集体重连。每位分享者给每位观看者分别上传一路视频；人数和投屏路数越多，设备负载及上、下行带宽占用越高。取消网站固定上限不代表服务可以承载无限流量。
- 默认捕获目标 1920×1080，`contentHint="motion"`。切换画质时，发送参数会按档位调整分辨率、码率和清晰度／帧率取舍。网站不设捕获或发送帧率上限，浏览器仍会自动调节。
- 每个画面下显示实际分辨率、FPS 和区间视频码率。只在正在投屏的朋友名字旁显示「经服务器约 X ms」：观看者发探测，经网站服务器到投屏者，再沿原路返回，用往返时间的一半估算投屏者经服务器到观看者的单程延迟。此值不包含视频编码、解码或显示，也不等于点对点视频流的延迟。未测得时显示 `—`。
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

浏览器测试使用本机 Microsoft Edge；其他平台先执行 `npx.cmd playwright install chromium`。测试覆盖第五人加入、第三路同时投屏、已有连接不因加入而重建、最高画质配置、经服务器延迟探测、直播小窗不重播旧弹幕。测试媒体是 canvas 和振荡器产生的合成视频/音频，经过真实 RTCPeerConnection 传输；真实桌面授权、系统声音和跨网络质量仍需实测。

实际 PiP API 在可用的浏览器中测试开窗与聊天同步；无边框游戏遮挡、长期稳定性、真实跨网络 1080p60、不同浏览器最小尺寸及冷启动需要人工实测。测试截图保存在 `test-results/`（Git 忽略）。

## 文件

```text
server/index.js       共享空间、会话、聊天、信令及延迟探测
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

本次本机验证：构建成功，16 项测试通过。服务端测试了 35 个 WebSocket、8 人加入与 6 人同时投屏状态；浏览器验证了第五人加入、三路合成画面同时播放、全屏发送弹幕、小窗不重播旧弹幕，以及实时画质切换和设置恢复。部署后所有人应刷新页面，以使用新的信令协议。
