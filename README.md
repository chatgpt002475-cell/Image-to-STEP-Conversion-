# Image to STEP Pro - Static CAD Studio 📐

A high-performance, 100% client-side **static website** that converts 2D images, drawings, sketches, and engineering schematics into **3D CAD models** with real-time interactive 3D visualization and multi-format export.

---

## 🚀 Key Features

- **100% Client-Side & Static**: Runs entirely in modern web browsers with zero server dependencies, no Python/CadQuery version mismatches, zero upload latency, and 100% offline privacy.
- **Multiple Conversion Modes**:
  1. 📐 **Prismatic Extrusion (Multi-Part Automatic)**: Automatically traces and extrudes **ALL** closed vector contours, disconnected tabs, plates, and components simultaneously with automatic inner hole cutouts, custom bevels, and parametric thickness.
  2. 📦 **Folded Sheet Metal CAD Engine**: Parametrically reconstructs folded sheet metal chassis brackets with 90° bends, Z-bend hanging tabs, roof canopies, 45° finger tabs, floor clearance bores, corner tabs, and stiffener gussets.
  3. 🔄 **Lathe / Revolve**: Converts cross-sections or profiles of symmetrical turned parts (shafts, pulleys, bushings, bottles) into 360° rotational 3D solids.
  4. 🏔️ **3D Bas-Relief / Heightmap**: Converts luminance gradients into watertight, solid 3D relief blocks with solid planar bases ready for CNC milling or 3D printing.
  5. ⚙️ **Parametric Mechanical Part Recognizer**: Automatically detects Outer Diameter (OD), Inner Bore (ID), Pitch Circle Diameter (PCD), and Bolt Holes, with interactive fine-tuning sliders.
- **📁 Folder & Multi-File Upload**:
  - Drag-and-drop entire folders or select folders with the dedicated "📁 Select Folder" button.
  - Interactive Folder Parts Strip to inspect each component image individually.
  - **⚡ 3D Assembly Mode**: Automatically vectorizes and renders all part images from a folder together in a single coordinated 3D CAD assembly.
- **⚡ Automatic Instant 3D Sync**:
  - Image or folder uploads are instantly processed by Vector Contour Detection and automatically pulled into the 3D Graphic Window with zero extra clicks.
- **Interactive 2D CAD Sketcher**: Draw freehand lines, precision circles, rectangular slots, or punch holes directly in the browser to generate 3D CAD parts in real-time.
- **Preloaded Engineering Presets**: Includes 1-click test parts (Industrial Flange, Mounting Bracket, Spur Gear, Stepped Shaft, Medallion Relief, Aerospace Control Arm).
- **Pro 3D CAD Viewport (Three.js)**:
  - OrbitControls (rotate, pan, zoom, reset view)
  - Camera presets: Isometric, Top (XY), Front (XZ), Right (YZ)
  - CAD Shading styles: **Clay CAD**, **Machined Aluminum**, **Technical Wireframe + Edges**, **X-Ray Glass**, **Surface Normals**, **Blueprint**
  - Live Cross-Section Slicer / Clipping Plane (inspect internal cavities and bores)
  - Real-time engineering telemetry (Dimensions in mm, Volume in $cm^3$, Surface Area in $cm^2$, Triangle & Vertex counts)
- **Multi-Format CAD Exports**:
  - 💾 **STEP (.step / .stp)**: ISO 10303-21 standard CAD AP214 format (opens in SolidWorks, Autodesk Fusion 360, FreeCAD, AutoCAD, Siemens NX, Rhino)
  - 🖨️ **STL (.stl)**: Binary & ASCII formats for 3D printing slicers (Bambu Studio, Cura, PrusaSlicer)
  - 🧊 **OBJ (.obj)**: Standard Wavefront 3D mesh
  - 📐 **DXF (.dxf)**: AutoCAD R12/2000 2D vector polylines for laser cutters and CNC waterjets
  - ✂️ **SVG (.svg)**: Scalable vector cut paths

---

## 📁 Directory Structure

```text
image-to-step-pro/
├── index.html                   # Main static website interface
├── start_website.bat            # Windows 1-click launcher
├── css/
│   └── style.css                # Dark-mode CAD workstation styling
├── libs/
│   ├── three.min.js             # Three.js 3D library (bundled offline)
│   └── OrbitControls.js         # Camera orbit interaction
├── js/
│   ├── app.js                   # Application coordinator & event bindings
│   ├── viewport.js              # 3D Viewport, materials, shaders & telemetry
│   ├── image_processor.js       # Vectorization, Otsu thresholding & contour tracing
│   ├── cad_generator.js         # Extrude, Revolve, Relief & Parametric CAD engines
│   ├── sketcher.js              # 2D interactive canvas drafting tool
│   ├── presets.js               # Procedural mechanical test parts
│   └── exporters/
│       ├── step_exporter.js     # ISO 10303-21 STEP AP214 exporter
│       ├── stl_exporter.js      # Binary & ASCII STL exporter
│       ├── obj_exporter.js      # Wavefront OBJ exporter
│       ├── dxf_exporter.js      # AutoCAD DXF 2D exporter
│       └── svg_exporter.js      # SVG vector exporter
└── README.md
```

---

## ⚡ How to Run

### Method 1: Windows 1-Click
Double-click `start_website.bat` in the project folder. It will launch a local server and open `http://localhost:8080` in your default browser.

### Method 2: Direct File Open
Double-click `index.html` to open it directly in Google Chrome, Microsoft Edge, Firefox, or Safari. All dependencies are bundled locally.

### Method 3: Any Static Server
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

---

## 🌐 Deployment
To deploy online, simply copy all files to any static hosting provider:
- **GitHub Pages**: Push to repository and enable GitHub Pages on the root branch.
- **Vercel / Netlify / Cloudflare Pages**: Drag and drop the folder.
- **AWS S3 / CloudFront**: Upload folder contents to an S3 bucket configured for static web hosting.
