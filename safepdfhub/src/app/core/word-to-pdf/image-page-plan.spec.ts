import { imagePagePlan } from './image-page-plan';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img1" Type="${R}/image" Target="media/image1.jpg"/></Relationships>`;
const picture = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="7556500" cy="10693400"/><wp:docPr name="PDF image 1"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="img1"/></pic:blipFill><pic:spPr><a:xfrm/><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const section = `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="11900" w:h="16840"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:gutter="0"/></w:sectPr>`;
const document = (body = picture + section) =>
  `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`;
describe('Page-image conversion eligibility', () => {
  it('preserves page size and placement', () =>
    expect(imagePagePlan(document(), rels)).toEqual([
      { path: 'word/media/image1.jpg', width: 595, height: 842, imageWidth: 595, imageHeight: 842 },
    ]));
  it('preserves one image per section', () =>
    expect(
      imagePagePlan(
        document(picture + '<w:p><w:pPr>' + section + '</w:pPr></w:p>' + picture + section),
        rels,
      )?.length,
    ).toBe(2));
  it('keeps editable text on the layout renderer', () =>
    expect(
      imagePagePlan(document().replace('<w:r>', '<w:r><w:t>Important text</w:t>'), rels),
    ).toBeNull());
  it('rejects rotated or cropped pictures', () => {
    expect(
      imagePagePlan(document().replace('<a:xfrm/>', '<a:xfrm rot="5400000"/>'), rels),
    ).toBeNull();
    expect(
      imagePagePlan(document().replace('<a:blip ', '<a:srcRect l="500"/><a:blip '), rels),
    ).toBeNull();
  });
  it('rejects headers and nonzero margins', () => {
    expect(
      imagePagePlan(document().replace('<w:sectPr>', '<w:sectPr><w:headerReference/>'), rels),
    ).toBeNull();
    expect(imagePagePlan(document().replace('w:left="0"', 'w:left="200"'), rels)).toBeNull();
  });
  it('does not drop unmatched images', () =>
    expect(imagePagePlan(document(picture + picture + section), rels)).toBeNull());
  it('rejects external and missing references', () => {
    expect(
      imagePagePlan(document(), rels.replace('Target="', 'TargetMode="External" Target="')),
    ).toBeNull();
    expect(imagePagePlan(document(), rels.replace('Id="img1"', 'Id="other"'))).toBeNull();
  });
  it('rejects XML entities', () =>
    expect(() => imagePagePlan('<!DOCTYPE document>' + document(), rels)).toThrow('declarations'));
});
