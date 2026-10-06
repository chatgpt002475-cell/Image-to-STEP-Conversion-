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

        // 3D Axis Tripod (X=Red, Y=Green, Z=Blue)
        this.axesHelper = new THREE.AxesHelper(40);
        this.axesHelper.renderOrder = 1;
        this.axesHelper.material.depthTest = false;
        this.scene.add(this.axesHelper);
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
