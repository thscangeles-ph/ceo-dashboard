# Builds the Windows icon (build/icon.ico, several sizes) and build/icon.png from the dashboard's app icon.
import os
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(here, "..", "public", "icons", "icon-512.png")).convert("RGBA")
src.save(os.path.join(here, "build", "icon.png"))
src.save(os.path.join(here, "build", "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written")
