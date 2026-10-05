from flask import Blueprint, request, jsonify
from auth.jwt_handler import create_token

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.json
    token = create_token(data.get('user_id', 1))
    return jsonify({"token": token})
