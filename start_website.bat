@echo off
title Image to STEP Pro - Static CAD Studio
echo ===================================================
echo     Image to STEP Pro - Static CAD Studio
echo ===================================================
echo Starting local web server on http://localhost:8080 ...
start "" http://localhost:8080
python -m http.server 8080
pause
