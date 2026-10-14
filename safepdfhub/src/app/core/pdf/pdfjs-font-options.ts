/** Keep original font rendering consistent across Studio and its edit previews.
 * Embedded fonts remain authoritative; packaged resources cover standard fonts
 * and CID mappings. Never replace source page text with HTML for viewing.
 */
export function pdfjsFontOptions(baseURI = document.baseURI) {
  const asset = (folder: string) => new URL(`assets/pdfjs/${folder}/`, baseURI).toString();
  return {
    disableFontFace: false,
    useSystemFonts: true,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
  };
}
