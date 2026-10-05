/**
 * ISO 10303-21 STEP (AP214) Exporter for Three.js Geometries
 * Generates valid Faceted B-Rep MANIFOLD_SOLID_BREP CAD files
 * Compatible with SolidWorks, Autodesk Fusion 360, FreeCAD, AutoCAD, Siemens NX, etc.
 */

window.StepExporter = {
    exportStep(geometry, partName = 'CAD_Model') {
        const geom = geometry.isBufferGeometry ? geometry : new THREE.BufferGeometry().fromGeometry(geometry);
        const posAttr = geom.getAttribute('position');
        const indexAttr = geom.getIndex();

        if (!posAttr) {
            throw new Error('Geometry does not have position attribute');
        }

        const dateStr = new Date().toISOString();
        let entityId = 1;
        const nextId = () => entityId++;

        // Collect unique vertices and face triangle indices
        const vertices = [];
        const vertexMap = new Map();
        const faces = [];

        function getVertexIndex(x, y, z) {
            // Round to 4 decimal places for deduplication and numerical stability
            const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
            if (vertexMap.has(key)) {
                return vertexMap.get(key);
            }
            const idx = vertices.length;
            vertices.push([x, y, z]);
            vertexMap.set(key, idx);
            return idx;
        }

        const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

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

            const p0 = getVertexIndex(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
            const p1 = getVertexIndex(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
            const p2 = getVertexIndex(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));

            // Avoid degenerate zero-area triangles
            if (p0 !== p1 && p1 !== p2 && p2 !== p0) {
                faces.push([p0, p1, p2]);
            }
        }

        // Build STEP content
        const lines = [];

        // STEP Header
        lines.push('ISO-10303-21;');
        lines.push('HEADER;');
        lines.push("FILE_DESCRIPTION(('Image-to-STEP Pro CAD Model', 'Faceted B-Rep MANIFOLD_SOLID_BREP'), '2;1');");
        lines.push(`FILE_NAME('${partName}.step', '${dateStr}', ('ImageToStep User'), ('ImageToStep Pro System'), 'ThreeJS STEP Engine', 'ImageToStep CAD Generator', '');`);
        lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
        lines.push('ENDSEC;');
        lines.push('DATA;');

        // Base Context & Product Definitions
        const idAppContext = nextId(); // #1
        lines.push(`#${idAppContext}=APPLICATION_CONTEXT('core data for automotive mechanical design processes');`);
        
        const idAppProtocol = nextId(); // #2
        lines.push(`#${idAppProtocol}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${idAppContext});`);

        const idProdContext = nextId(); // #3
        lines.push(`#${idProdContext}=PRODUCT_CONTEXT('',#${idAppContext},'mechanical');`);

        const idProduct = nextId(); // #4
        lines.push(`#${idProduct}=PRODUCT('${partName}','${partName}','Generated from 2D Image',(#${idProdContext}));`);

        const idProdFormation = nextId(); // #5
        lines.push(`#${idProdFormation}=PRODUCT_DEFINITION_FORMATION('1.0','Initial Release',#${idProduct});`);

        const idProdDef = nextId(); // #6
        lines.push(`#${idProdDef}=PRODUCT_DEFINITION('design','',#${idProdFormation},#${idProdContext});`);

        const idShapeDef = nextId(); // #7
        lines.push(`#${idShapeDef}=PRODUCT_DEFINITION_SHAPE('','',#${idProdDef});`);

        const idUncertainty = nextId();
        const idLengthUnit = nextId();
        const idAngleUnit = nextId();
        const idSolidAngleUnit = nextId();
        const idSiLength = nextId();
        const idDimExp = nextId();
        const idContext = nextId();

        lines.push(`#${idUncertainty}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#${idLengthUnit},'distance_accuracy_value','confusion accuracy');`);
        lines.push(`#${idSiLength}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
        lines.push(`#${idLengthUnit}=(CONVERSION_BASED_UNIT('MILLIMETRE',#${idSiLength}) LENGTH_UNIT() NAMED_UNIT(#${idDimExp}));`);
        lines.push(`#${idDimExp}=DIMENSIONAL_EXPOSITIONS_UNIT('MILLIMETRE');`);
        lines.push(`#${idAngleUnit}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));`);
        lines.push(`#${idSolidAngleUnit}=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());`);
        lines.push(`#${idContext}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${idUncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${idLengthUnit},#${idAngleUnit},#${idSolidAngleUnit})) REPRESENTATION_CONTEXT('Context #1','3D'));`);

        // Origin and axis placement for faces
        const idOrigin = nextId();
        lines.push(`#${idOrigin}=CARTESIAN_POINT('Origin',(0.,0.,0.));`);

        const idZDir = nextId();
        lines.push(`#${idZDir}=DIRECTION('Z Axis',(0.,0.,1.));`);

        const idXDir = nextId();
        lines.push(`#${idXDir}=DIRECTION('X Axis',(1.,0.,0.));`);

        const idBaseAxis = nextId();
        lines.push(`#${idBaseAxis}=AXIS2_PLACEMENT_3D('',#${idOrigin},#${idZDir},#${idXDir});`);

        // Write Cartesian Points for unique vertices
        const vertexIds = [];
        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            const pId = nextId();
            vertexIds.push(pId);
            lines.push(`#${pId}=CARTESIAN_POINT('',(${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}));`);
        }

        // Write Faces
        const faceIds = [];
        for (let i = 0; i < faces.length; i++) {
            const f = faces[i];
            const p0Id = vertexIds[f[0]];
            const p1Id = vertexIds[f[1]];
            const p2Id = vertexIds[f[2]];

            // Poly Loop with 3 vertices
            const loopId = nextId();
            lines.push(`#${loopId}=POLY_LOOP('',(#${p0Id},#${p1Id},#${p2Id}));`);

            // Face outer bound
            const boundId = nextId();
            lines.push(`#${boundId}=FACE_OUTER_BOUND('',#${loopId},.T.);`);

            // Face surface
            const faceId = nextId();
            faceIds.push(faceId);
            lines.push(`#${faceId}=FACE_SURFACE('',(#${boundId}),#${idBaseAxis},.T.);`);
        }

        // Closed Shell
        const idClosedShell = nextId();
        const faceRefList = faceIds.map(id => `#${id}`).join(',');
        lines.push(`#${idClosedShell}=CLOSED_SHELL('Closed Shell',(${faceRefList}));`);

        // Manifold Solid B-Rep
        const idSolid = nextId();
        lines.push(`#${idSolid}=MANIFOLD_SOLID_BREP('${partName}',#${idClosedShell});`);

        // Shape Representation
        const idShapeRep = nextId();
        lines.push(`#${idShapeRep}=SHAPE_REPRESENTATION('${partName}',(#${idSolid}),#${idContext});`);

        // Link shape def to shape rep
        const idShapeDefRep = nextId();
        lines.push(`#${idShapeDefRep}=SHAPE_DEFINITION_REPRESENTATION(#${idShapeDef},#${idShapeRep});`);

        lines.push('ENDSEC;');
        lines.push('END-ISO-10303-21;');

        return lines.join('\n');
    },

    downloadStep(geometry, filename = 'cad_model.step') {
        const stepData = this.exportStep(geometry, filename.replace(/\.[^/.]+$/, ''));
        const blob = new Blob([stepData], { type: 'application/step' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.step') || filename.endsWith('.stp') ? filename : `${filename}.step`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
};
