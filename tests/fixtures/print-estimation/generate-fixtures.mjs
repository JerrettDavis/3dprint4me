// Regenerates the committed STL/3MF fixtures: `node tests/fixtures/print-estimation/generate-fixtures.mjs`.
// Hostile fixtures are small on disk but would be dangerous if expanded without limits.
import { writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const out = name => new URL(`./${name}`, import.meta.url);

// Axis-aligned cube as 12 outward-facing triangles.
function cubeTriangles(size, [ox, oy, oz] = [0, 0, 0]) {
  const s = size;
  const v = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]].map(([x, y, z]) => [x + ox, y + oy, z + oz]);
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { vertices: v, faces, triangles: faces.map(face => face.map(index => v[index])) };
}

function asciiStl(size) {
  const lines = ["solid cube"];
  for (const tri of cubeTriangles(size).triangles) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (const [x, y, z] of tri) lines.push(`      vertex ${x} ${y} ${z}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push("endsolid cube", "");
  return Buffer.from(lines.join("\n"), "latin1");
}

function binaryStl(size, { lieAboutCount = false } = {}) {
  const tris = cubeTriangles(size).triangles;
  const buffer = Buffer.alloc(84 + tris.length * 50);
  buffer.write("solid binary header that is not ascii", 0, "latin1");
  buffer.writeUInt32LE(lieAboutCount ? tris.length + 5 : tris.length, 80);
  tris.forEach((tri, index) => tri.flat().forEach((value, axis) => buffer.writeFloatLE(value, 84 + index * 50 + 12 + axis * 4)));
  return buffer;
}

function modelXml({ unit = "millimeter", size = 10, transform = "1 0 0 0 1 0 0 0 1 5 5 0", prolog = "" } = {}) {
  const cube = cubeTriangles(size);
  return `<?xml version="1.0" encoding="UTF-8"?>${prolog}
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh><vertices>
${cube.vertices.map(([x, y, z]) => `   <vertex x="${x}" y="${y}" z="${z}"/>`).join("\n")}
  </vertices><triangles>
${cube.faces.map(([a, b, c]) => `   <triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("\n")}
  </triangles></mesh></object>
  <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object>
 </resources>
 <build><item objectid="1" transform="${transform}"/><item objectid="2"/></build>
</model>`;
}

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
const TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;

/** Minimal deterministic ZIP writer. `declaredSize` lets a fixture lie in its directory. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const stored = entry.store === true;
    const data = stored ? raw : deflateRawSync(raw, { level: 9 });
    const declared = entry.declaredSize ?? raw.length;
    const flags = entry.encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10); central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const package3mf = (model, extra = []) => zip([{ name: "[Content_Types].xml", data: TYPES }, { name: "_rels/.rels", data: RELS }, { name: "3D/3dmodel.model", data: model }, ...extra]);

const fixtures = {
  "cube-10mm-ascii.stl": asciiStl(10),
  "cube-20mm-binary.stl": binaryStl(20),
  "truncated-binary.stl": binaryStl(10, { lieAboutCount: true }),
  "incomplete-ascii.stl": Buffer.from("solid broken\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n  endloop\n endfacet\nendsolid broken\n", "latin1"),
  "two-cubes.3mf": package3mf(modelXml(), [{ name: "Metadata/Slic3r_PE.config", data: "; printer settings are ignored\n" }]),
  "inch-cube.3mf": package3mf(modelXml({ unit: "inch", size: 1, transform: "" })),
  "traversal.3mf": zip([{ name: "_rels/.rels", data: RELS }, { name: "../3D/3dmodel.model", data: modelXml() }]),
  "zip-bomb.3mf": package3mf(Buffer.alloc(32 * 1024 * 1024, 0x20)),
  "size-lie.3mf": zip([{ name: "_rels/.rels", data: RELS }, { name: "3D/3dmodel.model", data: modelXml().padEnd(200_000, " "), declaredSize: 1000 }]),
  "doctype-entity.3mf": package3mf(modelXml({ prolog: '<!DOCTYPE model [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' })),
  "too-many-entries.3mf": zip([{ name: "_rels/.rels", data: RELS }, { name: "3D/3dmodel.model", data: modelXml() }, ...Array.from({ length: 300 }, (_, index) => ({ name: `Metadata/pad-${index}.txt`, data: "x", store: true }))]),
  "encrypted.3mf": zip([{ name: "_rels/.rels", data: RELS }, { name: "3D/3dmodel.model", data: modelXml(), encrypted: true }]),
  "not-a-zip.3mf": Buffer.from("solid pretending\n", "latin1")
};

for (const [name, data] of Object.entries(fixtures)) writeFileSync(out(name), data);
console.log(`Wrote ${Object.keys(fixtures).length} print-estimation fixtures.`);
