# 自测脚本（可选，部署时用不到）

改完 `assets/app.js`、`assets/style.css` 或 `data/*.json` 后，想确认没把页面搞坏，可以跑这几个脚本。

它们用的是你电脑上已装的 Chrome（路径写在脚本顶部的 `CHROME` 常量里，换电脑记得改）。

## 准备

```bash
# 1. 装依赖
cd _test
npm install

# 2. 在项目根目录起一个本地服务（新开一个终端窗口）
cd ..
python -m http.server 8123
```

## 跑测试

```bash
cd _test

node test.js      # 页面渲染与交互：分组/预设切换、选值、JSON 输出、自定义值、重置
node layout.js    # 桌面 1600×1000 与手机 390×844 的布局、溢出、折叠面板
node compare.js   # 把生成的 JSON 和原站逐字节对比（需要原站还能访问）
node shot.js      # 生成界面截图 shot-desktop.png / shot-mobile.png
```

每个脚本最后会打印 `全部通过 ✅` 或失败项。

## 说明

- `compare.js` 会联网访问原站，原站失效后这个脚本就没用了，删掉即可。
- 三个脚本都会启动无头 Chrome，运行期间不要手动关闭弹出的窗口。
