/**
 * Image Processor for CAD Vectorization & Feature Extraction
 * High-performance, noise-filtered, non-blocking contour extraction
 */

window.ImageProcessor = {
    // Load an image file or Data URL into an Image object
    loadImage(source) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error('Failed to load image'));
            if (typeof source === 'string') {
                img.src = source;
            } else if (source instanceof File || source instanceof Blob) {
                const reader = new FileReader();
                reader.onload = (e) => { img.src = e.target.result; };
                reader.onerror = reject;
                reader.readAsDataURL(source);
            } else {
                reject(new Error('Invalid image source'));
            }
        });
    },

    // Process image onto a canvas with specified options
    processCanvas(img, options = {}) {
        const {
            maxWidth = 500,
            maxHeight = 500,
            threshold = 128,
            autoThreshold = false,
            invert = false,
            blur = 0,
            removeShadows = false
        } = options;

        let width = img.width || img.videoWidth || 400;
        let height = img.height || img.videoHeight || 400;

        // Downscale for instant client-side vectorization (< 30ms)
        if (width > maxWidth || height > maxHeight) {
            const aspect = width / height;
            if (aspect > 1) {
                width = maxWidth;
                height = Math.round(maxWidth / aspect);
            } else {
                height = maxHeight;
                width = Math.round(maxHeight * aspect);
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        ctx.drawImage(img, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // 1. Convert to Grayscale
        const gray = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }

        // 2. Fast Separable 2-Pass Blur
        let workingGray = gray;
        if (blur > 0) {
            workingGray = this.applyFastBlur(gray, width, height, blur);
        }

        // 3. Determine threshold
        let effectiveThreshold = threshold;
        if (autoThreshold) {
            effectiveThreshold = this.calculateOtsu(workingGray);
        }

        // 4. Binary Threshold & Inversion
        const binary = new Uint8Array(width * height);
        for (let i = 0; i < workingGray.length; i++) {
            const val = workingGray[i];
            const isForeground = invert ? (val >= effectiveThreshold) : (val < effectiveThreshold);
            binary[i] = isForeground ? 255 : 0;
        }

        // 5. Update canvas display image
        for (let i = 0; i < binary.length; i++) {
            const c = binary[i] === 255 ? 255 : 0;
            data[i * 4] = c;
            data[i * 4 + 1] = c;
            data[i * 4 + 2] = c;
            data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);

        return {
            canvas,
            ctx,
            width,
            height,
            binary,
            gray: workingGray,
            effectiveThreshold
        };
    },

    // Otsu's binarization threshold calculation
    calculateOtsu(gray) {
        const hist = new Int32Array(256);
        for (let i = 0; i < gray.length; i++) {
            hist[gray[i]]++;
        }

        const total = gray.length;
        let sum = 0;
        for (let t = 0; t < 256; t++) sum += t * hist[t];

        let sumB = 0;
        let wB = 0;
        let wF = 0;
        let varMax = 0;
        let threshold = 128;

        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB === 0) continue;
            wF = total - wB;
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
    },

    // Auto-detect if image background is dark (< 110 avg border luminance)
    detectBackgroundDark(gray, width, height) {
        let borderSum = 0;
        let count = 0;
        for (let x = 0; x < width; x += 4) {
            borderSum += gray[x];
            borderSum += gray[(height - 1) * width + x];
            count += 2;
        }
        for (let y = 0; y < height; y += 4) {
            borderSum += gray[y * width];
            borderSum += gray[y * width + (width - 1)];
            count += 2;
        }
        return (borderSum / count) < 110;
    },

    // High-performance Separable 1D Box Blur (O(W*H), ~2ms execution time)
    applyFastBlur(src, w, h, radius) {
        const r = Math.max(1, Math.min(6, radius));
        const temp = new Uint8Array(src.length);
        const dst = new Uint8Array(src.length);

        // Horizontal Pass
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            let sum = 0;
            let count = 0;

            for (let x = -r; x <= r; x++) {
                const px = Math.max(0, Math.min(w - 1, x));
                sum += src[rowOffset + px];
                count++;
            }
            temp[rowOffset] = Math.round(sum / count);

            for (let x = 1; x < w; x++) {
                const removeX = Math.max(0, x - r - 1);
                const addX = Math.min(w - 1, x + r);
                sum += src[rowOffset + addX] - src[rowOffset + removeX];
                temp[rowOffset + x] = Math.round(sum / count);
            }
        }

        // Vertical Pass
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let count = 0;

            for (let y = -r; y <= r; y++) {
                const py = Math.max(0, Math.min(h - 1, y));
                sum += temp[py * w + x];
                count++;
            }
            dst[x] = Math.round(sum / count);

            for (let y = 1; y < h; y++) {
                const removeY = Math.max(0, y - r - 1);
                const addY = Math.min(h - 1, y + r);
                sum += temp[addY * w + x] - temp[removeY * w + x];
                dst[y * w + x] = Math.round(sum / count);
            }
        }

        return dst;
    },

    // Ultra-Fast Contour Extraction with Noise Suppression & Cap
    extractContours(binary, width, height, minLength = 12, minArea = 25) {
        const visited = new Uint8Array(width * height);
        const contours = [];

        const dx = [0, 1, 1, 1, 0, -1, -1, -1];
        const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;

                if (binary[idx] === 255 && !visited[idx]) {
                    const hasBgNeighbor = (
                        binary[idx - 1] === 0 ||
                        binary[idx + 1] === 0 ||
                        binary[idx - width] === 0 ||
                        binary[idx + width] === 0
                    );

                    if (hasBgNeighbor) {
                        const contourPoints = this.traceMooreBoundary(binary, visited, width, height, x, y, dx, dy);
                        if (contourPoints.length >= minLength) {
                            const area = Math.abs(this.polygonArea(contourPoints));
                            if (area >= minArea) {
                                contours.push({ points: contourPoints, area });
                            }
                        }
                    }
                }
            }
        }

        if (contours.length === 0) return [];

        // Sort by area descending (largest outer contours first)
        contours.sort((a, b) => b.area - a.area);

        // Cap to top 25 most significant contours to eliminate noisy speckles
        const capped = contours.slice(0, 25);

        const classified = capped.map(c => {
            const bbox = this.polygonBBox(c.points);
            return {
                points: c.points,
                area: c.area,
                bbox: bbox,
                isHole: false,
                parent: null
            };
        });

        // Fast O(N) hierarchy classification against primary outer boundary
        const outer = classified[0];
        const outerSimplified = this.simplifyDouglasPeucker(outer.points, 2.0);

        for (let i = 1; i < classified.length; i++) {
            const current = classified[i];
            // Check if BBox is strictly inside outer's BBox
            if (current.bbox.minX >= outer.bbox.minX &&
                current.bbox.maxX <= outer.bbox.maxX &&
                current.bbox.minY >= outer.bbox.minY &&
                current.bbox.maxY <= outer.bbox.maxY) {
                
                // Sample point test against simplified boundary
                if (this.pointInPolygon(current.points[0], outerSimplified)) {
                    current.isHole = true;
                    current.parent = outer;
                }
            }
        }

        return classified;
    },

    // Moore-Neighbor Tracing with step cap for safety
    traceMooreBoundary(binary, visited, width, height, startX, startY, dx, dy) {
        const points = [];
        let currX = startX;
        let currY = startY;
        let currIdx = startY * width + startX;

        points.push({ x: currX, y: currY });
        visited[currIdx] = 1;

        let backDir = 6;
        let dir = (backDir + 2) % 8;

        const maxSteps = 4000; // Cap to avoid infinite loops on noisy rasters
        let steps = 0;

        while (steps < maxSteps) {
            steps++;
            let foundNext = false;
            let checkDir = dir;

            for (let i = 0; i < 8; i++) {
                const nextDir = (checkDir + i) % 8;
                const nx = currX + dx[nextDir];
                const ny = currY + dy[nextDir];

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (binary[nIdx] === 255) {
                        currX = nx;
                        currY = ny;
                        currIdx = nIdx;
                        visited[currIdx] = 1;
                        points.push({ x: currX, y: currY });

                        backDir = (nextDir + 4) % 8;
                        dir = (backDir + 2) % 8;
                        foundNext = true;
                        break;
                    }
                }
            }

            if (!foundNext || (currX === startX && currY === startY)) {
                break;
            }
        }

        return points;
    },

    // Signed polygon area (shoelace formula)
    polygonArea(points) {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return area / 2;
    },

    polygonBBox(points) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
    },

    // Point-in-polygon ray-casting test
    pointInPolygon(point, polygon) {
        let inside = false;
        const n = polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    // Douglas-Peucker Simplification
    simplifyDouglasPeucker(points, epsilon = 1.5) {
        if (!points || points.length <= 2) return points || [];

        let maxDist = 0;
        let index = 0;
        const start = points[0];
        const end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const d = this.perpendicularDistance(points[i], start, end);
            if (d > maxDist) {
                index = i;
                maxDist = d;
            }
        }

        if (maxDist > epsilon) {
            const left = this.simplifyDouglasPeucker(points.slice(0, index + 1), epsilon);
            const right = this.simplifyDouglasPeucker(points.slice(index), epsilon);
            return left.slice(0, -1).concat(right);
        } else {
            return [start, end];
        }
    },

    perpendicularDistance(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const mag = Math.hypot(dx, dy);
        if (mag === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / mag;
    },

    detectMechanicalFeatures(contours, imgWidth, imgHeight) {
        if (!contours || contours.length === 0) {
            return {
                flangeOD: 100,
                boreID: 30,
                boltPCD: 70,
                boltCount: 4,
                boltDiameter: 10
            };
        }

        const outer = contours.find(c => !c.isHole) || contours[0];
        const holes = contours.filter(c => c.isHole);

        const outerWidth = outer.bbox.width;
        const outerHeight = outer.bbox.height;
        const estOD = Math.max(outerWidth, outerHeight);

        const centerX = (outer.bbox.minX + outer.bbox.maxX) / 2;
        const centerY = (outer.bbox.minY + outer.bbox.maxY) / 2;

        let centerBore = null;
        const boltHoles = [];

        holes.forEach(hole => {
            const hw = hole.bbox.width;
            const hh = hole.bbox.height;
            const hx = (hole.bbox.minX + hole.bbox.maxX) / 2;
            const hy = (hole.bbox.minY + hole.bbox.maxY) / 2;
            const distFromCenter = Math.hypot(hx - centerX, hy - centerY);
            const dia = (hw + hh) / 2;

            if (distFromCenter < estOD * 0.18) {
                if (!centerBore || dia > centerBore.dia) {
                    centerBore = { dia, x: hx, y: hy };
                }
            } else {
                boltHoles.push({ dia, x: hx, y: hy, dist: distFromCenter });
            }
        });

        let estPCD = estOD * 0.65;
        let estBoltCount = boltHoles.length > 0 ? boltHoles.length : 4;
        let estBoltDia = 10;

        if (boltHoles.length > 0) {
            const avgDist = boltHoles.reduce((acc, h) => acc + h.dist, 0) / boltHoles.length;
            estPCD = avgDist * 2;
            estBoltDia = boltHoles.reduce((acc, h) => acc + h.dia, 0) / boltHoles.length;
        }

        return {
            flangeOD: Math.round(estOD),
            boreID: centerBore ? Math.round(centerBore.dia) : Math.round(estOD * 0.3),
            boltPCD: Math.round(estPCD),
            boltCount: Math.min(16, Math.max(3, estBoltCount)),
            boltDiameter: Math.max(3, Math.round(estBoltDia))
        };
    },

    sampleHeightmap(gray, width, height, gridRes = 96, invert = false) {
        const grid = new Float32Array(gridRes * gridRes);
        const stepX = width / (gridRes - 1);
        const stepY = height / (gridRes - 1);

        for (let gy = 0; gy < gridRes; gy++) {
            const py = Math.min(height - 1, Math.round(gy * stepY));
            for (let gx = 0; gx < gridRes; gx++) {
                const px = Math.min(width - 1, Math.round(gx * stepX));
                const val = gray[py * width + px] / 255.0;
                grid[gy * gridRes + gx] = invert ? (1.0 - val) : val;
            }
        }

        return { grid, res: gridRes };
    }
};
