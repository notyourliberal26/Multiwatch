// Renders icon.svg into icon.ico and icon.png. Run with: electron assets/build-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(win, svg, size) {
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${size};
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${size}, ${size});
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('svg failed to load'));
    img.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
  })`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function buildIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: await renderPng(win, svg, size) });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs.at(-1).data);
  if (process.env.ICON_PREVIEW_DIR) {
    for (const { size, data } of pngs) fs.writeFileSync(path.join(process.env.ICON_PREVIEW_DIR, `icon-${size}.png`), data);
  }
  app.quit();
});
