/**
 * Wavefront OBJ CAD Exporter
 * Generates .obj 3D mesh representation with normals and materials
 */

window.ObjExporter = {
    exportObj(geometry, name = 'CAD_Model') {
        const geom = geometry.isBufferGeometry ? geometry : new THREE.BufferGeometry().fromGeometry(geometry);
        const posAttr = geom.getAttribute('position');
        const normAttr = geom.getAttribute('normal');
        const uvAttr = geom.getAttribute('uv');
        const indexAttr = geom.getIndex();

        let output = `# Image-to-STEP Pro CAD Model OBJ\n# Part: ${name}\no ${name}\n`;

        // Vertices
        for (let i = 0; i < posAttr.count; i++) {
            output += `v ${posAttr.getX(i).toFixed(4)} ${posAttr.getY(i).toFixed(4)} ${posAttr.getZ(i).toFixed(4)}\n`;
        }

        // Normals
        if (normAttr) {
            for (let i = 0; i < normAttr.count; i++) {
                output += `vn ${normAttr.getX(i).toFixed(4)} ${normAttr.getY(i).toFixed(4)} ${normAttr.getZ(i).toFixed(4)}\n`;
            }
        }

        // UVs
        if (uvAttr) {
            for (let i = 0; i < uvAttr.count; i++) {
                output += `vt ${uvAttr.getX(i).toFixed(4)} ${uvAttr.getY(i).toFixed(4)}\n`;
            }
        }

        output += `s 1\n`;

        // Faces (1-indexed)
        const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

        for (let i = 0; i < numTriangles; i++) {
            let i0, i1, i2;
            if (indexAttr) {
                i0 = indexAttr.getX(i * 3) + 1;
                i1 = indexAttr.getX(i * 3 + 1) + 1;
                i2 = indexAttr.getX(i * 3 + 2) + 1;
            } else {
                i0 = i * 3 + 1;
                i1 = i * 3 + 2;
                i2 = i * 3 + 3;
            }

            if (normAttr && uvAttr) {
                output += `f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}\n`;
            } else if (normAttr) {
                output += `f ${i0}//${i0} ${i1}//${i1} ${i2}//${i2}\n`;
            } else {
                output += `f ${i0} ${i1} ${i2}\n`;
            }
        }

        return output;
    },

    downloadObj(geometry, filename = 'cad_model.obj') {
        const objText = this.exportObj(geometry, filename.replace(/\.[^/.]+$/, ''));
        const blob = new Blob([objText], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.obj') ? filename : `${filename}.obj`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
};
