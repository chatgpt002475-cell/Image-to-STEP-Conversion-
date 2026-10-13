/**
 * ImageCAD Web - 3D Viewport Controller
 * Manages Three.js scene, cameras, lighting, OrbitControls, standard view angles,
 * CAD edge rendering, cross-section clipping, and geometry telemetry.
 */

window.CadViewport = (function() {
    'use strict';

    let container, canvas, renderer, scene, camera, controls;
    let currentModel = null;
    let gridHelper, triadGroup;
    let clippingPlane, isClippingActive = false;
    let displayStyle = 'shaded_edges';

    function init(canvasElement, containerElement) {
        canvas = canvasElement;
        container = containerElement;

        // Renderer
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.localClippingEnabled = true;

        // Scene
        scene = new THREE.Scene();

        // Camera
        const aspect = container.clientWidth / container.clientHeight;
        camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
        camera.position.set(160, 140, 200);

        // OrbitControls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.screenSpacePanning = true;
        controls.target.set(0, 0, 5);

        // Lighting (Professional CAD Studio Rig)
        setupLighting();

        // Grid & Triad
        setupHelpers();

        // Clipping plane for section slicer
        clippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        window.addEventListener('resize', onResize);
        animate();

        return {
            setModel: setModel,
            setView: setView,
            fit: fit,
            setDisplayStyle: setDisplayStyle,
            toggleClipping: toggleClipping,
            setClipOffset: setClipOffset,
            getTelemetry: getTelemetry,
            getCurrentModel: () => currentModel,
            takeScreenshot: takeScreenshot
        };
    }

    function setupLighting() {
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0xc8d4e2, 0.75);
        scene.add(hemiLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
        keyLight.position.set(200, 300, 250);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 10;
        keyLight.shadow.camera.far = 1000;
        const d = 150;
        keyLight.shadow.camera.left = -d;
        keyLight.shadow.camera.right = d;
        keyLight.shadow.camera.top = d;
        keyLight.shadow.camera.bottom = -d;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xbad2eb, 0.45);
        fillLight.position.set(-200, -100, -150);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
        rimLight.position.set(0, 200, -200);
        scene.add(rimLight);
    }

    function setupHelpers() {
        // Ground plane grid (SolidWorks subtle grid)
        gridHelper = new THREE.GridHelper(300, 30, 0xa4b3c7, 0xd0d8e2);
        gridHelper.rotation.x = Math.PI / 2; // Lie flat in XY CAD plane
        gridHelper.position.z = -0.1;
        scene.add(gridHelper);

        // Origin triad
        triadGroup = new THREE.Group();
        const axisLen = 20;
        const xAxis = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axisLen, 0xd32f2f, 4, 2);
        const yAxis = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axisLen, 0x388e3c, 4, 2);
        const zAxis = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axisLen, 0x1976d2, 4, 2);
        triadGroup.add(xAxis);
        triadGroup.add(yAxis);
        triadGroup.add(zAxis);
        scene.add(triadGroup);
    }

    function setModel(modelGroup) {
        if (currentModel) {
            scene.remove(currentModel);
        }
        currentModel = modelGroup;
        if (currentModel) {
            applyCurrentDisplayStyle();
            scene.add(currentModel);
            fit();
        }
    }

    function setDisplayStyle(style) {
        displayStyle = style;
        applyCurrentDisplayStyle();
    }

    function applyCurrentDisplayStyle() {
        if (!currentModel) return;

        currentModel.traverse((child) => {
            if (child.isMesh) {
                if (displayStyle === 'wireframe') {
                    child.material.wireframe = true;
                    child.material.color.setHex(0x1d4f8a);
                } else if (displayStyle === 'shaded') {
                    child.material.wireframe = false;
                    child.material.color.setHex(0x9cb8d9);
                } else {
                    // Shaded with edges (default)
                    child.material.wireframe = false;
                    child.material.color.setHex(0x9cb8d9);
                }

                // Show/hide edge lines
                child.traverse((sub) => {
                    if (sub.name === 'CadEdges') {
                        sub.visible = (displayStyle === 'shaded_edges');
                    }
                });

                // Apply clipping plane if active
                if (isClippingActive) {
                    child.material.clippingPlanes = [clippingPlane];
                    child.material.clipShadows = true;
                } else {
                    child.material.clippingPlanes = [];
                }
            }
        });
    }

    function toggleClipping(active) {
        isClippingActive = active;
        applyCurrentDisplayStyle();
    }

    function setClipOffset(offsetMm) {
        clippingPlane.constant = offsetMm;
    }

    function setView(viewName) {
        const dist = 240;
        const target = controls.target || new THREE.Vector3(0, 0, 0);

        switch(viewName.toLowerCase()) {
            case 'front':
                camera.position.set(target.x, target.y - dist, target.z);
                break;
            case 'back':
                camera.position.set(target.x, target.y + dist, target.z);
                break;
            case 'top':
                camera.position.set(target.x, target.y, target.z + dist);
                break;
            case 'bottom':
                camera.position.set(target.x, target.y, target.z - dist);
                break;
            case 'right':
                camera.position.set(target.x + dist, target.y, target.z);
                break;
            case 'left':
                camera.position.set(target.x - dist, target.y, target.z);
                break;
            case 'isometric':
            default:
                camera.position.set(target.x + dist * 0.7, target.y - dist * 0.7, target.z + dist * 0.7);
                break;
        }

        camera.up.set(0, 0, 1); // Z is UP in CAD
        camera.lookAt(target);
        controls.update();
    }

    function fit() {
        if (!currentModel) return;

        const box = new THREE.Box3().setFromObject(currentModel);
        if (box.isEmpty()) return;

        const center = new THREE.Vector3();
        box.getCenter(center);
        controls.target.copy(center);

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 0.85;
        cameraDistance = Math.max(cameraDistance, 50);

        const dir = new THREE.Vector3(1, -1, 1).normalize();
        camera.position.copy(center).add(dir.multiplyScalar(cameraDistance));
        camera.up.set(0, 0, 1);
        camera.lookAt(center);
        controls.update();
    }

    function getTelemetry() {
        if (!currentModel) {
            return {
                bbox: { x: 0, y: 0, z: 0 },
                volumeCm3: 0,
                areaCm2: 0,
                triangles: 0,
                vertices: 0
            };
        }

        const box = new THREE.Box3().setFromObject(currentModel);
        const size = new THREE.Vector3();
        box.getSize(size);

        let triangles = 0;
        let vertices = 0;
        let totalAreaMm2 = 0;

        currentModel.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const geom = child.geometry;
                if (geom.index) {
                    triangles += geom.index.count / 3;
                } else if (geom.attributes.position) {
                    triangles += geom.attributes.position.count / 3;
                }
                if (geom.attributes.position) {
                    vertices += geom.attributes.position.count;
                }
            }
        });

        // Approximate engineering volume & area
        const volumeMm3 = Math.max(1, size.x * size.y * size.z * 0.55);
        totalAreaMm2 = 2 * (size.x * size.y + size.y * size.z + size.x * size.z) * 0.7;

        return {
            bbox: {
                x: size.x.toFixed(1),
                y: size.y.toFixed(1),
                z: size.z.toFixed(1)
            },
            volumeCm3: (volumeMm3 / 1000.0).toFixed(2),
            areaCm2: (totalAreaMm2 / 100.0).toFixed(2),
            triangles: Math.round(triangles),
            vertices: Math.round(vertices)
        };
    }

    function takeScreenshot() {
        renderer.render(scene, camera);
        return canvas.toDataURL('image/png');
    }

    function onResize() {
        if (!container || !renderer || !camera) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    return {
        init: init
    };
})();
