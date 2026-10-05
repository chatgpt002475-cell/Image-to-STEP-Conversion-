/**
 * Main Application Controller for Image-to-STEP Pro
 * Coordinates UI, Image Processing, CAD Generation, 3D Viewport, and Exporters.
 */

class ImageToCadApp {
    constructor() {
        this.currentMode = 'extrude'; // 'extrude', 'revolve', 'relief', 'parametric'
        this.inputMode = 'upload';    // 'upload', 'preset', 'sketch'
        this.currentImg = null;
        this.processedData = null;
        this.currentContours = [];
        this.currentGeometry = null;
        this.debounceTimer = null;

        this.init();
    }

    async init() {
        // Initialize Viewport
        this.viewport = new window.CadViewport('viewport-container');
        this.viewport.onTelemetryUpdate = (telemetry) => this.updateTelemetryUI(telemetry);

        // Initialize 2D Sketcher
        this.sketcher = new window.CadSketcher('sketcher-canvas', (dataUrl) => {
            this.handleSketchUpdate(dataUrl);
        });

        // Populate Presets list
        this.populatePresets();

        // Bind DOM Events
        this.bindEvents();

        // Load Default Preset (Industrial Flange)
        this.loadPreset('flange');
    }

    bindEvents() {
        // Mode Tabs (Extrude / Revolve / Relief / Parametric)
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                this.setMode(mode);
            });
        });

        // Input Source Tabs (Upload / Presets / Sketch)
        document.querySelectorAll('.input-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const source = e.currentTarget.dataset.source;
                this.setInputSource(source);
            });
        });

        // File & Folder Upload Controls
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        const btnSelectFile = document.getElementById('btn-select-file');
        const btnSelectFolder = document.getElementById('btn-select-folder');

        if (btnSelectFile) {
            btnSelectFile.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });
        }

        if (btnSelectFolder) {
            btnSelectFolder.addEventListener('click', (e) => {
                e.stopPropagation();
                folderInput.click();
            });
        }

        dropZone.addEventListener('click', (e) => {
            if (e.target !== btnSelectFile && e.target !== btnSelectFolder) {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                if (e.target.files.length === 1) {
                    this.handleImageFile(e.target.files[0]);
                } else {
                    this.handleMultipleFiles(Array.from(e.target.files));
                }
            }
        });

        if (folderInput) {
            folderInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.handleMultipleFiles(Array.from(e.target.files));
                }
            });
        }

        const btnRenderAll = document.getElementById('btn-render-all-folder-parts');
        if (btnRenderAll) {
            btnRenderAll.addEventListener('click', () => {
                this.renderFolderAssembly();
            });
        }

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            
            // Check for webkitGetAsEntry to support folders dropped directly!
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const collectedFiles = [];
                const queue = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
                    if (entry) {
                        queue.push(this.traverseFileTree(entry, collectedFiles));
                    } else if (items[i].kind === 'file') {
                        const f = items[i].getAsFile();
                        if (f && (f.type.startsWith('image/') || /\.(png|jpe?g|svg|webp|bmp)$/i.test(f.name))) {
                            collectedFiles.push(f);
                        }
                    }
                }
                await Promise.all(queue);
                if (collectedFiles.length > 1) {
                    this.handleMultipleFiles(collectedFiles);
                    return;
                } else if (collectedFiles.length === 1) {
                    this.handleImageFile(collectedFiles[0]);
                    return;
                }
            }

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                if (e.dataTransfer.files.length === 1) {
                    this.handleImageFile(e.dataTransfer.files[0]);
                } else {
                    this.handleMultipleFiles(Array.from(e.dataTransfer.files));
                }
            }
        });

        // Paste from clipboard (Ctrl+V)
        window.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const blob = item.getAsFile();
                    this.handleImageFile(blob);
                    this.showToast('Pasted image from clipboard');
                    break;
                }
            }
        });

        // Sliders & Controls with Debounced Regeneration
        const parameterInputs = document.querySelectorAll('.cad-param');
        parameterInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                // Update slider value badge
                const valDisplay = document.getElementById(`${e.target.id}-val`);
                if (valDisplay) {
                    valDisplay.textContent = e.target.value;
                }
                this.scheduleRegenerate();
            });
        });

        // Checkbox controls
        document.querySelectorAll('.cad-toggle').forEach(chk => {
            chk.addEventListener('change', () => this.scheduleRegenerate());
        });

        // Material Shading Buttons
        document.querySelectorAll('.shading-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.shading-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const style = btn.dataset.shader;
                this.viewport.setMaterialMode(style);
            });
        });

        // Camera Preset Views
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = btn.dataset.view;
                this.viewport.setView(view);
            });
        });

        // Section Plane Clipping Controls
        const clipToggle = document.getElementById('clip-toggle');
        const clipSlider = document.getElementById('clip-slider');
        const clipAxisSelect = document.getElementById('clip-axis');

        const updateClip = () => {
            const enabled = clipToggle.checked;
            const axis = clipAxisSelect.value;
            const offset = parseFloat(clipSlider.value);
            this.viewport.setClipping(enabled, axis, offset);
        };

        if (clipToggle) clipToggle.addEventListener('change', updateClip);
        if (clipSlider) clipSlider.addEventListener('input', updateClip);
        if (clipAxisSelect) clipAxisSelect.addEventListener('change', updateClip);

        // Pull to 3D Graphic Window Action (Sidebar & Header)
        const triggerPullTo3d = () => {
            if (!this.currentImg) {
                this.showToast('Please upload or select an image first', 'warning');
                return;
            }
            this.hasCustomImage = true;
            this.setMode('extrude', false);
            this.processAndGenerate();
            this.viewport.setView('iso');
            this.showToast('⚡ Pulled detected contours into 3D Graphic Window!', 'info');
        };

        const pullTo3dBtn = document.getElementById('btn-pull-to-3d');
        if (pullTo3dBtn) pullTo3dBtn.addEventListener('click', triggerPullTo3d);

        const headerPullTo3dBtn = document.getElementById('header-btn-pull-3d');
        if (headerPullTo3dBtn) headerPullTo3dBtn.addEventListener('click', triggerPullTo3d);

        // Export Buttons
        document.getElementById('export-step').addEventListener('click', () => this.exportStep());
        document.getElementById('export-stl-bin').addEventListener('click', () => this.exportStl(true));
        document.getElementById('export-stl-ascii').addEventListener('click', () => this.exportStl(false));
        document.getElementById('export-obj').addEventListener('click', () => this.exportObj());
        document.getElementById('export-dxf').addEventListener('click', () => this.exportDxf());
        document.getElementById('export-svg').addEventListener('click', () => this.exportSvg());

        // Studio View Mode Switcher (3D CAD Studio vs 2D Technical Drawing)
        const btnView3d = document.getElementById('view-mode-3d');
        const btnView2d = document.getElementById('view-mode-2d');
        const btnBackTo3d = document.getElementById('btn-back-to-3d');
        const viewportContainer = document.getElementById('viewport-container');
        const drawingContainer = document.getElementById('drawing-container');
        const viewportTopFloat = document.querySelector('.viewport-floating-top');
        const viewportViewsFloat = document.querySelector('.viewport-floating-views');
        const slicerWidget = document.querySelector('.slicer-widget');

        const switchTo3d = () => {
            this.currentViewMode = '3d';
            if (btnView3d) btnView3d.classList.add('active');
            if (btnView2d) btnView2d.classList.remove('active');
            if (viewportContainer) viewportContainer.classList.remove('hidden');
            if (drawingContainer) drawingContainer.classList.add('hidden');
            if (viewportTopFloat) viewportTopFloat.classList.remove('hidden');
            if (viewportViewsFloat) viewportViewsFloat.classList.remove('hidden');
            if (slicerWidget) slicerWidget.classList.remove('hidden');
        };

        const switchTo2d = () => {
            this.currentViewMode = '2d';
            if (btnView2d) btnView2d.classList.add('active');
            if (btnView3d) btnView3d.classList.remove('active');
            if (viewportContainer) viewportContainer.classList.add('hidden');
            if (drawingContainer) drawingContainer.classList.remove('hidden');
            if (viewportTopFloat) viewportTopFloat.classList.add('hidden');
            if (viewportViewsFloat) viewportViewsFloat.classList.add('hidden');
            if (slicerWidget) slicerWidget.classList.add('hidden');
            this.render2dDrawing();
        };

        if (btnView3d) btnView3d.addEventListener('click', switchTo3d);
        if (btnView2d) btnView2d.addEventListener('click', switchTo2d);
        if (btnBackTo3d) btnBackTo3d.addEventListener('click', switchTo3d);

        // Drawing theme select
        const themeSelect = document.getElementById('drawing-theme-select');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                if (window.CadDrawingGenerator) {
                    window.CadDrawingGenerator.theme = e.target.value;
                    this.render2dDrawing();
                }
            });
        }

        // Export Drawing SVG
        const btnExportDrawingSvg = document.getElementById('btn-export-drawing-svg');
        if (btnExportDrawingSvg) {
            btnExportDrawingSvg.addEventListener('click', () => {
                this.exportDrawingSvg();
            });
        }

        // Export Drawing PNG
        const btnExportDrawingPng = document.getElementById('btn-export-drawing-png');
        if (btnExportDrawingPng) {
            btnExportDrawingPng.addEventListener('click', () => {
                this.exportDrawingPng();
            });
        }

        // Sketcher tool buttons
        document.querySelectorAll('.sketch-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sketch-tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.sketcher.setTool(btn.dataset.tool);
            });
        });

        const brushSlider = document.getElementById('sketch-brush-size');
        if (brushSlider) {
            brushSlider.addEventListener('input', (e) => this.sketcher.setBrushSize(e.target.value));
        }

        const sketchClearBtn = document.getElementById('sketch-clear');
        if (sketchClearBtn) {
            sketchClearBtn.addEventListener('click', () => this.sketcher.clear());
        }

        const sketchUndoBtn = document.getElementById('sketch-undo');
        if (sketchUndoBtn) {
            sketchUndoBtn.addEventListener('click', () => this.sketcher.undo());
        }
    }

    populatePresets() {
        const container = document.getElementById('preset-grid');
        if (!container) return;
        container.innerHTML = '';

        window.CadPresets.presets.forEach(p => {
            const card = document.createElement('div');
            card.className = 'preset-card';
            card.dataset.id = p.id;
            card.innerHTML = `
                <div class="preset-badge">${p.category}</div>
                <div class="preset-name">${p.name}</div>
                <div class="preset-desc">${p.description}</div>
            `;
            card.addEventListener('click', () => {
                document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.loadPreset(p.id);
            });
            container.appendChild(card);
        });
    }

    async loadPreset(id) {
        const preset = window.CadPresets.getPreset(id);
        if (!preset) return;

        this.hasCustomImage = false;
        this.setMode(preset.recommendedMode, false);
        const dataUrl = preset.generate();
        await this.loadFromDataUrl(dataUrl, preset.name);
    }

    async traverseFileTree(item, collectedFiles) {
        if (item.isFile) {
            return new Promise((resolve) => {
                item.file((file) => {
                    if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|svg|webp|bmp)$/i.test(file.name))) {
                        collectedFiles.push(file);
                    }
                    resolve();
                }, () => resolve());
            });
        } else if (item.isDirectory) {
            return new Promise((resolve) => {
                const dirReader = item.createReader();
                const readEntries = () => {
                    dirReader.readEntries(async (entries) => {
                        if (entries.length === 0) {
                            resolve();
                        } else {
                            const subPromises = entries.map(entry => this.traverseFileTree(entry, collectedFiles));
                            await Promise.all(subPromises);
                            readEntries();
                        }
                    }, () => resolve());
                };
                readEntries();
            });
        }
    }

    async handleMultipleFiles(files) {
        const imageFiles = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|svg|webp|bmp)$/i.test(f.name));
        if (imageFiles.length === 0) {
            this.showToast('No image files found in folder', 'warning');
            return;
        }

        this.folderFiles = imageFiles;
        this.activeFolderIndex = 0;

        const container = document.getElementById('folder-parts-container');
        const titleEl = document.getElementById('folder-parts-title');
        const listEl = document.getElementById('folder-parts-list');
        if (container) container.classList.remove('hidden');
        if (titleEl) titleEl.textContent = `📁 Folder Parts (${imageFiles.length})`;

        if (listEl) {
            listEl.innerHTML = '';
            imageFiles.forEach((file, idx) => {
                const pill = document.createElement('div');
                pill.className = `part-pill ${idx === 0 ? 'active' : ''}`;
                pill.innerHTML = `<span>🧩</span> ${file.name}`;
                pill.title = file.name;
                pill.addEventListener('click', () => {
                    document.querySelectorAll('.part-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    this.activeFolderIndex = idx;
                    this.handleImageFile(file);
                });
                listEl.appendChild(pill);
            });
        }

        this.showToast(`📁 Loaded folder with ${imageFiles.length} CAD part images!`);
        await this.handleImageFile(imageFiles[0]);
    }

    async renderFolderAssembly() {
        if (!this.folderFiles || this.folderFiles.length === 0) {
            this.showToast('No folder parts loaded to assemble', 'warning');
            return;
        }

        this.setLoading(true, `Assembling ${this.folderFiles.length} folder parts in 3D...`);

        setTimeout(async () => {
            try {
                const targetWidthMm = parseFloat(document.getElementById('param-width').value) || 100;
                const depth = parseFloat(document.getElementById('param-extrude-depth').value) || 15;
                const epsilon = parseFloat(document.getElementById('param-epsilon').value) || 1.5;
                const autoThreshold = document.getElementById('param-auto-thresh').checked;
                const threshold = parseInt(document.getElementById('param-threshold').value, 10);
                const blur = parseInt(document.getElementById('param-blur').value, 10);

                const assembledGeometries = [];
                let currentOffsetX = 0;
                const partSpacing = targetWidthMm * 0.25;

                for (let i = 0; i < this.folderFiles.length; i++) {
                    const file = this.folderFiles[i];
                    const img = await window.ImageProcessor.loadImage(file);
                    const processed = window.ImageProcessor.processCanvas(img, {
                        threshold,
                        autoThreshold,
                        invert: document.getElementById('param-invert').checked,
                        blur
                    });

                    const contours = window.ImageProcessor.extractContours(processed.binary, processed.width, processed.height);
                    if (contours && contours.length > 0) {
                        const res = window.CadGenerator.createExtrudedSolid(contours, {
                            depth,
                            targetWidthMm,
                            epsilon,
                            centerAtOrigin: true
                        });

                        if (res && res.geometry) {
                            const partW = res.dimensions.width;
                            res.geometry.translate(currentOffsetX + partW / 2, 0, 0);
                            currentOffsetX += partW + partSpacing;
                            assembledGeometries.push(res.geometry);
                        }
                    }
                }

                if (assembledGeometries.length > 0) {
                    const finalAssembly = window.CadGenerator.mergeGeometries(assembledGeometries);
                    finalAssembly.computeVertexNormals();
                    this.currentGeometry = finalAssembly;
                    this.viewport.setModel(finalAssembly);
                    this.viewport.setView('iso');
                    this.showToast(`⚡ Successfully assembled ${assembledGeometries.length} folder parts in 3D!`);
                } else {
                    this.showToast('Could not extract 3D contours from folder images', 'warning');
                }
            } catch (err) {
                console.error('Folder Assembly Error:', err);
                this.showToast('Assembly error: ' + err.message, 'error');
            } finally {
                this.setLoading(false);
            }
        }, 30);
    }

    async handleImageFile(file) {
        try {
            const img = await window.ImageProcessor.loadImage(file);
            this.currentImg = img;
            this.hasCustomImage = true;
            this.showToast(`Loaded ${file.name || 'image'}`);
            
            // Auto-detect if image has dark background
            try {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = 100;
                tempCanvas.height = 100;
                const tctx = tempCanvas.getContext('2d');
                tctx.drawImage(img, 0, 0, 100, 100);
                const idata = tctx.getImageData(0, 0, 100, 100).data;
                const tgray = new Uint8Array(100 * 100);
                for (let i = 0; i < idata.length; i += 4) {
                    tgray[i / 4] = Math.round(0.299 * idata[i] + 0.587 * idata[i+1] + 0.114 * idata[i+2]);
                }
                const isDarkBg = window.ImageProcessor.detectBackgroundDark(tgray, 100, 100);
                const invertChk = document.getElementById('param-invert');
                if (invertChk) {
                    invertChk.checked = isDarkBg;
                }
            } catch(e) {
                console.warn('Auto polarity check skipped:', e);
            }

            // Keep Sheet Metal mode if user was already in Sheet Metal mode, otherwise switch to Extrude
            const targetMode = (this.currentMode === 'sheetmetal') ? 'sheetmetal' : 'extrude';
            this.setMode(targetMode, false);
            this.processAndGenerate();
            this.viewport.setView('iso');
        } catch (err) {
            console.error(err);
            this.showToast('Failed to load image: ' + err.message, 'error');
        }
    }

    async loadFromDataUrl(dataUrl, name = 'Preset') {
        try {
            const img = await window.ImageProcessor.loadImage(dataUrl);
            this.currentImg = img;
            this.processAndGenerate();
        } catch (err) {
            console.error(err);
            this.showToast('Error loading preset', 'error');
        }
    }

    handleSketchUpdate(dataUrl) {
        if (this.inputMode !== 'sketch') return;
        this.loadFromDataUrl(dataUrl, 'Sketch');
    }

    setMode(mode, triggerGen = true) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === mode);
        });

        // Show/hide mode-specific parameter groups
        document.querySelectorAll('.param-group').forEach(group => {
            group.classList.toggle('hidden', group.dataset.mode !== mode && group.dataset.mode !== 'all');
        });

        if (triggerGen) {
            this.processAndGenerate();
        }
    }

    setInputSource(source) {
        this.inputMode = source;
        document.querySelectorAll('.input-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.source === source);
        });

        document.getElementById('upload-panel').classList.toggle('hidden', source !== 'upload');
        document.getElementById('preset-panel').classList.toggle('hidden', source !== 'preset');
        document.getElementById('sketch-panel').classList.toggle('hidden', source !== 'sketch');

        if (source === 'sketch') {
            this.handleSketchUpdate(this.sketcher.getImageDataUrl());
        }
    }

    scheduleRegenerate() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.processAndGenerate();
        }, 120);
    }

    setLoading(isLoading, text = 'Generating 3D CAD Model...') {
        const overlay = document.getElementById('loading-overlay');
        const textEl = document.getElementById('loading-text');
        if (overlay) {
            overlay.classList.toggle('hidden', !isLoading);
            if (textEl && text) textEl.textContent = text;
        }
    }

    // Main CAD Generation Pipeline (Non-blocking async)
    processAndGenerate() {
        if (!this.currentImg) return;

        this.setLoading(true, 'Extracting CAD geometry...');

        // Yield execution to browser paint to show the spinner immediately
        setTimeout(() => {
            try {
                // Read UI parameter values
                const threshold = parseInt(document.getElementById('param-threshold').value, 10);
                const autoThreshold = document.getElementById('param-auto-thresh').checked;
                const invert = document.getElementById('param-invert').checked;
                const blur = parseInt(document.getElementById('param-blur').value, 10);
                const epsilon = parseFloat(document.getElementById('param-epsilon').value);
                const targetWidthMm = parseFloat(document.getElementById('param-width').value);

                // 1. Process 2D Image onto canvas
                const processed = window.ImageProcessor.processCanvas(this.currentImg, {
                    threshold,
                    autoThreshold,
                    invert,
                    blur
                });
                this.processedData = processed;

                // Update 2D Preview Canvas in UI
                this.update2DPreview(processed);

                // 2. Extract closed vector contours
                const contours = window.ImageProcessor.extractContours(processed.binary, processed.width, processed.height);
                this.currentContours = contours;

                // 3. Feature detection for mechanical parameters
                const features = window.ImageProcessor.detectMechanicalFeatures(contours, processed.width, processed.height);
                this.updateDetectedFeaturesUI(features);

                // 4. Generate 3D CAD Geometry based on selected mode
                let cadResult = null;

                if (this.currentMode === 'sheetmetal') {
                    if (this.hasCustomImage && contours && contours.length > 0) {
                        // Extrude uploaded custom image contours with sheet gauge thickness
                        const thickness = parseFloat(document.getElementById('param-sm-thick').value);
                        const targetWidthMm = parseFloat(document.getElementById('param-width').value);
                        const epsilon = parseFloat(document.getElementById('param-epsilon').value);

                        cadResult = window.CadGenerator.createExtrudedSolid(contours, {
                            depth: thickness,
                            bevelEnabled: true,
                            bevelThickness: 0.2,
                            bevelSize: 0.2,
                            targetWidthMm,
                            epsilon
                        });
                    } else {
                        // Parametric Chassis Bracket preset
                        const thickness = parseFloat(document.getElementById('param-sm-thick').value);
                        const width = parseFloat(document.getElementById('param-sm-width').value);
                        const height = parseFloat(document.getElementById('param-sm-height').value);
                        const sideDepth = parseFloat(document.getElementById('param-sm-side-depth').value);
                        const topTab = parseFloat(document.getElementById('param-sm-top-tab').value);
                        const footLen = parseFloat(document.getElementById('param-sm-foot-len').value);
                        const notchW = parseFloat(document.getElementById('param-sm-notch-w').value);
                        const notchH = parseFloat(document.getElementById('param-sm-notch-h').value);
                        const holeDia = parseFloat(document.getElementById('param-sm-hole-dia').value);
                        const gusset = document.getElementById('param-sm-gusset').checked;

                        cadResult = window.CadGenerator.createSheetMetalBracket({
                            thickness,
                            width,
                            height,
                            sideDepth,
                            topTabLength: topTab,
                            bottomFootLength: footLen,
                            notchWidth: notchW,
                            notchHeight: notchH,
                            holeDia,
                            hasGusset: gusset,
                            hasTabs: true
                        });
                    }
                } else if (this.currentMode === 'extrude') {
                    const depth = parseFloat(document.getElementById('param-extrude-depth').value);
                    const bevel = document.getElementById('param-extrude-bevel').checked;
                    const bevelThickness = parseFloat(document.getElementById('param-bevel-thick').value);

                    cadResult = window.CadGenerator.createExtrudedSolid(contours, {
                        depth,
                        bevelEnabled: bevel,
                        bevelThickness,
                        bevelSize: bevelThickness,
                        targetWidthMm,
                        epsilon
                    });
                } else if (this.currentMode === 'revolve') {
                    const targetHeightMm = parseFloat(document.getElementById('param-revolve-height').value);
                    const targetRadiusMm = parseFloat(document.getElementById('param-revolve-radius').value);
                    const angleDeg = parseFloat(document.getElementById('param-revolve-angle').value);
                    const segments = parseInt(document.getElementById('param-revolve-segments').value, 10);
                    const hollow = document.getElementById('param-revolve-hollow').checked;

                    cadResult = window.CadGenerator.createRevolvedSolid(contours, {
                        targetHeightMm,
                        targetRadiusMm,
                        revolveAngleDeg: angleDeg,
                        radialSegments: segments,
                        hollow,
                        wallThickness: 4,
                        epsilon
                    });
                } else if (this.currentMode === 'relief') {
                    const reliefDepth = parseFloat(document.getElementById('param-relief-depth').value);
                    const baseThickness = parseFloat(document.getElementById('param-relief-base').value);
                    const invertRelief = document.getElementById('param-relief-invert').checked;

                    const heightmap = window.ImageProcessor.sampleHeightmap(
                        processed.gray,
                        processed.width,
                        processed.height,
                        96,
                        invertRelief
                    );

                    cadResult = window.CadGenerator.createHeightmapSolid(heightmap, {
                        widthMm: targetWidthMm,
                        heightMm: (targetWidthMm * processed.height) / processed.width,
                        reliefDepthMm: reliefDepth,
                        baseThicknessMm: baseThickness
                    });
                } else if (this.currentMode === 'parametric') {
                const flangeOD = parseFloat(document.getElementById('param-flange-od').value);
                const boreID = parseFloat(document.getElementById('param-flange-bore').value);
                const thickness = parseFloat(document.getElementById('param-flange-thick').value);
                const bossOD = parseFloat(document.getElementById('param-flange-boss-od').value);
                const bossHeight = parseFloat(document.getElementById('param-flange-boss-h').value);
                const boltPCD = parseFloat(document.getElementById('param-flange-pcd').value);
                const boltCount = parseInt(document.getElementById('param-flange-bolt-n').value, 10);
                const boltDia = parseFloat(document.getElementById('param-flange-bolt-dia').value);
                const keyway = document.getElementById('param-flange-keyway').checked;

                cadResult = window.CadGenerator.createParametricFlange({
                    flangeOD,
                    boreID,
                    flangeThickness: thickness,
                    bossOD,
                    bossHeight,
                    boltPCD,
                    boltCount,
                    boltDiameter: boltDia,
                    hasKeyway: keyway
                });
            }

            if (cadResult && cadResult.geometry) {
                this.currentGeometry = cadResult.geometry;
                this.currentDimensions = cadResult.dimensions;
                this.lastFeatures = features;
                this.viewport.setModel(cadResult.geometry);
                if (this.currentViewMode === '2d') {
                    this.render2dDrawing();
                }
            }
        } catch (err) {
            console.error('CAD Generation Error:', err);
            this.showToast('CAD Error: ' + err.message, 'warning');
        } finally {
            this.setLoading(false);
        }
    }, 20);
}

    update2DPreview(processed) {
        const previewCanvas = document.getElementById('image-preview-canvas');
        if (!previewCanvas) return;
        previewCanvas.width = processed.width;
        previewCanvas.height = processed.height;
        const ctx = previewCanvas.getContext('2d');
        ctx.drawImage(processed.canvas, 0, 0);

        // Overlay extracted vector contours
        if (this.currentContours && this.currentContours.length > 0) {
            this.currentContours.forEach(c => {
                if (c.points.length < 2) return;
                ctx.strokeStyle = c.isHole ? '#00e5ff' : '#ff3366';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(c.points[0].x, c.points[0].y);
                for (let i = 1; i < c.points.length; i++) {
                    ctx.lineTo(c.points[i].x, c.points[i].y);
                }
                ctx.closePath();
                ctx.stroke();
            });
        }
    }

    updateDetectedFeaturesUI(features) {
        const badge = document.getElementById('detected-features-badge');
        if (badge) {
            const partCount = this.currentContours ? this.currentContours.filter(c => !c.isHole).length : 1;
            const holeCount = this.currentContours ? this.currentContours.filter(c => c.isHole).length : 0;
            if (partCount > 1) {
                badge.textContent = `Auto-Detected: ${partCount} Solid Parts | ${holeCount} Holes | Size ${features.flangeOD}mm`;
            } else {
                badge.textContent = `Auto-Detected: OD ${features.flangeOD}mm | Bore ${features.boreID}mm | ${holeCount} Holes`;
            }
        }

        // Auto-fill parametric inputs if user hasn't modified them manually
        const odInput = document.getElementById('param-flange-od');
        const boreInput = document.getElementById('param-flange-bore');
        const pcdInput = document.getElementById('param-flange-pcd');
        const boltCountInput = document.getElementById('param-flange-bolt-n');
        const boltDiaInput = document.getElementById('param-flange-bolt-dia');

        if (odInput && !odInput.dataset.dirty) {
            odInput.value = features.flangeOD;
            document.getElementById('param-flange-od-val').textContent = features.flangeOD;
        }
        if (boreInput && !boreInput.dataset.dirty) {
            boreInput.value = features.boreID;
            document.getElementById('param-flange-bore-val').textContent = features.boreID;
        }
        if (pcdInput && !pcdInput.dataset.dirty) {
            pcdInput.value = features.boltPCD;
            document.getElementById('param-flange-pcd-val').textContent = features.boltPCD;
        }
        if (boltCountInput && !boltCountInput.dataset.dirty) {
            boltCountInput.value = features.boltCount;
            document.getElementById('param-flange-bolt-n-val').textContent = features.boltCount;
        }
        if (boltDiaInput && !boltDiaInput.dataset.dirty) {
            boltDiaInput.value = features.boltDiameter;
            document.getElementById('param-flange-bolt-dia-val').textContent = features.boltDiameter;
        }
    }

    updateTelemetryUI(t) {
        document.getElementById('stat-dim').textContent = `${t.widthMm} × ${t.depthMm} × ${t.heightMm} mm`;
        document.getElementById('stat-vol').textContent = `${t.volumeCm3} cm³`;
        document.getElementById('stat-area').textContent = `${t.surfaceAreaCm2} cm²`;
        document.getElementById('stat-tris').textContent = `${t.triangles} ▲`;
        document.getElementById('stat-verts').textContent = `${t.vertices} pts`;
    }

    // Exporters
    exportStep() {
        if (!this.currentGeometry) {
            this.showToast('No CAD model generated yet', 'error');
            return;
        }
        this.showToast('Generating ISO 10303-21 STEP AP214 file...');
        window.StepExporter.downloadStep(this.currentGeometry, `cad_model_${this.currentMode}.step`);
    }

    exportStl(binary = true) {
        if (!this.currentGeometry) {
            this.showToast('No CAD model generated yet', 'error');
            return;
        }
        const formatName = binary ? 'Binary STL' : 'ASCII STL';
        this.showToast(`Exporting ${formatName}...`);
        window.StlExporter.downloadStl(this.currentGeometry, `cad_model_${this.currentMode}.stl`, binary);
    }

    exportObj() {
        if (!this.currentGeometry) {
            this.showToast('No CAD model generated yet', 'error');
            return;
        }
        this.showToast('Exporting Wavefront OBJ mesh...');
        window.ObjExporter.downloadObj(this.currentGeometry, `cad_model_${this.currentMode}.obj`);
    }

    exportDxf() {
        if (!this.currentContours || this.currentContours.length === 0) {
            this.showToast('No 2D contours available for DXF', 'error');
            return;
        }
        this.showToast('Exporting AutoCAD DXF (R12/2000)...');
        const scale = parseFloat(document.getElementById('param-width').value) / (this.processedData.width || 400);
        window.DxfExporter.downloadDxf(this.currentContours, scale, `cad_contours_${this.currentMode}.dxf`);
    }

    exportSvg() {
        if (!this.currentContours || this.currentContours.length === 0) {
            this.showToast('No 2D contours available for SVG', 'error');
            return;
        }
        this.showToast('Exporting SVG Cut Paths...');
        const scale = parseFloat(document.getElementById('param-width').value) / (this.processedData.width || 400);
        window.SvgExporter.downloadSvg(this.currentContours, this.processedData.width, this.processedData.height, scale, `cad_vectors.svg`);
    }

    render2dDrawing() {
        const canvas = document.getElementById('drawing-canvas');
        if (!canvas || !window.CadDrawingGenerator) return;

        const dimensions = this.currentDimensions || { width: 115, height: 105, depth: 15 };
        const thickness = parseFloat(document.getElementById('param-sm-thick') ? document.getElementById('param-sm-thick').value : 1.8);
        const features = this.lastFeatures || { flangeOD: 115, boreID: 34, boltCount: 4, boltDiameter: 6.5 };

        window.CadDrawingGenerator.renderDrawing(canvas, {
            contours: this.currentContours,
            dimensions,
            thickness,
            partName: this.currentPartName || 'SHEET METAL BRACKET',
            drawingNo: 'DWG-CATIA-' + Math.floor(1000 + Math.random() * 9000),
            material: 'ALUMINIUM 6061-T6',
            scaleRatio: '1:1',
            features
        });
    }

    exportDrawingSvg() {
        if (!window.CadDrawingGenerator) return;
        const dimensions = this.currentDimensions || { width: 115, height: 105, depth: 15 };
        const thickness = parseFloat(document.getElementById('param-sm-thick') ? document.getElementById('param-sm-thick').value : 1.8);
        const svgStr = window.CadDrawingGenerator.exportDrawingSvg({
            dimensions,
            thickness,
            partName: this.currentPartName || 'SHEET METAL BRACKET',
            drawingNo: 'DWG-CATIA-001',
            material: 'ALUMINIUM 6061-T6'
        });
        this.downloadFile(svgStr, 'CATIA_2D_Engineering_Drawing.svg', 'image/svg+xml');
        this.showToast('Downloaded 2D Vector Drawing (SVG)');
    }

    exportDrawingPng() {
        const canvas = document.getElementById('drawing-canvas');
        if (!canvas) return;
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'CATIA_2D_Blueprint_Sheet.png';
        link.href = dataUrl;
        link.click();
        this.showToast('Downloaded High-Res 2D Blueprint (PNG)');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        setTimeout(() => {
            toast.className = 'toast';
        }, 3200);
    }
}

// Start app when DOM loads
window.addEventListener('DOMContentLoaded', () => {
    window.app = new ImageToCadApp();
});
