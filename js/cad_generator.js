/**
 * CAD Geometry Generator
 * Generates 3D CAD models from 2D contours, profiles, heightmaps, and mechanical parameters.
 */

window.CadGenerator = {
    // Helper for robust polygon orientation check
    checkIsClockwise(pts) {
        if (typeof THREE !== 'undefined' && THREE.ShapeUtils) {
            if (typeof THREE.ShapeUtils.isClockWise === 'function') {
                return THREE.ShapeUtils.isClockWise(pts);
            }
            if (typeof THREE.ShapeUtils.isClockwise === 'function') {
                return THREE.ShapeUtils.isClockwise(pts);
            }
        }
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        return (area / 2) < 0;
    },

    // Mode 1: Prismatic Extrusion supporting ALL parts and internal holes
    createExtrudedSolid(contours, options = {}) {
        const {
            depth = 15,
            bevelEnabled = false,
            bevelThickness = 1,
            bevelSize = 1,
            bevelSegments = 3,
            targetWidthMm = 100,
            originalWidth = 800,
            originalHeight = 800,
            epsilon = 1.5,
            centerAtOrigin = true,
            extrusionNormal = 'z' // 'z' (Normal to Section Plane), 'y' (Normal to Ground), 'x' (Normal to Profile)
        } = options;

        if (!contours || contours.length === 0) {
            throw new Error('No valid contours found to extrude');
        }

        // 0. Apply CATIA-Grade Geometric Regularization (true lines, circular holes, 45° chamfers)
        let workingContours = contours;
        if (typeof window !== 'undefined' && window.ImageProcessor && typeof window.ImageProcessor.regularizeContours === 'function') {
            try {
                workingContours = window.ImageProcessor.regularizeContours(contours, epsilon);
            } catch (errReg) {
                console.warn('Contour regularization fallback:', errReg);
            }
        }

        // 1. Separate all outer contours (individual parts/components) and holes
        let outerContours = workingContours.filter(c => !c.isHole && c.area >= 40);
        if (outerContours.length === 0) {
            outerContours = [workingContours[0]];
        }
        const holes = workingContours.filter(c => c.isHole && c.area >= 20);

        // 2. Global bounding box across all outer parts for consistent scaling & positioning
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        outerContours.forEach(oc => {
            minX = Math.min(minX, oc.bbox.minX);
            maxX = Math.max(maxX, oc.bbox.maxX);
            minY = Math.min(minY, oc.bbox.minY);
            maxY = Math.max(maxY, oc.bbox.maxY);
        });

        const totalWidthPx = Math.max(1, maxX - minX);
        const totalHeightPx = Math.max(1, maxY - minY);
        const scale = targetWidthMm / totalWidthPx;

        // Centering offset
        const offsetX = centerAtOrigin ? (minX + maxX) / 2 : 0;
        const offsetY = centerAtOrigin ? (minY + maxY) / 2 : 0;

        // Extrude settings
        const extrudeSettings = {
            steps: 1,
            depth: Math.max(0.5, depth),
            bevelEnabled: Boolean(bevelEnabled),
            bevelThickness: Math.min(depth * 0.4, bevelThickness),
            bevelSize: bevelSize,
            bevelOffset: 0,
            bevelSegments: Math.max(1, bevelSegments)
        };

        const partGeometries = [];
        const simplify = (pts, eps) => (typeof window !== 'undefined' && window.ImageProcessor && window.ImageProcessor.simplifyPointPreserving)
            ? window.ImageProcessor.simplifyPointPreserving(pts, 13.5, Math.min(0.55, eps * 0.35))
            : (typeof window !== 'undefined' && window.ImageProcessor && window.ImageProcessor.simplifyDouglasPeucker)
                ? window.ImageProcessor.simplifyDouglasPeucker(pts, eps)
                : pts;

        // 3. Extrude EVERY detected outer contour into a solid part
        outerContours.forEach((outerContour) => {
            try {
                const simplifiedOuter = simplify(outerContour.points, epsilon);
                if (simplifiedOuter.length < 3) return;

                let outerPoints2D = simplifiedOuter.map(pt => ({
                    x: (pt.x - offsetX) * scale,
                    y: -(pt.y - offsetY) * scale
                }));

                // In Three.js, outer boundary must be Counter-Clockwise (CCW)
                if (this.checkIsClockwise(outerPoints2D)) {
                    outerPoints2D.reverse();
                }

                const shape = new THREE.Shape();
                shape.moveTo(outerPoints2D[0].x, outerPoints2D[0].y);
                for (let i = 1; i < outerPoints2D.length; i++) {
                    shape.lineTo(outerPoints2D[i].x, outerPoints2D[i].y);
                }
                shape.closePath();

                // Find holes belonging to this specific outer contour
                const partHoles = holes.filter(h => {
                    if (h.parent === outerContour) return true;
                    return (
                        h.bbox.minX >= outerContour.bbox.minX - 2 &&
                        h.bbox.maxX <= outerContour.bbox.maxX + 2 &&
                        h.bbox.minY >= outerContour.bbox.minY - 2 &&
                        h.bbox.maxY <= outerContour.bbox.maxY + 2
                    );
                }).sort((a, b) => b.area - a.area).slice(0, 28);

                partHoles.forEach(hole => {
                    try {
                        // High-Accuracy Parametric Circle Hole Reconstruction
                        if (hole.isParametricCircle && hole.circleCenter && hole.circleRadius) {
                            const hcx = (hole.circleCenter.x - offsetX) * scale;
                            const hcy = -(hole.circleCenter.y - offsetY) * scale;
                            const hr = hole.circleRadius * scale;
                            const holePath = new THREE.Path();
                            // In Three.js, holes in Shape must be clockwise. absarc(x,y,r,sAngle,eAngle,clockwise)
                            holePath.absarc(hcx, hcy, hr, 0, Math.PI * 2, true);
                            shape.holes.push(holePath);
                            return;
                        }

                        const simplifiedHole = simplify(hole.points, Math.max(1.0, epsilon));
                        if (simplifiedHole.length >= 3) {
                            let holePoints2D = simplifiedHole.map(pt => ({
                                x: (pt.x - offsetX) * scale,
                                y: -(pt.y - offsetY) * scale
                            }));

                            // In Three.js, holes must be Clockwise (CW)
                            if (!this.checkIsClockwise(holePoints2D)) {
                                holePoints2D.reverse();
                            }

                            const holePath = new THREE.Path();
                            holePath.moveTo(holePoints2D[0].x, holePoints2D[0].y);
                            for (let i = 1; i < holePoints2D.length; i++) {
                                holePath.lineTo(holePoints2D[i].x, holePoints2D[i].y);
                            }
                            holePath.closePath();
                            shape.holes.push(holePath);
                        }
                    } catch (errHole) {
                        console.warn('Skipped problematic hole:', errHole);
                    }
                });

                let geom;
                try {
                    geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                } catch (errExtrude) {
                    console.warn('Extrude with holes failed, attempting outer shape only:', errExtrude);
                    try {
                        shape.holes = [];
                        geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                    } catch (errExtrudeOuter) {
                        const pw = Math.max(2, outerContour.bbox.width * scale);
                        const ph = Math.max(2, outerContour.bbox.height * scale);
                        geom = new THREE.BoxGeometry(pw, ph, depth);
                        const cx = ((outerContour.bbox.minX + outerContour.bbox.maxX) / 2 - offsetX) * scale;
                        const cy = -((outerContour.bbox.minY + outerContour.bbox.maxY) / 2 - offsetY) * scale;
                        geom.translate(cx, cy, depth / 2);
                    }
                }

                if (geom) {
                    partGeometries.push(geom);
                }
            } catch (errPart) {
                console.warn('Skipped part contour:', errPart);
            }
        });

        if (partGeometries.length === 0) {
            // Absolute emergency fallback: box with total dimensions
            const fb = new THREE.BoxGeometry(totalWidthPx * scale, totalHeightPx * scale, depth);
            partGeometries.push(fb);
        }

        // 4. Merge all parts into a unified CAD solid geometry
        let finalGeometry;
        if (partGeometries.length === 1) {
            finalGeometry = partGeometries[0];
        } else {
            finalGeometry = this.mergeGeometries(partGeometries);
        }

        // Apply Extrusion Normal Direction (Strictly normal to selected engineering plane)
        let dimW = totalWidthPx * scale;
        let dimH = totalHeightPx * scale;
        let dimD = depth + (bevelEnabled ? extrudeSettings.bevelThickness * 2 : 0);

        if (extrusionNormal === 'y') {
            // Extruded vertically normal to ground plane (XZ plane)
            finalGeometry.rotateX(-Math.PI / 2);
            const temp = dimH;
            dimH = dimD;
            dimD = temp;
        } else if (extrusionNormal === 'x') {
            // Extruded horizontally normal to cross-section (YZ plane)
            finalGeometry.rotateY(Math.PI / 2);
            const temp = dimW;
            dimW = dimD;
            dimD = temp;
        }

        finalGeometry.computeVertexNormals();

        return {
            geometry: finalGeometry,
            dimensions: {
                width: dimW,
                height: dimH,
                depth: dimD
            },
            scaleMmPerPx: scale,
            partCount: partGeometries.length
        };
    },

    // Mode 2: Rotational / Lathe CAD (Revolve half-profile around axis)
    createRevolvedSolid(contours, options = {}) {
        const {
            targetHeightMm = 80,
            targetRadiusMm = 40,
            revolveAngleDeg = 360,
            radialSegments = 48,
            hollow = false,
            wallThickness = 4,
            originalWidth = 800,
            originalHeight = 800,
            epsilon = 2.0
        } = options;

        if (!contours || contours.length === 0) {
            throw new Error('No contours found for revolve');
        }

        const outer = contours.find(c => !c.isHole) || contours[0];
        const bbox = outer.bbox;
        const centerX = (bbox.minX + bbox.maxX) / 2;

        // Simplify points
        const simplified = window.ImageProcessor.simplifyDouglasPeucker(outer.points, epsilon);

        // Extract right-side profile (x >= centerX)
        // Group points by Y and find max X at each Y
        const heightPx = Math.max(1, bbox.height);
        const scaleZ = targetHeightMm / heightPx;
        const scaleR = targetRadiusMm / Math.max(1, bbox.maxX - centerX);

        // Sort profile points along height (Z axis)
        const profileMap = new Map();
        simplified.forEach(pt => {
            const relY = pt.y - bbox.minY; // 0 to heightPx
            const radiusPx = Math.max(0, pt.x - centerX);
            const key = Math.round(relY);
            if (!profileMap.has(key) || radiusPx > profileMap.get(key)) {
                profileMap.set(key, radiusPx);
            }
        });

        // Convert sorted keys to Vector2 points for Lathe (x = radius, y = height)
        const sortedY = Array.from(profileMap.keys()).sort((a, b) => a - b);
        let lathePoints = [];

        // Base center point if solid
        if (!hollow && sortedY.length > 0) {
            lathePoints.push(new THREE.Vector2(0, 0));
        }

        sortedY.forEach(yKey => {
            const rPx = profileMap.get(yKey);
            const rMm = Math.max(hollow ? wallThickness : 0.5, rPx * scaleR);
            const zMm = yKey * scaleZ;
            lathePoints.push(new THREE.Vector2(rMm, zMm));
        });

        // Top center point if solid
        if (!hollow && sortedY.length > 0) {
            const topZ = sortedY[sortedY.length - 1] * scaleZ;
            lathePoints.push(new THREE.Vector2(0, topZ));
        }

        if (lathePoints.length < 3) {
            // Fallback simple stepped cylinder
            lathePoints = [
                new THREE.Vector2(0, 0),
                new THREE.Vector2(targetRadiusMm, 0),
                new THREE.Vector2(targetRadiusMm, targetHeightMm * 0.4),
                new THREE.Vector2(targetRadiusMm * 0.6, targetHeightMm * 0.4),
                new THREE.Vector2(targetRadiusMm * 0.6, targetHeightMm),
                new THREE.Vector2(0, targetHeightMm)
            ];
        }

        const phiLength = (revolveAngleDeg * Math.PI) / 180;
        const geometry = new THREE.LatheGeometry(lathePoints, radialSegments, 0, phiLength);
        geometry.computeVertexNormals();

        return {
            geometry,
            dimensions: {
                width: targetRadiusMm * 2,
                height: targetRadiusMm * 2,
                depth: targetHeightMm
            },
            profilePoints: lathePoints
        };
    },

    // Mode 3: 3D Bas-Relief / Heightmap Solid (Watertight CNC / 3D Print Block)
    createHeightmapSolid(heightmapData, options = {}) {
        const {
            widthMm = 100,
            heightMm = 100,
            reliefDepthMm = 8,
            baseThicknessMm = 5,
            smooth = true
        } = options;

        const { grid, res } = heightmapData;
        const N = res;

        // Vertices, Normals, Indices
        // Top surface: N * N vertices
        // Bottom surface: N * N vertices (flat at z = -baseThicknessMm)
        // 4 side walls connecting top border to bottom border
        const numTopVerts = N * N;
        const totalVerts = numTopVerts * 2;

        const positions = new Float32Array(totalVerts * 3);
        const indices = [];

        const dx = widthMm / (N - 1);
        const dy = heightMm / (N - 1);
        const halfW = widthMm / 2;
        const halfH = heightMm / 2;

        // 1. Populate Top Surface Vertices (0 to numTopVerts - 1)
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const idx = y * N + x;
                const vx = x * dx - halfW;
                const vy = -(y * dy - halfH);
                const vz = grid[idx] * reliefDepthMm;

                positions[idx * 3] = vx;
                positions[idx * 3 + 1] = vy;
                positions[idx * 3 + 2] = vz;
            }
        }

        // 2. Populate Bottom Surface Vertices (numTopVerts to totalVerts - 1)
        const botZ = -baseThicknessMm;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const topIdx = y * N + x;
                const botIdx = numTopVerts + topIdx;
                const vx = x * dx - halfW;
                const vy = -(y * dy - halfH);

                positions[botIdx * 3] = vx;
                positions[botIdx * 3 + 1] = vy;
                positions[botIdx * 3 + 2] = botZ;
            }
        }

        // 3. Triangulate Top Surface
        for (let y = 0; y < N - 1; y++) {
            for (let x = 0; x < N - 1; x++) {
                const i00 = y * N + x;
                const i10 = y * N + (x + 1);
                const i01 = (y + 1) * N + x;
                const i11 = (y + 1) * N + (x + 1);

                indices.push(i00, i01, i10);
                indices.push(i10, i01, i11);
            }
        }

        // 4. Triangulate Bottom Surface (wound counter-clockwise facing downwards)
        for (let y = 0; y < N - 1; y++) {
            for (let x = 0; x < N - 1; x++) {
                const i00 = numTopVerts + (y * N + x);
                const i10 = numTopVerts + (y * N + (x + 1));
                const i01 = numTopVerts + ((y + 1) * N + x);
                const i11 = numTopVerts + ((y + 1) * N + (x + 1));

                indices.push(i00, i10, i01);
                indices.push(i10, i11, i01);
            }
        }

        // 5. Triangulate 4 Side Walls
        // North Wall (y = 0)
        for (let x = 0; x < N - 1; x++) {
            const t0 = x;
            const t1 = x + 1;
            const b0 = numTopVerts + t0;
            const b1 = numTopVerts + t1;
            indices.push(t0, t1, b0);
            indices.push(t1, b1, b0);
        }

        // South Wall (y = N - 1)
        for (let x = 0; x < N - 1; x++) {
            const t0 = (N - 1) * N + x;
            const t1 = (N - 1) * N + (x + 1);
            const b0 = numTopVerts + t0;
            const b1 = numTopVerts + t1;
            indices.push(t0, b0, t1);
            indices.push(t1, b0, b1);
        }

        // West Wall (x = 0)
        for (let y = 0; y < N - 1; y++) {
            const t0 = y * N;
            const t1 = (y + 1) * N;
            const b0 = numTopVerts + t0;
            const b1 = numTopVerts + t1;
            indices.push(t0, b0, t1);
            indices.push(t1, b0, b1);
        }

        // East Wall (x = N - 1)
        for (let y = 0; y < N - 1; y++) {
            const t0 = y * N + (N - 1);
            const t1 = (y + 1) * N + (N - 1);
            const b0 = numTopVerts + t0;
            const b1 = numTopVerts + t1;
            indices.push(t0, t1, b0);
            indices.push(t1, b1, b0);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return {
            geometry,
            dimensions: {
                width: widthMm,
                height: heightMm,
                depth: reliefDepthMm + baseThicknessMm
            }
        };
    },

    // Mode 4: Exact Parametric Mechanical Part (Flange / Bracket / Gear / Spacer)
    createParametricFlange(params = {}) {
        const {
            flangeOD = 120,          // Outer Diameter (mm)
            boreID = 35,             // Inner Bore (mm)
            flangeThickness = 12,    // Flange Base Thickness (mm)
            bossOD = 65,             // Raised Hub Diameter (mm)
            bossHeight = 25,         // Raised Hub Total Height (mm)
            boltPCD = 90,            // Bolt Pitch Circle Diameter (mm)
            boltCount = 4,           // Number of Bolt Holes
            boltDiameter = 12,       // Diameter of each bolt hole (mm)
            hasKeyway = true,        // Shaft Keyway slot
            keywayWidth = 8,
            keywayDepth = 4,
            segments = 64
        } = params;

        // Build outer flange shape with holes
        const flangeShape = new THREE.Shape();
        flangeShape.absarc(0, 0, flangeOD / 2, 0, Math.PI * 2, false);

        // Center Bore Hole with optional keyway
        const boreRadius = boreID / 2;
        const borePath = new THREE.Path();

        if (hasKeyway) {
            const halfKw = keywayWidth / 2;
            const kwTop = boreRadius + keywayDepth;
            const startAngle = Math.asin(halfKw / boreRadius);

            borePath.moveTo(halfKw, Math.cos(startAngle) * boreRadius);
            borePath.lineTo(halfKw, kwTop);
            borePath.lineTo(-halfKw, kwTop);
            borePath.lineTo(-halfKw, Math.cos(startAngle) * boreRadius);
            borePath.absarc(0, 0, boreRadius, Math.PI - startAngle, Math.PI * 2 + startAngle, false);
            borePath.closePath();
        } else {
            borePath.absarc(0, 0, boreRadius, 0, Math.PI * 2, true);
        }
        flangeShape.holes.push(borePath);

        // Bolt Holes on PCD
        const boltRadius = boltDiameter / 2;
        const pcdRadius = boltPCD / 2;

        for (let i = 0; i < boltCount; i++) {
            const angle = (i * 2 * Math.PI) / boltCount;
            const bx = Math.cos(angle) * pcdRadius;
            const by = Math.sin(angle) * pcdRadius;

            const boltHole = new THREE.Path();
            boltHole.absarc(bx, by, boltRadius, 0, Math.PI * 2, true);
            flangeShape.holes.push(boltHole);
        }

        // Extrude Flange Base
        const flangeExtrude = new THREE.ExtrudeGeometry(flangeShape, {
            steps: 1,
            depth: flangeThickness,
            bevelEnabled: true,
            bevelThickness: 0.8,
            bevelSize: 0.8,
            bevelSegments: 2,
            curveSegments: segments
        });

        // If there is a raised Boss / Hub:
        let finalGeometry = flangeExtrude;
        if (bossHeight > flangeThickness && bossOD > boreID) {
            const bossShape = new THREE.Shape();
            bossShape.absarc(0, 0, bossOD / 2, 0, Math.PI * 2, false);

            // Add center bore through boss
            const bossBore = new THREE.Path();
            if (hasKeyway) {
                const halfKw = keywayWidth / 2;
                const kwTop = boreRadius + keywayDepth;
                const startAngle = Math.asin(halfKw / boreRadius);
                bossBore.moveTo(halfKw, Math.cos(startAngle) * boreRadius);
                bossBore.lineTo(halfKw, kwTop);
                bossBore.lineTo(-halfKw, kwTop);
                bossBore.lineTo(-halfKw, Math.cos(startAngle) * boreRadius);
                bossBore.absarc(0, 0, boreRadius, Math.PI - startAngle, Math.PI * 2 + startAngle, false);
                bossBore.closePath();
            } else {
                bossBore.absarc(0, 0, boreRadius, 0, Math.PI * 2, true);
            }
            bossShape.holes.push(bossBore);

            const bossExtrude = new THREE.ExtrudeGeometry(bossShape, {
                steps: 1,
                depth: bossHeight - flangeThickness,
                bevelEnabled: true,
                bevelThickness: 0.8,
                bevelSize: 0.8,
                bevelSegments: 2,
                curveSegments: segments
            });
            bossExtrude.translate(0, 0, flangeThickness);

            // Merge flange and boss geometries into one solid BufferGeometry
            finalGeometry = this.mergeGeometries([flangeExtrude, bossExtrude]);
        }

        finalGeometry.computeVertexNormals();

        return {
            geometry: finalGeometry,
            dimensions: {
                width: flangeOD,
                height: flangeOD,
                depth: Math.max(flangeThickness, bossHeight)
            }
        };
    },

    // Mode 5 Helper: Cylindrical Press-Brake Bend Sector
    makeCurvedBend(length, innerR, thickness, arcStart, arcEnd, segments = 16) {
        const rIn = Math.max(0.4, innerR);
        const rOut = rIn + thickness;
        const shape = new THREE.Shape();
        shape.absarc(0, 0, rOut, arcStart, arcEnd, false);
        shape.lineTo(rIn * Math.cos(arcEnd), rIn * Math.sin(arcEnd));
        shape.absarc(0, 0, rIn, arcEnd, arcStart, true);
        shape.closePath();

        const geom = new THREE.ExtrudeGeometry(shape, {
            steps: 1,
            depth: length,
            bevelEnabled: false,
            curveSegments: segments
        });
        return geom;
    },

    // Mode 5A: Formed L-Mount Bracket with Large Central Motor Bore & 90° Flanges
    // (Matches user upload media_1791279263846 with CATIA-grade formed bends and detailed ends)
    createFormedMotorBracket(params = {}) {
        const {
            thickness = 2.0,       // Sheet metal gauge (mm)
            width = 110,           // Base upright plate width (mm)
            height = 100,          // Base upright plate height (mm)
            baseLength = 52,       // Bottom base flange depth (mm)
            topTabLength = 26,     // Top rear bent tab length (mm)
            topTabWidth = 48,      // Top bent tab width (mm)
            boreDia = 36,          // Center motor/bearing clearance bore (mm)
            holeDia = 6.5,         // Standard mounting hole diameter (mm)
            bendRadius = 2.0,      // Press-brake inner bend radius (mm)
            cornerFillet = 6.0,    // Corner rounding radius (mm)
            hasWaistCutouts = true,// Side waist clearance cutouts
            isFlat = false         // If true, generate unfolded sheet blank for laser cutting
        } = params;

        const geoms = [];
        const t = Math.max(0.8, thickness);
        const rIn = Math.max(0.5, bendRadius);
        const rOut = rIn + t;
        const rHole = holeDia / 2;
        const rBore = boreDia / 2;

        const makePlate = (shape, depth, rotX = 0, rotY = 0, rotZ = 0, tx = 0, ty = 0, tz = 0) => {
            const geom = new THREE.ExtrudeGeometry(shape, {
                steps: 1,
                depth: depth,
                bevelEnabled: true,
                bevelThickness: 0.18,
                bevelSize: 0.18,
                bevelSegments: 1,
                curveSegments: 24
            });
            if (rotX) geom.rotateX(rotX);
            if (rotY) geom.rotateY(rotY);
            if (rotZ) geom.rotateZ(rotZ);
            if (tx || ty || tz) geom.translate(tx, ty, tz);
            return geom;
        };

        const addHole = (s, x, y, r) => {
            const h = new THREE.Path();
            h.absarc(x, y, r, 0, Math.PI * 2, true);
            s.holes.push(h);
        };

        if (isFlat) {
            // UNFOLDED 2D FLAT PATTERN (CATIA Laser-cut Blank)
            const blank = new THREE.Shape();
            const ba = (Math.PI / 2) * (rIn + 0.44 * t); // Bend allowance
            const totalH = height + baseLength + topTabLength + ba * 2;
            const tabStartX = (width - topTabWidth) / 2;

            // Trace outer perimeter of unfolded blank
            blank.moveTo(cornerFillet, -baseLength - ba);
            blank.lineTo(width - cornerFillet, -baseLength - ba);
            blank.absarc(width - cornerFillet, -baseLength - ba + cornerFillet, cornerFillet, -Math.PI / 2, 0, false);
            blank.lineTo(width, 0);
            blank.lineTo(width, height);
            blank.lineTo(tabStartX + topTabWidth, height);
            blank.lineTo(tabStartX + topTabWidth, height + topTabLength + ba - 4);
            blank.absarc(tabStartX + topTabWidth - 4, height + topTabLength + ba - 4, 4, 0, Math.PI / 2, false);
            blank.lineTo(tabStartX + 4, height + topTabLength + ba);
            blank.absarc(tabStartX + 4, height + topTabLength + ba - 4, 4, Math.PI / 2, Math.PI, false);
            blank.lineTo(tabStartX, height);
            blank.lineTo(0, height);
            blank.lineTo(0, 0);
            blank.lineTo(0, -baseLength - ba + cornerFillet);
            blank.absarc(cornerFillet, -baseLength - ba + cornerFillet, cornerFillet, Math.PI, 1.5 * Math.PI, false);
            blank.closePath();

            // Center motor bore
            addHole(blank, width / 2, height * 0.52, rBore);

            // Upright mounting holes
            addHole(blank, 16, height - 16, rHole);
            addHole(blank, width - 16, height - 16, rHole);

            // Base flange mounting holes
            addHole(blank, 24, -baseLength * 0.55 - ba, rHole);
            addHole(blank, width - 24, -baseLength * 0.55 - ba, rHole);

            const flatGeom = new THREE.ExtrudeGeometry(blank, { steps: 1, depth: t, bevelEnabled: false, curveSegments: 32 });
            flatGeom.computeVertexNormals();

            return {
                geometry: flatGeom,
                dimensions: { width, height: totalH, depth: t },
                isFlat: true,
                partName: 'FORMED L-MOUNT BRACKET (FLAT BLANK)'
            };
        }

        // 3D FOLDED SOLID MODEL (CATIA Sheet Metal with formed cylindrical bends)

        // 1. Main Upright Web
        const webH = height - rOut * 2;
        const web = new THREE.Shape();
        web.moveTo(0, 0);
        web.lineTo(width, 0);
        // Right side waist cutout if enabled
        if (hasWaistCutouts) {
            const cutY = webH * 0.38;
            web.lineTo(width, cutY);
            web.absarc(width, cutY + 10, 8, -Math.PI / 2, Math.PI / 2, true); // Inward notch
            web.lineTo(width, webH - cornerFillet);
        } else {
            web.lineTo(width, webH - cornerFillet);
        }
        // Top-right corner fillet
        web.absarc(width - cornerFillet, webH - cornerFillet, cornerFillet, 0, Math.PI / 2, false);
        // Top-left corner fillet
        web.lineTo(cornerFillet, webH);
        web.absarc(cornerFillet, webH - cornerFillet, cornerFillet, Math.PI / 2, Math.PI, false);
        // Left side waist cutout if enabled
        if (hasWaistCutouts) {
            const cutY = webH * 0.38;
            web.lineTo(0, cutY + 20);
            web.absarc(0, cutY + 10, 8, Math.PI / 2, -Math.PI / 2, true); // Inward notch
            web.lineTo(0, 0);
        } else {
            web.lineTo(0, 0);
        }
        web.closePath();

        // Add large central motor/clearance bore
        addHole(web, width / 2, webH * 0.48, rBore);

        // Add top-left and top-right precision mounting holes
        addHole(web, 16, webH - 14, rHole);
        addHole(web, width - 16, webH - 14, rHole);

        // Extrude vertical plate (located at y = rOut, z in [0, t])
        geoms.push(makePlate(web, t, 0, 0, 0, 0, rOut, 0));

        // 2. Bottom 90° Cylindrical Press-Brake Bend (connecting Web to Forward Base Flange)
        // Curves smoothly from (y = rOut, z in [0, t]) to (y in [0, t], z = rOut)
        const bottomBend = this.makeCurvedBend(width, rIn, t, Math.PI, 1.5 * Math.PI, 20);
        bottomBend.rotateY(Math.PI / 2);
        bottomBend.translate(0, rOut, rOut);
        geoms.push(bottomBend);

        // 3. Horizontal Base Flange (extends forward in +Z)
        const baseFlangeLen = baseLength - rOut;
        const flange = new THREE.Shape();
        flange.moveTo(0, 0);
        flange.lineTo(width, 0);
        // Front-right corner fillet
        flange.lineTo(width, baseFlangeLen - cornerFillet - 2);
        flange.absarc(width - (cornerFillet + 2), baseFlangeLen - (cornerFillet + 2), cornerFillet + 2, 0, Math.PI / 2, false);
        // Front-left corner fillet
        flange.lineTo(cornerFillet + 2, baseFlangeLen);
        flange.absarc(cornerFillet + 2, baseFlangeLen - (cornerFillet + 2), cornerFillet + 2, Math.PI / 2, Math.PI, false);
        flange.closePath();

        // 2 Precision mounting holes on bottom base flange
        addHole(flange, 22, baseFlangeLen * 0.58, rHole);
        addHole(flange, width - 22, baseFlangeLen * 0.58, rHole);

        // Plate in XZ plane: rotateX(-PI/2), translate to (0, 0, rOut)
        geoms.push(makePlate(flange, t, -Math.PI / 2, 0, 0, 0, 0, rOut));

        // 4. Top 90° Cylindrical Press-Brake Bend (connecting Web to Rear Top Tab)
        // Tab width is centered
        const tabX = (width - topTabWidth) / 2;
        const topBend = this.makeCurvedBend(topTabWidth, rIn, t, 0.5 * Math.PI, Math.PI, 20);
        topBend.rotateY(Math.PI / 2);
        topBend.translate(tabX, height - rOut, 0);
        geoms.push(topBend);

        // 5. Top Rear Bent Tab (extends backward in -Z)
        const tabLen = topTabLength - rOut;
        const tab = new THREE.Shape();
        tab.moveTo(0, 0);
        tab.lineTo(topTabWidth, 0);
        // Rear-right corner fillet
        tab.lineTo(topTabWidth, tabLen - 4);
        tab.absarc(topTabWidth - 4, tabLen - 4, 4, 0, Math.PI / 2, false);
        // Center cable notch
        tab.lineTo(topTabWidth / 2 + 8, tabLen);
        tab.lineTo(topTabWidth / 2 + 8, tabLen - 7);
        tab.lineTo(topTabWidth / 2 - 8, tabLen - 7);
        tab.lineTo(topTabWidth / 2 - 8, tabLen);
        // Rear-left corner fillet
        tab.lineTo(4, tabLen);
        tab.absarc(4, tabLen - 4, 4, Math.PI / 2, Math.PI, false);
        tab.closePath();

        // Extrude and orient backward: rotateX(PI/2), translate
        geoms.push(makePlate(tab, t, Math.PI / 2, 0, 0, tabX, height, 0));

        // Merge all components into watertight BufferGeometry
        const mergedGeometry = this.mergeGeometries(geoms);
        mergedGeometry.computeVertexNormals();

        return {
            geometry: mergedGeometry,
            dimensions: {
                width: width,
                height: height,
                depth: baseLength + topTabLength
            },
            isFlat: false,
            partName: 'FORMED L-MOUNT BRACKET'
        };
    },

    // Mode 5B: Folded Sheet Metal Chassis Bracket (Matches user photo & 4 highlighted features)
    createSheetMetalBracket(params = {}) {
        const {
            thickness = 1.8,       // Sheet metal gauge (mm)
            width = 115,           // Base plate width (mm)
            height = 105,          // Base plate height (mm)
            sideDepth = 52,        // Right bent channel / sidewall depth (mm)
            notchWidth = 34,       // Center clearance notch width (mm)
            notchHeight = 60,      // Center clearance notch height (mm)
            notchX = 36,           // Notch start position from left (mm)
            holeDia = 6.5,         // Standard mounting hole diameter (mm)
            bendRadius = 1.8,      // Inner bend radius (mm)
            hasGusset = true,      // Triangular stiffener gusset
            hasTabs = true,        // Small upright bent tabs
            isFlat = false         // If true, generate flat blank
        } = params;

        const geoms = [];
        const t = Math.max(0.8, thickness);
        const rIn = Math.max(0.4, bendRadius);
        const rOut = rIn + t;
        const rHole = holeDia / 2;

        const makePlate = (shape, depth, rotX = 0, rotY = 0, rotZ = 0, tx = 0, ty = 0, tz = 0) => {
            const geom = new THREE.ExtrudeGeometry(shape, {
                steps: 1,
                depth: depth,
                bevelEnabled: true,
                bevelThickness: 0.18,
                bevelSize: 0.18,
                bevelSegments: 1,
                curveSegments: 24
            });
            if (rotX) geom.rotateX(rotX);
            if (rotY) geom.rotateY(rotY);
            if (rotZ) geom.rotateZ(rotZ);
            if (tx || ty || tz) geom.translate(tx, ty, tz);
            return geom;
        };

        const addHole = (s, x, y, r) => {
            const h = new THREE.Path();
            h.absarc(x, y, r, 0, Math.PI * 2, true);
            s.holes.push(h);
        };

        if (isFlat) {
            // UNFOLDED FLAT PATTERN FOR CHASSIS BRACKET
            const blank = new THREE.Shape();
            const footLen = params.bottomFootLength || 54;
            const topTab = params.topTabLength || 42;

            blank.moveTo(0, -footLen);
            blank.lineTo(notchX, -footLen);
            blank.lineTo(notchX, 0);
            blank.lineTo(notchX + notchWidth, 0);
            blank.lineTo(notchX + notchWidth, -sideDepth);
            blank.lineTo(width, -sideDepth);
            blank.lineTo(width + sideDepth, -sideDepth);
            blank.lineTo(width + sideDepth, height);
            blank.lineTo(width, height + sideDepth);
            blank.lineTo(notchX + notchWidth, height);
            blank.lineTo(notchX, height);
            blank.lineTo(notchX, height + topTab);
            blank.lineTo(0, height + topTab);
            blank.lineTo(0, 0);
            blank.closePath();

            // Precision holes
            addHole(blank, 14, height - 16, rHole);
            addHole(blank, notchX + notchWidth + 14, height - 14, rHole * 1.15);
            addHole(blank, 16, 26, rHole);
            addHole(blank, notchX + notchWidth + 10, 34, rHole);

            const flatGeom = new THREE.ExtrudeGeometry(blank, { steps: 1, depth: t, bevelEnabled: false, curveSegments: 32 });
            flatGeom.computeVertexNormals();

            return {
                geometry: flatGeom,
                dimensions: { width: width + sideDepth, height: height + footLen + topTab, depth: t },
                isFlat: true,
                partName: 'CHASSIS BRACKET (FLAT PATTERN)'
            };
        }

        // 1. Main Vertical Backplate with Inverted U-Notch & Mounting Holes
        const bp = new THREE.Shape();
        bp.moveTo(0, 0);
        bp.lineTo(width, 0);
        bp.lineTo(width, height);
        bp.lineTo(0, height);
        bp.closePath();

        // Center inverted U-notch
        const notchPath = new THREE.Path();
        notchPath.moveTo(notchX, 0);
        notchPath.lineTo(notchX + notchWidth, 0);
        notchPath.lineTo(notchX + notchWidth, notchHeight);
        notchPath.lineTo(notchX, notchHeight);
        notchPath.closePath();
        bp.holes.push(notchPath);

        // Precision mounting holes on backplate
        addHole(bp, 14, height - 16, rHole);                       // Top-left mounting hole
        addHole(bp, notchX + notchWidth + 14, height - 14, rHole * 1.15); // Top-center-right hole
        addHole(bp, 16, 26, rHole);                                // Lower-left leg hole
        addHole(bp, notchX + notchWidth + 10, 34, rHole);          // Mid-right flange hole

        geoms.push(makePlate(bp, t, 0, 0, 0, 0, 0, 0));

        // 2. HIGHLIGHT 1: Top-Left "Z-Bend" Hanging Tab (Forward Horizontal + Downward Vertical with Hole)
        const zTabW = 24;
        const zTabForward = params.topTabLength ? Math.round(params.topTabLength * 0.48) : 20;
        const zTabDrop = params.topTabLength ? Math.round(params.topTabLength * 0.52) : 22;
        const zTabX = 22;

        // Part A: Forward horizontal section
        const zHoriz = new THREE.Shape();
        zHoriz.moveTo(0, 0);
        zHoriz.lineTo(zTabW, 0);
        zHoriz.lineTo(zTabW, zTabForward);
        zHoriz.lineTo(0, zTabForward);
        zHoriz.closePath();
        geoms.push(makePlate(zHoriz, t, -Math.PI / 2, 0, 0, zTabX, height, 0));

        // Cylindrical Bend 1: from backplate to horizontal forward
        const zBend1 = this.makeCurvedBend(zTabW, rIn, t, Math.PI, 1.5 * Math.PI, 16);
        zBend1.rotateY(Math.PI / 2);
        zBend1.translate(zTabX, height, rOut);
        geoms.push(zBend1);

        // Part B: Downward vertical lip with center pilot hole
        const zDown = new THREE.Shape();
        zDown.moveTo(0, 0);
        zDown.lineTo(zTabW, 0);
        zDown.lineTo(zTabW - 3, zTabDrop);
        zDown.absarc(zTabW - 3, zTabDrop - 3, 3, 0, Math.PI / 2, false);
        zDown.lineTo(3, zTabDrop);
        zDown.absarc(3, zTabDrop - 3, 3, Math.PI / 2, Math.PI, false);
        zDown.lineTo(0, 0);
        zDown.closePath();
        addHole(zDown, zTabW / 2, zTabDrop / 2, 2.5); // Hole in downward vertical face
        geoms.push(makePlate(zDown, t, 0, 0, 0, zTabX, height - zTabDrop, zTabForward));

        // Cylindrical Bend 2: from horizontal to vertical down
        const zBend2 = this.makeCurvedBend(zTabW, rIn, t, 0, 0.5 * Math.PI, 16);
        zBend2.rotateY(Math.PI / 2);
        zBend2.translate(zTabX, height - t, zTabForward - rOut);
        geoms.push(zBend2);

        // 3. HIGHLIGHT 2: Top-Right Canopy Box with 45° Angled Finger Tab
        const rightBoxW = width - (notchX + notchWidth);
        const rightBoxX = notchX + notchWidth;

        // Top Roof Canopy (Horizontal ceiling bridging from backplate to right sidewall)
        const roof = new THREE.Shape();
        roof.moveTo(0, 0);
        roof.lineTo(rightBoxW, 0);
        roof.lineTo(rightBoxW, sideDepth);
        roof.lineTo(0, sideDepth);
        roof.closePath();
        geoms.push(makePlate(roof, t, -Math.PI / 2, 0, 0, rightBoxX, height, 0));

        // Smooth bend connecting backplate to roof
        const roofBend = this.makeCurvedBend(rightBoxW, rIn, t, Math.PI, 1.5 * Math.PI, 16);
        roofBend.rotateY(Math.PI / 2);
        roofBend.translate(rightBoxX, height, rOut);
        geoms.push(roofBend);

        // Deep Right Sidewall
        const floorY = 24;
        const sideH = height - floorY;
        const side = new THREE.Shape();
        side.moveTo(0, 0);
        side.lineTo(sideDepth, 0);
        side.lineTo(sideDepth, sideH);
        side.lineTo(0, sideH);
        side.closePath();
        addHole(side, sideDepth * 0.52, sideH * 0.52, 3.5); // Right sidewall hole
        geoms.push(makePlate(side, t, 0, -Math.PI / 2, 0, width, floorY, 0));

        // Sidewall bend from roof
        const sideBend = this.makeCurvedBend(sideDepth, rIn, t, 0, 0.5 * Math.PI, 16);
        sideBend.rotateZ(-Math.PI / 2);
        sideBend.translate(width - rOut, height, 0);
        geoms.push(sideBend);

        // 45° Angled Finger Tab (descends into cavity from front of roof with pilot hole)
        const fingerW = 16;
        const fingerLen = 26;
        const finger = new THREE.Shape();
        finger.moveTo(0, 0);
        finger.lineTo(fingerW, 0);
        finger.lineTo(fingerW - 2, fingerLen);
        finger.lineTo(2, fingerLen);
        finger.lineTo(0, 0);
        finger.closePath();
        addHole(finger, fingerW / 2, fingerLen * 0.42, 2.2);

        const fingerGeom = makePlate(finger, t, 0, 0, 0, 0, 0, 0);
        fingerGeom.rotateX(Math.PI / 4); // 45° forward-down tilt
        fingerGeom.translate(rightBoxX + 10, height - 18, sideDepth - 10);
        geoms.push(fingerGeom);

        // 4. HIGHLIGHT 3: Right Bottom Floor with Large Clearance Hole & Upright Corner Tab
        const floor = new THREE.Shape();
        floor.moveTo(0, 0);
        floor.lineTo(rightBoxW, 0);
        floor.lineTo(rightBoxW, sideDepth);
        floor.lineTo(0, sideDepth);
        floor.closePath();
        addHole(floor, rightBoxW * 0.5, sideDepth * 0.5, 8.5); // Large 17mm circular clearance hole
        geoms.push(makePlate(floor, t, -Math.PI / 2, 0, 0, rightBoxX, floorY, 0));

        // Floor bend from backplate
        const floorBend = this.makeCurvedBend(rightBoxW, rIn, t, Math.PI, 1.5 * Math.PI, 16);
        floorBend.rotateY(Math.PI / 2);
        floorBend.translate(rightBoxX, floorY + rOut, rOut);
        geoms.push(floorBend);

        // Upright small corner tab at front-right corner of bottom floor
        if (hasTabs) {
            const cornerTabW = 14;
            const cornerTabH = 16;
            const cornerTab = new THREE.Shape();
            cornerTab.moveTo(0, 0);
            cornerTab.lineTo(cornerTabW, 0);
            cornerTab.lineTo(cornerTabW - 2, cornerTabH);
            cornerTab.absarc(cornerTabW - 2, cornerTabH - 2, 2, 0, Math.PI / 2, false);
            cornerTab.lineTo(2, cornerTabH);
            cornerTab.absarc(2, cornerTabH - 2, 2, Math.PI / 2, Math.PI, false);
            cornerTab.lineTo(0, 0);
            cornerTab.closePath();
            addHole(cornerTab, cornerTabW / 2, cornerTabH / 2, 2.0); // Pilot hole
            geoms.push(makePlate(cornerTab, t, 0, -Math.PI / 2, 0, width, floorY, sideDepth - cornerTabW));
        }

        // 5. HIGHLIGHT 4: Bottom-Left Foot with Curved Contour, Hole, Gusset & Front Upright Tab
        const footW = notchX;
        const footLen = params.bottomFootLength || 54;
        const foot = new THREE.Shape();
        foot.moveTo(0, 0);
        foot.lineTo(footW, 0);
        foot.lineTo(footW, footLen - 16);
        foot.absarc(footW - 16, footLen - 16, 16, 0, Math.PI / 2, false);
        foot.lineTo(0, footLen);
        foot.closePath();
        addHole(foot, footW * 0.52, 26, 4.2); // 8.4mm foot mounting hole
        geoms.push(makePlate(foot, t, -Math.PI / 2, 0, 0, 0, 0, 0));

        // Cylindrical bend for bottom-left foot
        const footBend = this.makeCurvedBend(footW, rIn, t, Math.PI, 1.5 * Math.PI, 16);
        footBend.rotateY(Math.PI / 2);
        footBend.translate(0, rOut, rOut);
        geoms.push(footBend);

        // Front upright bent tab at the tip of bottom-left foot
        if (hasTabs) {
            const frontTabW = 12;
            const frontTabH = 14;
            const frontTab = new THREE.Shape();
            frontTab.moveTo(0, 0);
            frontTab.lineTo(frontTabW, 0);
            frontTab.lineTo(frontTabW - 2, frontTabH);
            frontTab.absarc(frontTabW - 2, frontTabH - 2, 2, 0, Math.PI / 2, false);
            frontTab.lineTo(2, frontTabH);
            frontTab.absarc(2, frontTabH - 2, 2, Math.PI / 2, Math.PI, false);
            frontTab.lineTo(0, 0);
            frontTab.closePath();
            addHole(frontTab, frontTabW / 2, frontTabH / 2, 2.0); // Pilot hole
            geoms.push(makePlate(frontTab, t, 0, 0, 0, footW - frontTabW, 0, footLen));
        }

        // Triangular Stiffening Gusset
        if (hasGusset) {
            const gusset = new THREE.Shape();
            gusset.moveTo(0, 0);
            gusset.lineTo(26, 0);
            gusset.lineTo(0, 32);
            gusset.closePath();
            const gussetGeom = new THREE.ExtrudeGeometry(gusset, { depth: t, bevelEnabled: false });
            gussetGeom.rotateY(-Math.PI / 2);
            gussetGeom.translate(24, 0, 0);
            geoms.push(gussetGeom);
        }

        // Merge all components into a watertight CAD BufferGeometry
        const mergedGeometry = this.mergeGeometries(geoms);
        mergedGeometry.computeVertexNormals();

        return {
            geometry: mergedGeometry,
            dimensions: {
                width: width,
                height: height,
                depth: sideDepth
            },
            isFlat: false,
            partName: 'CHASSIS SHEET METAL BRACKET'
        };
    },

    // Mode 5C: Stepped Sheet Metal Z-Channel Bracket
    // (Matches user upload media_1791282879370 with multi-step press-brake cylindrical bends
    //  and extrusion strictly normal to the section profile)
    createSteppedZChannel(params = {}) {
        const {
            thickness = 2.0,            // Sheet metal gauge (mm)
            length = 130,               // Channel longitudinal extrusion length (mm)
            topFlangeWidth = 40,        // Top horizontal flange width (mm)
            upperWebHeight = 55,        // Upper vertical upright web height (mm)
            stepWidth = 50,             // Middle horizontal step/shelf width (mm)
            lowerWebHeight = 55,        // Lower vertical upright web height (mm)
            bottomFlangeWidth = 40,     // Bottom horizontal flange width (mm)
            bendRadius = 2.0,           // Press-brake inner bend radius (mm)
            holeDia = 6.5,              // Standard mounting hole diameter (mm)
            cornerFillet = 5.0,         // Flange outer corner fillet radius (mm)
            isFlat = false              // If true, generate unfolded sheet blank for laser cutting
        } = params;

        const geoms = [];
        const t = Math.max(0.8, thickness);
        const rIn = Math.max(0.4, bendRadius);
        const rOut = rIn + t;
        const rHole = holeDia / 2;
        const L = Math.max(20, length);

        const makeFlatPlateWithHoles = (width, len, numHoles, rH, cornerR = 0) => {
            const shape = new THREE.Shape();
            const w = Math.max(2, width);
            const l = Math.max(2, len);
            const cr = Math.min(cornerR, w * 0.4, l * 0.4);

            if (cr > 0.5) {
                shape.moveTo(0, 0);
                shape.lineTo(w - cr, 0);
                shape.absarc(w - cr, cr, cr, -Math.PI / 2, 0, false);
                shape.lineTo(w, l - cr);
                shape.absarc(w - cr, l - cr, cr, 0, Math.PI / 2, false);
                shape.lineTo(0, l);
                shape.closePath();
            } else {
                shape.moveTo(0, 0);
                shape.lineTo(w, 0);
                shape.lineTo(w, l);
                shape.lineTo(0, l);
                shape.closePath();
            }

            if (numHoles >= 2 && rH > 0.5) {
                const h1 = new THREE.Path();
                h1.absarc(w * 0.5, l * 0.25, rH, 0, Math.PI * 2, true);
                shape.holes.push(h1);

                const h2 = new THREE.Path();
                h2.absarc(w * 0.5, l * 0.75, rH, 0, Math.PI * 2, true);
                shape.holes.push(h2);
            }

            const geom = new THREE.ExtrudeGeometry(shape, {
                steps: 1,
                depth: t,
                bevelEnabled: true,
                bevelThickness: 0.15,
                bevelSize: 0.15,
                bevelSegments: 1,
                curveSegments: 24
            });
            return { geom, width: w, len: l };
        };

        if (isFlat) {
            // UNFOLDED 2D FLAT PATTERN (CATIA Laser-cut Blank)
            // Bend allowance for 90° press brake bend
            const ba = (Math.PI / 2) * (rIn + 0.44 * t);
            const bd = 2 * rOut - ba;
            const totalW = topFlangeWidth + upperWebHeight + stepWidth + lowerWebHeight + bottomFlangeWidth - (4 * bd);

            const blank = new THREE.Shape();
            const cr = Math.min(cornerFillet, 8);
            blank.moveTo(cr, 0);
            blank.lineTo(totalW - cr, 0);
            blank.absarc(totalW - cr, cr, cr, -Math.PI / 2, 0, false);
            blank.lineTo(totalW, L - cr);
            blank.absarc(totalW - cr, L - cr, cr, 0, Math.PI / 2, false);
            blank.lineTo(cr, L);
            blank.absarc(cr, L - cr, cr, Math.PI / 2, Math.PI, false);
            blank.lineTo(0, cr);
            blank.absarc(cr, cr, cr, Math.PI, 1.5 * Math.PI, false);
            blank.closePath();

            // Mounting holes on unfolded flat blank
            const addH = (s, x, y, r) => {
                const p = new THREE.Path();
                p.absarc(x, y, r, 0, Math.PI * 2, true);
                s.holes.push(p);
            };

            // Top flange holes
            const xTopHole = topFlangeWidth * 0.5;
            addH(blank, xTopHole, L * 0.25, rHole);
            addH(blank, xTopHole, L * 0.75, rHole);

            // Middle step holes
            const xStepHole = topFlangeWidth + upperWebHeight - (2 * bd) + stepWidth * 0.5;
            addH(blank, xStepHole, L * 0.25, rHole);
            addH(blank, xStepHole, L * 0.75, rHole);

            // Bottom flange holes
            const xBotHole = totalW - bottomFlangeWidth * 0.5;
            addH(blank, xBotHole, L * 0.25, rHole);
            addH(blank, xBotHole, L * 0.75, rHole);

            const flatGeom = new THREE.ExtrudeGeometry(blank, { steps: 1, depth: t, bevelEnabled: false, curveSegments: 32 });
            flatGeom.computeVertexNormals();

            return {
                geometry: flatGeom,
                dimensions: { width: totalW, height: L, depth: t },
                isFlat: true,
                partName: 'STEPPED Z-CHANNEL (FLAT BLANK)'
            };
        }

        // 3D FOLDED SOLID MODEL (CATIA Sheet Metal with 4 cylindrical press-brake bends
        //  extruded strictly normal to the section plane along length L)

        // Segment dimensions
        const wBottomFlat = Math.max(10, bottomFlangeWidth - rOut);
        const hLowerFlat = Math.max(10, lowerWebHeight - 2 * rOut);
        const wStepFlat = Math.max(10, stepWidth - 2 * rOut);
        const hUpperFlat = Math.max(10, upperWebHeight - 2 * rOut);
        const wTopFlat = Math.max(10, topFlangeWidth - rOut);

        // 1. Bottom Flange (Horizontal plate in XZ plane, at Y in [0, t], extending in +X)
        const bf = makeFlatPlateWithHoles(wBottomFlat, L, 2, rHole, cornerFillet);
        bf.geom.rotateX(-Math.PI / 2);
        bf.geom.translate(rOut, 0, 0);
        geoms.push(bf.geom);

        // 2. Bend 4: Connects Bottom Flange to Lower Web (curves from horizontal +X to vertical +Y)
        // Center at (x = rOut, y = rOut), angle PI to 1.5*PI
        const bend4 = this.makeCurvedBend(L, rIn, t, Math.PI, 1.5 * Math.PI, 20);
        bend4.translate(rOut, rOut, 0);
        geoms.push(bend4);

        // 3. Lower Web (Vertical plate at X in [0, t], Y in [rOut, rOut + hLowerFlat])
        const lwShape = new THREE.Shape();
        lwShape.moveTo(0, 0);
        lwShape.lineTo(t, 0);
        lwShape.lineTo(t, hLowerFlat);
        lwShape.lineTo(0, hLowerFlat);
        lwShape.closePath();
        const lwGeom = new THREE.ExtrudeGeometry(lwShape, { steps: 1, depth: L, bevelEnabled: false });
        lwGeom.translate(0, rOut, 0);
        geoms.push(lwGeom);

        // 4. Bend 3: Connects Lower Web to Middle Step (curves from vertical +Y to horizontal -X)
        // Center at (x = -rIn, y = lowerWebHeight - rOut), angle 0 to 0.5*PI
        const bend3 = this.makeCurvedBend(L, rIn, t, 0, 0.5 * Math.PI, 20);
        bend3.translate(-rIn, lowerWebHeight - rOut, 0);
        geoms.push(bend3);

        // 5. Middle Step (Horizontal plate at Y in [lowerWebHeight - t, lowerWebHeight], extending in -X)
        const ms = makeFlatPlateWithHoles(wStepFlat, L, 2, rHole, 0);
        ms.geom.rotateX(-Math.PI / 2);
        ms.geom.translate(-rIn - wStepFlat, lowerWebHeight - t, 0);
        geoms.push(ms.geom);

        // End of middle step in X
        const xStepEnd = -rIn - wStepFlat;

        // 6. Bend 2: Connects Middle Step to Upper Web (curves from horizontal -X to vertical +Y)
        // Center at (x = xStepEnd + rOut, y = lowerWebHeight + rIn), angle PI to 1.5*PI
        const bend2 = this.makeCurvedBend(L, rIn, t, Math.PI, 1.5 * Math.PI, 20);
        bend2.translate(xStepEnd + rOut, lowerWebHeight + rIn, 0);
        geoms.push(bend2);

        // 7. Upper Web (Vertical plate at X in [xStepEnd, xStepEnd + t], Y in [lowerWebHeight + rIn, lowerWebHeight + rIn + hUpperFlat])
        const uwShape = new THREE.Shape();
        uwShape.moveTo(0, 0);
        uwShape.lineTo(t, 0);
        uwShape.lineTo(t, hUpperFlat);
        uwShape.lineTo(0, hUpperFlat);
        uwShape.closePath();
        const uwGeom = new THREE.ExtrudeGeometry(uwShape, { steps: 1, depth: L, bevelEnabled: false });
        uwGeom.translate(xStepEnd, lowerWebHeight + rIn, 0);
        geoms.push(uwGeom);

        // 8. Bend 1: Connects Upper Web to Top Flange (curves from vertical +Y to horizontal -X)
        // Center at (x = xStepEnd - rIn, y = lowerWebHeight + upperWebHeight - rOut), angle 0 to 0.5*PI
        const bend1 = this.makeCurvedBend(L, rIn, t, 0, 0.5 * Math.PI, 20);
        bend1.translate(xStepEnd - rIn, lowerWebHeight + upperWebHeight - rOut, 0);
        geoms.push(bend1);

        // 9. Top Flange (Horizontal plate at Y in [lowerWebHeight + upperWebHeight - t, lowerWebHeight + upperWebHeight], extending in -X)
        const tf = makeFlatPlateWithHoles(wTopFlat, L, 2, rHole, cornerFillet);
        tf.geom.rotateX(-Math.PI / 2);
        tf.geom.rotateY(Math.PI);
        tf.geom.translate(xStepEnd - rIn, lowerWebHeight + upperWebHeight - t, L);
        geoms.push(tf.geom);

        // Merge all 9 components into a watertight CAD BufferGeometry
        const mergedGeometry = this.mergeGeometries(geoms);
        mergedGeometry.computeVertexNormals();

        const totalWidth = bottomFlangeWidth + stepWidth + topFlangeWidth;
        const totalHeight = lowerWebHeight + upperWebHeight;

        return {
            geometry: mergedGeometry,
            dimensions: {
                width: totalWidth,
                height: totalHeight,
                depth: L
            },
            isFlat: false,
            partName: 'STEPPED SHEET METAL Z-CHANNEL'
        };
    },

    // Fast geometry merge utility
    mergeGeometries(geometries) {
        let totalVerts = 0;
        let totalIndices = 0;

        geometries.forEach(g => {
            const pos = g.getAttribute('position');
            totalVerts += pos.count;
            totalIndices += g.getIndex() ? g.getIndex().count : pos.count;
        });

        const mergedPos = new Float32Array(totalVerts * 3);
        const mergedNorm = new Float32Array(totalVerts * 3);
        const mergedIndices = [];

        let vertOffset = 0;

        geometries.forEach(g => {
            const pos = g.getAttribute('position');
            const norm = g.getAttribute('normal');
            const idx = g.getIndex();

            mergedPos.set(pos.array, vertOffset * 3);
            if (norm) {
                mergedNorm.set(norm.array, vertOffset * 3);
            }

            if (idx) {
                for (let i = 0; i < idx.count; i++) {
                    mergedIndices.push(idx.getX(i) + vertOffset);
                }
            } else {
                for (let i = 0; i < pos.count; i++) {
                    mergedIndices.push(i + vertOffset);
                }
            }

            vertOffset += pos.count;
        });

        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
        merged.setIndex(mergedIndices);
        return merged;
    },

    // Mode: Multi-Plate Sheet Metal Solid from Multi-Directional Geometric Scanner
    createMultiPlateCadSolid(scanResult, options = {}) {
        const {
            thickness = (scanResult?.thicknessAnalysis?.thicknessMm || 2.0),
            bendRadius = 2.0,
            isFlat = false,
            contours = [],
            targetWidthMm = 120,
            epsilon = 0.5
        } = options;

        const geoms = [];
        const t = Math.max(0.6, thickness);
        const rIn = Math.max(0.4, bendRadius);
        const rOut = rIn + t;

        const makePlate = (shape, depth, rotX = 0, rotY = 0, rotZ = 0, tx = 0, ty = 0, tz = 0) => {
            const geom = new THREE.ExtrudeGeometry(shape, {
                steps: 1,
                depth: depth,
                bevelEnabled: true,
                bevelThickness: 0.15,
                bevelSize: 0.15,
                bevelSegments: 1,
                curveSegments: 28
            });
            if (rotX) geom.rotateX(rotX);
            if (rotY) geom.rotateY(rotY);
            if (rotZ) geom.rotateZ(rotZ);
            geom.translate(tx, ty, tz);
            return geom;
        };

        const simplify = (pts, eps) => (typeof window !== 'undefined' && window.ImageProcessor && window.ImageProcessor.simplifyPointPreserving)
            ? window.ImageProcessor.simplifyPointPreserving(pts, 13.5, Math.min(0.55, eps * 0.35))
            : (typeof window !== 'undefined' && window.ImageProcessor && window.ImageProcessor.simplifyDouglasPeucker)
                ? window.ImageProcessor.simplifyDouglasPeucker(pts, eps)
                : pts;

        let primaryShape = null;
        let partW = targetWidthMm;
        let partH = 100;
        let partD = t;

        const outerContours = (contours || []).filter(c => !c.isHole);
        const holes = (contours || []).filter(c => c.isHole);

        if (outerContours.length > 0) {
            // Sort by area descending to find the primary part contour of the current model
            const primaryOuter = outerContours.slice().sort((a, b) => (b.area || 0) - (a.area || 0))[0];
            const scale = targetWidthMm / Math.max(1, primaryOuter.bbox.width);
            partW = primaryOuter.bbox.width * scale;
            partH = primaryOuter.bbox.height * scale;
            const offsetX = primaryOuter.bbox.minX + primaryOuter.bbox.width / 2;
            const offsetY = primaryOuter.bbox.minY + primaryOuter.bbox.height / 2;

            const simplifiedOuter = simplify(primaryOuter.points, epsilon);
            if (simplifiedOuter.length >= 3) {
                let outerPoints2D = simplifiedOuter.map(pt => ({
                    x: (pt.x - offsetX) * scale,
                    y: -(pt.y - offsetY) * scale
                }));

                if (this.checkIsClockwise(outerPoints2D)) {
                    outerPoints2D.reverse();
                }

                primaryShape = new THREE.Shape();
                primaryShape.moveTo(outerPoints2D[0].x, outerPoints2D[0].y);
                for (let i = 1; i < outerPoints2D.length; i++) {
                    primaryShape.lineTo(outerPoints2D[i].x, outerPoints2D[i].y);
                }
                primaryShape.closePath();

                // Add all holes inside this outer contour
                const partHoles = holes.filter(h => {
                    if (h.parent === primaryOuter) return true;
                    return (
                        h.bbox.minX >= primaryOuter.bbox.minX - 2 &&
                        h.bbox.maxX <= primaryOuter.bbox.maxX + 2 &&
                        h.bbox.minY >= primaryOuter.bbox.minY - 2 &&
                        h.bbox.maxY <= primaryOuter.bbox.maxY + 2
                    );
                }).sort((a, b) => b.area - a.area).slice(0, 36);

                partHoles.forEach(hole => {
                    try {
                        if (hole.isParametricCircle && hole.circleCenter && hole.circleRadius) {
                            const hcx = (hole.circleCenter.x - offsetX) * scale;
                            const hcy = -(hole.circleCenter.y - offsetY) * scale;
                            const hr = hole.circleRadius * scale;
                            const holePath = new THREE.Path();
                            holePath.absarc(hcx, hcy, hr, 0, Math.PI * 2, true);
                            primaryShape.holes.push(holePath);
                            return;
                        }

                        const simplifiedHole = simplify(hole.points, Math.max(1.0, epsilon));
                        if (simplifiedHole.length >= 3) {
                            let holePoints2D = simplifiedHole.map(pt => ({
                                x: (pt.x - offsetX) * scale,
                                y: -(pt.y - offsetY) * scale
                            }));

                            if (!this.checkIsClockwise(holePoints2D)) {
                                holePoints2D.reverse();
                            }

                            const holePath = new THREE.Path();
                            holePath.moveTo(holePoints2D[0].x, holePoints2D[0].y);
                            for (let i = 1; i < holePoints2D.length; i++) {
                                holePath.lineTo(holePoints2D[i].x, holePoints2D[i].y);
                            }
                            holePath.closePath();
                            primaryShape.holes.push(holePath);
                        }
                    } catch (errHole) {
                        console.warn('Skipped hole in sheet metal plate:', errHole);
                    }
                });
            }
        }

        if (primaryShape) {
            // Main sheet metal plate body with laser cut bevel and sheet gauge thickness
            geoms.push(makePlate(primaryShape, t, 0, 0, 0, 0, 0, -t / 2));

            // Check if Multi-Directional Scan detected secondary formed plates or step flanges
            const structures = scanResult?.sheetMetalStructure || [];
            const hasBasePlate = structures.some(s => s.type === 'BASE_PLATE');
            const hasStepShelf = structures.some(s => s.type === 'STEP_SHELF');
            const scanD = scanResult?.fused3DGeometry?.boundingBoxMm?.depth || (partW * 0.45);
            partD = isFlat ? t : Math.max(t, scanD);

            if (!isFlat && hasBasePlate) {
                // Formed bottom flange with press-brake cylindrical bend
                const baseLen = Math.max(20, Math.min(partW * 0.6, scanD));
                const baseWidth = partW * 0.85;
                const baseShape = new THREE.Shape();
                baseShape.moveTo(-baseWidth / 2, 0);
                baseShape.lineTo(baseWidth / 2, 0);
                baseShape.lineTo(baseWidth / 2, baseLen);
                baseShape.lineTo(-baseWidth / 2, baseLen);
                baseShape.closePath();

                geoms.push(makePlate(baseShape, t, -Math.PI / 2, 0, 0, 0, -partH / 2, rOut));

                const bend = this.makeCurvedBend(baseWidth, rIn, t, -Math.PI / 2, 0, 16);
                bend.rotateY(-Math.PI / 2);
                bend.translate(baseWidth / 2, -partH / 2 + rOut, 0);
                geoms.push(bend);
            }

            if (!isFlat && hasStepShelf) {
                const shelfLen = Math.max(18, scanD * 0.4);
                const shelfW = partW * 0.6;
                const shelfShape = new THREE.Shape();
                shelfShape.moveTo(-shelfW / 2, 0);
                shelfShape.lineTo(shelfW / 2, 0);
                shelfShape.lineTo(shelfW / 2, shelfLen);
                shelfShape.lineTo(-shelfW / 2, shelfLen);
                shelfShape.closePath();

                geoms.push(makePlate(shelfShape, t, Math.PI / 2, 0, 0, 0, 0, -t));
            }
        } else {
            // Fallback bounding box plate if no contours available
            const bbox = scanResult?.fused3DGeometry?.boundingBoxMm || { width: 120, height: 100, depth: 60 };
            const W = bbox.width;
            const H = bbox.height;
            const D = bbox.depth;
            partW = W;
            partH = H;
            partD = isFlat ? t : D;

            const holes = scanResult?.detectedHoles || [];
            const bore = holes.find(h => h.type === 'BORE_CLEARANCE');
            const boreR = bore ? (bore.diameterMm / 2) : (W * 0.16);

            const web = new THREE.Shape();
            web.moveTo(0, rOut);
            web.lineTo(W, rOut);
            web.lineTo(W, H - 4);
            web.absarc(W - 4, H - 4, 4, 0, Math.PI / 2, false);
            web.lineTo(4, H);
            web.absarc(4, H - 4, 4, Math.PI / 2, Math.PI, false);
            web.closePath();

            const boreCenterY = H * 0.52;
            const borePath = new THREE.Path();
            borePath.absarc(W / 2, boreCenterY, boreR, 0, Math.PI * 2, true);
            web.holes.push(borePath);

            geoms.push(makePlate(web, t, 0, 0, 0, -W / 2, 0, -t));

            if (!isFlat) {
                const baseLen = Math.max(30, D * 0.55);
                const base = new THREE.Shape();
                base.moveTo(0, 0);
                base.lineTo(W, 0);
                base.lineTo(W, baseLen - 4);
                base.absarc(W - 4, baseLen - 4, 4, 0, Math.PI / 2, false);
                base.lineTo(4, baseLen);
                base.absarc(4, baseLen - 4, 4, Math.PI / 2, Math.PI, false);
                base.closePath();

                geoms.push(makePlate(base, t, -Math.PI / 2, 0, 0, -W / 2, 0, rOut));

                const bendGeom = this.makeCurvedBend(W, rIn, t, -Math.PI / 2, 0, 16);
                bendGeom.rotateY(-Math.PI / 2);
                bendGeom.translate(W / 2, rOut, 0);
                geoms.push(bendGeom);
            }
        }

        const merged = this.mergeGeometries(geoms);
        merged.computeVertexNormals();

        return {
            geometry: merged,
            dimensions: {
                width: Math.round(partW * 10) / 10,
                height: Math.round(partH * 10) / 10,
                depth: Math.round(partD * 10) / 10
            },
            components: scanResult?.sheetMetalStructure || [],
            featureInventory: scanResult?.featureInventory || null,
            validation: scanResult?.validation || null,
            thicknessAnalysis: scanResult?.thicknessAnalysis || null,
            partName: isFlat ? 'CURRENT MODEL (FLAT PATTERN)' : 'CURRENT MODEL (SHEET METAL SOLID)'
        };
    }
};
