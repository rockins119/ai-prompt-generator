# AI 提示词生成器

一个纯静态的提示词生成器：左边勾选参数，右边实时生成结构化 JSON 提示词，一键复制丢给豆包 / Nanobanana / GPT-image 等出图模型。

**不调用任何 AI、不需要 API Key、没有后端**，就是一堆静态文件，可以直接扔到 Cloudflare Pages。

- 4 个分组：家装设计 / 工装设计 / 景观设计 / 建筑设计
- 37 个预设（一键切换整套参数组合）
- 覆盖 图生图任务、场景类型、光影氛围、摄影参数、核心约束、出图参数 等分区
- 每个分区渲染成一张「层」卡片（`LAYER 01` + 标题 + 说明），顶部有层导航，点哪层跳到哪层
- **右侧同时给出两种结果**：可直接粘给 AI 的「提示词文本」和结构化的「JSON」
- 字段类型：单选胶囊、多选框、开关、文本框（**全部点选，不用下拉框**）
- **字段说明收在名字后面的 ⓘ 里**，鼠标移上去（手机上点一下）才显示
- 每个字段都能「+ 自定义」临时加值，不用改代码
- 往下滚时分组和预设自动收起（滚回顶部自动展开），给内容腾地方
- 分组 / 预设选择会记在浏览器里，也同步到网址参数（可收藏特定组合）
- 窄屏下结果面板自动收成底部一条，点「展开」查看

---

## 一、目录结构

```
.
├── index.html                 页面骨架
├── favicon.svg                图标
├── assets/
│   ├── style.css              样式（配色在文件顶部 :root 里改）
│   └── app.js                 全部逻辑（标题、跳转网址在顶部 CONFIG 里改）
├── data/                      ★ 提示词配置，日常只改这里
│   ├── project.json           项目总入口：有哪几个分组
│   └── groups/
│       ├── interior.json      家装设计（7 分区 / 47 字段 / 28 预设）
│       ├── architecture.json  工装设计（6 分区 / 32 字段 / 6 预设）
│       ├── landscape.json     景观设计（6 分区 / 29 字段 / 1 预设）
│       └── group_6y2csa.json  建筑设计（目前是空的，留给你填）
└── _test/                     开发者自测脚本，部署时可以不管
```

只有 `index.html`、`assets/`、`data/`、`favicon.svg` 是网站本体。

---

## 二、本地预览

不能直接双击 `index.html`（浏览器安全策略会拦住本地 JSON 读取），要起个本地服务：

```bash
cd 项目目录
python -m http.server 8000
```

然后浏览器打开 <http://127.0.0.1:8000/>。

> Node 用户也可以：`npx serve .`

---

## 三、部署到 Cloudflare Pages

### 方式 A：连 GitHub 自动部署（推荐，改完 push 就自动更新）

1. 把本目录推到你自己的 GitHub 仓库（见下面「五、上传到 GitHub」）。
2. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 授权并选中这个仓库，然后按下面填：

   | 配置项 | 填什么 |
   | --- | --- |
   | Framework preset | `None` |
   | Build command | **留空**（没有构建步骤） |
   | Build output directory | `/` |

4. 点 **Save and Deploy**，等十几秒就得到一个 `xxx.pages.dev` 网址。

之后每次你改完 `data/*.json` 并 push，Cloudflare 会自动重新发布。

### 方式 B：命令行直接上传（不想要 GitHub 时）

```bash
npx wrangler pages deploy . --project-name=prompt-generator
```

首次运行会引导你登录 Cloudflare 账号。

### 方式 C：网页拖拽上传

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**，
把 `index.html`、`favicon.svg`、`assets/`、`data/` 拖进去即可（`_test/` 不用传）。

---

## 四、日常怎么改

### 1. 换标题、换「复制并打开」跳转的网站

打开 `assets/app.js`，最上面：

```js
const CONFIG = {
  projectUrl: 'data/project.json',
  aiUrl: 'https://www.doubao.com/chat/',   // ← 改成你常用的 AI 网址
  aiButtonLabel: '复制并打开豆包',           // ← 按钮上的文字
  autoOpenAi: true,                        // 复制后是否自动打开
  rememberLastChoice: true                 // 是否记住上次的选择
};
```

网页大标题来自 `data/project.json` 里的 `name`（现在是「香蕉」），改成你想要的名字即可。

### 2. 换配色

`assets/style.css` 顶部 `:root` 里改。例如 `--primary-color: #f59e0b` 是主色调（默认琥珀色），
`--bg-color` / `--card-bg` 是背景与卡片底色，换成蓝色系就是另一套观感。

