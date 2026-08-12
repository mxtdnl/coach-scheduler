// Minimal ZIP writer (SPEC.md §7.4).
//
// The coach calendar export is one .ics file per meeting, bundled into a
// single .zip. That is the only ZIP this app ever writes: a handful of small
// UTF-8 text files. A stored (uncompressed) archive is therefore both correct
// and smaller in code than pulling in a compression library — SPEC.md §2 keeps
// the app to plain modules with no build step and one CDN dependency, so a
// second library for a few kilobytes of text would be the wrong trade.
//
// Everything here is pure: it takes file names and bytes and returns the
// archive bytes, so tests.html can assert on the real archive without a DOM,
// a download, or a network request.

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Store (no compression). */
const METHOD_STORE = 0;

/** General purpose bit 11: file names and comments are UTF-8. */
const FLAG_UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum every ZIP entry carries. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function toBytes(data) {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error('A ZIP entry must be a string or a Uint8Array.');
}

/**
 * The MS-DOS date and time fields a ZIP entry carries. They have two-second
 * resolution and no timezone — that is the format, not an approximation on
 * our part. Dates before 1980 cannot be represented and are clamped, so an
 * unset clock cannot produce a corrupt archive.
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * ZIP entry names must be relative POSIX paths. Everything the app puts in an
 * archive is a single flat file name built from user-supplied coach and
 * student names, so this is the one place that has to make sure a name
 * containing a slash, a backslash, "..", or a control character cannot become
 * a path that escapes the archive.
 *
 * @param {string} name the desired file name
 * @param {string} [fallback] used when nothing usable survives
 */
export function sanitiseZipEntryName(name, fallback = 'file') {
  const cleaned = String(name ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '') // control characters
    // Path segments are dropped rather than rewritten: "." and ".." carry
    // meaning to an extractor, so they must not survive in any form.
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('-')
    .replace(/[:*?"<>|]+/g, '-') // characters Windows refuses in a file name
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-]+/, '') // no leading dot (hidden file) or stray separator
    .replace(/\.+$/, '') // Windows drops a trailing dot silently
    .slice(0, 180);
  return cleaned === '' ? fallback : cleaned;
}

/**
 * Makes a list of entry names unique, in order, by appending `_2`, `_3`, …
 * before the extension. Two meetings that would otherwise produce the same
 * file name (same student, same day, same time — possible when a rescheduled
 * meeting lands beside another) must not silently overwrite one another
 * inside the archive.
 */
export function dedupeEntryNames(names) {
  const used = new Map(); // lower-cased name → how many times it has been taken
  return names.map((raw) => {
    const name = String(raw);
    const key = name.toLowerCase();
    const count = used.get(key) || 0;
    used.set(key, count + 1);
    if (count === 0) return name;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    // The suffixed name could itself already be taken; keep counting up.
    let n = count + 1;
    let candidate = `${stem}_${n}${ext}`;
    while (used.has(candidate.toLowerCase())) {
      n += 1;
      candidate = `${stem}_${n}${ext}`;
    }
    used.set(candidate.toLowerCase(), 1);
    return candidate;
  });
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Builds a real .zip archive containing the given files, stored uncompressed.
 *
 * @param {Array<{name:string, data:string|Uint8Array}>} files
 * @param {{date?:Date}} [options] the modification timestamp written on every
 *        entry; pass a fixed date for a byte-for-byte deterministic archive
 * @returns {Uint8Array} the archive bytes
 */
export function buildZip(files, options = {}) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    throw new Error('A ZIP archive needs at least one file.');
  }

  const stamp = dosDateTime(options.date instanceof Date ? options.date : new Date());
  const names = dedupeEntryNames(list.map((file, i) => sanitiseZipEntryName(file.name, `file-${i + 1}`)));

  const entries = list.map((file, i) => {
    const data = toBytes(file.data);
    return { nameBytes: encoder.encode(names[i]), data, crc: crc32(data) };
  });

  const localSize = entries.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
  const buffer = new ArrayBuffer(localSize + centralSize + 22);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let offset = 0;
  entries.forEach((entry) => {
    entry.offset = offset;
    writeU32(view, offset, LOCAL_HEADER_SIG);
    writeU16(view, offset + 4, 20); // version needed to extract (2.0)
    writeU16(view, offset + 6, FLAG_UTF8);
    writeU16(view, offset + 8, METHOD_STORE);
    writeU16(view, offset + 10, stamp.time);
    writeU16(view, offset + 12, stamp.date);
    writeU32(view, offset + 14, entry.crc);
    writeU32(view, offset + 18, entry.data.length); // compressed size
    writeU32(view, offset + 22, entry.data.length); // uncompressed size
    writeU16(view, offset + 26, entry.nameBytes.length);
    writeU16(view, offset + 28, 0); // extra field length
    bytes.set(entry.nameBytes, offset + 30);
    bytes.set(entry.data, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + entry.data.length;
  });

  const centralStart = offset;
  entries.forEach((entry) => {
    writeU32(view, offset, CENTRAL_HEADER_SIG);
    writeU16(view, offset + 4, 20); // version made by
    writeU16(view, offset + 6, 20); // version needed to extract
    writeU16(view, offset + 8, FLAG_UTF8);
    writeU16(view, offset + 10, METHOD_STORE);
    writeU16(view, offset + 12, stamp.time);
    writeU16(view, offset + 14, stamp.date);
    writeU32(view, offset + 16, entry.crc);
    writeU32(view, offset + 20, entry.data.length);
    writeU32(view, offset + 24, entry.data.length);
    writeU16(view, offset + 28, entry.nameBytes.length);
    writeU16(view, offset + 30, 0); // extra field length
    writeU16(view, offset + 32, 0); // file comment length
    writeU16(view, offset + 34, 0); // disk number start
    writeU16(view, offset + 36, 0); // internal file attributes
    writeU32(view, offset + 38, 0); // external file attributes
    writeU32(view, offset + 42, entry.offset);
    bytes.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  });

  writeU32(view, offset, EOCD_SIG);
  writeU16(view, offset + 4, 0); // this disk
  writeU16(view, offset + 6, 0); // disk with the central directory
  writeU16(view, offset + 8, entries.length);
  writeU16(view, offset + 10, entries.length);
  writeU32(view, offset + 12, offset - centralStart);
  writeU32(view, offset + 16, centralStart);
  writeU16(view, offset + 20, 0); // archive comment length

  return bytes;
}
