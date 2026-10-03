from pathlib import Path
import random
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--mb',type=int,choices=[40,50,75,100,150,200,201,300,500],default=40)
parser.add_argument('--interactive', action='store_true')
args=parser.parse_args()
root=Path('capacity-fixtures');root.mkdir(exist_ok=True)
r=random.Random(123); payload=r.randbytes(990000)+bytes(990000)
for size,pages in [(args.mb * 1_000_000, (args.mb * 1_000_000 - 300_000) // 1_980_000)]:
 p=root/f'{size//1_000_000}MB.pdf'
 with p.open('wb') as f:
  f.write(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
  def obj(n,b):
   assert n==len(offsets);offsets.append(f.tell());f.write(f'{n} 0 obj\n'.encode()+b+b'\nendobj\n')
  field_id=5+pages*3
  form=f' /AcroForm << /Fields [{field_id} 0 R] /NeedAppearances true /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 3 0 R >> >> >>' if args.interactive else ''
  obj(1,f'<< /Type /Catalog /Pages 2 0 R {form} >>'.encode());obj(2,('<< /Type /Pages /Count '+str(pages)+' /Kids ['+' '.join(f'{5+i*3} 0 R' for i in range(pages))+'] >>').encode())
  obj(3,b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');obj(4,b'<< /Title (Capacity regression) /Author (SafePDFHub test) >>')
  for i in range(pages):
   n=5+i*3
   annotations=(' /Annots [' + (f'{field_id} 0 R ' if i == 0 else '') + '<< /Type /Annot /Subtype /Link /Rect [30 725 200 745] /A << /S /URI /URI (https://example.com/) >> >>]') if args.interactive else ''
   obj(n,f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> /XObject << /Im {n+2} 0 R >> >> /Contents {n+1} 0 R {annotations} >>'.encode())
   content=f'BT /F1 14 Tf 30 760 Td (Capacity test page {i+1}) Tj ET q 500 0 0 330 30 300 cm /Im Do Q'.encode()
   obj(n+1,f'<< /Length {len(content)} >>\nstream\n'.encode()+content+b'\nendstream')
   obj(n+2,f'<< /Type /XObject /Subtype /Image /Width 1000 /Height 660 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {len(payload)} >>\nstream\n'.encode()+payload+b'\nendstream')
  if args.interactive:obj(field_id,b'<< /Type /Annot /Subtype /Widget /FT /Tx /T (capacity-field) /V (Editable value) /Rect [30 680 250 710] /P 5 0 R /F 4 >>')
  # Exact decimal boundary fixture; padding is outside objects, before the xref.
  count=len(offsets)
  tail_len=len(f'xref\n0 {count}\n'.encode())+20*count+len(f'trailer\n<< /Size {count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n'.encode())+len(str(size))+len('\n%%EOF\n')
  padding=size-f.tell()-tail_len
  f.write(b'%' + b' '*(padding-2)+b'\n');xref=f.tell()
  f.write(f'xref\n0 {count}\n0000000000 65535 f \n'.encode())
  for off in offsets[1:]:f.write(f'{off:010d} 00000 n \n'.encode())
  f.write(f'trailer\n<< /Size {count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
 assert p.stat().st_size==size,(p,p.stat().st_size)
 print(p,size)
