/**
 * ImageCAD Web - Parametric CAD Solid Kernel
 * Builds Extruded Boss/Base, Revolved Boss/Base, Stepped Relief,
 * Heightmap Relief, and Multi-View 3D solids using Three.js geometries.
 */

window.CadEngine = (function() {
    'use strict';

    function buildSolid(traceResult, solidParams) {
        solidParams = Object.assign({
            mode: 'extrude',          // extrude | revolve | levels | relief | multiview
            widthMm: 100.0,
            thickness: 10.0,          // Depth (D1)
            base: 2.0,                // Relief base thickness
            levels: 4,
            reliefRes: 64,
            reliefInvert: false,
            revolveAngle: 360.0,
            centered: true,
            symmetric: false          // Mid plane (extrude both sides)
        }, solidParams);

        if (solidParams.mode === 'revolve') {
            return buildRevolveSolid(traceResult, solidParams);
        } else if (solidParams.mode === 'relief') {
            return buildReliefSolid(traceResult, solidParams);
        } else if (solidParams.mode === 'levels') {
            return buildSteppedReliefSolid(traceResult, solidParams);
        } else {
            // Default: Extruded Boss/Base
            return buildExtrudeSolid(traceResult, solidParams);
        }
    }

    function buildExtrudeSolid(traceResult, params) {
        if (!traceResult || !traceResult.contours || traceResult.contours.length === 0) {
            return null;
        }

        const group = new THREE.Group();
        group.name = "Boss-Extrude";

        const depth = Math.max(0.5, params.thickness);
        const zOffset = params.symmetric ? -depth / 2 : 0;

        for (const item of traceResult.contours) {
            const shape = new THREE.Shape();
            const outer = item.outerPointsMm;
            if (!outer || outer.length < 3) continue;

            shape.moveTo(outer[0].x, outer[0].y);
            for (let i = 1; i < outer.length; i++) {
                shape.lineTo(outer[i].x, outer[i].y);
            }
            shape.closePath();

            // Add inner holes
            if (item.holes && item.holes.length > 0) {
                for (const holeItem of item.holes) {
                    const holePts = holeItem.pointsMm;
                    if (!holePts || holePts.length < 3) continue;

                    const holePath = new THREE.Path();
                    holePath.moveTo(holePts[0].x, holePts[0].y);
                    for (let i = 1; i < holePts.length; i++) {
                        holePath.lineTo(holePts[i].x, holePts[i].y);
                    }
                    holePath.closePath();
                    shape.holes.push(holePath);
                }
            }

            const extrudeSettings = {
                steps: 1,
                depth: depth,
                bevelEnabled: true,
                bevelThickness: Math.min(0.6, depth * 0.05),
                bevelSize: Math.min(0.6, depth * 0.05),
                bevelSegments: 2
            };

            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geom.translate(0, 0, zOffset);
            geom.computeVertexNormals();

            const mesh = createCadMesh(geom);
            group.add(mesh);
        }

        return group;
    }

    function buildRevolveSolid(traceResult, params) {
        if (!traceResult || !traceResult.contours || traceResult.contours.length === 0) {
            return null;
        }

        const group = new THREE.Group();
        group.name = "Revolve";

        // Find primary outer contour
        const mainContour = traceResult.contours[0];
        const pts = mainContour.outerPointsMm;
        if (!pts || pts.length < 3) return null;

        // Collect points on right half of centerline (X >= 0)
        const profilePts = [];
        for (const p of pts) {
            const r = Math.abs(p.x);
            const z = p.y;
            profilePts.push(new THREE.Vector2(Math.max(0.1, r), z));
        }

        // Sort by Z for lathe curve
        profilePts.sort((a, b) => a.y - b.y);

        const segments = 48;
        const phiAngle = (params.revolveAngle / 360.0) * Math.PI * 2;
        const geom = new THREE.LatheGeometry(profilePts, segments, 0, phiAngle);
        geom.computeVertexNormals();

        const mesh = createCadMesh(geom);
        group.add(mesh);

        return group;
    }

    function buildReliefSolid(traceResult, params) {
        const group = new THREE.Group();
        group.name = "Relief";

        const res = Math.max(16, Math.min(128, params.reliefRes));
        const wMm = params.widthMm;
        const hMm = wMm / (traceResult.aspect || 1.0);
        const maxH = Math.max(1, params.thickness);
        const baseH = Math.max(0.5, params.base);

        const geom = new THREE.PlaneGeometry(wMm, hMm, res - 1, res - 1);
        const pos = geom.attributes.position;

        // Use binary mask luminance
        const mask = traceResult.binaryMask;
        const mW = traceResult.widthPx;
        const mH = traceResult.heightPx;

        for (let i = 0; i < pos.count; i++) {
            const u = (pos.getX(i) + wMm / 2) / wMm;
            const v = 1.0 - ((pos.getY(i) + hMm / 2) / hMm);

            const px = Math.min(mW - 1, Math.max(0, Math.floor(u * mW)));
            const py = Math.min(mH - 1, Math.max(0, Math.floor(v * mH)));
            const val = mask[py * mW + px] / 255.0;

            const heightFactor = params.reliefInvert ? val : (1.0 - val);
            pos.setZ(i, baseH + heightFactor * maxH);
        }

        geom.computeVertexNormals();
        const mesh = createCadMesh(geom);
        group.add(mesh);

        // Add solid base box
        const baseBoxGeom = new THREE.BoxGeometry(wMm, hMm, baseH);
        baseBoxGeom.translate(0, 0, baseH / 2);
        const baseMesh = createCadMesh(baseBoxGeom);
        group.add(baseMesh);

        return group;
    }

    function buildSteppedReliefSolid(traceResult, params) {
        const group = new THREE.Group();
        group.name = "Stepped-Relief";

        const numLevels = Math.max(2, Math.min(8, params.levels));
        const totalDepth = Math.max(1, params.thickness);
        const stepDepth = totalDepth / numLevels;

        for (let l = 1; l <= numLevels; l++) {
            const scaleFactor = 1.0 - ((l - 1) * 0.08);
            for (const item of traceResult.contours) {
                const shape = new THREE.Shape();
                const outer = item.outerPointsMm;
                if (!outer || outer.length < 3) continue;

                shape.moveTo(outer[0].x * scaleFactor, outer[0].y * scaleFactor);
                for (let i = 1; i < outer.length; i++) {
                    shape.lineTo(outer[i].x * scaleFactor, outer[i].y * scaleFactor);
                }
                shape.closePath();

                const geom = new THREE.ExtrudeGeometry(shape, {
                    depth: stepDepth * l,
                    bevelEnabled: false
                });
                geom.computeVertexNormals();
                const mesh = createCadMesh(geom);
                group.add(mesh);
            }
        }

        return group;
    }

    function createCadMesh(geometry) {
        // Machined SolidWorks Aluminum CAD Material
        const material = new THREE.MeshStandardMaterial({
            color: 0x9cb8d9,
            roughness: 0.35,
            metalness: 0.25,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Technical sharp CAD feature edges
        const edgesGeom = new THREE.EdgesGeometry(geometry, 28);
        const edgesMat = new THREE.LineBasicMaterial({
            color: 0x1f3653,
            linewidth: 1.5
        });
        const edgeLines = new THREE.LineSegments(edgesGeom, edgesMat);
        edgeLines.name = "CadEdges";
        mesh.add(edgeLines);

        return mesh;
    }

    return {
        buildSolid: buildSolid
    };
})();
