# Easy-ADs

丢素材，出广告 —— 素材 + 一句剧情 → 30 秒内广告成片（Seedance 2.5）。

- `/` 对外展示站（本包）
- `/app` 素材直出工作台（`components/AdMode.tsx` + `lib/adBrain.ts` + `app/api/adscript`）：丢素材 → 补个人（真人活体 / 演员库 / 照片）→ 一句主题 + 结构 → 节拍表 → 一次 Seedance 2.5 生成
- `/app/studio` 导演模式：easy-director v66 引擎原样搬入（`components/ed/`、`lib/`、`app/api/`、`netlify/functions/`），拆场 / 选角 / 关键帧 / 多场拼接
- 图片走 `/api/rehost`（ImgBB）；参考视频、音频走 `netlify/functions/media-put`（Netlify Blobs，≤ 5MB）由 `media-get` 公网提供

## 本地运行

```bash
npm install
npm run dev
```

## 往首页加成片

1. 把 mp4 放进 `public/showcase/`（720P/1080P，H.264，单条建议 ≤ 20MB）
2. 运行 `npm run showcase`：自动抽封面（需要本机有 ffmpeg）、读尺寸和时长，写入 `data/showcase.json`
3. 打开 `data/showcase.json`，填每条的 `title`、`template`、`industry`，把想放开屏的那条设 `"hero": true`
4. `git add -A && git commit -m "showcase" && git push`

`template` 用下面六个名字之一，模板卡片才会自动挂上样片：
`痛点–解决` `剧情植入` `老板口播种草` `开箱 / 展示` `使用前后对比` `证言 / 评价`

## 部署（Netlify）

- 新建站点连接本仓库，构建命令 `npm run build`，Next.js 插件自动启用（见 `netlify.toml`）
- 「申请内测」表单走 Netlify Forms：`public/__forms.html` 里的静态表单负责被 Netlify 识别，页面表单用 fetch 提交到它；部署后在 Netlify → Forms 里看提交
- 环境变量：见 `.env.example`，与 easy-director 站点同名同值，在 Netlify → Site configuration → Environment variables 里逐个加上（或用 Netlify CLI `netlify env:import`）；改完手动 Trigger deploy

## 版本

`lib/version.ts` 里的 `APP_VERSION`，每次发包 +0.1，页脚同步显示。
