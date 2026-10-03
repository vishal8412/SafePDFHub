"""Rebuild the compressor-only glue variant; refuses unreviewed upstream changes."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[1]
source = root / 'src/assets/qpdf/qpdf-performance.js'
assert hashlib.sha256(source.read_bytes()).hexdigest() == '349f5ba7a15bfd50fe934e497b6e0777ca47e4aa7316dea818eead82f131aeae', 'Review the new qpdf runtime before regenerating its memory cap.'
text = source.read_text()
assert text.count('getHeapMax=()=>2147483648') == 1
bounded = text.replace('getHeapMax=()=>2147483648', 'getHeapMax=()=>Math.min(536870912,Math.max(134217728,Number(Module["compressionMemoryBytes"])||201326592))')
assert bounded.count('Module["FS"]=FS;') == 1
bounded = bounded.replace('Module["FS"]=FS;', 'Module["getCompressionHeapBytes"]=()=>HEAPU8.byteLength;Module["FS"]=FS;')
(root / 'src/assets/qpdf/qpdf-compression-bounded.js').write_text(bounded)
print('Generated compressor-only configurable 128–512 MiB growth ceiling; security runtime unchanged.')
