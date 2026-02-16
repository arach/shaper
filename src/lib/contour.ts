/**
 * Contour extraction from binary images.
 * Ported from talkie/scripts/extract_logo_primitives.py
 */

/** Otsu's method — find optimal threshold for grayscale histogram */
export function otsuThreshold(gray: number[]): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;

  const total = gray.length;
  let sumTotal = 0;
  for (let i = 0; i < 256; i++) sumTotal += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumTotal - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = i;
    }
  }
  return threshold;
}

/** Convert RGBA ImageData to a boolean mask using alpha channel (if present) or Otsu threshold */
export function imageToMask(imageData: ImageData): boolean[] {
  const { data, width, height } = imageData;
  const n = width * height;

  // Check if image uses alpha channel for shape definition
  // by counting transparent vs opaque pixels
  let transparentCount = 0;
  let opaqueCount = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 10) transparentCount++;
    else if (a > 245) opaqueCount++;
  }

  const usesAlpha = transparentCount > n * 0.1;

  if (usesAlpha) {
    // Shape is defined by alpha: opaque = foreground
    console.log("[mask] using alpha channel,", opaqueCount, "opaque pixels");
    return Array.from({ length: n }, (_, i) => data[i * 4 + 3] > 128);
  }

  // Fallback: use luminance + Otsu
  const gray: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  const threshold = otsuThreshold(gray);
  console.log("[mask] using Otsu threshold:", threshold);
  return gray.map((v) => v < threshold);
}

type Pt = [number, number];

function ptKey(x: number, y: number): string {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
}

/** Marching squares contour extraction — returns longest closed contour */
export function marchingSquares(
  mask: boolean[],
  width: number,
  height: number
): Pt[] {
  function isOn(x: number, y: number): boolean {
    return mask[y * width + x];
  }

  const segments: [string, string, Pt, Pt][] = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = isOn(x, y) ? 1 : 0;
      const tr = isOn(x + 1, y) ? 1 : 0;
      const br = isOn(x + 1, y + 1) ? 1 : 0;
      const bl = isOn(x, y + 1) ? 1 : 0;
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;

      const top: Pt = [x + 0.5, y];
      const right: Pt = [x + 1, y + 0.5];
      const bottom: Pt = [x + 0.5, y + 1];
      const left: Pt = [x, y + 0.5];

      const crossings: [string, Pt][] = [];
      if (tl !== tr) crossings.push(["top", top]);
      if (tr !== br) crossings.push(["right", right]);
      if (br !== bl) crossings.push(["bottom", bottom]);
      if (bl !== tl) crossings.push(["left", left]);

      if (crossings.length === 2) {
        const k1 = ptKey(crossings[0][1][0], crossings[0][1][1]);
        const k2 = ptKey(crossings[1][1][0], crossings[1][1][1]);
        segments.push([k1, k2, crossings[0][1], crossings[1][1]]);
      } else if (crossings.length === 4) {
        if (c === 5) {
          segments.push([ptKey(top[0], top[1]), ptKey(right[0], right[1]), top, right]);
          segments.push([ptKey(bottom[0], bottom[1]), ptKey(left[0], left[1]), bottom, left]);
        } else if (c === 10) {
          segments.push([ptKey(top[0], top[1]), ptKey(left[0], left[1]), top, left]);
          segments.push([ptKey(bottom[0], bottom[1]), ptKey(right[0], right[1]), bottom, right]);
        }
      }
    }
  }

  // Build adjacency
  const adj = new Map<string, string[]>();
  const ptLookup = new Map<string, Pt>();

  for (const [k1, k2, p1, p2] of segments) {
    ptLookup.set(k1, p1);
    ptLookup.set(k2, p2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push(k2);
    adj.get(k2)!.push(k1);
  }

  // Walk paths
  function edgeId(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  const visitedEdges = new Set<string>();
  const paths: Pt[][] = [];

  for (const [k1, k2] of segments) {
    const eid = edgeId(k1, k2);
    if (visitedEdges.has(eid)) continue;

    const path: string[] = [k1, k2];
    visitedEdges.add(eid);
    let prev = k1;
    let curr = k2;

    while (true) {
      const neighbors = adj.get(curr);
      if (!neighbors || neighbors.length === 0) break;

      let next: string;
      if (neighbors.length === 1) {
        next = neighbors[0];
      } else {
        next = neighbors[0] !== prev ? neighbors[0] : neighbors[1];
      }

      if (next === path[0]) {
        path.push(next);
        break;
      }

      const eidNext = edgeId(curr, next);
      if (visitedEdges.has(eidNext)) break;

      visitedEdges.add(eidNext);
      path.push(next);
      prev = curr;
      curr = next;
    }

    paths.push(path.map((k) => ptLookup.get(k)!));
  }

  if (paths.length === 0) return [];

  // Return longest path
  paths.sort((a, b) => b.length - a.length);
  return paths[0];
}

/** Ramer-Douglas-Peucker polyline simplification */
export function rdp(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;

  function distPointLine(pt: Pt, start: Pt, end: Pt): number {
    const [sx, sy] = start;
    const [ex, ey] = end;
    const [px, py] = pt;
    const dx = ex - sx;
    const dy = ey - sy;
    if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);
    let t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
  }

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distPointLine(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }

  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [points[0], points[points.length - 1]];
}

/** Load an image into an offscreen canvas and return pixel data at given resolution */
export function loadImageData(src: string, size: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = reject;
    img.src = src;
  });
}
