/**
 * Scalable Vector Graphics (SVG) Exporter
 * Exports clean 2D cut contours and vector geometries for laser cutters & CNC
 */

window.SvgExporter = {
    exportSvg(contours, widthPx, heightPx, scaleMmPerPx = 1.0) {
        const widthMm = (widthPx * scaleMmPerPx).toFixed(2);
        const heightMm = (heightPx * scaleMmPerPx).toFixed(2);

        let svg = `<?xml version="1.0" standalone="no"?>\n`;
        svg += `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n`;
        svg += `<svg width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthPx} ${heightPx}" xmlns="http://www.w3.org/2000/svg" version="1.1">\n`;
        svg += `  <title>Image-to-STEP Pro 2D CAD Vector</title>\n`;
        svg += `  <style>\n`;
        svg += `    .outer-cut { fill: none; stroke: #ff2222; stroke-width: 1.5; }\n`;
        svg += `    .inner-cut { fill: none; stroke: #0088ff; stroke-width: 1.5; }\n`;
        svg += `  </style>\n`;

        contours.forEach((c) => {
            const pts = c.points;
            if (!pts || pts.length < 2) return;
            const className = c.isHole ? 'inner-cut' : 'outer-cut';

            let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} `;
            for (let i = 1; i < pts.length; i++) {
                d += `L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} `;
            }
            d += 'Z';

            svg += `  <path class="${className}" d="${d}" />\n`;
        });

        svg += `</svg>`;
        return svg;
    },

    downloadSvg(contours, widthPx, heightPx, scaleMmPerPx = 1.0, filename = 'cad_vector.svg') {
        const svgText = this.exportSvg(contours, widthPx, heightPx, scaleMmPerPx);
        const blob = new Blob([svgText], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
};
