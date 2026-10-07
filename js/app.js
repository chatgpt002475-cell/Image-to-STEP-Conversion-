/**
 * Main Application Controller for Image-to-STEP Pro
 * Coordinates UI, Image Processing, CAD Generation, 3D Viewport, and Exporters.
 */

class ImageToCadApp {
    constructor() {
        this.currentMode = 'sheetmetal'; // Default to Sheet Metal mode for engineering workflow
        this.inputMode = 'upload';    // 'upload', 'preset', 'sketch'
        this.sheetMetalType = 'motor'; // 'motor' (Formed L-Mount) or 'chassis' (Chassis Multi-Flange)
        this.sheetMetalForm = 'folded'; // 'folded' (3D Solid) or 'flat' (Unfolded Blank)
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

        // Coordinate System & Datum Planes Controls
        const btnToggleDatum = document.getElementById('btn-toggle-datum');
        const btnToggleImgXy = document.getElementById('btn-toggle-img-xy');
        const btnToggleProj = document.getElementById('btn-toggle-projections');
        const xyOpacitySlider = document.getElementById('xy-opacity-slider');
        const xyOpacityVal = document.getElementById('xy-opacity-val');

        if (btnToggleDatum) {
            btnToggleDatum.addEventListener('click', () => {
                const isVis = !this.viewport.datumPlanesVisible;
                this.viewport.setDatumPlanesVisible(isVis);
                btnToggleDatum.classList.toggle('active', isVis);
            });
        }

        if (btnToggleImgXy) {
            btnToggleImgXy.addEventListener('click', () => {
                const isVis = !this.viewport.imageXYVisible;
                this.viewport.setImageXYVisible(isVis);
                btnToggleImgXy.classList.toggle('active', isVis);
            });
        }

        if (btnToggleProj) {
            btnToggleProj.addEventListener('click', () => {
                const isVis = !this.viewport.projectionsVisible;
                this.viewport.setProjectionsVisible(isVis);
                btnToggleProj.classList.toggle('active', isVis);
            });
        }

        if (xyOpacitySlider) {
            xyOpacitySlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                if (xyOpacityVal) xyOpacityVal.textContent = `${val}%`;
                this.viewport.setImageXYOpacity(val / 100);
            });
        }

        // Sheet Metal Architecture Selection (Formed L-Mount vs Chassis Bracket vs Stepped Z-Channel)
        const btnSmTypeMotor = document.getElementById('btn-sm-type-motor');
        const btnSmTypeChassis = document.getElementById('btn-sm-type-chassis');
        const btnSmTypeStepped = document.getElementById('btn-sm-type-stepped');
        const btnSmTypeCustom = document.getElementById('btn-sm-type-custom');
        if (btnSmTypeMotor) {
            btnSmTypeMotor.addEventListener('click', () => this.setSheetMetalType('motor'));
        }
        if (btnSmTypeChassis) {
            btnSmTypeChassis.addEventListener('click', () => this.setSheetMetalType('chassis'));
        }
        if (btnSmTypeStepped) {
            btnSmTypeStepped.addEventListener('click', () => this.setSheetMetalType('stepped'));
        }
        if (btnSmTypeCustom) {
            btnSmTypeCustom.addEventListener('click', () => this.setSheetMetalType('custom'));
        }

        // Extrusion Normal Axis selector in Extrude Mode
        const extrudeAxisSelect = document.getElementById('param-extrude-axis');
        if (extrudeAxisSelect) {
            extrudeAxisSelect.addEventListener('change', () => this.scheduleRegenerate());
        }

        // Sheet Metal CAD Manufacturing State (3D Folded Solid vs Flat Blank)
        const btnSmFormFolded = document.getElementById('btn-sm-form-folded');
        const btnSmFormFlat = document.getElementById('btn-sm-form-flat');
        if (btnSmFormFolded) {
            btnSmFormFolded.addEventListener('click', () => this.setSheetMetalForm('folded'));
        }
        if (btnSmFormFlat) {
            btnSmFormFlat.addEventListener('click', () => this.setSheetMetalForm('flat'));
        }

        // Pull to 3D Graphic Window Action (Sidebar & Header)
        const triggerPullTo3d = () => {
            if (!this.currentImg) {
                this.showToast('Please upload or select an image first', 'warning');
                return;
            }
            this.hasCustomImage = true;
            // Intelligently preserve mode or detect if uploaded image is sheetmetal/bracket
            if (this.currentMode === 'extrude') {
                if (this.lastFeatures && (this.lastFeatures.isMotorBracket || this.lastFeatures.isChassisBracket || this.lastFeatures.isSteppedChannel)) {
                    this.setMode('sheetmetal', false);
                    if (this.lastFeatures.isSteppedChannel) {
                        this.setSheetMetalType('stepped');
                    } else if (this.lastFeatures.isMotorBracket) {
                        this.setSheetMetalType('motor');
                    } else if (this.lastFeatures.isChassisBracket) {
                        this.setSheetMetalType('chassis');
                    }
                }
            }
            this.processAndGenerate();
            this.viewport.setView('iso');
            this.showToast('⚡ Pulled finished CAD solid into 3D Graphic Window!', 'info');
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
        const planesWidget = document.getElementById('planes-widget');

        const switchTo3d = () => {
            this.currentViewMode = '3d';
            if (btnView3d) btnView3d.classList.add('active');
            if (btnView2d) btnView2d.classList.remove('active');
            if (viewportContainer) viewportContainer.classList.remove('hidden');
            if (drawingContainer) drawingContainer.classList.add('hidden');
            if (viewportTopFloat) viewportTopFloat.classList.remove('hidden');
            if (viewportViewsFloat) viewportViewsFloat.classList.remove('hidden');
            if (slicerWidget) slicerWidget.classList.remove('hidden');
            if (planesWidget) planesWidget.classList.remove('hidden');
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
            if (planesWidget) planesWidget.classList.add('hidden');
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
    }

    archiveCurrentPartToPresets() {
        if (!this.currentImg && !this.currentGeometry) return;

        try {
            const partName = this.currentPartName || this.lastLoadedFileName || `Custom CAD Part (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

            // Capture thumbnail
            let thumbUrl = '';
            if (this.processedData && this.processedData.canvas) {
                thumbUrl = this.processedData.canvas.toDataURL('image/png');
            } else if (this.currentImg) {
                const tc = document.createElement('canvas');
                tc.width = 160;
                tc.height = 120;
                const tctx = tc.getContext('2d');
                tctx.fillStyle = '#0f172a';
                tctx.fillRect(0, 0, 160, 120);
                tctx.drawImage(this.currentImg, 0, 0, 160, 120);
                thumbUrl = tc.toDataURL('image/png');
            }

            const dataUrl = thumbUrl || (this.currentImg ? this.currentImg.src : '');
            if (!dataUrl) return;

            const savedPreset = {
                id: `saved-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                name: partName,
                category: 'Saved Parts (History)',
                isUserSaved: true,
                recommendedMode: this.currentMode || 'sheetmetal',
                bracketType: this.sheetMetalType || 'motor',
                description: `Auto-saved from graphic window (${(this.currentMode || 'CAD').toUpperCase()})`,
                thumbnail: thumbUrl,
                dataUrl: dataUrl,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                generate() {
                    return this.dataUrl;
                }
            };

            window.CadPresets.saveUserPreset(savedPreset);
            this.populatePresets();
            this.showToast(`💾 Saved previous model "${partName}" to Presets Library`, 'info');
        } catch (e) {
            console.warn('Failed to archive previous model:', e);
        }
    }

    populatePresets() {
        const container = document.getElementById('preset-grid');
        if (!container) return;
        container.innerHTML = '';

        const allPresets = (window.CadPresets && typeof window.CadPresets.getAllPresets === 'function')
            ? window.CadPresets.getAllPresets()
            : (window.CadPresets ? window.CadPresets.presets : []);

        allPresets.forEach(p => {
            const card = document.createElement('div');
            const isUser = Boolean(p.isUserSaved);
            card.className = `preset-card ${isUser ? 'user-saved-card' : ''}`;
            card.dataset.id = p.id;
            const badgeIcon = isUser ? '💾' : '🏷️';

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="preset-badge" style="${isUser ? 'background:rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4);' : ''}">${badgeIcon} ${p.category}</div>
                    ${isUser ? `<button type="button" class="btn-del-preset" title="Remove from saved library" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:12px; padding:0 4px; line-height:1;">✕</button>` : ''}
                </div>
                ${p.thumbnail ? `<div style="width:100%; height:75px; margin:6px 0; border-radius:4px; overflow:hidden; background:#0f172a; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color);"><img src="${p.thumbnail}" style="max-width:100%; max-height:100%; object-fit:contain;"></div>` : ''}
                <div class="preset-name">${p.name}</div>
                <div class="preset-desc">${p.description}</div>
                ${p.timestamp ? `<div style="font-size:9px; color:var(--text-secondary); margin-top:4px;">🕒 Saved: ${p.timestamp}</div>` : ''}
            `;

            // Delete button handler
            const delBtn = card.querySelector('.btn-del-preset');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.CadPresets.deleteUserPreset(p.id);
                    this.populatePresets();
                    this.showToast('Removed saved preset');
                });
            }

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

        // If an active part exists, archive it first
        if (this.currentImg || this.currentGeometry) {
            this.archiveCurrentPartToPresets();
        }

        // Cleanly wipe previous model from 3D graphic window
        this.viewport.clearModel();

        this.hasCustomImage = false;
        if (preset.bracketType) {
            const bType = preset.bracketType === 'formed_l' ? 'motor' : (preset.bracketType === 'stepped' ? 'stepped' : (preset.bracketType === 'custom' ? 'custom' : 'chassis'));
            this.setSheetMetalType(bType);
        }
        this.setMode(preset.recommendedMode, false);
        const dataUrl = typeof preset.generate === 'function' ? preset.generate() : preset.dataUrl;
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
            // 1. If an active model/image exists, archive it first to Presets Library
            if (this.currentImg || this.currentGeometry) {
                this.archiveCurrentPartToPresets();
            }

            // 2. Cleanly wipe old model from 3D graphic window before loading new file
            this.viewport.clearModel();

            const img = await window.ImageProcessor.loadImage(file);
            this.currentImg = img;
            this.lastLoadedFileName = file.name || 'Sheet Metal Plate';
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

    setSheetMetalType(type) {
        this.sheetMetalType = type;
        const btnMotor = document.getElementById('btn-sm-type-motor');
        const btnChassis = document.getElementById('btn-sm-type-chassis');
        const btnStepped = document.getElementById('btn-sm-type-stepped');
        const btnCustom = document.getElementById('btn-sm-type-custom');
        const grpMotor = document.getElementById('group-sm-motor');
        const grpChassis = document.getElementById('group-sm-chassis');
        const grpStepped = document.getElementById('group-sm-stepped');

        if (btnMotor) btnMotor.classList.toggle('active', type === 'motor');
        if (btnChassis) btnChassis.classList.toggle('active', type === 'chassis');
        if (btnStepped) btnStepped.classList.toggle('active', type === 'stepped');
        if (btnCustom) btnCustom.classList.toggle('active', type === 'custom');
        if (grpMotor) grpMotor.classList.toggle('hidden', type !== 'motor');
        if (grpChassis) grpChassis.classList.toggle('hidden', type !== 'chassis');
        if (grpStepped) grpStepped.classList.toggle('hidden', type !== 'stepped');
        this.scheduleRegenerate();
    }

    setSheetMetalForm(form) {
        this.sheetMetalForm = form;
        const btnFolded = document.getElementById('btn-sm-form-folded');
        const btnFlat = document.getElementById('btn-sm-form-flat');

        if (btnFolded) btnFolded.classList.toggle('active', form === 'folded');
        if (btnFlat) btnFlat.classList.toggle('active', form === 'flat');
        this.scheduleRegenerate();
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
                    const isFlat = (this.sheetMetalForm === 'flat');
                    const thickness = parseFloat(document.getElementById('param-sm-thick')?.value) || 2.0;
                    const bendRadius = parseFloat(document.getElementById('param-sm-bend-r')?.value) || 2.0;

                    if (this.sheetMetalType === 'motor') {
                        let boreDia = parseFloat(document.getElementById('param-sm-bore')?.value) || 36;
                        let width = parseFloat(document.getElementById('param-sm-motor-w')?.value) || 110;
                        let height = parseFloat(document.getElementById('param-sm-motor-h')?.value) || 100;
                        const baseLen = parseFloat(document.getElementById('param-sm-base-len')?.value) || 52;
                        const topLen = parseFloat(document.getElementById('param-sm-top-len')?.value) || 26;
                        const holeDia = parseFloat(document.getElementById('param-sm-motor-hole')?.value) || 6.5;
                        const fillet = parseFloat(document.getElementById('param-sm-fillet')?.value) || 6.0;
                        const waist = document.getElementById('param-sm-waist')?.checked ?? true;

                        // Auto-scale bore and width from detected image features if user uploaded an image
                        if (this.hasCustomImage && features) {
                            if (features.centerBoreRatio > 0) {
                                const detectedBoreMm = Math.round(width * Math.max(0.2, features.centerBoreRatio));
                                if (detectedBoreMm >= 18 && detectedBoreMm <= 75) {
                                    boreDia = detectedBoreMm;
                                    const bSlider = document.getElementById('param-sm-bore');
                                    const bVal = document.getElementById('param-sm-bore-val');
                                    if (bSlider) bSlider.value = boreDia;
                                    if (bVal) bVal.textContent = boreDia;
                                }
                            }
                        }

                        cadResult = window.CadGenerator.createFormedMotorBracket({
                            thickness,
                            width,
                            height,
                            baseLength: baseLen,
                            topTabLength: topLen,
                            topTabWidth: Math.round(width * 0.44),
                            boreDia,
                            holeDia,
                            bendRadius,
                            cornerFillet: fillet,
                            hasWaistCutouts: waist,
                            isFlat
                        });
                        this.currentPartName = isFlat ? 'FORMED L-MOUNT BRACKET (FLAT BLANK)' : 'FORMED L-MOUNT BRACKET';
                    } else if (this.sheetMetalType === 'stepped') {
                        // Parametric Stepped Z-Channel Multi-Bend Bracket (User Upload media_1791282879370)
                        const length = parseFloat(document.getElementById('param-sm-step-len')?.value) || 130;
                        const h1 = parseFloat(document.getElementById('param-sm-step-h1')?.value) || 55;
                        const h2 = parseFloat(document.getElementById('param-sm-step-h2')?.value) || 55;
                        const w2 = parseFloat(document.getElementById('param-sm-step-w2')?.value) || 50;
                        const w1 = parseFloat(document.getElementById('param-sm-step-w1')?.value) || 40;
                        const w3 = parseFloat(document.getElementById('param-sm-step-w3')?.value) || 40;
                        const holeDia = parseFloat(document.getElementById('param-sm-step-hole')?.value) || 6.5;
                        const fillet = parseFloat(document.getElementById('param-sm-step-fillet')?.value) || 5.0;

                        cadResult = window.CadGenerator.createSteppedZChannel({
                            thickness,
                            length,
                            topFlangeWidth: w1,
                            upperWebHeight: h1,
                            stepWidth: w2,
                            lowerWebHeight: h2,
                            bottomFlangeWidth: w3,
                            bendRadius,
                            holeDia,
                            cornerFillet: fillet,
                            isFlat
                        });
                        this.currentPartName = isFlat ? 'STEPPED Z-CHANNEL (FLAT BLANK)' : 'STEPPED SHEET METAL Z-CHANNEL';
                    } else if (this.sheetMetalType === 'custom') {
                        // Custom Sheet Metal Plate extruded at exact sheet gauge thickness with hole cutouts & fillets
                        const thickness = parseFloat(document.getElementById('param-sm-thick')?.value) || 2.0;
                        cadResult = window.CadGenerator.createExtrudedSolid(contours, {
                            depth: thickness,
                            bevelEnabled: true,
                            bevelThickness: Math.min(0.5, thickness * 0.25),
                            bevelSize: Math.min(0.5, thickness * 0.25),
                            targetWidthMm,
                            epsilon,
                            extrusionNormal: 'z'
                        });
                        this.currentPartName = isFlat ? 'SCANNED SHEET METAL PLATE (FLAT BLANK)' : 'SCANNED SHEET METAL SOLID PLATE';
                    } else {
                        // Parametric Chassis Multi-Flange Bracket
                        const width = parseFloat(document.getElementById('param-sm-width')?.value) || 115;
                        const height = parseFloat(document.getElementById('param-sm-height')?.value) || 105;
                        const sideDepth = parseFloat(document.getElementById('param-sm-side-depth')?.value) || 52;
                        const topTab = parseFloat(document.getElementById('param-sm-top-tab')?.value) || 32;
                        const footLen = parseFloat(document.getElementById('param-sm-foot-len')?.value) || 48;
                        const notchW = parseFloat(document.getElementById('param-sm-notch-w')?.value) || 34;
                        const notchH = parseFloat(document.getElementById('param-sm-notch-h')?.value) || 60;
                        const holeDia = parseFloat(document.getElementById('param-sm-hole-dia')?.value) || 6.5;
                        const gusset = document.getElementById('param-sm-gusset')?.checked ?? true;

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
                            bendRadius,
                            hasGusset: gusset,
                            hasTabs: true,
                            isFlat
                        });
                        this.currentPartName = isFlat ? 'CHASSIS BRACKET (FLAT PATTERN)' : 'CHASSIS SHEET METAL BRACKET';
                    }
                } else if (this.currentMode === 'extrude') {
                    const depth = parseFloat(document.getElementById('param-extrude-depth').value);
                    const bevel = document.getElementById('param-extrude-bevel').checked;
                    const bevelThickness = parseFloat(document.getElementById('param-bevel-thick').value);
                    const extrusionNormal = document.getElementById('param-extrude-axis')?.value || 'z';

                    cadResult = window.CadGenerator.createExtrudedSolid(contours, {
                        depth,
                        bevelEnabled: bevel,
                        bevelThickness,
                        bevelSize: bevelThickness,
                        targetWidthMm,
                        epsilon,
                        extrusionNormal
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

                // Render 2D image/drawing on XY Datum Sketch Plane with normal projection rays
                const imgSource = processed?.canvas || this.currentImg;
                if (imgSource) {
                    const imgW = targetWidthMm;
                    const imgH = processed ? (targetWidthMm * processed.height) / processed.width : targetWidthMm;
                    this.viewport.setImageOnXY(imgSource, imgW, imgH, this.viewport.imageXYOpacity);
                }

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

        const dimensions = this.currentDimensions || { width: 110, height: 100, depth: 52 };
        const thickness = parseFloat(document.getElementById('param-sm-thick') ? document.getElementById('param-sm-thick').value : 2.0);
        const features = this.lastFeatures || { flangeOD: 110, boreID: 36, boltCount: 4, boltDiameter: 6.5 };

        window.CadDrawingGenerator.renderDrawing(canvas, {
            contours: this.currentContours,
            dimensions,
            thickness,
            sheetMetalType: this.sheetMetalType,
            sheetMetalForm: this.sheetMetalForm,
            partName: this.currentPartName || (this.sheetMetalType === 'motor' ? 'FORMED L-MOUNT BRACKET' : 'CHASSIS SHEET METAL BRACKET'),
            drawingNo: 'DWG-CATIA-2026',
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
