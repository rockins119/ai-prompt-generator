/* 真实 Chrome 下的布局与视觉量化检查 */
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8123/index.html';
let bad = 0;

function check(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { bad++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  /* ---------- 桌面 ---------- */
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#form-container .card', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  console.log('\n=== 桌面 1600x1000 ===');
  check('无控制台错误', errors.length === 0, errors);

  const layout = await page.evaluate(() => {
    const rect = s => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const cs = (s, p) => {
      const e = document.querySelector(s);
      return e ? getComputedStyle(e).getPropertyValue(p) : null;
    };
    return {
      bodyScrollW: document.documentElement.scrollWidth,
      bodyClientW: document.documentElement.clientWidth,
      mainH: rect('main'),
      left: rect('#left-panel'),
      right: rect('#right-panel'),
      previewH: rect('#preview-content'),
      card: rect('#form-container .card'),
      bodyBg: cs('body', 'background-color'),
      cardBg: cs('.card', 'background-color'),
      rightBg: cs('#right-panel', 'background-color'),
      cardCount: document.querySelectorAll('#form-container .card').length,
      pillCount: document.querySelectorAll('#form-container .pill-text').length,
      previewScrollH: (() => { const e = document.querySelector('#preview-content'); return e ? e.scrollHeight : 0; })(),
      leftScrollH: (() => { const e = document.querySelector('#left-panel'); return e ? e.scrollHeight : 0; })(),
      toastHidden: getComputedStyle(document.getElementById('toast')).opacity
    };
  });

  console.log('    ' + JSON.stringify(layout, null, 1).replace(/\n/g, '\n    '));
  check('页面无横向溢出', layout.bodyScrollW <= layout.bodyClientW + 1,
    { scrollW: layout.bodyScrollW, clientW: layout.bodyClientW });
  check('右栏宽度约 400px', layout.right.w >= 380 && layout.right.w <= 420, layout.right.w);
  check('左栏与右栏不重叠', layout.left.x + layout.left.w <= layout.right.x + 1,
    { leftRight: layout.left.x + layout.left.w, rightX: layout.right.x });
  check('右栏内容区可滚动', layout.previewScrollH > layout.previewH.h,
    { scrollH: layout.previewScrollH, clientH: layout.previewH.h });
  check('左栏内容超出可滚动', layout.leftScrollH > layout.left.h);
  check('暗色主题生效', layout.bodyBg === 'rgb(9, 9, 11)', layout.bodyBg);
  check('卡片与背景不同色', layout.cardBg !== layout.bodyBg, layout.cardBg);
  check('有字段卡片', layout.cardCount > 0, layout.cardCount);
  check('toast 默认隐藏', layout.toastHidden === '0', layout.toastHidden);
  check('右栏填满主区高度（留出上下内边距）',
    Math.abs(layout.right.h - (layout.mainH.h - 32)) < 4,
    { rightH: layout.right.h, mainH: layout.mainH.h });

  console.log('\n=== 交互后的状态 ===');
  await page.click('#presetNavBar .preset-pill:nth-child(3)');
  await new Promise(r => setTimeout(r, 600));
  const afterPreset = await page.evaluate(() => ({
    cards: document.querySelectorAll('#form-container .card').length,
    url: location.search,
    active: document.querySelectorAll('#presetNavBar .preset-pill.active').length,
    json: document.getElementById('json-preview').textContent.length
  }));
  check('切换预设后卡片重绘', afterPreset.cards > 0, afterPreset);
  check('仅一个预设高亮', afterPreset.active === 1, afterPreset.active);
  check('预览有内容', afterPreset.json > 100, afterPreset.json);

  await page.click('#groupNavBar .group-tab:nth-child(3)');
  await new Promise(r => setTimeout(r, 1200));
  const afterGroup = await page.evaluate(() => ({
    activeGroup: document.querySelector('#groupNavBar .group-tab.active').textContent.trim(),
    cards: document.querySelectorAll('#form-container .card').length,
    url: location.search
  }));
  check('切到景观设计', /景观/.test(afterGroup.activeGroup), afterGroup);
  check('景观设计有卡片', afterGroup.cards > 0, afterGroup.cards);

  console.log('\n=== 复制按钮 ===');
  const copyResult = await page.evaluate(async () => {
    const btn = document.querySelector('[data-action=copy]');
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      toast: document.getElementById('toast').textContent,
      toastVisible: document.getElementById('toast').classList.contains('show'),
      btnText: btn.textContent
    };
  });
  check('点击复制给出提示', copyResult.toastVisible && /已复制|失败/.test(copyResult.toast), copyResult);

  console.log('\n=== 移动端 390x844 ===');
  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message));
  await page2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page2.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page2.waitForSelector('#form-container .card', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  const mobile = await page2.evaluate(() => {
    const rect = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      right: rect('#right-panel'),
      left: rect('#left-panel'),
      cardW: rect('#form-container .card').w,
      headerTitle: document.querySelector('.header-title').textContent,
      titleFontSize: getComputedStyle(document.querySelector('.header-title')).fontSize,
      collapsed: document.getElementById('right-panel').classList.contains('collapsed'),
      toggleText: document.getElementById('panelToggle').textContent,
      toggleVisible: getComputedStyle(document.getElementById('panelToggle')).display !== 'none',
      previewHidden: getComputedStyle(document.getElementById('preview-content')).display === 'none',
      panelCopyVisible: getComputedStyle(document.querySelector('.panel-copy')).display !== 'none'
    };
  });
  console.log('    ' + JSON.stringify(mobile));
  check('移动端无横向溢出', mobile.scrollW <= mobile.clientW + 1, mobile);
  check('移动端卡片占满宽度', mobile.cardW > 300, mobile.cardW);
  check('移动端无 JS 错误', errors2.length === 0, errors2);
  check('移动端右栏全宽', mobile.right.w >= 380, mobile.right.w);
  check('移动端面板默认收起', mobile.collapsed, mobile);
  check('收起时预览隐藏', mobile.previewHidden);
  check('收起时高度很小', mobile.right.h < 80, mobile.right.h);
  check('收起时有「展开」按钮', mobile.toggleVisible && /展开/.test(mobile.toggleText), mobile.toggleText);
  check('收起时有快捷复制按钮', mobile.panelCopyVisible);

  // 展开
  await page2.click('#panelToggle');
  await new Promise(r => setTimeout(r, 400));
  const expanded = await page2.evaluate(() => ({
    collapsed: document.getElementById('right-panel').classList.contains('collapsed'),
    h: Math.round(document.getElementById('right-panel').getBoundingClientRect().height),
    previewVisible: getComputedStyle(document.getElementById('preview-content')).display !== 'none',
    toggleText: document.getElementById('panelToggle').textContent
  }));
  console.log('    展开后: ' + JSON.stringify(expanded));
  check('点击后展开', !expanded.collapsed && expanded.previewVisible);
  check('展开后高度变大', expanded.h > 300, expanded.h);
  check('展开后按钮变「收起」', /收起/.test(expanded.toggleText), expanded.toggleText);

  // 移动端复制按钮
  await page2.click('#panelToggle');
  await new Promise(r => setTimeout(r, 200));
  const mobileCopy = await page2.evaluate(async () => {
    document.querySelector('.panel-copy').click();
    await new Promise(r => setTimeout(r, 400));
    return { toast: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show') };
  });
  check('收起状态可一键复制', mobileCopy.shown && /已复制|失败/.test(mobileCopy.toast), mobileCopy);

  await page.screenshot({ path: 'shot-desktop.png', fullPage: false });
  await page2.screenshot({ path: 'shot-mobile.png', fullPage: false });

  console.log('\n=== 结果 ===');
  console.log(bad === 0 ? '布局检查全部通过 ✅' : bad + ' 项失败 ❌');
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error('异常: ' + e.message); process.exit(2); });
