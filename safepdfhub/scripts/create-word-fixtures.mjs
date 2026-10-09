import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const out = new URL('../regression-fixtures/word/', import.meta.url);
await mkdir(out, { recursive: true });
const doc = await PDFDocument.create(),
  font = await doc.embedFont(StandardFonts.Helvetica),
  bold = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage([612, 792]);
page.drawText('Quarterly project report', { x: 48, y: 732, size: 22, font: bold });
page.drawText('Editable text, images and page order', { x: 48, y: 696, size: 12, font });
page.drawText('Revenue grew by 18% & costs stayed stable.', { x: 48, y: 666, size: 12, font });
page.drawText('This sentence should remain editable in Word.', { x: 48, y: 646, size: 12, font });
const image = await doc.embedPng(
  await readFile(new URL('../regression-fixtures/studio/replacement.png', import.meta.url)),
);
page.drawImage(image, { x: 48, y: 450, width: 180, height: 120 });
page.drawText('The image above is part of the source PDF.', { x: 48, y: 426, size: 11, font });
const next = doc.addPage([612, 792]);
next.drawText('Second page', { x: 48, y: 732, size: 22, font: bold });
next.drawText('Page order must remain unchanged.', { x: 48, y: 690, size: 12, font });
await writeFile(new URL('editable.pdf', out), await doc.save());
const scan = await PDFDocument.create(),
  jpg = await scan.embedJpg(
    await readFile(new URL('../regression-fixtures/studio/oriented.jpg', import.meta.url)),
  );
scan.addPage([612, 792]).drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 });
await writeFile(new URL('image-only.pdf', out), await scan.save());
await writeFile(new URL('invalid.pdf', out), 'This is not a PDF.');
const many = await PDFDocument.create();
for (let i = 0; i < 301; i++) many.addPage([612, 792]);
await writeFile(new URL('over-page-limit.pdf', out), await many.save());
