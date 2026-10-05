import cadquery as cq

def generate_cad(dim):
    model = cq.Workplane("XY").circle(dim["flange_od"]/2).extrude(10)
    return model
