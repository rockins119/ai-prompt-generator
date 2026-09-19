/* 真实 Chrome 下的布局与视觉量化检查 */
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8123/index.html';
let bad = 0;

/* 先确认本地服务活着，避免后面卡在网络上浪费两分钟 */
async function ensureServer() {
  try {
    const res = await fetch(URL, { method: 'GET' }, { timeout: 5000 });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    console.error('\n本地服务不可用（' + e.message + '）');
    console.error('请先在项目根目录执行：python -m http.server 8123');
    process.exit(3);
  }
}

/* 收尾兜底：任何截图/关闭卡住都不影响测试结论 */
function guardExit(code) {
  setTimeout(() => process.exit(code), 8000).unref();
}

function check(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { bad++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await ensureServer();
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
  await page.waitForSelector('#form-container .field', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  console.log('\n=== 桌面 1600x1000 ===');
  check('无控制台错误', errors.length === 0, errors.slice(0, 3));

  const m = await page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rows = Array.from(document.querySelectorAll('#form-container .field'));
    const labels = rows.map(r => r.querySelector('.field-label'));
    const controls = rows.map(r => r.querySelector('.field-control'));
    const pills = Array.from(document.querySelectorAll('#form-container .pill-text'));
    const nav = document.querySelector('.nav-block').getBoundingClientRect();
    const left = document.querySelector('#left-panel');

    // 标签列：只统计「普通行」（开关行标签占满、独占行的标签本来就满宽）
    const isNormal = r => !r.classList.contains('field-wide') && !r.classList.contains('field-switch');
    const normalIdx = rows.map((r, i) => (isNormal(r) ? i : -1)).filter(i => i >= 0);
    const labelWidths = normalIdx.map(i => Math.round(labels[i].getBoundingClientRect().width));
    const normalHeights = normalIdx.map(i => Math.round(labels[i].getBoundingClientRect().height));

    // 控件起点（同样只看普通行，开关行的控件钉在最右边）
    const controlLefts = normalIdx
      .filter(i => controls[i].getBoundingClientRect().width > 0)
      .map(i => Math.round(controls[i].getBoundingClientRect().left));

    const heights = rows.map(r => Math.round(r.getBoundingClientRect().height));

    return {
      navH: Math.round(nav.height),
      presetSelectW: Math.round(document.getElementById('presetSelect').getBoundingClientRect().width),
      rowCount: rows.length,
      labelWidths: { min: Math.min(...labelWidths), max: Math.max(...labelWidths) },
      labelHeights: { min: Math.min(...normalHeights), max: Math.max(...normalHeights) },
      normalLabelMax: normalHeights.length ? Math.max(...normalHeights) : 0,
      normalLabelCount: normalHeights.length,
      controlLeft: { min: Math.min(...controlLefts), max: Math.max(...controlLefts) },
      rowHeights: { min: Math.min(...heights), avg: Math.round(heights.reduce((a, b) => a + b, 0) / heights.length), max: Math.max(...heights) },
      leftTotalH: left.scrollHeight,
      leftViewH: left.clientHeight,
      screens: +(left.scrollHeight / left.clientHeight).toFixed(1),
      pillCount: pills.length,
      perScreen: Math.round(left.clientHeight / (heights.reduce((a, b) => a + b, 0) / heights.length)),
      bodyScrollW: document.documentElement.scrollWidth,
      bodyClientW: document.documentElement.clientWidth,
      tooltipCount: document.querySelectorAll('#form-container .info').length
    };
  });

  console.log('    导航区高度        : ' + m.navH + 'px（预设下拉宽 ' + m.presetSelectW + 'px）');
  console.log('    字段行数          : ' + m.rowCount);
  console.log('    标签列宽          : ' + m.labelWidths.min + ' ~ ' + m.labelWidths.max + 'px');
  console.log('    标签列高          : ' + m.labelHeights.min + ' ~ ' + m.labelHeights.max + 'px（普通行最大 ' + m.normalLabelMax + 'px）');
  console.log('    控件起点 x        : ' + m.controlLeft.min + ' ~ ' + m.controlLeft.max);
  console.log('    行高 min/avg/max  : ' + m.rowHeights.min + ' / ' + m.rowHeights.avg + ' / ' + m.rowHeights.max + 'px');
  console.log('    内容总高          : ' + m.leftTotalH + 'px → 需滚动 ' + m.screens + ' 屏，一屏约 ' + m.perScreen + ' 个字段');
  console.log('    胶囊数            : ' + m.pillCount);
  if (m.tooltip) console.log('    提示气泡          : ' + JSON.stringify(m.tooltip));
  check('页面无横向溢出', m.bodyScrollW <= m.bodyClientW + 1, { w: m.bodyScrollW, c: m.bodyClientW });
  check('标签列宽一致（控件起点对齐）', m.controlLeft.max - m.controlLeft.min <= 2,
    { min: m.controlLeft.min, max: m.controlLeft.max });
  check('普通字段的标签不折行', m.normalLabelMax <= 26, { max: m.normalLabelMax, 检查了: m.normalLabelCount + ' 个' });
  check('导航区显著变矮（< 110px）', m.navH < 110, m.navH);
  check('一屏能看到 15 个以上字段', m.perScreen >= 15, m.perScreen);
  check('内容总高降到 2000px 以内', m.leftTotalH < 2000, m.leftTotalH);
  check('滚动距离不超过 2.2 屏', m.screens <= 2.2, m.screens);
  check('行高比旧版整齐（max/min < 3.5）', m.rowHeights.max / m.rowHeights.min < 3.5,
    { min: m.rowHeights.min, max: m.rowHeights.max });

  console.log('\n=== 提示气泡（说明文字）===');
  const tipBefore = await page.evaluate(() => ({
    leftScrollW: document.querySelector('#left-panel').scrollWidth,
    docScrollW: document.documentElement.scrollWidth
  }));
  await page.hover('#form-container .info');
  await new Promise(r => setTimeout(r, 350));
  const tipAfter = await page.evaluate(() => ({
    leftScrollW: document.querySelector('#left-panel').scrollWidth,
    docScrollW: document.documentElement.scrollWidth,
    display: getComputedStyle(document.querySelector('#form-container .info'), '::after').display
  }));
  console.log('    说明图标 ' + m.tooltipCount + ' 个；hover 后伪元素 display=' + tipAfter.display);
  console.log('    左栏 scrollWidth  ' + tipBefore.leftScrollW + ' → ' + tipAfter.leftScrollW);
  console.log('    页面 scrollWidth  ' + tipBefore.docScrollW + ' → ' + tipAfter.docScrollW);
  check('页面上确实有说明图标', m.tooltipCount > 0, m.tooltipCount);
  check('悬停时气泡真的显示', tipAfter.display === 'block', tipAfter.display);
  check('气泡显示后不撑出横向滚动', tipAfter.leftScrollW <= tipBefore.leftScrollW + 1,
    { before: tipBefore.leftScrollW, after: tipAfter.leftScrollW });
  check('气泡显示后页面仍无横向溢出', tipAfter.docScrollW <= tipBefore.docScrollW + 1,
    { before: tipBefore.docScrollW, after: tipAfter.docScrollW });

  console.log('\n=== 对照旧版（改版前实测）===');
  console.log('    导航区      277px → ' + m.navH + 'px');
  console.log('    一屏字段      8 个 → ' + m.perScreen + ' 个');
  console.log('    内容总高   4398px → ' + m.leftTotalH + 'px');
  console.log('    滚动屏数    5.0 屏 → ' + m.screens + ' 屏');
  console.log('    行高离散  标准差 128px → 极差 ' + (m.rowHeights.max - m.rowHeights.min) + 'px');

  console.log('\n=== 交互后状态 ===');
  await page.select('#presetSelect', await page.evaluate(() => document.getElementById('presetSelect').options[2].value));
  await new Promise(r => setTimeout(r, 600));
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('#form-container .field').length,
    leftTotalH: document.querySelector('#left-panel').scrollHeight,
    scrollTop: document.querySelector('#left-panel').scrollTop,
    url: location.search
  }));
  check('切换预设后重新渲染', after.rows > 0, after);
  check('切换预设后回到顶部', after.scrollTop === 0, after.scrollTop);

  await page.click('#groupNavBar .group-tab:nth-child(3)');
  await new Promise(r => setTimeout(r, 1200));
  const g = await page.evaluate(() => ({
    active: document.querySelector('#groupNavBar .group-tab.active').textContent.trim(),
    rows: document.querySelectorAll('#form-container .field').length,
    presets: document.getElementById('presetSelect').options.length
  }));
  check('切到景观设计', /景观/.test(g.active), g);
  check('景观设计有内容', g.rows > 0 && g.presets > 0, g);

  const copy = await page.evaluate(async () => {
    document.querySelector('[data-action=copy]').click();
    await new Promise(r => setTimeout(r, 400));
    return { toast: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show') };
  });
  check('复制按钮有反馈', copy.shown && /已复制|失败/.test(copy.toast), copy);

  console.log('\n=== 中等宽度 1100x900 ===');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1100, height: 900 });
  await p2.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p2.waitForSelector('#form-container .field', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 700));
  const mid = await p2.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#form-container .field'));
    const labels = rows.filter(r => !r.classList.contains('field-wide') && !r.classList.contains('field-switch'))
      .map(r => Math.round(r.querySelector('.field-label').getBoundingClientRect().height));
    const controls = rows.map(r => Math.round(r.querySelector('.field-control').getBoundingClientRect().left));
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      maxLabelH: Math.max(...labels),
      controlSpread: Math.max(...controls) - Math.min(...controls)
    };
  });
  console.log('    ' + JSON.stringify(mid));
  check('中等宽度无横向溢出', mid.scrollW <= mid.clientW + 1, mid);
  check('中等宽度标签不折行', mid.maxLabelH <= 26, mid.maxLabelH);
  check('中等宽度控件仍对齐', mid.controlSpread <= 2, mid.controlSpread);
  await p2.close();

  console.log('\n=== 移动端 390x844 ===');
  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message));
  await page2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page2.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page2.waitForSelector('#form-container .field', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  const mobile = await page2.evaluate(() => {
    const rect = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rows = Array.from(document.querySelectorAll('#form-container .field'));
    const stacked = rows.filter(r => {
      const l = r.querySelector('.field-label').getBoundingClientRect();
      const c = r.querySelector('.field-control').getBoundingClientRect();
      return c.top >= l.bottom - 2;
    }).length;
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      right: rect('#right-panel'),
      rowCount: rows.length,
      stacked,
      collapsed: document.getElementById('right-panel').classList.contains('collapsed'),
      toggleText: document.getElementById('panelToggle').textContent,
      panelCopyVisible: getComputedStyle(document.querySelector('.panel-copy')).display !== 'none'
    };
  });
  console.log('    ' + JSON.stringify(mobile));
  check('移动端无横向溢出', mobile.scrollW <= mobile.clientW + 1, mobile);
  check('移动端字段改成上下排', mobile.stacked === mobile.rowCount, { stacked: mobile.stacked, total: mobile.rowCount });
  check('移动端面板默认收起', mobile.collapsed && mobile.panelCopyVisible);
  check('移动端无 JS 错误', errors2.length === 0, errors2);

  await page2.click('#panelToggle');
  await new Promise(r => setTimeout(r, 400));
  const expanded = await page2.evaluate(() => ({
    collapsed: document.getElementById('right-panel').classList.contains('collapsed'),
    h: Math.round(document.getElementById('right-panel').getBoundingClientRect().height)
  }));
  check('点击后展开', !expanded.collapsed && expanded.h > 300, expanded);

  await page.mouse.move(0, 0).catch(() => {});
  console.log('\n=== 结果 ===');
  console.log(bad === 0 ? '布局检查全部通过 ✅' : bad + ' 项失败 ❌');
  guardExit(bad === 0 ? 0 : 1);
  try {
    await page.screenshot({ path: 'shot-desktop.png', timeout: 15000 });
    await page2.screenshot({ path: 'shot-mobile.png', timeout: 15000 });
    console.log('已保存截图：_test/shot-desktop.png、_test/shot-mobile.png');
  } catch (e) {
    console.log('（截图失败，不影响结论：' + e.message.split('\n')[0] + '）');
  }
  await browser.close().catch(() => {});
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error('异常: ' + e.message); process.exit(2); });
