import { svgToBmp, DISPLAY_WIDTH, DISPLAY_HEIGHT } from "./image-pipeline.js";
import type { WidgetDefinition } from "./types.js";

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function buildClockSvg(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const day = DAYS[now.getDay()];
  const date = now.getDate();
  const month = MONTHS[now.getMonth()];
  const year = now.getFullYear();

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- Large time - centered -->
  <text x="400" y="205"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="185" font-weight="bold" fill="black">${hh}:${mm}</text>

  <!-- Date -->
  <text x="400" y="370"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="42" fill="#222">${day}, ${date} ${month} ${year}</text>

  <!-- Branding -->
  <text x="28" y="458"
    font-family="Arial, Helvetica, sans-serif"
    font-size="20" fill="#bbb">xteink</text>
</svg>`;
}

export async function renderClockBmp(): Promise<Buffer> {
  return svgToBmp(buildClockSvg());
}

export const clockWidget: WidgetDefinition = {
  name: "clock",
  render: () => renderClockBmp(),
};
