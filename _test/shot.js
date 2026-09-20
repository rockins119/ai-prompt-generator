/* 生成界面截图（桌面 + 手机），跑完直接看图 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8123/index.html';

async function shoot(browser, name, viewport, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#form-container .field', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
  const t = Date.now();
  await page.screenshot({
    path: name,
    animations: 'disabled',
    caret: 'hide',
    timeout: 20000,
    ...opts
  });
  console.log('  ' + name + '  (' + (Date.now() - t) + 'ms)');
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb']
  });
  console.log('生成截图...');
  await shoot(browser, 'shot-desktop.png', { width: 1600, height: 1000, deviceScaleFactor: 1 });
  await shoot(browser, 'shot-mobile.png', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await browser.close();
  console.log('完成');
  process.exit(0);
})().catch(e => { console.error('异常: ' + e.message); process.exit(1); });
