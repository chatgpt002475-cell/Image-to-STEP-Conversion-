/**
 * ImageCAD Web - Main Application Coordinator
 * Binds SolidWorks ribbon tabs, PropertyManager controls, FeatureManager tree,
 * task pane image preview, sample loading, and multi-format exporters.
 */

(function() {
    'use strict';

    let viewport;
    let currentImage = null;
    let currentTrace = null;
    let currentSolid = null;
    let featureCounter = 1;
    let featuresList = [];

    // Default configuration matching desktop ImageCAD
    const state = {
        mode: 'extrude',
        method: 'otsu',
        threshold: 128,
        invert: false,
        keepHoles: true,
        blur: 1,
        morph: 1,
        simplify: 1.2,
        minArea: 80,
        smooth: 0,
        widthMm: 100.0,
        thickness: 10.0,
        base: 2.0,
        levels: 4,
        reliefRes: 64,
        reliefInvert: false,
        revolveAngle: 360.0,
        symmetric: false
    };

    window.addEventListener('DOMContentLoaded', initApp);

    function initApp() {
        // 1. Initialize Viewport
        const canvas = document.getElementById('sw-canvas');
        const container = document.getElementById('sw-viewport-container');
        viewport = CadViewport.init(canvas, container);

        // 2. Setup UI event bindings
        setupRibbonTabs();
        setupLeftTabs();
        setupPropertyManager();
        setupHeadsUpToolbar();
        setupExporters();
        setupSamples();
        setupModals();

        // 3. Setup File Upload & Drag-and-Drop
        setupFileUpload();

        // 4. Load initial sample (bracket.png)
        loadSampleImage('samples/bracket.png', 'bracket.png');

        updateStatus("Ready — ImageCAD SolidWorks Web CAD Studio loaded.");
    }

    // --- Ribbon Tabs ---
    function setupRibbonTabs() {
        const tabs = document.querySelectorAll('.sw-ribbon-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const targetId = 'ribbon-' + tab.dataset.tab;
                document.querySelectorAll('.sw-ribbon-tab-content').forEach(c => {
                    c.classList.remove('active');
                });
                const target = document.getElementById(targetId);
                if (target) target.classList.add('active');
            });
        });

        // Feature tools in ribbon
        document.getElementById('tool-extrude')?.addEventListener('click', () => startFeatureMode('extrude'));
        document.getElementById('tool-revolve')?.addEventListener('click', () => startFeatureMode('revolve'));
        document.getElementById('tool-levels')?.addEventListener('click', () => startFeatureMode('levels'));
        document.getElementById('tool-relief')?.addEventListener('click', () => startFeatureMode('relief'));

        // Measure & Mass props
        document.getElementById('tool-measure')?.addEventListener('click', showMeasureDialog);
        document.getElementById('tool-mass')?.addEventListener('click', showMassPropsDialog);
        document.getElementById('tool-about')?.addEventListener('click', showAboutDialog);
    }

    // --- Left Tabs (FeatureManager vs PropertyManager) ---
    function setupLeftTabs() {
        const tabs = document.querySelectorAll('.sw-left-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                switchLeftTab(tab.dataset.pane);
            });
        });
    }

    function switchLeftTab(paneName) {
        document.querySelectorAll('.sw-left-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.pane === paneName);
        });
        document.querySelectorAll('.sw-left-pane').forEach(p => {
            p.classList.toggle('active', p.id === 'pane-' + paneName);
        });
    }

    // --- PropertyManager Controls ---
    function setupPropertyManager() {
        // Mode dropdown
        const selMode = document.getElementById('pm-mode');
        if (selMode) {
            selMode.addEventListener('change', (e) => {
                state.mode = e.target.value;
                updatePmVisibility();
                rebuildCAD();
            });
        }

        // Detection Method
        const selMethod = document.getElementById('pm-method');
        if (selMethod) {
            selMethod.addEventListener('change', (e) => {
                state.method = e.target.value;
                const manualRow = document.getElementById('row-manual-threshold');
                if (manualRow) manualRow.style.display = (state.method === 'manual') ? 'flex' : 'none';
                rebuildCAD();
            });
        }

        // Sliders & inputs
        bindInput('pm-threshold', 'threshold', (val) => {
            document.getElementById('pm-threshold-val').textContent = val;
        });
        bindInput('pm-invert', 'invert', null, true);
        bindInput('pm-holes', 'keepHoles', null, true);
        bindInput('pm-blur', 'blur');
        bindInput('pm-morph', 'morph');
        bindInput('pm-simplify', 'simplify');
        bindInput('pm-minarea', 'minArea');
        bindInput('pm-smooth', 'smooth');

        bindInput('pm-width', 'widthMm');
        bindInput('pm-thick', 'thickness');
        bindInput('pm-base', 'base');
        bindInput('pm-levels', 'levels');
        bindInput('pm-res', 'reliefRes');
        bindInput('pm-angle', 'revolveAngle');
        bindInput('pm-symmetric', 'symmetric', null, true);
        bindInput('pm-rinvert', 'reliefInvert', null, true);

        // Header buttons (OK, Preview, Cancel)
        document.getElementById('pm-btn-ok')?.addEventListener('click', () => {
            commitFeature();
            switchLeftTab('tree');
            updateStatus("Feature committed to FeatureManager tree.");
        });

        document.getElementById('pm-btn-preview')?.addEventListener('click', () => {
            rebuildCAD();
            updateStatus("Preview updated.");
        });

        document.getElementById('pm-btn-cancel')?.addEventListener('click', () => {
            switchLeftTab('tree');
        });
    }

    function bindInput(elementId, stateKey, onValChange, isCheckbox = false) {
        const el = document.getElementById(elementId);
        if (!el) return;

        el.addEventListener(isCheckbox ? 'change' : 'input', (e) => {
            if (isCheckbox) {
                state[stateKey] = e.target.checked;
            } else {
                state[stateKey] = parseFloat(e.target.value) || 0;
            }
            if (onValChange) onValChange(state[stateKey]);
            debounceRebuild();
        });
    }

    let rebuildTimer = null;
    function debounceRebuild() {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuildCAD, 150);
    }

    function updatePmVisibility() {
        const m = state.mode;
        const detBox = document.getElementById('group-detection');
        if (detBox) detBox.style.display = (m === 'relief') ? 'none' : 'block';

        const rowThick = document.getElementById('row-thick');
        if (rowThick) rowThick.style.display = (m === 'revolve') ? 'none' : 'flex';

        const rowBase = document.getElementById('row-base');
        if (rowBase) rowBase.style.display = (m === 'relief') ? 'flex' : 'none';

        const rowLevels = document.getElementById('row-levels');
        if (rowLevels) rowLevels.style.display = (m === 'levels') ? 'flex' : 'none';

        const rowRes = document.getElementById('row-res');
        if (rowRes) rowRes.style.display = (m === 'relief') ? 'flex' : 'none';

        const rowAngle = document.getElementById('row-angle');
        if (rowAngle) rowAngle.style.display = (m === 'revolve') ? 'flex' : 'none';

        const rowSym = document.getElementById('row-symmetric');
        if (rowSym) rowSym.style.display = (m === 'extrude') ? 'flex' : 'none';

        const rowRInvert = document.getElementById('row-rinvert');
        if (rowRInvert) rowRInvert.style.display = (m === 'relief') ? 'flex' : 'none';

        // Update title
        const titles = {
            'extrude': 'Boss-Extrude',
            'revolve': 'Revolve',
            'levels': 'Stepped-Relief',
            'relief': 'Heightmap Relief'
        };
        const titleEl = document.getElementById('pm-header-title');
        if (titleEl) titleEl.textContent = titles[m] || 'Image to CAD';
    }

    function startFeatureMode(mode) {
        state.mode = mode;
        const selMode = document.getElementById('pm-mode');
        if (selMode) selMode.value = mode;
        updatePmVisibility();
        switchLeftTab('pm');
        rebuildCAD();
    }

    // --- Heads-up View Toolbar ---
    function setupHeadsUpToolbar() {
        document.querySelectorAll('.sw-headsup-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                viewport.setView(btn.dataset.view);
            });
        });

        document.getElementById('btn-view-fit')?.addEventListener('click', () => {
            viewport.fit();
        });

        const selStyle = document.getElementById('sel-display-style');
        if (selStyle) {
            selStyle.addEventListener('change', (e) => {
                viewport.setDisplayStyle(e.target.value);
            });
        }

        const btnSection = document.getElementById('btn-view-section');
        let sectionActive = false;
        if (btnSection) {
            btnSection.addEventListener('click', () => {
                sectionActive = !sectionActive;
                btnSection.classList.toggle('active', sectionActive);
                viewport.toggleClipping(sectionActive);
            });
        }
    }

    // --- Core Rebuild Pipeline ---
    function rebuildCAD() {
        if (!currentImage) return;

        updateStatus("Tracing outlines & building CAD solid...");

        // 1. Image vectorization
        currentTrace = ImageProcessor.traceImage(currentImage, state);

        // 2. Render vector overlay on right task pane preview
        renderPreviewOverlay(currentImage, currentTrace);

        // 3. Generate 3D CAD solid
        currentSolid = CadEngine.buildSolid(currentTrace, state);

        if (currentSolid) {
            viewport.setModel(currentSolid);
            updateTelemetry();
            updateStatus(`Solid rebuilt: ${currentTrace.contours.length} contour(s) generated.`);
        } else {
            updateStatus("Warning: No closed vector boundaries detected with current threshold.");
        }
    }

    function renderPreviewOverlay(img, trace) {
        const previewCanvas = document.getElementById('sw-preview-canvas');
        if (!previewCanvas) return;

        const ctx = previewCanvas.getContext('2d');
        previewCanvas.width = trace.widthPx;
        previewCanvas.height = trace.heightPx;

        // Draw source image
        ctx.drawImage(img, 0, 0, trace.widthPx, trace.heightPx);

        // Draw traced contours
        ctx.lineWidth = 1.8;
        for (const c of trace.contours) {
            // Outer contour (Cyan / Blue)
            ctx.strokeStyle = '#0066ff';
            ctx.beginPath();
            const outer = c.outerPixels;
            ctx.moveTo(outer[0][0], outer[0][1]);
            for (let i = 1; i < outer.length; i++) {
                ctx.lineTo(outer[i][0], outer[i][1]);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner holes (Red / Orange)
            if (c.holes) {
                ctx.strokeStyle = '#e65100';
                for (const hole of c.holes) {
                    const hp = hole.pixels;
                    ctx.beginPath();
                    ctx.moveTo(hp[0][0], hp[0][1]);
                    for (let i = 1; i < hp.length; i++) {
                        ctx.lineTo(hp[i][0], hp[i][1]);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
            }
        }
    }

    function updateTelemetry() {
        const t = viewport.getTelemetry();
        document.getElementById('tel-bbox').textContent = `${t.bbox.x} × ${t.bbox.y} × ${t.bbox.z} mm`;
        document.getElementById('tel-volume').textContent = `${t.volumeCm3} cm³`;
        document.getElementById('tel-area').textContent = `${t.areaCm2} cm²`;
        document.getElementById('tel-tris').textContent = `${t.triangles} ▲`;
        document.getElementById('tel-verts').textContent = `${t.vertices} pts`;
    }

    function commitFeature() {
        const featName = `${state.mode === 'extrude' ? 'Boss-Extrude' : state.mode === 'revolve' ? 'Revolve' : 'Relief'}${featureCounter++}`;
        featuresList.push({
            name: featName,
            mode: state.mode,
            params: Object.assign({}, state)
        });
        updateFeatureTree();
    }

    function updateFeatureTree() {
        const treeList = document.getElementById('sw-feature-tree');
        if (!treeList) return;

        // Preserve base items (Planes, Origin)
        let html = `
            <li class="sw-tree-item"><span class="sw-tree-icon">🧱</span> Material &lt;AISI 6061-T6&gt;</li>
            <li class="sw-tree-item"><span class="sw-tree-icon">📐</span> Front Plane</li>
            <li class="sw-tree-item"><span class="sw-tree-icon">📐</span> Top Plane</li>
            <li class="sw-tree-item"><span class="sw-tree-icon">📐</span> Right Plane</li>
            <li class="sw-tree-item"><span class="sw-tree-icon">📍</span> Origin</li>
        `;

        featuresList.forEach((feat, index) => {
            const isLast = (index === featuresList.length - 1);
            html += `
                <li class="sw-tree-item ${isLast ? 'selected' : ''}">
                    <span class="sw-tree-icon">📦</span> ${feat.name}
                </li>
            `;
        });

        treeList.innerHTML = html;
    }

    // --- File Upload & Drag-and-Drop ---
    function setupFileUpload() {
        const fileInput = document.getElementById('sw-file-input');
        const btnOpenImg = document.getElementById('tool-open-img');
        const menuOpenImg = document.getElementById('menu-open-img');

        const triggerUpload = () => fileInput && fileInput.click();
        if (btnOpenImg) btnOpenImg.addEventListener('click', triggerUpload);
        if (menuOpenImg) menuOpenImg.addEventListener('click', triggerUpload);

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleImageFile(file);
            });
        }

        // Drag and drop onto viewport
        const dropZone = document.getElementById('sw-viewport-container');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    handleImageFile(file);
                }
            });
        }
    }

    function handleImageFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                currentImage = img;
                document.getElementById('pm-source-name').textContent = file.name;
                switchLeftTab('pm');
                rebuildCAD();
                updateStatus(`Loaded image: ${file.name}`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- Sample Loading ---
    function setupSamples() {
        document.querySelectorAll('.sw-sample-card').forEach(card => {
            card.addEventListener('click', () => {
                const src = card.dataset.src;
                const mode = card.dataset.mode || 'extrude';
                state.mode = mode;
                const selMode = document.getElementById('pm-mode');
                if (selMode) selMode.value = mode;
                updatePmVisibility();
                loadSampleImage(src, card.dataset.name);
            });
        });
    }

    function loadSampleImage(src, name) {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            const srcNameEl = document.getElementById('pm-source-name');
            if (srcNameEl) srcNameEl.textContent = name;
            rebuildCAD();
        };
        img.src = src;
    }

    // --- Exporters ---
    function setupExporters() {
        const triggerExport = (format) => {
            if (!currentSolid) {
                alert("Please build a 3D model first.");
                return;
            }

            const model = viewport.getCurrentModel();
            const filename = `ImageCAD_Part_${Date.now()}`;

            updateStatus(`Exporting ${format.toUpperCase()} model...`);

            if (format === 'step') {
                if (window.StepExporter) {
                    window.StepExporter.export(model, filename + '.step');
                }
            } else if (format === 'iges') {
                if (window.IgesExporter) {
                    window.IgesExporter.export(model, filename + '.igs');
                }
            } else if (format === 'stl') {
                if (window.StlExporter) {
                    window.StlExporter.exportBinary(model, filename + '.stl');
                }
            } else if (format === 'obj') {
                if (window.ObjExporter) {
                    window.ObjExporter.export(model, filename + '.obj');
                }
            } else if (format === 'dxf') {
                if (window.DxfExporter && currentTrace) {
                    window.DxfExporter.export2D(currentTrace, filename + '.dxf');
                }
            }
            updateStatus(`Export completed: ${filename}`);
        };

        document.getElementById('tool-export-step')?.addEventListener('click', () => triggerExport('step'));
        document.getElementById('tool-export-iges')?.addEventListener('click', () => triggerExport('iges'));
        document.getElementById('tool-export-stl')?.addEventListener('click', () => triggerExport('stl'));
        document.getElementById('tool-export-obj')?.addEventListener('click', () => triggerExport('obj'));
        document.getElementById('tool-export-dxf')?.addEventListener('click', () => triggerExport('dxf'));

        document.getElementById('menu-export-step')?.addEventListener('click', () => triggerExport('step'));
        document.getElementById('menu-export-iges')?.addEventListener('click', () => triggerExport('iges'));
        document.getElementById('menu-export-stl')?.addEventListener('click', () => triggerExport('stl'));
        document.getElementById('menu-export-obj')?.addEventListener('click', () => triggerExport('obj'));
    }

    // --- Dialogs ---
    function setupModals() {
        document.querySelectorAll('.sw-modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sw-modal-overlay').forEach(m => m.style.display = 'none');
            });
        });
    }

    function showMeasureDialog() {
        const t = viewport.getTelemetry();
        document.getElementById('measure-details').innerHTML = `
            <strong>Length (X):</strong> ${t.bbox.x} mm<br>
            <strong>Width (Y):</strong> ${t.bbox.y} mm<br>
            <strong>Height / Depth (Z):</strong> ${t.bbox.z} mm<br>
            <strong>Diagonal Distance:</strong> ${Math.hypot(t.bbox.x, t.bbox.y, t.bbox.z).toFixed(2)} mm
        `;
        document.getElementById('modal-measure').style.display = 'flex';
    }

    function showMassPropsDialog() {
        const t = viewport.getTelemetry();
        const density = 0.0027; // Aluminum 6061 g/mm3
        const massGrams = (parseFloat(t.volumeCm3) * 1000 * density).toFixed(2);
        document.getElementById('mass-details').innerHTML = `
            <strong>Material:</strong> 6061-T6 Aluminum (Density: 2.70 g/cm³)<br>
            <strong>Mass:</strong> ${massGrams} grams<br>
            <strong>Volume:</strong> ${t.volumeCm3} cm³<br>
            <strong>Surface Area:</strong> ${t.areaCm2} cm²<br>
            <strong>Center of Mass:</strong> (0.00, 0.00, ${(t.bbox.z / 2).toFixed(2)}) mm
        `;
        document.getElementById('modal-mass').style.display = 'flex';
    }

    function showAboutDialog() {
        document.getElementById('modal-about').style.display = 'flex';
    }

    function updateStatus(msg) {
        const el = document.getElementById('sw-status-msg');
        if (el) el.textContent = msg;
    }

})();
