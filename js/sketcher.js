/**
 * 2D Interactive CAD Sketcher
 * Allows freehand drafting, parametric circle & rectangle drawing,
 * hole punch mode, and instant conversion to 3D CAD.
 */

window.CadSketcher = class {
    constructor(canvasId, onUpdateCallback) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.onUpdate = onUpdateCallback;
        this.tool = 'brush'; // 'brush', 'circle', 'rect', 'hole-circle', 'eraser'
        this.brushSize = 14;
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.history = [];
        this.snapshot = null;

        this.initCanvas();
        this.bindEvents();
    }

    initCanvas() {
        this.canvas.width = 400;
        this.canvas.height = 400;
        this.clear(false);
        this.saveState();
    }

    clear(triggerUpdate = true) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (triggerUpdate) {
            this.saveState();
            this.notify();
        }
    }

    saveState() {
        this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
        if (this.history.length > 20) this.history.shift();
    }

    undo() {
        if (this.history.length > 1) {
            this.history.pop();
            const prevState = this.history[this.history.length - 1];
            this.ctx.putImageData(prevState, 0, 0);
            this.notify();
        }
    }

    setTool(tool) {
        this.tool = tool;
    }

    setBrushSize(size) {
        this.brushSize = parseInt(size, 10) || 10;
    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        let clientX = e.clientX;
        let clientY = e.clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    bindEvents() {
        const start = (e) => {
            e.preventDefault();
            this.isDrawing = true;
            const pos = this.getPos(e);
            this.startX = pos.x;
            this.startY = pos.y;
            this.snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

            if (this.tool === 'brush' || this.tool === 'eraser') {
                this.ctx.beginPath();
                this.ctx.moveTo(pos.x, pos.y);
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.lineWidth = this.brushSize;
                this.ctx.strokeStyle = this.tool === 'eraser' ? '#ffffff' : '#000000';
            }
        };

        const move = (e) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            const pos = this.getPos(e);

            if (this.tool === 'brush' || this.tool === 'eraser') {
                this.ctx.lineTo(pos.x, pos.y);
                this.ctx.stroke();
            } else if (this.snapshot) {
                // Restore before drawing preview
                this.ctx.putImageData(this.snapshot, 0, 0);

                if (this.tool === 'circle' || this.tool === 'hole-circle') {
                    const radius = Math.hypot(pos.x - this.startX, pos.y - this.startY);
                    this.ctx.fillStyle = this.tool === 'hole-circle' ? '#ffffff' : '#000000';
                    this.ctx.beginPath();
                    this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
                    this.ctx.fill();
                } else if (this.tool === 'rect') {
                    const w = pos.x - this.startX;
                    const h = pos.y - this.startY;
                    this.ctx.fillStyle = '#000000';
                    this.ctx.fillRect(this.startX, this.startY, w, h);
                }
            }
        };

        const end = (e) => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.saveState();
            this.notify();
        };

        this.canvas.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);

        this.canvas.addEventListener('touchstart', start, { passive: false });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', end);
    }

    notify() {
        if (this.onUpdate) {
            this.onUpdate(this.canvas.toDataURL('image/png'));
        }
    }

    getImageDataUrl() {
        return this.canvas.toDataURL('image/png');
    }
};
