import cv2

def process_image(path):
    img = cv2.imread(path, 0)
    edges = cv2.Canny(img, 50, 150)
    return {"edges": edges}
