/**
 * AutoCAD DXF Exporter (Release 12 / 2000 compliant ASCII DXF)
 * Exports 2D vector boundaries, cut contours, and circular holes in millimeters
 * Ideal for CNC Router, Laser Cutter, Plasma, Waterjet, and 2D CAD drafting.
 */

window.DxfExporter = {
    exportDxf(contours, scaleMmPerPx = 1.0) {
        // contours: array of { points: [{x, y}], isHole: boolean }
        const lines = [];

        // Header section
        lines.push('0', 'SECTION');
        lines.push('2', 'HEADER');
        lines.push('9', '$ACADVER');
        lines.push('1', 'AC1009'); // AutoCAD R12 ASCII DXF
        lines.push('9', '$INSUNITS');
        lines.push('70', '4'); // 4 = Millimeters
        lines.push('0', 'ENDSEC');

        // Tables section
        lines.push('0', 'SECTION');
        lines.push('2', 'TABLES');
        lines.push('0', 'TABLE');
        lines.push('2', 'LAYER');
        lines.push('70', '2');

        // Layer: CUT_OUTER
        lines.push('0', 'LAYER');
        lines.push('2', 'CUT_OUTER');
        lines.push('70', '0');
        lines.push('62', '1'); // Red
        lines.push('6', 'CONTINUOUS');

        // Layer: CUT_HOLES
        lines.push('0', 'LAYER');
        lines.push('2', 'CUT_HOLES');
        lines.push('70', '0');
        lines.push('62', '4'); // Cyan
        lines.push('6', 'CONTINUOUS');

        lines.push('0', 'ENDTAB');
        lines.push('0', 'ENDSEC');

        // Entities section
        lines.push('0', 'SECTION');
        lines.push('2', 'ENTITIES');

        contours.forEach((contour) => {
            const pts = contour.points;
            if (!pts || pts.length < 2) return;

            const layerName = contour.isHole ? 'CUT_HOLES' : 'CUT_OUTER';

            lines.push('0', 'POLYLINE');
            lines.push('8', layerName);
            lines.push('66', '1'); // Vertices follow
            lines.push('70', '1'); // 1 = Closed polyline
            lines.push('10', '0.0');
            lines.push('20', '0.0');
            lines.push('30', '0.0');

            for (let i = 0; i < pts.length; i++) {
                const px = pts[i].x * scaleMmPerPx;
                const py = -pts[i].y * scaleMmPerPx; // Invert Y for standard CAD Cartesian orientation

                lines.push('0', 'VERTEX');
                lines.push('8', layerName);
                lines.push('10', px.toFixed(4));
                lines.push('20', py.toFixed(4));
                lines.push('30', '0.0');
            }

            lines.push('0', 'SEQEND');
        });

        lines.push('0', 'ENDSEC');
        lines.push('0', 'EOF');

        return lines.join('\n');
    },

    downloadDxf(contours, scaleMmPerPx = 1.0, filename = 'cad_drawing.dxf') {
        const dxfText = this.exportDxf(contours, scaleMmPerPx);
        const blob = new Blob([dxfText], { type: 'application/dxf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.dxf') ? filename : `${filename}.dxf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
};