### 3. 加 / 改分组

编辑 `data/project.json`：

```json
{
  "name": "我的提示词库",
  "groups": {
    "interior": { "name": "家装设计", "icon": "🏠", "file": "groups/interior.json" },
    "myscene":  { "name": "我的场景", "icon": "🎬", "file": "groups/myscene.json" }
  }
}
```

再照着 `data/groups/interior.json` 的样子，新建 `data/groups/myscene.json` 就行。

### 4. 加 / 改字段

每个分组 JSON 是这么个结构：

```json
{
  "name": "家装设计",
  "icon": "🏠",
  "sections": {
    "场景类型": {
      "title": "场景类型（显示在界面上的分区标题）",
      "icon": "🛋️",
      "fields": {
        "空间类型": {
          "label": "🏡空间类型",
          "type": "button-select",
          "description": "鼠标悬停看到的小字说明，可省略",
          "options": [
            { "value": "写进提示词里的内容", "label": "界面上显示的短名字" },
            "只有一个值时，也可以直接写字符串"
          ],
          "default": "平层家装室内空间"
        }
      }
    }
  },
  "presets": [
    { "key": "unique-key", "name": "界面上显示的预设名", "sections": { /* 同上面的结构 */ } }
  ]
}
```

`type` 支持 5 种：

| type | 界面形态 | 值的形式 |
| --- | --- | --- |
| `button-select` | 一排单选胶囊（推荐，最直观） | 字符串 |
| `select` | 下拉框（选项多时用） | 字符串 |
| `multi-select` | 可多选的胶囊 | 数组 |
| `switch` | 开关 | true / false |
| `text` | 文本框 | 字符串 |

几个实用技巧：

- **`value` 写提示词正文，`label` 写短名字。** 界面上只显示 `label`，生成的 JSON 里是 `value`。这样界面清爽，提示词又能写得很长。
- **选项一律铺开成胶囊**，点了就选中，不用展开下拉框。字段名超过 22 字会自动独占一行（`assets/app.js` 顶部的 `LONG_LABEL` 可调）。
- **层说明是自动从标题括号里取的**：标题写成 `场景类型（这里是这句说明）`，界面就会把「场景类型」当层名、括号内容当层说明。不写括号就只有标题。
- 右侧「提示词文本」是把各层选中的值按顺序拼成的自然语言，层与层之间用【层名】分段，方便粘给即梦 / 可灵这类不吃 JSON 的工具。
- **想直接塞一段结构化片段？** 让 `value` 是一个完整 JSON 对象文本（`{` 开头 `}` 结尾），生成时会自动展开成嵌套对象。
- **`switch` 的字段名可以写成 `"键:值"`**，开启时就会往 JSON 里写 `"键": "值"` 而不是 `true`。
- **`options` 也能分组**：写成 `{ "分组名": [ ...选项 ] }`，下拉框里会显示成 optgroup。
- **`default` 决定初始选中值**；不在 `options` 里的话会退回第一个选项。
- **实际生效的是 `presets` 里那套 `sections`**（每个预设自带一整套字段配置），`sections` 只在该分组没有预设时兜底。所以改预设内容时记得改 `presets[].sections`，别只改了外层。

> 提示：JSON 文件请用 UTF-8 编码保存，用 VS Code 之类的编辑器改，改完注意别多出逗号或漏掉引号。

---

## 五、上传到 GitHub

在本目录执行（把地址换成你自己的仓库）：

```bash
git init
git add .
git commit -m "AI 提示词生成器"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

推之前可以先跑 `git status` 确认没有把 `_test/node_modules` 之类的传上去（已有 `.gitignore` 挡着）。

---

## 六、自测（可选）

`_test/` 里有三个用真实浏览器跑的脚本，改完代码想确认没搞坏东西时可以跑：

```bash
cd _test
npm install
python -m http.server 8123   # 另开一个终端，在项目根目录执行
node test.js                 # 页面渲染与交互
node layout.js               # 桌面 / 手机布局
```

---

## 七、说明

- 本项目的字段、选项、预设内容整理自 `http://154.201.65.81/`（LIN 香萱 Nanobanana/GPT-image2 提示词生成器）的数据接口，**仅供自己使用**，请勿公开分发或商用。
- 原站里的微信号、推广链接、课程广告等引流内容已全部移除。
- 数据文件较大（`interior.json` 约 2 MB）。页面是按需加载的：打开时只拉 `project.json`，点进哪个分组才加载哪个文件，所以首屏很快。
