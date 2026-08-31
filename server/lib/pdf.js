/**
 * A PDF writer, for turning the images of one post into one file.
 *
 * Written by hand rather than pulled from npm, for the same reason nothing else here
 * comes from npm -- but it is worth saying why it is *small* enough to be reasonable.
 * A PDF page that shows a JPEG does not have to decode it: the format has a filter
 * called `DCTDecode` whose payload is a JPEG file, byte for byte. So the whole job is
 * to write a few dictionaries around bytes we already have. Nothing is re-encoded,
 * nothing loses quality, and there is no image library involved.
 *
 * Everything is a JPEG by the time it arrives here -- ytdlp.js converts with ffmpeg
 * first -- which is what keeps this file short. PNG would mean `FlateDecode`, palette
 * and alpha handling, and a real decoder, and it would buy nothing: the pictures came
 * off a website as JPEGs to begin with.
 */

/** PDF wants its own escaping inside strings; we only ever write ASCII names here. */
const enc = (s) => Buffer.from(s, 'latin1');

/**
 * Read a JPEG's pixel size and component count out of its SOF marker.
 *
 * Walking the markers is a dozen lines and means no second process just to ask how big
 * a picture is. Progressive JPEGs (SOF2) and the other SOF variants carry the same
 * fields in the same place, so every SOFn except the four that are not frame headers is
 * accepted.
 *
 * @returns {{width: number, height: number, components: number}}
 */
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('not a JPEG');
  }

  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; } // resync past padding
    const marker = buf[i + 1];
    i += 2;

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break; // end of image, or start of scan

    const length = buf.readUInt16BE(i);
    // SOF0..SOF15, minus DHT (c4), DAC (cc) and the RSTn range, are frame headers.
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      return {
        height: buf.readUInt16BE(i + 3),
        width: buf.readUInt16BE(i + 5),
        components: buf[i + 7],
      };
    }
    i += length;
  }
  throw new Error('no JPEG frame header found');
}

const COLOR_SPACE = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' };

/**
 * Build a PDF with one page per image, each page exactly the size of its picture.
 *
 * Sizing the page to the image rather than to a paper size is deliberate: a post's
 * pictures are whatever shape the person posted, and forcing them onto A4 would add
 * margins nobody asked for and letterbox a portrait photo against a landscape one.
 * PDF units are 1/72 inch, so a pixel becomes a point and the page is the picture.
 *
 * @param {Buffer[]} images JPEG buffers, in the order they should appear
 * @returns {Buffer}
 */
export function imagesToPdf(images) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('no images');

  const chunks = [];
  const offsets = [0]; // object 0 is the free-list head and has no offset of its own
  let length = 0;

  const push = (buf) => { chunks.push(buf); length += buf.length; };
  const obj = (id, body, stream = null) => {
    offsets[id] = length;
    push(enc(`${id} 0 obj\n${body}\n`));
    if (stream) {
      push(enc('stream\n'));
      push(stream);
      push(enc('\nendstream\n'));
    }
    push(enc('endobj\n'));
  };

  // The binary comment tells anything that copies this file to treat it as binary.
  push(enc('%PDF-1.4\n'));
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Ids: 1 catalog, 2 page tree, then three objects per image.
  const pageId = (n) => 3 + n * 3;
  const contentId = (n) => 4 + n * 3;
  const imageId = (n) => 5 + n * 3;

  const kids = images.map((_, n) => `${pageId(n)} 0 R`).join(' ');

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [ ${kids} ] /Count ${images.length} >>`);

  images.forEach((jpeg, n) => {
    const { width, height, components } = jpegSize(jpeg);
    const colorSpace = COLOR_SPACE[components];
    if (!colorSpace) throw new Error(`unsupported JPEG with ${components} components`);

    obj(pageId(n), [
      '<< /Type /Page /Parent 2 0 R',
      `/MediaBox [ 0 0 ${width} ${height} ]`,
      `/Resources << /XObject << /Im0 ${imageId(n)} 0 R >> >>`,
      `/Contents ${contentId(n)} 0 R >>`,
    ].join(' '));

    // Scale the unit square up to the page and paint the image into it.
    const content = enc(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`);
    obj(contentId(n), `<< /Length ${content.length} >>`, content);

    obj(imageId(n), [
      '<< /Type /XObject /Subtype /Image',
      `/Width ${width} /Height ${height}`,
      `/ColorSpace ${colorSpace} /BitsPerComponent 8`,
      `/Filter /DCTDecode /Length ${jpeg.length} >>`,
    ].join(' '), jpeg);
  });

  // The cross-reference table has to name a byte offset for every object, which is why
  // `length` has been tracked all along rather than measured at the end.
  const count = 3 + images.length * 3;
  const startxref = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  push(enc(xref));
  push(enc(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`));

  return Buffer.concat(chunks);
}
