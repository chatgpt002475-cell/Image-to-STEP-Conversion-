import cadquery as cq
import os

def export_step(model, name):
    path = f"backend/outputs/{name}.step"
    cq.exporters.export(model, path)
    return path
