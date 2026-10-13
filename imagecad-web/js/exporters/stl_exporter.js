/**
 * STL (Stereolithography) Exporter
 * Exports Binary STL (compact, industry-standard for 3D printing and CAD)
 * and ASCII STL.
 */

window.StlExporter = {
    exportBinary(geometry) {
        const geom = geometry.isBufferGeometry ? geometry : new THREE.BufferGeometry().fromGeometry(geometry);
        const posAttr = geom.getAttribute('position');
        const indexAttr = geom.getIndex();

        const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
        const bufferSize = 84 + (50 * numTriangles);
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);

        // 80-byte header
        const headerStr = 'Image-to-STEP Pro Binary STL CAD Export';
        for (let i = 0; i < 80; i++) {
            view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 32);
        }

        // Number of triangles (uint32, little-endian)
        view.setUint32(80, numTriangles, true);

        let offset = 84;
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const normal = new THREE.Vector3();

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

            // Face normal
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab).normalize();

            // Normal vector (3x float32)
            view.setFloat32(offset, cb.x, true); offset += 4;
            view.setFloat32(offset, cb.y, true); offset += 4;
            view.setFloat32(offset, cb.z, true); offset += 4;

            // Vertex 1
            view.setFloat32(offset, pA.x, true); offset += 4;
            view.setFloat32(offset, pA.y, true); offset += 4;
            view.setFloat32(offset, pA.z, true); offset += 4;

            // Vertex 2
            view.setFloat32(offset, pB.x, true); offset += 4;
            view.setFloat32(offset, pB.y, true); offset += 4;
            view.setFloat32(offset, pB.z, true); offset += 4;

            // Vertex 3
            view.setFloat32(offset, pC.x, true); offset += 4;
            view.setFloat32(offset, pC.y, true); offset += 4;
            view.setFloat32(offset, pC.z, true); offset += 4;

            // Attribute byte count (uint16)
            view.setUint16(offset, 0, true); offset += 2;
        }

        return buffer;
    },

    exportAscii(geometry, name = 'CAD_Model') {
        const geom = geometry.isBufferGeometry ? geometry : new THREE.BufferGeometry().fromGeometry(geometry);
        const posAttr = geom.getAttribute('position');
        const indexAttr = geom.getIndex();

        let output = `solid ${name}\n`;
        const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

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

            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab).normalize();

            output += `  facet normal ${cb.x.toExponential(6)} ${cb.y.toExponential(6)} ${cb.z.toExponential(6)}\n`;
            output += `    outer loop\n`;
            output += `      vertex ${pA.x.toExponential(6)} ${pA.y.toExponential(6)} ${pA.z.toExponential(6)}\n`;
            output += `      vertex ${pB.x.toExponential(6)} ${pB.y.toExponential(6)} ${pB.z.toExponential(6)}\n`;
            output += `      vertex ${pC.x.toExponential(6)} ${pC.y.toExponential(6)} ${pC.z.toExponential(6)}\n`;
            output += `    endloop\n`;
            output += `  endfacet\n`;
        }

        output += `endsolid ${name}\n`;
        return output;
    },

    downloadStl(geometry, filename = 'cad_model.stl', binary = true) {
        let blob;
        if (binary) {
            const buffer = this.exportBinary(geometry);
            blob = new Blob([buffer], { type: 'application/octet-stream' });
        } else {
            const str = this.exportAscii(geometry, filename.replace(/\.[^/.]+$/, ''));
            blob = new Blob([str], { type: 'text/plain' });
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.stl') ? filename : `${filename}.stl`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
};
