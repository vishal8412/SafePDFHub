"""Generate synthetic stress data; not a copy of a user's document.
Usage: python scripts/studio-large-fixture.py /tmp/studio-large.pdf
"""
import sys, os, fitz
from pathlib import Path
output = Path(sys.argv[1]); output.parent.mkdir(parents=True, exist_ok=True)
doc = fitz.open()
# Unique, incompressible RGB images create actual heavy referenced PDF streams.
for i in range(18639):
    p = doc.new_page(width=600,height=800)
    p.insert_text((40,50),f'Studio large document regression - page {i+1}',fontsize=14)
    if i < 490:
        pix = fitz.Pixmap(fitz.csRGB,512,512,os.urandom(512*512*3),False)
        p.insert_image(fitz.Rect(40,90,552,602),pixmap=pix)
    if i % 3000 == 0: print(i, flush=True)
doc.save(output,deflate=False)
print({'path':str(output),'bytes':output.stat().st_size,'pages':len(doc)},flush=True)
