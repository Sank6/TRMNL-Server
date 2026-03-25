import sharp from "sharp";
import { encodeGrayscaleBmp } from "./bmp.js";
import type { WidgetDefinition } from "./types.js";

const W = 800;
const H = 480;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Clock face fills the left portion: 30px margins on all sides → R=210, CX=250, CY=240.
// Right panel: x=500–800 (300px wide), date centred at x=650.
const CX = 250;
const CY = 240;
const R  = 210;

const SEP_X   = 500;   // vertical separator x
const DATE_CX = 650;   // date panel text centre x

function buildAnalogClockSvg(): string {
  const now = new Date();
  const hours   = now.getHours() % 12;
  const minutes = now.getMinutes();
  const day     = DAYS[now.getDay()];
  const date    = now.getDate();
  const month   = MONTHS[now.getMonth()];
  const year    = now.getFullYear();

  // ── Tick marks ──────────────────────────────────────────────────────────────
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const angle   = (i * 6 - 90) * (Math.PI / 180);
    const isHour  = i % 5 === 0;
    const outerR  = R - 2;                   // right at the face edge
    const innerR  = R - (isHour ? 26 : 12);
    const x1 = (CX + innerR * Math.cos(angle)).toFixed(2);
    const y1 = (CY + innerR * Math.sin(angle)).toFixed(2);
    const x2 = (CX + outerR * Math.cos(angle)).toFixed(2);
    const y2 = (CY + outerR * Math.sin(angle)).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="black" stroke-width="${isHour ? 6 : 2}" stroke-linecap="round"/>`;
  }).join("\n  ");

  // ── Hands ────────────────────────────────────────────────────────────────────
  const hourAngle = (-90 + (hours + minutes / 60) * 30) * (Math.PI / 180);
  const minAngle  = (-90 + minutes * 6)              * (Math.PI / 180);

  const HOUR_LEN = 130; const HOUR_BACK = 22; const HOUR_W = 14;
  const MIN_LEN  = 185; const MIN_BACK  = 18; const MIN_W  = 8;

  const hTipX = (CX + HOUR_LEN  * Math.cos(hourAngle)).toFixed(2);
  const hTipY = (CY + HOUR_LEN  * Math.sin(hourAngle)).toFixed(2);
  const hBakX = (CX - HOUR_BACK * Math.cos(hourAngle)).toFixed(2);
  const hBakY = (CY - HOUR_BACK * Math.sin(hourAngle)).toFixed(2);

  const mTipX = (CX + MIN_LEN  * Math.cos(minAngle)).toFixed(2);
  const mTipY = (CY + MIN_LEN  * Math.sin(minAngle)).toFixed(2);
  const mBakX = (CX - MIN_BACK * Math.cos(minAngle)).toFixed(2);
  const mBakY = (CY - MIN_BACK * Math.sin(minAngle)).toFixed(2);

  // ── Date block — vertically centred in the right panel ───────────────────────
  // Visual block: day(30) + gap(20) + date(90) + gap(16) + month(30) + gap(12) + year(28)
  // Total ~226px → centred at CY=240 → top ≈ 127
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- Clock face -->
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="white" stroke="black" stroke-width="3"/>

  <!-- Tick marks -->
  ${ticks}

  <!-- Minute hand -->
  <line x1="${mBakX}" y1="${mBakY}" x2="${mTipX}" y2="${mTipY}"
    stroke="black" stroke-width="${MIN_W}" stroke-linecap="round"/>

  <!-- Hour hand -->
  <line x1="${hBakX}" y1="${hBakY}" x2="${hTipX}" y2="${hTipY}"
    stroke="black" stroke-width="${HOUR_W}" stroke-linecap="round"/>

  <!-- Centre cap -->
  <circle cx="${CX}" cy="${CY}" r="10" fill="black"/>

  <!-- Separator -->
  <line x1="${SEP_X}" y1="40" x2="${SEP_X}" y2="440" stroke="black" stroke-width="1"/>

  <!-- Day name -->
  <text x="${DATE_CX}" y="148"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30" fill="#333">${day}</text>

  <!-- Numeric date — hero element -->
  <text x="${DATE_CX}" y="234"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="90" font-weight="bold" fill="black">${date}</text>

  <!-- Month -->
  <text x="${DATE_CX}" y="302"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30" fill="#333">${month}</text>

  <!-- Year -->
  <text x="${DATE_CX}" y="340"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28" fill="#333">${year}</text>
</svg>`;
}

export async function renderAnalogClockBmp(): Promise<Buffer> {
  const { data } = await sharp(Buffer.from(buildAnalogClockSvg()))
    .resize(W, H)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeGrayscaleBmp(data as unknown as Buffer, W, H);
}

export const analogClockWidget: WidgetDefinition = {
  name: "analog-clock",
  render: () => renderAnalogClockBmp(),
};
