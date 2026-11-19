'use strict';
// Synthetic JPEG builder for limit tests. Not owner data and not a copy of any
// file: it writes a flat picture in which every coefficient is zero, using one
// one-bit Huffman code per table, so a 4096 x 4096 picture is 65 to 263 KB of
// input while the decoder still allocates every block, line and pixel.
// No restart markers. Checked once against an independent libjpeg decoder
// (all five layouts, baseline and progressive, at 16x16, 17x9 and 100x37).
const LAYOUTS = Object.freeze({
  grey: [ [ 1, 1 ] ],
  '4:4:4': [ [ 1, 1 ], [ 1, 1 ], [ 1, 1 ] ],
  '4:2:2': [ [ 2, 1 ], [ 1, 1 ], [ 1, 1 ] ],
  '4:2:0': [ [ 2, 2 ], [ 1, 1 ], [ 1, 1 ] ],
  // Four components, no subsampling, with the Adobe marker (transform 0).
  'four-component': [ [ 1, 1 ], [ 1, 1 ], [ 1, 1 ], [ 1, 1 ] ]
});

function segment(marker, body) {
  const head = Buffer.alloc(4);
  head[0] = 255;
  head[1] = marker;
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([ head, body ]);
}

function syntheticJpeg({ width, height, layout = '4:2:0', progressive = false }) {
  const components = LAYOUTS[layout];
  if (!components || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) throw Error('SYNTHETIC_JPEG_OPTIONS');
  const parts = [ Buffer.from([ 255, 216 ]) ];
  if (components.length === 4) parts.push(segment(238, Buffer.from([ 65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0 ])));
  parts.push(segment(219, Buffer.concat([ Buffer.from([ 0 ]), Buffer.alloc(64, 1) ])));
  const frame = Buffer.alloc(6 + 3 * components.length);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = components.length;
  components.forEach(([ h, v ], i) => {
    frame[6 + 3 * i] = i + 1;
    frame[7 + 3 * i] = h << 4 | v;
    frame[8 + 3 * i] = 0;
  });
  parts.push(segment(progressive ? 194 : 192, frame));
  // One code of length one for symbol 0, in a DC table and an AC table.
  const table = kind => Buffer.concat([ Buffer.from([ kind << 4, 1 ]), Buffer.alloc(15), Buffer.from([ 0 ]) ]);
  parts.push(segment(196, table(0)), segment(196, table(1)));
  const hMax = Math.max(...components.map(c => c[0])), vMax = Math.max(...components.map(c => c[1]));
  const units = Math.ceil(width / (8 * hMax)) * Math.ceil(height / (8 * vMax));
  const blocksPerUnit = components.reduce((n, [ h, v ]) => n + h * v, 0);
  function scan(ids, first, last, bits) {
    const head = Buffer.alloc(4 + 2 * ids.length);
    head[0] = ids.length;
    ids.forEach((id, i) => {
      head[1 + 2 * i] = id;
      head[2 + 2 * i] = 0;
    });
    head[1 + 2 * ids.length] = first;
    head[2 + 2 * ids.length] = last;
    head[3 + 2 * ids.length] = 0;
    // Every code is the single bit 0; the last byte is padded with ones and
    // can never become 0xFF because it holds at least one zero bit.
    const data = Buffer.alloc(Math.ceil(bits / 8));
    if (bits % 8) data[data.length - 1] = 255 >>> bits % 8;
    return Buffer.concat([ segment(218, head), data ]);
  }
  const all = components.map((_, i) => i + 1);
  if (!progressive) parts.push(scan(all, 0, 63, units * blocksPerUnit * 2));
  else {
    parts.push(scan(all, 0, 0, units * blocksPerUnit));
    components.forEach(([ h, v ], i) => {
      const blocks = Math.ceil(Math.ceil(width * h / hMax) / 8) * Math.ceil(Math.ceil(height * v / vMax) / 8);
      parts.push(scan([ i + 1 ], 1, 63, blocks));
    });
  }
  parts.push(Buffer.from([ 255, 217 ]));
  return Buffer.concat(parts);
}

module.exports = { syntheticJpeg, SYNTHETIC_JPEG_LAYOUTS: Object.freeze(Object.keys(LAYOUTS)) };
