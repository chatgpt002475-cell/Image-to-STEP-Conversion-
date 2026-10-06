/**
 * Three.js CAD Viewport Manager
 * Handles 3D rendering, orbit navigation, camera presets,
 * edge wireframe overlays, shaders, clipping planes, and geometric telemetry.
 */

window.CadViewport = class {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container element #${containerId} not found`);
        }

        this.currentMesh = null;
        this.currentEdges = null;
        this.currentGeometry = null;
        this.currentMaterialMode = 'cad-clay';
        this.clippingEnabled = false;
        this.clipAxis = 'z';
        this.clipOffset = 0;

        // Coordinate System Datum Planes & Multi-Plane Projections State
        this.datumPlanesVisible = true;
        this.imageXYVisible = true;
        this.projectionsVisible = true;
        this.imageXYOpacity = 0.65;
        this.currentImage = null;
        this.currentImageDimensions = null;

        this.initScene();
        this.initLights();
        this.initGrid();
        this.initControls();
        this.bindEvents();
        this.animate();
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1e24);

        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
        this.camera.position.set(120, 150, 180);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.localClippingEnabled = true;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.container.appendChild(this.renderer.domElement);

        // Section Clipping Plane
        this.clippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100);

        // Coordinate System & Projection Groups
        this.datumGroup = new THREE.Group();
        this.scene.add(this.datumGroup);

        this.imageXYGroup = new THREE.Group();
        this.scene.add(this.imageXYGroup);

        this.projectionGroup = new THREE.Group();
        this.scene.add(this.projectionGroup);

        this.coordAxisGroup = new THREE.Group();
        this.scene.add(this.coordAxisGroup);
    }

    initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.65);
        this.scene.add(ambient);

        const mainLight = new THREE.DirectionalLight(0xffffff, 0.85);
        mainLight.position.set(150, 250, 200);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 1024;
        mainLight.shadow.mapSize.height = 1024;
        this.scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0xaaccff, 0.45);
        fillLight.position.set(-150, 100, -150);
        this.scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
        rimLight.position.set(0, -150, 100);
        this.scene.add(rimLight);
    }

    initGrid() {
        // Engineering Ground Grid
        this.gridHelper = new THREE.GridHelper(300, 30, 0x00d2ff, 0x2a3b4c);
        this.gridHelper.position.y = -0.05;
        this.scene.add(this.gridHelper);

        // Initialize CATIA-grade 3D Coordinate System
        this.initCoordinateSystem();
    }

    initControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 1200;
        this.controls.target.set(0, 0, 0);
    }

    bindEvents() {
        window.addEventListener('resize', () => this.onResize());
        
        const resizeObserver = new ResizeObserver(() => this.onResize());
        resizeObserver.observe(this.container);
    }

    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    // Load or update 3D CAD model
    setModel(geometry) {
        this.currentGeometry = geometry;

        // Remove previous mesh and edges
        if (this.currentMesh) {
            this.scene.remove(this.currentMesh);
            if (this.currentMesh.geometry) this.currentMesh.geometry.dispose();
            this.currentMesh = null;
        }
        if (this.currentEdges) {
            this.scene.remove(this.currentEdges);
            if (this.currentEdges.geometry) this.currentEdges.geometry.dispose();
            this.currentEdges = null;
        }

        // Center geometry and align bottom with ground
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        // Center horizontally (X, Z) and rest bottom surface on engineering ground grid (Y = 0)
        geometry.center();
        geometry.computeBoundingBox();
        const minY = geometry.boundingBox.min.y;
        geometry.translate(0, -minY, 0);

        // Recompute bbox after grounding
        geometry.computeBoundingBox();

        // Create Mesh with active material
        const material = this.createMaterial(this.currentMaterialMode);
        this.currentMesh = new THREE.Mesh(geometry, material);
        this.currentMesh.castShadow = true;
        this.currentMesh.receiveShadow = true;
        this.scene.add(this.currentMesh);

        // Add crisp CAD edge lines (EdgesGeometry)
        const edgesGeom = new THREE.EdgesGeometry(geometry, 28);
        const edgesMat = new THREE.LineBasicMaterial({
            color: 0x11161d,
            linewidth: 1.5,
            clippingPlanes: this.clippingEnabled ? [this.clippingPlane] : []
        });
        this.currentEdges = new THREE.LineSegments(edgesGeom, edgesMat);
        this.currentMesh.add(this.currentEdges);

        this.updateClipping();
        this.updateDatumPlanes();
        this.updatePlaneProjections(geometry);
        if (this.currentImage && this.currentImageDimensions) {
            this.setImageOnXY(this.currentImage, this.currentImageDimensions.width, this.currentImageDimensions.height, this.imageXYOpacity);
        }
        this.calculateTelemetry(geometry);
    }

    createMaterial(mode) {
        const clippingPlanes = this.clippingEnabled ? [this.clippingPlane] : [];

        switch (mode) {
            case 'catia':
                return new THREE.MeshPhysicalMaterial({
                    color: 0xdde6ed,
                    metalness: 0.88,
                    roughness: 0.16,
                    clearcoat: 0.45,
                    clearcoatRoughness: 0.08,
                    reflectivity: 0.95,
                    clippingPlanes,
                    clipShadows: true,
                    side: THREE.DoubleSide
                });

            case 'cad-clay':
                return new THREE.MeshStandardMaterial({
                    color: 0xdae2ed,
                    roughness: 0.45,
                    metalness: 0.1,
                    clippingPlanes,
                    clipShadows: true,
                    side: THREE.DoubleSide
                });

            case 'metallic':
                return new THREE.MeshStandardMaterial({
                    color: 0xcccccc,
                    roughness: 0.2,
                    metalness: 0.88,
                    clippingPlanes,
                    clipShadows: true,
                    side: THREE.DoubleSide
                });

            case 'xray':
                return new THREE.MeshPhysicalMaterial({
                    color: 0x38bdf8,
                    roughness: 0.1,
                    metalness: 0.1,
                    transmission: 0.85,
                    opacity: 0.55,
                    transparent: true,
                    clippingPlanes,
                    side: THREE.DoubleSide
                });

            case 'wireframe':
                return new THREE.MeshStandardMaterial({
                    color: 0x223344,
                    wireframe: true,
                    clippingPlanes
                });

            case 'normal':
                return new THREE.MeshNormalMaterial({
                    clippingPlanes,
                    side: THREE.DoubleSide
                });

            case 'blueprint':
                return new THREE.MeshStandardMaterial({
                    color: 0x0066cc,
                    roughness: 0.5,
                    metalness: 0.05,
                    clippingPlanes,
                    side: THREE.DoubleSide
                });

            default:
                return new THREE.MeshStandardMaterial({
                    color: 0xd0d8e2,
                    roughness: 0.4,
                    metalness: 0.15,
                    clippingPlanes,
                    side: THREE.DoubleSide
                });
        }
    }

    setMaterialMode(mode) {
        this.currentMaterialMode = mode;
        if (this.currentMesh) {
            this.currentMesh.material = this.createMaterial(mode);
            if (this.currentEdges) {
                this.currentEdges.visible = (mode !== 'wireframe');
            }
        }
    }

    // Toggle and adjust live section clipping plane
    setClipping(enabled, axis = 'z', offsetPercent = 50) {
        this.clippingEnabled = enabled;
        this.clipAxis = axis;

        if (!this.currentGeometry) return;

        this.currentGeometry.computeBoundingBox();
        const bbox = this.currentGeometry.boundingBox;

        let normal = new THREE.Vector3(0, 0, -1);
        let minVal = bbox.min.z;
        let maxVal = bbox.max.z;

        if (axis === 'x') {
            normal = new THREE.Vector3(-1, 0, 0);
            minVal = bbox.min.x;
            maxVal = bbox.max.x;
        } else if (axis === 'y') {
            normal = new THREE.Vector3(0, -1, 0);
            minVal = bbox.min.y;
            maxVal = bbox.max.y;
        }

        const distance = minVal + ((maxVal - minVal) * (offsetPercent / 100));
        this.clippingPlane.set(normal, distance);

        this.updateClipping();
    }

    updateClipping() {
        if (!this.currentMesh) return;
        const planes = this.clippingEnabled ? [this.clippingPlane] : [];
        if (this.currentMesh.material) {
            this.currentMesh.material.clippingPlanes = planes;
            this.currentMesh.material.needsUpdate = true;
        }
        if (this.currentEdges && this.currentEdges.material) {
            this.currentEdges.material.clippingPlanes = planes;
            this.currentEdges.material.needsUpdate = true;
        }
    }

    // Camera preset orientations
    setView(viewType) {
        if (!this.currentGeometry) return;
        this.currentGeometry.computeBoundingBox();
        const size = new THREE.Vector3();
        this.currentGeometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 50);
        const dist = maxDim * 2.2;
        const targetY = size.y * 0.5;

        this.controls.target.set(0, targetY, 0);

        switch (viewType) {
            case 'iso':
                this.camera.position.set(dist * 0.75, targetY + dist * 0.75, dist * 0.75);
                break;
            case 'top':
                this.camera.position.set(0, targetY + dist * 1.5, 0.001);
                break;
            case 'front':
                this.camera.position.set(0, targetY, dist * 1.5);
                break;
            case 'right':
                this.camera.position.set(dist * 1.5, targetY, 0);
                break;
            case 'reset':
                this.camera.position.set(dist * 0.75, targetY + dist * 0.75, dist * 0.75);
                break;
        }

        this.camera.lookAt(0, targetY, 0);
        this.controls.update();
    }

    // CATIA-Grade Coordinate System & Datum Reference Planes
    initCoordinateSystem() {
        // 1. Engineering 3D Arrow Triad at Origin (X=Red, Y=Green, Z=Blue)
        const makeAxisArrow = (dir, color, length = 45, radius = 0.8) => {
            const group = new THREE.Group();
            const cylinderGeom = new THREE.CylinderGeometry(radius, radius, length - 8, 16);
            cylinderGeom.translate(0, (length - 8) / 2, 0);
            const coneGeom = new THREE.ConeGeometry(radius * 2.5, 8, 16);
            coneGeom.translate(0, length - 4, 0);

            const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
            const cylinder = new THREE.Mesh(cylinderGeom, mat);
            const cone = new THREE.Mesh(coneGeom, mat);
            cylinder.renderOrder = 999;
            cone.renderOrder = 999;
            group.add(cylinder);
            group.add(cone);

            if (dir === 'x') {
                group.rotateZ(-Math.PI / 2);
            } else if (dir === 'z') {
                group.rotateX(Math.PI / 2);
            }
            return group;
        };

        const arrowX = makeAxisArrow('x', 0xef4444, 45); // Red +X
        const arrowY = makeAxisArrow('y', 0x22c55e, 45); // Green +Y
        const arrowZ = makeAxisArrow('z', 0x3b82f6, 45); // Blue +Z
        this.coordAxisGroup.add(arrowX);
        this.coordAxisGroup.add(arrowY);
        this.coordAxisGroup.add(arrowZ);

        // Origin sphere
        const origGeom = new THREE.SphereGeometry(1.8, 16, 16);
        const origMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false });
        const origMesh = new THREE.Mesh(origGeom, origMat);
        origMesh.renderOrder = 999;
        this.coordAxisGroup.add(origMesh);

        // Text Badge Sprites (+X, +Y, +Z, Origin)
        const lblX = this.createLabelSprite('+X', '#ef4444');
        if (lblX) { lblX.position.set(52, 0, 0); this.coordAxisGroup.add(lblX); }

        const lblY = this.createLabelSprite('+Y', '#22c55e');
        if (lblY) { lblY.position.set(0, 52, 0); this.coordAxisGroup.add(lblY); }

        const lblZ = this.createLabelSprite('+Z', '#3b82f6');
        if (lblZ) { lblZ.position.set(0, 0, 52); this.coordAxisGroup.add(lblZ); }

        const lblO = this.createLabelSprite('O (0,0,0)', '#f59e0b');
        if (lblO) { lblO.position.set(-6, -6, 0); this.coordAxisGroup.add(lblO); }

        // Negative axis dashed guide lines
        const negAxisMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 4, gapSize: 3, opacity: 0.45, transparent: true });
        const makeNegLine = (from, to) => {
            const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
            const line = new THREE.Line(geom, negAxisMat);
            line.computeLineDistances();
            return line;
        };
        this.coordAxisGroup.add(makeNegLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-45, 0, 0)));
        this.coordAxisGroup.add(makeNegLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -45, 0)));
        this.coordAxisGroup.add(makeNegLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -45)));

        // 2. Initial Datum Reference Planes
        this.updateDatumPlanes();
    }

    createLabelSprite(text, color = '#00d2ff', bgColor = 'rgba(15,23,42,0.85)') {
        if (typeof document === 'undefined') return null;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 280;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // Rounded badge
            ctx.fillStyle = bgColor;
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            const r = 8;
            ctx.beginPath();
            ctx.moveTo(r, 2);
            ctx.lineTo(278 - r, 2);
            ctx.quadraticCurveTo(278, 2, 278, r);
            ctx.lineTo(278, 62 - r);
            ctx.quadraticCurveTo(278, 62, 278 - r, 62);
            ctx.lineTo(r, 62);
            ctx.quadraticCurveTo(2, 62, 2, 62 - r);
            ctx.lineTo(2, r);
            ctx.quadraticCurveTo(2, 2, r, 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Text
            ctx.font = 'bold 20px "Inter", "Segoe UI", monospace';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 140, 32);

            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(22, 5, 1);
            sprite.renderOrder = 998;
            return sprite;
        } catch (e) {
            return null;
        }
    }

    updateDatumPlanes() {
        if (!this.datumGroup) return;

        // Clear existing datum planes
        while (this.datumGroup.children.length > 0) {
            const child = this.datumGroup.children[0];
            this.datumGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        }

        if (!this.datumPlanesVisible) return;

        // Calculate bounding dimensions
        let minX = -60, maxX = 60, minY = 0, maxY = 100, minZ = -60, maxZ = 60;
        if (this.currentGeometry) {
            this.currentGeometry.computeBoundingBox();
            const bb = this.currentGeometry.boundingBox;
            minX = bb.min.x; maxX = bb.max.x;
            minY = Math.min(0, bb.min.y); maxY = bb.max.y;
            minZ = bb.min.z; maxZ = bb.max.z;
        }

        const sizeX = Math.max(80, maxX - minX);
        const sizeY = Math.max(80, maxY - minY);
        const sizeZ = Math.max(80, maxZ - minZ);
        const padX = sizeX * 0.28;
        const padY = sizeY * 0.25;
        const padZ = sizeZ * 0.28;

        const x0 = minX - padX, x1 = maxX + padX;
        const y0 = minY, y1 = maxY + padY;
        const z0 = minZ - padZ, z1 = maxZ + padZ;

        const planeW_XY = x1 - x0;
        const planeH_XY = y1 - y0;
        const planeW_ZX = x1 - x0;
        const planeD_ZX = z1 - z0;
        const planeH_YZ = y1 - y0;
        const planeD_YZ = z1 - z0;

        const makePlane = (geom, color, rotX = 0, rotY = 0, tx = 0, ty = 0, tz = 0, label = '', lblPos = [0, 0, 0]) => {
            const meshMat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.06,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geom, meshMat);
            const edgesMat = new THREE.LineBasicMaterial({ color, opacity: 0.45, transparent: true, linewidth: 1.5 });
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), edgesMat);
            mesh.add(edges);

            if (rotX) mesh.rotateX(rotX);
            if (rotY) mesh.rotateY(rotY);
            mesh.position.set(tx, ty, tz);
            this.datumGroup.add(mesh);

            if (label) {
                const sprite = this.createLabelSprite(label, color, 'rgba(15,23,42,0.85)');
                if (sprite) {
                    sprite.position.set(lblPos[0], lblPos[1], lblPos[2]);
                    this.datumGroup.add(sprite);
                }
            }
        };

        // 1. Datum XY Plane (Sketch / Section Reference Plane at Z = minZ or Z = 0)
        const zDatumXY = Math.min(0, minZ) - 0.2;
        const geomXY = new THREE.PlaneGeometry(planeW_XY, planeH_XY);
        makePlane(
            geomXY,
            '#00d2ff',
            0, 0,
            (x0 + x1) / 2, (y0 + y1) / 2, zDatumXY,
            '[XY] SKETCH SECTION PLANE',
            [x1 - 10, y1 + 6, zDatumXY]
        );

        // 2. Datum ZX Plane (Ground / Plan Reference Plane at Y = 0)
        const geomZX = new THREE.PlaneGeometry(planeW_ZX, planeD_ZX);
        makePlane(
            geomZX,
            '#10b981',
            -Math.PI / 2, 0,
            (x0 + x1) / 2, 0, (z0 + z1) / 2,
            '[ZX] GROUND / PLAN PLANE',
            [x1 - 10, 2, z0]
        );

        // 3. Datum YZ Plane (Side / Profile Reference Plane at X = x0)
        const geomYZ = new THREE.PlaneGeometry(planeD_YZ, planeH_YZ);
        makePlane(
            geomYZ,
            '#a855f7',
            0, Math.PI / 2,
            x0, (y0 + y1) / 2, (z0 + z1) / 2,
            '[YZ] SIDE PROFILE PLANE',
            [x0, y1 + 6, z1]
        );
    }

    setImageOnXY(imageOrCanvas, widthMm = 100, heightMm = 100, opacity = 0.65) {
        if (!imageOrCanvas) return;
        this.currentImage = imageOrCanvas;
        this.currentImageDimensions = { width: widthMm, height: heightMm };
        this.imageXYOpacity = opacity;

        // Clear previous image on XY
        while (this.imageXYGroup.children.length > 0) {
            const child = this.imageXYGroup.children[0];
            this.imageXYGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        }

        if (!this.imageXYVisible) return;

        // Create canvas texture
        let canvas = imageOrCanvas;
        if (typeof document !== 'undefined') {
            if (!(imageOrCanvas instanceof HTMLCanvasElement)) {
                canvas = document.createElement('canvas');
                canvas.width = imageOrCanvas.naturalWidth || imageOrCanvas.width || 512;
                canvas.height = imageOrCanvas.naturalHeight || imageOrCanvas.height || 512;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imageOrCanvas, 0, 0, canvas.width, canvas.height);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const planeGeom = new THREE.PlaneGeometry(widthMm, heightMm);
        const planeMat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: Math.max(0.05, opacity),
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(planeGeom, planeMat);

        // Position on XY plane (Z = -0.3 slightly behind 3D solid)
        const zPos = -0.3;
        mesh.position.set(0, heightMm / 2, zPos);
        this.imageXYGroup.add(mesh);

        // Engineering cyan border frame
        const frameEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeom),
            new THREE.LineBasicMaterial({ color: 0x00d2ff, linewidth: 2 })
        );
        frameEdges.position.copy(mesh.position);
        this.imageXYGroup.add(frameEdges);

        // Badge sprite
        const sprite = this.createLabelSprite(`SKETCH ON [XY]: ${widthMm.toFixed(0)}×${heightMm.toFixed(0)}mm`, '#00d2ff');
        if (sprite) {
            sprite.position.set(0, heightMm + 6, zPos);
            this.imageXYGroup.add(sprite);
        }

        // Extrusion Normal Projection Rays from 4 corners of XY sketch plane through depth Z
        if (this.currentGeometry) {
            this.currentGeometry.computeBoundingBox();
            const depthZ = this.currentGeometry.boundingBox.max.z - this.currentGeometry.boundingBox.min.z;
            const rayMat = new THREE.LineDashedMaterial({ color: 0x00d2ff, dashSize: 3, gapSize: 3, opacity: 0.5, transparent: true });

            const halfW = widthMm / 2;
            const corners = [
                [-halfW, 0],
                [halfW, 0],
                [halfW, heightMm],
                [-halfW, heightMm]
            ];

            corners.forEach(([cx, cy]) => {
                const pts = [
                    new THREE.Vector3(cx, cy, zPos),
                    new THREE.Vector3(cx, cy, Math.max(10, depthZ))
                ];
                const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
                const ray = new THREE.Line(lineGeom, rayMat);
                ray.computeLineDistances();
                this.imageXYGroup.add(ray);
            });
        }
    }

    updatePlaneProjections(geometry) {
        if (!this.projectionGroup) return;

        // Clear existing projections
        while (this.projectionGroup.children.length > 0) {
            const child = this.projectionGroup.children[0];
            this.projectionGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        if (!geometry || !this.projectionsVisible) return;

        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        const size = new THREE.Vector3();
        bb.getSize(size);
        const center = new THREE.Vector3();
        bb.getCenter(center);

        const pad = Math.max(25, Math.max(size.x, size.y, size.z) * 0.28);
        const xDatumYZ = bb.min.x - pad;

        // 1. Orthographic Projection on ZX Plane (Ground Plan Footprint, Y = 0.05)
        const zxGeom = new THREE.PlaneGeometry(size.x, size.z);
        const zxMat = new THREE.MeshBasicMaterial({
            color: 0x00d2ff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const zxMesh = new THREE.Mesh(zxGeom, zxMat);
        zxMesh.rotateX(-Math.PI / 2);
        zxMesh.position.set(center.x, 0.05, center.z);
        this.projectionGroup.add(zxMesh);

        // Edge outline of ground projection
        const zxEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(zxGeom),
            new THREE.LineBasicMaterial({ color: 0x00d2ff, linewidth: 2 })
        );
        zxEdges.rotateX(-Math.PI / 2);
        zxEdges.position.copy(zxMesh.position);
        this.projectionGroup.add(zxEdges);

        // Center crosshair (+) on ground footprint
        const crossMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, opacity: 0.6, transparent: true });
        const crossPts = [
            new THREE.Vector3(center.x - size.x * 0.4, 0.06, center.z),
            new THREE.Vector3(center.x + size.x * 0.4, 0.06, center.z),
            new THREE.Vector3(center.x, 0.06, center.z - size.z * 0.4),
            new THREE.Vector3(center.x, 0.06, center.z + size.z * 0.4)
        ];
        this.projectionGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(crossPts), crossMat));

        // 4 Vertical Projection Witness Rays (Model to Ground)
        const vRayMat = new THREE.LineDashedMaterial({ color: 0x00d2ff, dashSize: 4, gapSize: 3, opacity: 0.4, transparent: true });
        const cornersZX = [
            [bb.min.x, bb.min.z],
            [bb.max.x, bb.min.z],
            [bb.max.x, bb.max.z],
            [bb.min.x, bb.max.z]
        ];
        cornersZX.forEach(([cx, cz]) => {
            const pts = [
                new THREE.Vector3(cx, bb.min.y, cz),
                new THREE.Vector3(cx, 0.05, cz)
            ];
            const rayGeom = new THREE.BufferGeometry().setFromPoints(pts);
            const ray = new THREE.Line(rayGeom, vRayMat);
            ray.computeLineDistances();
            this.projectionGroup.add(ray);
        });

        const spriteZX = this.createLabelSprite('PROJECTION: PLAN FOOTPRINT [ZX]', '#00d2ff');
        if (spriteZX) {
            spriteZX.position.set(center.x, 0.06, bb.max.z + 10);
            this.projectionGroup.add(spriteZX);
        }

        // 2. Orthographic Projection on YZ Plane (Side Elevation Profile, X = xDatumYZ)
        const yzGeom = new THREE.PlaneGeometry(size.z, size.y);
        const yzMat = new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const yzMesh = new THREE.Mesh(yzGeom, yzMat);
        yzMesh.rotateY(Math.PI / 2);
        yzMesh.position.set(xDatumYZ + 0.1, center.y, center.z);
        this.projectionGroup.add(yzMesh);

        // Edge outline of side projection
        const yzEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(yzGeom),
            new THREE.LineBasicMaterial({ color: 0xa855f7, linewidth: 2 })
        );
        yzEdges.rotateY(Math.PI / 2);
        yzEdges.position.copy(yzMesh.position);
        this.projectionGroup.add(yzEdges);

        // 4 Horizontal Projection Witness Rays (Model to YZ Side Plane)
        const hRayMat = new THREE.LineDashedMaterial({ color: 0xa855f7, dashSize: 4, gapSize: 3, opacity: 0.4, transparent: true });
        const cornersYZ = [
            [bb.min.y, bb.min.z],
            [bb.max.y, bb.min.z],
            [bb.max.y, bb.max.z],
            [bb.min.y, bb.max.z]
        ];
        cornersYZ.forEach(([cy, cz]) => {
            const pts = [
                new THREE.Vector3(bb.min.x, cy, cz),
                new THREE.Vector3(xDatumYZ + 0.1, cy, cz)
            ];
            const rayGeom = new THREE.BufferGeometry().setFromPoints(pts);
            const ray = new THREE.Line(rayGeom, hRayMat);
            ray.computeLineDistances();
            this.projectionGroup.add(ray);
        });

        const spriteYZ = this.createLabelSprite('PROJECTION: SIDE PROFILE [YZ]', '#a855f7');
        if (spriteYZ) {
            spriteYZ.position.set(xDatumYZ + 0.1, bb.max.y + 8, center.z);
            this.projectionGroup.add(spriteYZ);
        }
    }

    setDatumPlanesVisible(visible) {
        this.datumPlanesVisible = visible;
        if (this.datumGroup) this.datumGroup.visible = visible;
        if (this.coordAxisGroup) this.coordAxisGroup.visible = visible;
    }

    setImageXYVisible(visible) {
        this.imageXYVisible = visible;
        if (this.imageXYGroup) {
            this.imageXYGroup.visible = visible;
            if (visible && this.currentImage && this.currentImageDimensions) {
                this.setImageOnXY(this.currentImage, this.currentImageDimensions.width, this.currentImageDimensions.height, this.imageXYOpacity);
            }
        }
    }

    setImageXYOpacity(opacity) {
        this.imageXYOpacity = opacity;
        if (this.imageXYGroup) {
            this.imageXYGroup.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.opacity = opacity;
                }
            });
        }
    }

    setProjectionsVisible(visible) {
        this.projectionsVisible = visible;
        if (this.projectionGroup) {
            this.projectionGroup.visible = visible;
            if (visible && this.currentGeometry) {
                this.updatePlaneProjections(this.currentGeometry);
            }
        }
    }

    // Compute geometric telemetry (Bounding Box, Volume, Surface Area, Triangle Count)
    calculateTelemetry(geometry) {
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);

        const posAttr = geometry.getAttribute('position');
        const indexAttr = geometry.getIndex();
        const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
        const numVertices = posAttr.count;

        // Approximate volume & surface area using tetrahedron shoelace on triangles
        let volumeMm3 = 0;
        let surfaceAreaMm2 = 0;

        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        for (let i = 0; i < numTriangles; i++) {
            let i0, i1, i2;
            if (indexAttr) {
                i0 = indexAttr.getX(i * 3);
                i1 = indexAttr.getX(i * 3 + 1);
                i2 = indexAttr.getX(i * 3 + 2);
            } else {
                i0 = i * 3;
                i1 = i * 3 + 1;
                i2 = i * 3 + 2;
            }

            pA.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
            pB.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
            pC.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));

            // Surface Area = 0.5 * |(B - A) x (C - A)|
            ab.subVectors(pB, pA);
            cb.subVectors(pC, pA);
            cb.cross(ab);
            surfaceAreaMm2 += 0.5 * cb.length();

            // Signed Tetrahedron Volume = (A . (B x C)) / 6
            cb.subVectors(pB, new THREE.Vector3(0, 0, 0));
            ab.subVectors(pC, new THREE.Vector3(0, 0, 0));
            volumeMm3 += pA.dot(cb.cross(ab)) / 6.0;
        }

        const volumeCm3 = Math.abs(volumeMm3) / 1000.0;
        const surfaceAreaCm2 = surfaceAreaMm2 / 100.0;

        const telemetry = {
            widthMm: size.x.toFixed(1),
            depthMm: size.y.toFixed(1),
            heightMm: size.z.toFixed(1),
            volumeCm3: volumeCm3.toFixed(2),
            surfaceAreaCm2: surfaceAreaCm2.toFixed(2),
            triangles: numTriangles.toLocaleString(),
            vertices: numVertices.toLocaleString()
        };

        if (this.onTelemetryUpdate) {
            this.onTelemetryUpdate(telemetry);
        }

        return telemetry;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
};
