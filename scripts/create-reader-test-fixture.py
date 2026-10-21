"""Generate only synthetic reader-test content; requires the engine's PyMuPDF."""
from pathlib import Path
import sys
import fitz
root = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/flicker-qa")
root.mkdir(parents=True, exist_ok=True)
doc = fitz.open()
for i in range(30):
    page = doc.new_page(width=600, height=760)
    page.insert_text((54, 74), f"Render cache verification page {i+1}", fontsize=17)
    for line in range(18):
        page.insert_text((54, 112+line*26), f"Line {line+1}: Select these words to highlight and keep reading.", fontsize=12)
    page.insert_text((54, 650), "Existing highlight can be erased.", fontsize=14)
    page.add_highlight_annot(page.search_for("Existing highlight"))
    if i == 3:
        page.set_rotation(90)
    if i == 5:
        page.set_cropbox(fitz.Rect(24, 30, 570, 720))
doc.set_toc([[1, "First chapter", 1], [1, "Rotated page", 4], [1, "Last chapter", 30]])
doc.save(root / "fixture.pdf")
print("Synthetic reader fixture ready")
