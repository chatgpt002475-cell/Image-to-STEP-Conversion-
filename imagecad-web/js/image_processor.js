/**
 * ImageCAD Web - Image Processing & Vectorization Kernel
 * Implements Otsu thresholding, adaptive thresholding, edge filtering,
 * Moore-Neighbor contour tracing, hole detection, Douglas-Peucker simplification,
 * and Chaikin smoothing.
 */

window.ImageProcessor = (function() {
    'use strict';

    function traceImage(imageElement, params) {
        params = Object.assign({
            method: 'otsu',
            threshold: 128,
            invert: false,
            blur: 1,
            morph: 1,
            simplify: 1.2,
            minArea: 80,
            keepHoles: true,
            smooth: 0,
            widthMm: 100.0
        }, params);

        const canvas = document.createElement('canvas');
        let w = imageElement.naturalWidth || imageElement.width || 600;
        let h = imageElement.naturalHeight || imageElement.height || 400;

        // Downscale large images for interactive speed if needed
        const maxDim = 1200;
        let scale = 1.0;
        if (w > maxDim || h > maxDim) {
            scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imageElement, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // 1. Grayscale
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < data.length; i += 4) {
            gray[i >> 2] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }

        // 2. Blur (Box/Gaussian approximation)
        let blurred = gray;
        if (params.blur > 0) {
            blurred = applyBlur(gray, w, h, params.blur);
        }

        // 3. Thresholding
        let binary = new Uint8Array(w * h);
        let actualThreshold = params.threshold;

        if (params.method === 'otsu') {
            actualThreshold = computeOtsuThreshold(blurred);
            for (let i = 0; i < w * h; i++) {
                binary[i] = blurred[i] < actualThreshold ? 255 : 0;
            }
        } else if (params.method === 'adaptive') {
            binary = computeAdaptiveThreshold(blurred, w, h);
        } else if (params.method === 'edges') {
            binary = computeEdgeThreshold(blurred, w, h, params.threshold);
        } else {
            // Manual
            for (let i = 0; i < w * h; i++) {
                binary[i] = blurred[i] < actualThreshold ? 255 : 0;
            }
        }

        // Invert polarity if requested (trace light shapes)
        if (params.invert) {
            for (let i = 0; i < w * h; i++) {
                binary[i] = binary[i] === 255 ? 0 : 255;
            }
        }

        // 4. Morphological clean-up (remove speckles)
        if (params.morph > 0) {
            binary = applyMorphology(binary, w, h, params.morph);
        }

        // 5. Contour Tracing (Outer boundaries and inner holes)
        const rawContours = extractContours(binary, w, h);

        // 6. Filter by minArea, simplify, and smooth
        const processedContours = [];
        const mmPerPixel = params.widthMm / w;

        for (const item of rawContours) {
            let outer = simplifyPolygon(item.outer, params.simplify);
            if (params.smooth > 0) {
                outer = chaikinSmooth(outer, params.smooth);
            }

            const outerAreaPx = Math.abs(polygonArea(outer));
            if (outerAreaPx < params.minArea) continue;

            const holes = [];
            if (params.keepHoles && item.holes) {
                for (const holeRaw of item.holes) {
                    let hole = simplifyPolygon(holeRaw, params.simplify);
                    if (params.smooth > 0) {
                        hole = chaikinSmooth(hole, params.smooth);
                    }
                    const holeAreaPx = Math.abs(polygonArea(hole));
                    if (holeAreaPx >= (params.minArea * 0.4)) {
                        holes.push({
                            pixels: hole,
                            pointsMm: toMmCoords(hole, w, h, mmPerPixel)
                        });
                    }
                }
            }

            processedContours.push({
                outerPixels: outer,
                outerPointsMm: toMmCoords(outer, w, h, mmPerPixel),
                holes: holes,
                areaMm2: outerAreaPx * mmPerPixel * mmPerPixel
            });
        }

        return {
            widthPx: w,
            heightPx: h,
            aspect: w / h,
            scale: scale,
            threshold: actualThreshold,
            binaryMask: binary,
            contours: processedContours,
            mmPerPixel: mmPerPixel
        };
    }

    function toMmCoords(points, imgW, imgH, mmPerPx) {
        const cx = imgW / 2;
        const cy = imgH / 2;
        return points.map(pt => ({
            x: (pt[0] - cx) * mmPerPx,
            y: (cy - pt[1]) * mmPerPx // Flip Y for standard Cartesian CAD plane
        }));
    }

    function computeOtsuThreshold(gray) {
        const hist = new Int32Array(256);
        for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

        const total = gray.length;
        let sum = 0;
        for (let t = 0; t < 256; t++) sum += t * hist[t];

        let sumB = 0;
        let wB = 0;
        let varMax = 0;
        let threshold = 128;

        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB === 0) continue;
            const wF = total - wB;
            if (wF === 0) break;

            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);

            if (varBetween > varMax) {
                varMax = varBetween;
                threshold = t;
            }
        }
        return threshold;
    }

    function computeAdaptiveThreshold(gray, w, h) {
        const out = new Uint8Array(w * h);
        const radius = 15;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, count = 0;
                const ymin = Math.max(0, y - radius), ymax = Math.min(h - 1, y + radius);
                const xmin = Math.max(0, x - radius), xmax = Math.min(w - 1, x + radius);
                for (let ny = ymin; ny <= ymax; ny += 3) {
                    for (let nx = xmin; nx <= xmax; nx += 3) {
                        sum += gray[ny * w + nx];
                        count++;
                    }
                }
                const mean = sum / count;
                out[y * w + x] = gray[y * w + x] < (mean - 5) ? 255 : 0;
            }
        }
        return out;
    }

    function computeEdgeThreshold(gray, w, h, thr) {
        const out = new Uint8Array(w * h);
        const t = Math.max(20, thr * 0.8);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const gx = -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
                         - 2 * gray[y * w + (x - 1)]   + 2 * gray[y * w + (x + 1)]
                         - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
                const gy = -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
                         + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
                const mag = Math.sqrt(gx * gx + gy * gy);
                out[y * w + x] = mag > t ? 255 : 0;
            }
        }
        return out;
    }

    function applyBlur(src, w, h, r) {
        const dst = new Uint8Array(w * h);
        const win = r * 2 + 1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, count = 0;
                for (let dy = -r; dy <= r; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= h) continue;
                    for (let dx = -r; dx <= r; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= w) continue;
                        sum += src[ny * w + nx];
                        count++;
                    }
                }
                dst[y * w + x] = sum / count;
            }
        }
        return dst;
    }

    function applyMorphology(src, w, h, rad) {
        // Simple opening (erosion followed by dilation)
        const temp = new Uint8Array(w * h);
        const out = new Uint8Array(w * h);

        // Erosion
        for (let y = rad; y < h - rad; y++) {
            for (let x = rad; x < w - rad; x++) {
                let all255 = true;
                for (let dy = -rad; dy <= rad && all255; dy++) {
                    for (let dx = -rad; dx <= rad; dx++) {
                        if (src[(y + dy) * w + (x + dx)] === 0) {
                            all255 = false;
                            break;
                        }
                    }
                }
                temp[y * w + x] = all255 ? 255 : 0;
            }
        }

        // Dilation
        for (let y = rad; y < h - rad; y++) {
            for (let x = rad; x < w - rad; x++) {
                let any255 = false;
                for (let dy = -rad; dy <= rad && !any255; dy++) {
                    for (let dx = -rad; dx <= rad; dx++) {
                        if (temp[(y + dy) * w + (x + dx)] === 255) {
                            any255 = true;
                            break;
                        }
                    }
                }
                out[y * w + x] = any255 ? 255 : 0;
            }
        }
        return out;
    }

    function extractContours(bin, w, h) {
        const visited = new Uint8Array(w * h);
        const contours = [];

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (bin[idx] === 255 && visited[idx] === 0) {
                    const poly = traceBoundary(bin, visited, w, h, x, y);
                    if (poly && poly.length >= 4) {
                        contours.push({ outer: poly, holes: [] });
                    }
                }
            }
        }

        // Hole detection: Scan inverted space inside contours
        const filled = new Uint8Array(w * h);
        for (const c of contours) {
            fillPolyMask(filled, c.outer, w, h);
        }

        const holeVisited = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (bin[idx] === 0 && filled[idx] === 1 && holeVisited[idx] === 0) {
                    const holePoly = traceBoundaryInvert(bin, holeVisited, filled, w, h, x, y);
                    if (holePoly && holePoly.length >= 4) {
                        // Associate hole with matching parent contour
                        const rep = holePoly[0];
                        for (const c of contours) {
                            if (pointInPolygon(rep[0], rep[1], c.outer)) {
                                c.holes.push(holePoly);
                                break;
                            }
                        }
                    }
                }
            }
        }

        return contours;
    }

    function traceBoundary(bin, visited, w, h, startX, startY) {
        const poly = [];
        let currX = startX, currY = startY;
        const dx = [1, 1, 0, -1, -1, -1, 0, 1];
        const dy = [0, 1, 1, 1, 0, -1, -1, -1];
        let dir = 7;

        poly.push([currX, currY]);
        visited[currY * w + currX] = 1;

        let steps = 0;
        const maxSteps = 10000;

        while (steps++ < maxSteps) {
            let found = false;
            let checkDir = (dir + 5) % 8; // Turn 90 deg clockwise from entry

            for (let i = 0; i < 8; i++) {
                const nd = (checkDir + i) % 8;
                const nx = currX + dx[nd];
                const ny = currY + dy[nd];

                if (nx >= 0 && nx < w && ny >= 0 && ny < h && bin[ny * w + nx] === 255) {
                    currX = nx;
                    currY = ny;
                    dir = nd;
                    found = true;
                    visited[currY * w + currX] = 1;
                    poly.push([currX, currY]);
                    break;
                }
            }

            if (!found || (currX === startX && currY === startY)) break;
        }

        return poly;
    }

    function traceBoundaryInvert(bin, holeVisited, filled, w, h, startX, startY) {
        const poly = [];
        let currX = startX, currY = startY;
        const dx = [1, 1, 0, -1, -1, -1, 0, 1];
        const dy = [0, 1, 1, 1, 0, -1, -1, -1];
        let dir = 7;

        poly.push([currX, currY]);
        holeVisited[currY * w + currX] = 1;

        let steps = 0;
        while (steps++ < 6000) {
            let found = false;
            let checkDir = (dir + 5) % 8;
            for (let i = 0; i < 8; i++) {
                const nd = (checkDir + i) % 8;
                const nx = currX + dx[nd];
                const ny = currY + dy[nd];
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && bin[ny * w + nx] === 0 && filled[ny * w + nx] === 1) {
                    currX = nx;
                    currY = ny;
                    dir = nd;
                    found = true;
                    holeVisited[currY * w + currX] = 1;
                    poly.push([currX, currY]);
                    break;
                }
            }
            if (!found || (currX === startX && currY === startY)) break;
        }
        return poly;
    }

    function fillPolyMask(mask, poly, w, h) {
        let minX = w, maxX = 0, minY = h, maxY = 0;
        for (const p of poly) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        minX = Math.max(0, minX); maxX = Math.min(w - 1, maxX);
        minY = Math.max(0, minY); maxY = Math.min(h - 1, maxY);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (pointInPolygon(x, y, poly)) {
                    mask[y * w + x] = 1;
                }
            }
        }
    }

    function pointInPolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1];
            const xj = poly[j][0], yj = poly[j][1];
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function polygonArea(poly) {
        let area = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
        }
        return area / 2;
    }

    function simplifyPolygon(points, tol) {
        if (!points || points.length <= 4 || tol <= 0) return points;
        return douglasPeucker(points, 0, points.length - 1, tol);
    }

    function douglasPeucker(pts, first, last, tol) {
        let maxDist = 0;
        let index = 0;
        const p1 = pts[first], p2 = pts[last];

        for (let i = first + 1; i < last; i++) {
            const d = distToSegment(pts[i], p1, p2);
            if (d > maxDist) {
                maxDist = d;
                index = i;
            }
        }

        if (maxDist > tol) {
            const res1 = douglasPeucker(pts, first, index, tol);
            const res2 = douglasPeucker(pts, index, last, tol);
            return res1.slice(0, -1).concat(res2);
        } else {
            return [p1, p2];
        }
    }

    function distToSegment(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }

    function chaikinSmooth(pts, passes) {
        let res = pts;
        for (let p = 0; p < passes; p++) {
            const next = [];
            for (let i = 0; i < res.length; i++) {
                const p0 = res[i];
                const p1 = res[(i + 1) % res.length];
                next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
                next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
            }
            res = next;
        }
        return res;
    }

    return {
        traceImage: traceImage
    };
})();
