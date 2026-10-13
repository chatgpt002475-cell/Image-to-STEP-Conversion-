@echo off
title ImageCAD - SolidWorks Style Web CAD Studio
echo ===================================================
echo     ImageCAD - SolidWorks Style Web CAD Studio
echo ===================================================
echo Starting separate local hosting on http://localhost:8085 ...
start "" http://localhost:8085
python -m http.server 8085
pause
