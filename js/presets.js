/**
 * Engineering Preset Generator
 * Procedurally generates high-contrast CAD drawings and silhouettes
 * for instant 1-click testing in Extrude, Revolve, Relief, and Parametric modes.
 */

window.CadPresets = {
    presets: [
        {
            id: 'motor-bracket',
            name: 'Formed L-Mount Bracket (Bore & 90° Flanges)',
            category: 'Sheet Metal',
            recommendedMode: 'sheetmetal',
            bracketType: 'formed_l',
            description: 'Formed motor mounting bracket with 36mm bore, 90° base flange & rear tab',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 440;
                canvas.height = 420;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 440, 420);

                // Silhouette representation of the Formed L-bracket
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.moveTo(80, 50);
                ctx.lineTo(360, 50);
                // Top tab notch
                ctx.lineTo(360, 110);
                // Side waist cutout
                ctx.arc(360, 210, 24, -Math.PI / 2, Math.PI / 2, true);
                ctx.lineTo(360, 310);
                // Forward base flange
                ctx.lineTo(380, 310);
                ctx.lineTo(380, 370);
                ctx.lineTo(60, 370);
                ctx.lineTo(60, 310);
                ctx.lineTo(80, 310);
                // Left side waist cutout
                ctx.arc(80, 210, 24, Math.PI / 2, -Math.PI / 2, true);
                ctx.lineTo(80, 50);
                ctx.closePath();
                ctx.fill();

                // Center Motor Clearance Bore
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(220, 210, 52, 0, Math.PI * 2);
                ctx.fill();

                // Top corner mounting holes
                [ [120, 90, 14], [320, 90, 14], [110, 340, 14], [330, 340, 14] ].forEach(([hx, hy, r]) => {
                    ctx.beginPath();
                    ctx.arc(hx, hy, r, 0, Math.PI * 2);
                    ctx.fill();
                });

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'sheet-metal',
            name: 'Sheet Metal Chassis Bracket (User Photo 1)',
            category: 'Sheet Metal',
            recommendedMode: 'sheetmetal',
            bracketType: 'chassis',
            description: 'Folded 3D sheet metal bracket with 90° bends, tabs, gusset & holes',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 440;
                canvas.height = 400;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 440, 400);

                // Silhouette representation of the bracket
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.moveTo(60, 60);
                ctx.lineTo(240, 60);
                ctx.lineTo(240, 100);
                ctx.lineTo(360, 100);
                ctx.lineTo(360, 300);
                ctx.lineTo(260, 300);
                ctx.lineTo(260, 240);
                ctx.lineTo(160, 240);
                ctx.lineTo(160, 340);
                ctx.lineTo(60, 340);
                ctx.closePath();
                ctx.fill();

                // Holes
                ctx.fillStyle = '#ffffff';
                const holes = [
                    [100, 100, 16],
                    [200, 90, 14],
                    [100, 300, 16],
                    [310, 200, 16],
                    [300, 270, 14]
                ];
                holes.forEach(([hx, hy, r]) => {
                    ctx.beginPath();
                    ctx.arc(hx, hy, r, 0, Math.PI * 2);
                    ctx.fill();
                });

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'flange',
            name: 'Industrial Flange (PCD & Bore)',
            category: 'Mechanical',
            recommendedMode: 'extrude',
            description: 'Flanged pipe connector with 4-bolt circle and central bore',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 400;
                canvas.height = 400;
                const ctx = canvas.getContext('2d');

                // White background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 400, 400);

                // Black outer flange
                ctx.fillStyle = '#000000';
                ctx.beginPath();
                ctx.arc(200, 200, 160, 0, Math.PI * 2);
                ctx.fill();

                // White center bore
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(200, 200, 50, 0, Math.PI * 2);
                ctx.fill();

                // 4 Bolt holes on PCD (radius 115)
                const boltRadius = 18;
                const pcd = 115;
                for (let i = 0; i < 4; i++) {
                    const angle = (i * Math.PI) / 2;
                    const bx = 200 + Math.cos(angle) * pcd;
                    const by = 200 + Math.sin(angle) * pcd;
                    ctx.beginPath();
                    ctx.arc(bx, by, boltRadius, 0, Math.PI * 2);
                    ctx.fill();
                }

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'bracket',
            name: 'Mounting Bracket with Slots',
            category: 'Structural',
            recommendedMode: 'extrude',
            description: 'Industrial motor bracket with mounting slots and central window',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 440;
                canvas.height = 360;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 440, 360);

                // Rounded rectangular bracket body
                ctx.fillStyle = '#000000';
                this.roundRect(ctx, 40, 40, 360, 280, 40);
                ctx.fill();

                // Center cutout slot
                ctx.fillStyle = '#ffffff';
                this.roundRect(ctx, 140, 100, 160, 160, 25);
                ctx.fill();

                // 4 Corner mounting holes
                const holes = [
                    [80, 80],
                    [360, 80],
                    [80, 280],
                    [360, 280]
                ];
                holes.forEach(([hx, hy]) => {
                    ctx.beginPath();
                    ctx.arc(hx, hy, 16, 0, Math.PI * 2);
                    ctx.fill();
                });

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'gear',
            name: 'Transmission Spur Gear',
            category: 'Mechanical',
            recommendedMode: 'extrude',
            description: '18-tooth involute spur gear with center shaft bore and keyway',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 400;
                canvas.height = 400;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 400, 400);

                // Gear teeth
                ctx.fillStyle = '#000000';
                const cx = 200, cy = 200;
                const numTeeth = 18;
                const rRoot = 135;
                const rTip = 175;

                ctx.beginPath();
                for (let i = 0; i < numTeeth; i++) {
                    const a0 = (i * 2 * Math.PI) / numTeeth;
                    const a1 = a0 + (0.5 * Math.PI) / numTeeth;
                    const a2 = a0 + (1.0 * Math.PI) / numTeeth;
                    const a3 = a0 + (1.5 * Math.PI) / numTeeth;

                    const p0 = [cx + Math.cos(a0) * rRoot, cy + Math.sin(a0) * rRoot];
                    const p1 = [cx + Math.cos(a1) * rTip, cy + Math.sin(a1) * rTip];
                    const p2 = [cx + Math.cos(a2) * rTip, cy + Math.sin(a2) * rTip];
                    const p3 = [cx + Math.cos(a3) * rRoot, cy + Math.sin(a3) * rRoot];

                    if (i === 0) ctx.moveTo(p0[0], p0[1]);
                    else ctx.lineTo(p0[0], p0[1]);
                    ctx.lineTo(p1[0], p1[1]);
                    ctx.lineTo(p2[0], p2[1]);
                    ctx.lineTo(p3[0], p3[1]);
                }
                ctx.closePath();
                ctx.fill();

                // Center bore with keyway slot
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(cx, cy, 45, 0, Math.PI * 2);
                ctx.fill();

                // Keyway slot
                ctx.fillRect(cx - 10, cy - 60, 20, 30);

                // 4 Lightening holes in gear web
                for (let k = 0; k < 4; k++) {
                    const ang = (k * Math.PI) / 2 + (Math.PI / 4);
                    const hx = cx + Math.cos(ang) * 90;
                    const hy = cy + Math.sin(ang) * 90;
                    ctx.beginPath();
                    ctx.arc(hx, hy, 18, 0, Math.PI * 2);
                    ctx.fill();
                }

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'shaft',
            name: 'Turned Shaft / Pulley',
            category: 'Rotational',
            recommendedMode: 'revolve',
            description: 'Stepped drive shaft profile with pulley groove for Lathe / Revolve',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 400;
                canvas.height = 400;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 400, 400);

                // Symmetric stepped shaft silhouette
                ctx.fillStyle = '#000000';
                ctx.beginPath();
                // Left profile
                ctx.moveTo(160, 40);
                ctx.lineTo(240, 40);
                ctx.lineTo(240, 110);
                // Step up to flange/pulley
                ctx.lineTo(270, 110);
                ctx.lineTo(270, 140);
                // V-groove
                ctx.lineTo(245, 160);
                ctx.lineTo(270, 180);
                ctx.lineTo(270, 210);
                // Step to main bearing journal
                ctx.lineTo(230, 210);
                ctx.lineTo(230, 290);
                // Step to thread/coupler
                ctx.lineTo(215, 290);
                ctx.lineTo(215, 360);
                // Bottom end
                ctx.lineTo(185, 360);
                ctx.lineTo(185, 290);
                ctx.lineTo(170, 290);
                ctx.lineTo(170, 210);
                ctx.lineTo(130, 210);
                ctx.lineTo(130, 180);
                ctx.lineTo(155, 160);
                ctx.lineTo(130, 140);
                ctx.lineTo(130, 110);
                ctx.lineTo(160, 110);
                ctx.closePath();
                ctx.fill();

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'relief',
            name: 'Engineering Medallion (Relief)',
            category: 'Relief',
            recommendedMode: 'relief',
            description: 'Multi-level relief medallion for 3D Heightmap & CNC Carving',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 300;
                canvas.height = 300;
                const ctx = canvas.getContext('2d');

                // Radial gradient background
                const grad = ctx.createRadialGradient(150, 150, 20, 150, 150, 140);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.5, '#999999');
                grad.addColorStop(0.85, '#444444');
                grad.addColorStop(1, '#000000');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(150, 150, 140, 0, Math.PI * 2);
                ctx.fill();

                // Inner embossed ring
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 8;
                ctx.beginPath();
                ctx.arc(150, 150, 105, 0, Math.PI * 2);
                ctx.stroke();

                // Central star / geometric emblem
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                const spikes = 6;
                const outerR = 75, innerR = 35;
                for (let i = 0; i < spikes * 2; i++) {
                    const r = (i % 2 === 0) ? outerR : innerR;
                    const a = (i * Math.PI) / spikes - Math.PI / 2;
                    const x = 150 + Math.cos(a) * r;
                    const y = 150 + Math.sin(a) * r;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.fill();

                return canvas.toDataURL('image/png');
            }
        },
        {
            id: 'linkage',
            name: 'Aerospace Control Arm',
            category: 'Structural',
            recommendedMode: 'extrude',
            description: 'Lightweight double-pivot linkage arm with weight-reduction pockets',
            generate() {
                const canvas = document.createElement('canvas');
                canvas.width = 460;
                canvas.height = 240;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 460, 240);

                // Arm body connecting two eyelets
                ctx.fillStyle = '#000000';
                ctx.beginPath();
                // Left eyelet
                ctx.arc(90, 120, 70, 0, Math.PI * 2);
                ctx.fill();

                // Right eyelet
                ctx.beginPath();
                ctx.arc(370, 120, 50, 0, Math.PI * 2);
                ctx.fill();

                // Connecting beam
                ctx.beginPath();
                ctx.moveTo(90, 70);
                ctx.lineTo(370, 85);
                ctx.lineTo(370, 155);
                ctx.lineTo(90, 170);
                ctx.closePath();
                ctx.fill();

                // Pivot bearing holes
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(90, 120, 32, 0, Math.PI * 2); // Left bore
                ctx.fill();

                ctx.beginPath();
                ctx.arc(370, 120, 22, 0, Math.PI * 2); // Right bore
                ctx.fill();

                // Weight reduction truss cutouts in center
                this.roundRect(ctx, 180, 100, 60, 40, 12);
                ctx.fill();
                this.roundRect(ctx, 260, 103, 60, 34, 12);
                ctx.fill();

                return canvas.toDataURL('image/png');
            }
        }
    ],

    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    },

    getPreset(id) {
        return this.presets.find(p => p.id === id);
    }
};
