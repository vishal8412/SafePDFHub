"""Synthetic documents only; no customer content. Run before browser regression."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import base64
out=Path(__file__).resolve().parent.parent/'regression-fixtures/word-to-pdf';out.mkdir(parents=True,exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ct='http://schemas.openxmlformats.org/package/2006/content-types'
content=f'<Types xmlns="{ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'+''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name,kind in [('document','document.main'),('styles','styles'),('numbering','numbering'),('header1','header')])+'</Types>'
def p(text,props=''):return f'<w:p><w:pPr>{props}<w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
def sect(land=False,header=False):return '<w:sectPr>'+('<w:headerReference w:type="default" r:id="rHeader"/>' if header else '')+f'<w:pgSz w:w="{15840 if land else 12240}" w:h="{12240 if land else 15840}"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360"/></w:sectPr>'
img='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Synthetic image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="fixture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
body=p('Regression 4827')+p('A bullet whose continuation must align with its first text line. '*8,'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:line="278" w:lineRule="auto"/>')+img+p('',sect(header=True))+p('Second section 90210')+p('',sect())+p('Landscape final section')+sect(True)
doc=f'<w:document xmlns:w="{w}" xmlns:r="{rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{body}</w:body></w:document>'
rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="{id}" Type="{rel}/{typ}" Target="{target}"/>' for id,typ,target in [('rStyles','styles','styles.xml'),('rNums','numbering','numbering.xml'),('rHeader','header','header1.xml'),('rImage','image','media/image.png')])+'</Relationships>'
entries={'[Content_Types].xml':content,'_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="{rel}/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':doc,'word/_rels/document.xml.rels':rels,'word/styles.xml':f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>','word/numbering.xml':f'<w:numbering xmlns:w="{w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>','word/header1.xml':f'<w:hdr xmlns:w="{w}">{p("Inherited regression header")}</w:hdr>','word/media/image.png':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')}
for name in ['layout','external','macro']:
 data=dict(entries)
 if name=='external':data['word/_rels/document.xml.rels']=rels.replace('</Relationships>',f'<Relationship Id="remoteImage" Type="{rel}/image" Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>')
 if name=='macro':data['word/vbaProject.bin']=b'macro test'
 with ZipFile(out/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for key,value in data.items():z.writestr(key,value)
(out/'corrupt.docx').write_bytes(b'not a DOCX')
print(out)
