import sharp from "sharp";
import { encodeGrayscaleBmp } from "./bmp.js";
import type { WidgetDefinition } from "./types.js";

const W = 800;
const H = 480;

const DAYS = ["M", "T", "W", "Th", "F", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function buildCalendarSvg(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // 0=Mon
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const numRows = Math.ceil((firstDayOfWeek + daysInMonth) / 7);

  const gridLeft = 44;
  const gridRight = W - 44;
  const headerY = 134;      // day-of-week label baseline
  const gridTop = 150;      // top of the day number rows
  const gridBottom = H - 28;
  const cellW = Math.floor((gridRight - gridLeft) / 7);
  const cellH = Math.floor((gridBottom - gridTop) / numRows);
  const separatorTop = gridTop + 18;
  const separatorBottom = gridTop + numRows * cellH;

  // Vertical column separators — between columns only, no outer borders.
  // Only span the body of the date grid, leaving whitespace below the weekday labels.
  let colSeparators = "";
  for (let c = 1; c < 7; c++) {
    const x = gridLeft + c * cellW;
    colSeparators += `<line x1="${x}" y1="${separatorTop}" x2="${x}" y2="${separatorBottom}" stroke="black" stroke-width="1"/>`;
  }

  // Day-of-week header labels
  let dayHeaders = "";
  for (let d = 0; d < 7; d++) {
    const cx = gridLeft + d * cellW + cellW / 2;
    dayHeaders += `<text x="${cx}" y="${headerY}" text-anchor="middle"
      font-family="Arial, Helvetica, sans-serif" font-size="24" fill="black">${DAYS[d]}</text>`;
  }

  // Day number cells
  let cells = "";
  let col = firstDayOfWeek;
  let row = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const x = gridLeft + col * cellW;
    const y = gridTop + row * cellH;
    const cx = x + cellW / 2;
    const cy = y + cellH / 2;

    if (day === today) {
      // Inverted square highlight — sits inside the column separator lines
      cells += `<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" fill="black"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" fill="white">${day}</text>`;
    } else {
      cells += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#222">${day}</text>`;
    }

    col++;
    if (col === 7) { col = 0; row++; }
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <text x="44" y="72"
    font-family="Arial, Helvetica, sans-serif"
    font-size="56" font-weight="bold" fill="black">${MONTHS[month]}</text>
  <text x="${W - 44}" y="72"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="46" fill="#aaa">${year}</text>

  ${dayHeaders}
  ${colSeparators}
  ${cells}

  <text x="28" y="458"
    font-family="Arial, Helvetica, sans-serif"
    font-size="20" fill="#bbb">xteink</text>
</svg>`;
}

async function renderCalendarBmp(): Promise<Buffer> {
  const { data } = await sharp(Buffer.from(buildCalendarSvg()))
    .resize(W, H)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeGrayscaleBmp(data as unknown as Buffer, W, H);
}

export const calendarWidget: WidgetDefinition = {
  name: "calendar",
  render: () => renderCalendarBmp(),
};
