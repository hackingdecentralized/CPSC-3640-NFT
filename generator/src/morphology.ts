/**
 * Binary dilation and erosion with a square window, using a summed-area table so
 * the cost does not depend on the window size. Masks are one byte per pixel,
 * 0 or 255.
 */

function summedArea(mask: Uint8Array, width: number, height: number): Int32Array {
  const stride = width + 1;
  const sat = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += mask[y * width + x]! > 0 ? 1 : 0;
      sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1]! + rowSum;
    }
  }
  return sat;
}

function windowFilter(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  keep: (count: number, area: number) => boolean
): Uint8Array {
  const sat = summedArea(mask, width, height);
  const stride = width + 1;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius) + 1;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius) + 1;
      const count =
        sat[y1 * stride + x1]! - sat[y0 * stride + x1]! - sat[y1 * stride + x0]! + sat[y0 * stride + x0]!;
      if (keep(count, (x1 - x0) * (y1 - y0))) out[y * width + x] = 255;
    }
  }
  return out;
}

export const dilate = (mask: Uint8Array, width: number, height: number, radius: number): Uint8Array =>
  windowFilter(mask, width, height, radius, (count) => count > 0);

export const erode = (mask: Uint8Array, width: number, height: number, radius: number): Uint8Array =>
  windowFilter(mask, width, height, radius, (count, area) => count === area);

/** Dilate then erode: fills gaps narrower than the window without growing the shape. */
export const close = (mask: Uint8Array, width: number, height: number, radius: number): Uint8Array =>
  erode(dilate(mask, width, height, radius), width, height, radius);

/**
 * Mark every enclosed gap as part of the shape: a flood fill from the edge of `box`
 * finds the true background, and anything it cannot reach is a hole. This is what
 * keeps a dark nose or doorway from being treated as open background.
 */
export function fillHoles(
  mask: Uint8Array,
  width: number,
  box: {x: number; y: number; w: number; h: number}
): Uint8Array {
  const out = mask.slice();
  const reached = new Uint8Array(mask.length);
  const queue = new Int32Array(box.w * box.h);
  const x1 = box.x + box.w - 1;
  const y1 = box.y + box.h - 1;
  let head = 0;
  let tail = 0;

  const visit = (x: number, y: number) => {
    const i = y * width + x;
    if (!reached[i] && !mask[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = box.x; x <= x1; x++) {
    visit(x, box.y);
    visit(x, y1);
  }
  for (let y = box.y; y <= y1; y++) {
    visit(box.x, y);
    visit(x1, y);
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > box.x) visit(x - 1, y);
    if (x < x1) visit(x + 1, y);
    if (y > box.y) visit(x, y - 1);
    if (y < y1) visit(x, y + 1);
  }
  for (let y = box.y; y <= y1; y++) {
    for (let x = box.x; x <= x1; x++) {
      const i = y * width + x;
      if (!mask[i] && !reached[i]) out[i] = 255;
    }
  }
  return out;
}
