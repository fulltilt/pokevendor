import sharp from "sharp";

const RESIZE_SIDE = 64;
const DCT_SIDE = 32;

const toUnit = (values: number[]): number[] => {
  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm <= 0) return values;
  return values.map((value) => value / norm);
};

const rgbToHsv = (
  r: number,
  g: number,
  b: number,
): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [h, s, v];
};

const computeColorHistogram = (rgb: Uint8Array): number[] => {
  const binsH = 16;
  const binsS = 4;
  const binsV = 4;
  const totalBins = binsH * binsS * binsV;
  const hist = new Array<number>(totalBins).fill(0);

  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i] ?? 0;
    const g = rgb[i + 1] ?? 0;
    const b = rgb[i + 2] ?? 0;
    const [h, s, v] = rgbToHsv(r, g, b);

    const hBin = Math.min(Math.floor((h / 360) * binsH), binsH - 1);
    const sBin = Math.min(Math.floor(s * binsS), binsS - 1);
    const vBin = Math.min(Math.floor(v * binsV), binsV - 1);

    const index = hBin * binsS * binsV + sBin * binsV + vBin;
    hist[index] += 1;
  }

  const total = Math.max(1, rgb.length / 3);
  return hist.map((value) => value / total);
};

const dct2d = (matrix: number[][]): number[][] => {
  const n = matrix.length;
  const result: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const c = (index: number) =>
    index === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);

  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          sum +=
            (matrix[x]?.[y] ?? 0) *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
        }
      }
      result[u][v] = c(u) * c(v) * sum;
    }
  }

  return result;
};

const computeDctDescriptor = (gray: Uint8Array): number[] => {
  const side = DCT_SIDE;
  const matrix: number[][] = [];
  for (let y = 0; y < side; y++) {
    const row: number[] = [];
    for (let x = 0; x < side; x++) {
      row.push((gray[y * side + x] ?? 0) / 255);
    }
    matrix.push(row);
  }

  const dct = dct2d(matrix);
  const descriptor: number[] = [];

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue;
      descriptor.push(dct[y]?.[x] ?? 0);
    }
  }

  return descriptor;
};

const computeEdgeHistogram = (gray: Uint8Array): number[] => {
  const side = RESIZE_SIDE;
  const bins = new Array<number>(16).fill(0);

  for (let y = 1; y < side - 1; y++) {
    for (let x = 1; x < side - 1; x++) {
      const i = y * side + x;
      const gx =
        (gray[i - side + 1] ?? 0) +
        2 * (gray[i + 1] ?? 0) +
        (gray[i + side + 1] ?? 0) -
        (gray[i - side - 1] ?? 0) -
        2 * (gray[i - 1] ?? 0) -
        (gray[i + side - 1] ?? 0);

      const gy =
        (gray[i + side - 1] ?? 0) +
        2 * (gray[i + side] ?? 0) +
        (gray[i + side + 1] ?? 0) -
        (gray[i - side - 1] ?? 0) -
        2 * (gray[i - side] ?? 0) -
        (gray[i - side + 1] ?? 0);

      const mag = Math.hypot(gx, gy);
      const bin = Math.min(15, Math.floor((mag / 1448) * 16));
      bins[bin] += 1;
    }
  }

  const total = bins.reduce((sum, value) => sum + value, 0) || 1;
  return bins.map((value) => value / total);
};

export const computeVisionEmbeddingFromBuffer = async (
  image: Buffer,
): Promise<number[]> => {
  const rgbRaw = await sharp(image)
    .rotate()
    .resize(RESIZE_SIDE, RESIZE_SIDE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const gray64 = await sharp(image)
    .rotate()
    .grayscale()
    .resize(RESIZE_SIDE, RESIZE_SIDE, { fit: "fill" })
    .raw()
    .toBuffer();

  const gray32 = await sharp(image)
    .rotate()
    .grayscale()
    .resize(DCT_SIDE, DCT_SIDE, { fit: "fill" })
    .raw()
    .toBuffer();

  const color = computeColorHistogram(rgbRaw);
  const edges = computeEdgeHistogram(gray64);
  const dct = computeDctDescriptor(gray32);

  return toUnit([...color, ...edges, ...dct]);
};

export const toPgVectorLiteral = (embedding: number[]): string =>
  `[${embedding.map((value) => Number(value).toFixed(8)).join(",")}]`;
