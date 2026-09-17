"""Shared styling for the repo's slide builders (build-deck.py, build-exec-deck.py).

The site's design tokens (src/render.js :root), portability-safe fonts (python-pptx
cannot embed fonts, and the presenting machine is unknown), the two logos, and the
drawing helpers. When OPS is a list, box/text/logo also record what they drew, so
a builder can render an HTML twin and check text fit without redrawing anything.
"""
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
DESK = Path.home() / "Desktop"

# ---- the map's design tokens (src/render.js :root) --------------------------
CREAM = "F5F1E8"
CREAM90 = "EEE9DC"
NAVY = "14233E"
MUTE = "41506C"
FAINT = "63748C"
AH = "005C99"
OH = "B20838"
WHITE = "FFFFFF"
BLACK = "000000"
BAND_META = "9DC3DF"

MONO = "Courier New"
DISP = "Helvetica Neue"

AH_LOGO = ROOT / "assets" / "adventhealth-logo.png"
OH_LOGO = ROOT / "assets" / "orlandohealth-logo.png"
LOGO_RATIOS = {"AH": 462 / 112, "OH": 343 / 120}

rgb = lambda h: RGBColor.from_string(h)
OPS = None  # set to a list to record every box/text/logo drawn on the current slide


def new_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    return prs, prs.slide_layouts[6]


def _record(op):
    if OPS is not None:
        OPS.append(op)


def box(slide, x, y, w, h, fill=None, line=None, line_w=2.0):
    sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.shadow.inherit = False
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = rgb(fill)
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = rgb(line)
        sh.line.width = Pt(line_w)
    _record({"kind": "box", "x": x, "y": y, "w": w, "h": h, "fill": fill, "line": line, "line_w": line_w})
    return sh


def text(slide, x, y, w, h, runs, size=14, font=DISP, color=NAVY, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, leading=1.15, wrap=True):
    """runs: str, or list of paragraphs, each str or list of (txt, overrides)."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    paras = runs if isinstance(runs, list) else [runs]
    recorded = []
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = leading
        if i > 0:
            p.space_before = Pt(size * 0.45)
        rec_runs = []
        for piece in (para if isinstance(para, list) else [(para, {})]):
            t, ov = piece if isinstance(piece, tuple) else (piece, {})
            r = p.add_run()
            r.text = t
            r.font.name = ov.get("font", font)
            r.font.size = Pt(ov.get("size", size))
            r.font.bold = ov.get("bold", bold)
            r.font.color.rgb = rgb(ov.get("color", color))
            if ov.get("link"):
                r.hyperlink.address = ov["link"]  # a real link; the visible text keeps its own styling
            rec_runs.append({"t": t, "font": ov.get("font", font), "size": ov.get("size", size),
                             "bold": ov.get("bold", bold), "color": ov.get("color", color), "link": ov.get("link")})
        recorded.append(rec_runs)
    _record({"kind": "text", "x": x, "y": y, "w": w, "h": h, "paras": recorded, "size": size,
             "align": str(align), "anchor": str(anchor), "leading": leading, "wrap": wrap})
    return tb


def base(slide):
    box(slide, -0.06, -0.06, 13.45, 7.62, fill=CREAM)


def band(slide, title, meta=""):
    box(slide, 0.5, 0.42, 12.33, 0.62, fill=NAVY)
    text(slide, 0.78, 0.56, 9.6, 0.4, title, size=17, font=MONO, color=CREAM, bold=True)
    if meta:
        text(slide, 8.2, 0.6, 4.35, 0.36, meta, size=12.5, font=MONO, color=BAND_META,
             bold=True, align=PP_ALIGN.RIGHT)


def kicker(slide, x, y, w, t, color=FAINT, size=10.5):
    text(slide, x, y, w, 0.3, t.upper(), size=size, font=MONO, color=color, bold=True)


def logo(slide, which, x, y, h=0.42):
    p = AH_LOGO if which == "AH" else OH_LOGO
    ratios = LOGO_RATIOS
    slide.shapes.add_picture(str(p), Inches(x), Inches(y), height=Inches(h),
                             width=Inches(h * ratios[which]))
    _record({"kind": "logo", "which": which, "x": x, "y": y, "w": h * ratios[which], "h": h, "path": str(p)})


def bullets_block(slide, x, y, w, items, size=19, h=4.5):
    paras = [[("-  ", {"font": MONO, "bold": True, "color": FAINT}), (b, {})] for b in items]
    text(slide, x, y, w, h, paras, size=size, color=MUTE, leading=1.28)
