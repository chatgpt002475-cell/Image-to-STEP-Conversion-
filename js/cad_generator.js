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
            centerAtOrigin = true
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
        const simplify = (pts, eps) => (typeof window !== 'undefined' && window.ImageProcessor && window.ImageProcessor.simplifyDouglasPeucker)
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
                }).sort((a, b) => b.area - a.area).slice(0, 20);

                partHoles.forEach(hole => {
                    try {
                        const simplifiedHole = simplify(hole.points, Math.max(1.5, epsilon));
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

        finalGeometry.computeVertexNormals();

        return {
            geometry: finalGeometry,
            dimensions: {
                width: totalWidthPx * scale,
                height: totalHeightPx * scale,
                depth: depth + (bevelEnabled ? extrudeSettings.bevelThickness * 2 : 0)
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
    }
};
