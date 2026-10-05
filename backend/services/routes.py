from flask import Blueprint, request, jsonify
from services.image_processor import process_image
from services.dimension_estimator import estimate_dimensions
from services.cad_generator import generate_cad
from services.step_exporter import export_step

api_bp = Blueprint('api', __name__)

@api_bp.route('/upload', methods=['POST'])
def upload():
    file = request.files['image']
    path = f"backend/uploads/{file.filename}"
    file.save(path)

    features = process_image(path)
    dims = estimate_dimensions(features)
    model = generate_cad(dims)
    step = export_step(model, file.filename)

    return jsonify({"step_file": step})
