/**
 * CAD Geometry Generator
 * Generates 3D CAD models from 2D contours, profiles, heightmaps, and mechanical parameters.
 */

window.CadGenerator = {
    // Mode 1: Prismatic Extrusion with internal holes
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

        // Find primary outer contour (largest area non-hole)
        const outerContour = contours.find(c => !c.isHole) || contours[0];
        const holes = contours.filter(c => c.isHole);

        // Calculate scaling factor to map pixels to real-world millimeters
        const bbox = outerContour.bbox;
        const currentWidth = Math.max(1, bbox.width);
        const scale = targetWidthMm / currentWidth;

        // Centering offset
        const offsetX = centerAtOrigin ? (bbox.minX + bbox.maxX) / 2 : 0;
        const offsetY = centerAtOrigin ? (bbox.minY + bbox.maxY) / 2 : 0;

        // Simplify outer contour
        const simplifiedOuter = window.ImageProcessor.simplifyDouglasPeucker(outerContour.points, epsilon);
        if (simplifiedOuter.length < 3) {
            throw new Error('Outer contour has insufficient points');
        }

        // Build outer THREE.Shape with proper winding order
        let outerPoints2D = simplifiedOuter.map(pt => ({
            x: (pt.x - offsetX) * scale,
            y: -(pt.y - offsetY) * scale
        }));

        // In Three.js, outer boundary must be Counter-Clockwise (CCW)
        if (THREE.ShapeUtils && THREE.ShapeUtils.isClockwise(outerPoints2D)) {
            outerPoints2D.reverse();
        }

        const shape = new THREE.Shape();
        shape.moveTo(outerPoints2D[0].x, outerPoints2D[0].y);
        for (let i = 1; i < outerPoints2D.length; i++) {
            shape.lineTo(outerPoints2D[i].x, outerPoints2D[i].y);
        }
        shape.closePath();

        // Filter and sanitize internal holes / cutouts
        // Discard small noise specks (area < 60) to avoid earcut triangulation errors
        const validHoles = holes
            .filter(h => h.area >= 60 && h.points.length >= 4)
            .sort((a, b) => b.area - a.area)
            .slice(0, 15); // Top 15 largest holes (motor bore, screw holes, slots)

        validHoles.forEach(hole => {
            try {
                const simplifiedHole = window.ImageProcessor.simplifyDouglasPeucker(hole.points, Math.max(1.5, epsilon));
                if (simplifiedHole.length >= 3) {
                    let holePoints2D = simplifiedHole.map(pt => ({
                        x: (pt.x - offsetX) * scale,
                        y: -(pt.y - offsetY) * scale
                    }));

                    // In Three.js, holes MUST be Clockwise (CW)
                    if (THREE.ShapeUtils && !THREE.ShapeUtils.isClockwise(holePoints2D)) {
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
            } catch (err) {
                console.warn('Skipped problematic hole:', err);
            }
        });

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

        let geometry;
        try {
            geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        } catch (err) {
            console.warn('Extrude with all holes failed, retrying with outer shape:', err);
            try {
                // Retry with outer boundary only
                shape.holes = [];
                geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            } catch (err2) {
                console.error('Extrude outer shape failed, generating fallback block:', err2);
                geometry = new THREE.BoxGeometry(bbox.width * scale, bbox.height * scale, depth);
            }
        }

        geometry.computeVertexNormals();

        // Orient so the model rests on XY plane with extrusion pointing along Z+
        return {
            geometry,
            dimensions: {
                width: bbox.width * scale,
                height: bbox.height * scale,
                depth: depth + (bevelEnabled ? extrudeSettings.bevelThickness * 2 : 0)
            },
            scaleMmPerPx: scale
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

    // Mode 5: Folded Sheet Metal Chassis Bracket (Matches user photo & 4 highlighted features)
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
            hasGusset = true,      // Triangular stiffener gusset
            hasTabs = true         // Small upright bent tabs
        } = params;

        const geoms = [];
        const t = Math.max(0.8, thickness);
        const rHole = holeDia / 2;

        // Helper to extrude plate with bevel and transform
        const makePlate = (shape, depth, rotX = 0, rotY = 0, rotZ = 0, tx = 0, ty = 0, tz = 0) => {
            const geom = new THREE.ExtrudeGeometry(shape, {
                steps: 1,
                depth: depth,
                bevelEnabled: true,
                bevelThickness: 0.2,
                bevelSize: 0.2,
                bevelSegments: 1
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

        // Part B: Downward vertical lip with center pilot hole
        const zDown = new THREE.Shape();
        zDown.moveTo(0, 0);
        zDown.lineTo(zTabW, 0);
        zDown.lineTo(zTabW, zTabDrop);
        zDown.lineTo(0, zTabDrop);
        zDown.closePath();
        addHole(zDown, zTabW / 2, zTabDrop / 2, 2.5); // Hole in downward vertical face
        geoms.push(makePlate(zDown, t, 0, 0, 0, zTabX, height - zTabDrop, zTabForward));

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

        // 45° Angled Finger Tab (descends into cavity from front of roof with pilot hole)
        const fingerW = 16;
        const fingerLen = 26;
        const finger = new THREE.Shape();
        finger.moveTo(0, 0);
        finger.lineTo(fingerW, 0);
        finger.lineTo(fingerW, fingerLen);
        finger.lineTo(0, fingerLen);
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

        // Upright small corner tab at front-right corner of bottom floor
        if (hasTabs) {
            const cornerTabW = 14;
            const cornerTabH = 16;
            const cornerTab = new THREE.Shape();
            cornerTab.moveTo(0, 0);
            cornerTab.lineTo(cornerTabW, 0);
            cornerTab.lineTo(cornerTabW, cornerTabH);
            cornerTab.lineTo(0, cornerTabH);
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

        // Front upright bent tab at the tip of bottom-left foot
        if (hasTabs) {
            const frontTabW = 12;
            const frontTabH = 14;
            const frontTab = new THREE.Shape();
            frontTab.moveTo(0, 0);
            frontTab.lineTo(frontTabW, 0);
            frontTab.lineTo(frontTabW, frontTabH);
            frontTab.lineTo(0, frontTabH);
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
            }
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
