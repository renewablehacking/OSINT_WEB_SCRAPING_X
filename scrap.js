// scrap-to-sheet.js
const puppeteer = require('puppeteer-core');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1c8uEQB8p0dCrjlVJHNOiwpZQNlKzLIrxU6Es057NbE8'; // ganti kalau perlu
const KEYFILE = 'scraping-x-471319-824a826bc2d8.json'; // path ke service account JSON
const SHEET_NAME = 'Sheet1';
const APPEND_RANGE = `${SHEET_NAME}!A2:G`; // append mulai baris 2
const HEADER_RANGE = `${SHEET_NAME}!A1:G1`;

// Google Auth
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function ensureSheetExistsAndHeader(sheetsApi) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheets = meta.data.sheets || [];
  const exists = sheets.some(s => s.properties && s.properties.title === SHEET_NAME);

  if (!exists) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
    console.log(`Membuat sheet baru: ${SHEET_NAME}`);
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: HEADER_RANGE,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Nama', 'Username', 'Tanggal', 'Status', 'Komentar', 'Retweet', 'Suka']],
    },
  });
  console.log('Header ditetapkan di', HEADER_RANGE);
}

async function appendRow(sheetsApi, row) {
  try {
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: APPEND_RANGE,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.error('Gagal append ke Sheets:', err?.message || err);
  }
}

(async () => {
  const client = await auth.getClient();
  const sheetsApi = google.sheets({ version: 'v4', auth: client });

  try {
    await ensureSheetExistsAndHeader(sheetsApi);
  } catch (err) {
    console.error('Error saat memastikan sheet/header:', err);
    process.exit(1);
  }

  const keyword = 'bubarkan dpr';
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query`;

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

  await page.waitForSelector('article', { timeout: 30000 });

  const scrollTime = 5 * 60 * 1000; // 5 menit
  const scrollInterval = 2000;
  const start = Date.now();
  const seen = new Set();
  let totalCount = 0;

  while (Date.now() - start < scrollTime) {
    const tweets = await page.$$eval('article', articles => {
      return articles.map(article => {
        const getTextByClass = (className) => {
          const el = article.querySelector(className);
          return el ? el.innerText.trim() : '';
        };

        const getAttrByClass = (className, attr) => {
          const el = article.querySelector(className);
          return el ? el.getAttribute(attr) : '';
        };

        // Ambil semua actions (komentar, retweet, suka)
        const getActions = () => {
          const els = article.querySelectorAll(
            'div.css-175oi2r.r-xoduu5.r-1udh08x span.css-1jxf684'
          );
          return Array.from(els).map(el => el.innerText.trim());
        };

        const actions = getActions();
        const getKomentar = () => actions[0] || '0';
        const getRetweet  = () => actions[1] || '0';
        const getSuka     = () => actions[2] || '0';

        const statusEl = article.querySelector('div[data-testid="tweetText"]');
        const status = statusEl ? statusEl.innerText.trim() : '';

        return {
          nama: getTextByClass('div.css-146c3p1.r-bcqeeo.r-1ttztb7.r-qvutc0.r-37j5jr.r-a023e6.r-rjixqe.r-b88u0q.r-1awozwy.r-6koalj.r-1udh08x.r-3s2u2q'),
          username: getTextByClass('div.css-146c3p1.r-dnmrzs.r-1udh08x.r-1udbk01.r-3s2u2q.r-bcqeeo.r-1ttztb7.r-qvutc0.r-37j5jr.r-a023e6.r-rjixqe.r-16dba41.r-18u37iz.r-1wvb978'),
          tanggal: getAttrByClass('div.css-175oi2r.r-18u37iz.r-1q142lx time', 'datetime'),
          status: status,
          jumlahKomentar: getKomentar(),
          postingUlang: getRetweet(),
          jumlahSuka: getSuka(),
        };
      });
    });

    for (const t of tweets) {
      const key = t.username + t.tanggal + t.status;
      if (!seen.has(key)) {
        seen.add(key);
        totalCount++;

        console.log(`Tweet #${totalCount}`);
        console.log(`Nama       : ${t.nama}`);
        console.log(`Username   : ${t.username}`);
        console.log(`Tanggal    : ${t.tanggal}`);
        console.log(`Status     : ${t.status}`);
        console.log(`Komentar   : ${t.jumlahKomentar}`);
        console.log(`Retweet    : ${t.postingUlang}`);
        console.log(`Suka       : ${t.jumlahSuka}`);
        console.log('----------------------------------------\n');

        await appendRow(sheetsApi, [
          t.nama,
          t.username,
          t.tanggal,
          t.status,
          t.jumlahKomentar,
          t.postingUlang,
          t.jumlahSuka,
        ]);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1500));
    await new Promise(resolve => setTimeout(resolve, scrollInterval));
  }

  console.log(`\n=== Total ${totalCount} tweet berhasil dicapture & disimpan ===\n`);
  await browser.close();
})();
