import { imageShapes } from './large-image-inspection';
/** Consume qpdf JSON one page at a time; raw inventory size is not PDF size. */
export class StreamedInventory {
  private decoder = new TextDecoder();
  private prefix = '';
  private started = false;
  private ended = false;
  private page = '';
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private bytes = 0;
  private shapes: string[] = [];
  private shapeBytes = 0;
  constructor(private pixels: number, private maxPages: number, private maxBytes: number) {}
  getSize = () => this.bytes;
  truncate = (size: number) => {
    if (size !== 0) throw new Error('Invalid inventory truncation.');
    this.decoder = new TextDecoder(); this.prefix = ''; this.started = this.ended = false;
    this.page = ''; this.depth = 0; this.quoted = this.escaped = false;
    this.bytes = this.shapeBytes = 0; this.shapes = [];
  };
  write = (data: Uint8Array, options: {at: number}) => {
    if (options.at !== this.bytes) throw new Error('Non-sequential inventory.');
    this.bytes += data.length;
    let text = this.decoder.decode(data, { stream: true });
    if (!this.started) {
      this.prefix += text;
      const match = /"pages"\s*:\s*\[/.exec(this.prefix);
      if (!match) { if (this.prefix.length > 4096) throw new Error('Missing page inventory.'); return data.length; }
      text = this.prefix.slice(match.index + match[0].length); this.prefix = ''; this.started = true;
    }
    for (const char of text) {
      if (this.ended) break;
      if (!this.depth) {
        if (char === ']') { this.ended = true; continue; }
        if (/\s|,/.test(char)) continue;
        if (char !== '{') throw new Error('Invalid page inventory.');
      }
      this.page += char;
      if (this.page.length > 2_000_000) throw new Error('Page inventory exceeds the device budget.');
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.quoted = false;
      } else if (char === '"') this.quoted = true;
      else if (char === '{' || char === '[') this.depth++;
      else if (char === '}' || char === ']') this.depth--;
      if (!this.depth) {
        const shape = imageShapes({ pages: [JSON.parse(this.page)] }, this.pixels)[0];
        this.shapeBytes += shape.length * 2 + 32;
        if (this.shapes.length >= this.maxPages || this.shapeBytes > this.maxBytes) throw new Error('Image inventory exceeds the device budget.');
        this.shapes.push(shape); this.page = '';
      }
    }
    return data.length;
  };
  finish(): string[] {
    if (!this.started || !this.ended || this.depth || !this.shapes.length) throw new Error('Incomplete page inventory.');
    return this.shapes;
  }
}
