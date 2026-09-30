"""Corroborative full-image comparison; never a flicker or timing scorer."""
import json
import sys
from pathlib import Path
import PIL
from PIL import Image, ImageChops
root = Path(__file__).resolve().parent
run = root / (sys.argv[1] if len(sys.argv) > 1 else 'paired-v3')
results = []
for cell in (0, 1):
    before = Image.open(run / f'baseline-cell-{cell}.png').convert('RGB')
    after = Image.open(run / f'candidate-cell-{cell}.png').convert('RGB')
    assert before.size == after.size
    diff = ImageChops.difference(before, after)
    pixels = list(diff.get_flattened_data() if hasattr(diff, 'get_flattened_data') else diff.getdata())
    results.append({'cell': cell, 'size': before.size, 'n': 1,
        'exactChangedFraction': sum(any(p) for p in pixels) / len(pixels),
        'over8ChangedFraction': sum(any(c > 8 for c in p) for p in pixels) / len(pixels),
        'differenceBoundingBox': diff.getbbox()})
with (run / 'screen-comparison.json').open('x') as output:
    json.dump({'scope': 'Single unmasked final capture per viewport; not time series, flicker or timing proof.',
               'python': sys.version.split()[0], 'pillow': PIL.__version__, 'results': results}, output, indent=2)
    output.write('\n')
print(json.dumps(results))
