import assert from "node:assert/strict";
import test from "node:test";
import { GENERAL, fieldSection, hasSections, partSection, partsOfSection, sectionLabel, sectionList } from "../../customizer/framework/sections.js";
import { groupFields, renderFormHtml } from "../../customizer/framework/form.js";

// A stub generator that uses the section contract (what the real definitions are adding).
const stub = {
  id: "stub",
  title: "Stub",
  sections: { top: "Top text", lower: "Lower text", back: "Back QR", unused: "Never used" },
  focus: [
    { part: "top", section: "top" },
    { part: "top-outline", section: "outline" },
    { part: "lower", section: "lower" },
    { part: "qr", section: "back" }
  ],
  schema: {
    top_text: { type: "text", label: "Top", max: 10, default: "A", group: "text", section: "top" },
    top_color: { type: "color", label: "Top color", default: "#ffffff", group: "colors", section: "top" },
    lower_text: { type: "text", label: "Lower", max: 10, default: "B", group: "text", section: "lower" },
    qr_size: { type: "number", label: "QR size", min: 25, max: 100, step: 5, default: 100, group: "back", section: "back", help: "100 = fills the tag" },
    width: { type: "number", label: "Width", min: 10, max: 99, step: 1, default: 50, group: "size" },
    font: {
      type: "enum", label: "Font", picker: "font", default: "a", group: "font", section: "top",
      options: [
        { value: "a", label: "Alpha", group: "Sans" },
        { value: "b", label: "Beta", group: "Sans" },
        { value: "c", label: "Gamma", group: "Script" },
        { value: "own", label: "Mine" }
      ]
    }
  }
};

test("sections: ordered, declared labels, General last, unused declared sections dropped", () => {
  assert.deepEqual(sectionList(stub).map(s => s.key), ["top", "lower", "back", "outline", GENERAL]);
  assert.equal(sectionLabel(stub, "top"), "Top text");
  assert.equal(sectionLabel(stub, "outline"), "Outline", "a focus-only section gets a title-cased label");
  assert.equal(sectionLabel(stub, GENERAL), "General");
  assert.equal(fieldSection(stub.schema.width), GENERAL);
  assert.equal(hasSections(stub), true);
  assert.equal(hasSections({ schema: { a: { type: "int", default: 1 } } }), false);
});

test("a definition may place General itself", () => {
  const g = { sections: { general: "Basics", top: "Top" }, schema: { a: { type: "int", default: 1 }, b: { type: "int", default: 1, section: "top" } } };
  assert.deepEqual(sectionList(g).map(s => s.key), ["general", "top"]);
  assert.equal(sectionLabel(g, "general"), "Basics");
});

test("parts map to sections by exact name, then the longest prefix", () => {
  assert.equal(partSection(stub, "top"), "top");
  assert.equal(partSection(stub, "top-text"), "top");
  assert.equal(partSection(stub, "top-outline-2"), "outline");
  assert.equal(partSection(stub, "top-outline"), "outline");
  assert.equal(partSection(stub, "qr-modules"), "back");
  assert.equal(partSection(stub, "plate"), null);
  assert.equal(partSection({}, "anything"), null);
  assert.deepEqual(partsOfSection(stub, ["top-a", "lower", "plate", "top-outline"], "top"), ["top-a"]);
});

test("groupFields: Category keeps schema order of `group`; Section follows `sections`; both cover every field once", () => {
  const category = groupFields(stub, "category");
  assert.deepEqual(category.map(g => g.key), ["text", "colors", "back", "size", "font"]);
  const section = groupFields(stub, "section");
  assert.deepEqual(section.map(g => [g.key, g.label]), [["top", "Top text"], ["lower", "Lower text"], ["back", "Back QR"], [GENERAL, "General"]]);
  assert.deepEqual(section[0].keys, ["top_text", "top_color", "font"]);
  const all = k => groupFields(stub, k).flatMap(g => g.keys).sort();
  assert.deepEqual(all("section"), all("category"));
});

test("a generator without sections renders exactly the category fieldsets", () => {
  const legacy = { schema: { a: { type: "int", label: "A", min: 1, max: 3, step: 1, default: 2, group: "text" }, b: { type: "int", label: "B", min: 1, max: 3, step: 1, default: 2, group: "size" } } };
  const html = renderFormHtml(legacy, {});
  assert.deepEqual([...html.matchAll(/<legend class="cz-legend">([^<]+)<\/legend>/g)].map(m => m[1]), ["Text", "Size and depth"]);
  assert.deepEqual(groupFields(legacy, "section").map(g => g.key), [GENERAL]);
});

test("renderFormHtml can render the Section grouping too", () => {
  const html = renderFormHtml(stub, {}, { mode: "section" });
  assert.deepEqual([...html.matchAll(/<legend class="cz-legend">([^<]+)<\/legend>/g)].map(m => m[1]), ["Top text", "Lower text", "Back QR", "General"]);
});

test("a number field's help is rendered and described by both of its controls", () => {
  const html = renderFormHtml(stub, {});
  assert.match(html, /<p class="help" id="cz-qr_size-help">100 = fills the tag<\/p>/);
  assert.match(html.match(/<input[^>]*type="range"[^>]*data-for="qr_size"[^>]*>/)[0] + html.match(/<input[^>]*name="qr_size"[^>]*>/)[0], /aria-describedby="cz-qr_size-help"[\s\S]*aria-describedby="cz-qr_size-help"/);
  const plain = html.match(/<input[^>]*name="width"[^>]*>/)[0];
  assert.doesNotMatch(plain, /aria-describedby/);
});

test("the font picker draws a heading when an option's group changes, keeping option order", () => {
  const html = renderFormHtml(stub, {});
  const list = html.slice(html.indexOf('id="cz-font-list"'));
  const order = [...list.matchAll(/class="cz-picker-group[^"]*" role="presentation">([^<]*)<|for="cz-font-([a-z]+)"/g)].map(m => m[1] ?? m[2]);
  assert.deepEqual(order, ["Sans", "a", "b", "Script", "c", "", "own"]);
  assert.ok(!/<label[^>]*cz-picker-group/.test(html), "headings are not labels (the picker's labels are its options)");
});

test("an error slot is a wrapper that starts open only when there is a message", () => {
  const open = renderFormHtml(stub, {}, { fieldErrors: { width: "Too wide" } });
  assert.match(open, /<div class="cz-err is-open"><p class="cz-field-error" id="cz-width-error">Too wide<\/p><\/div>/);
  assert.match(renderFormHtml(stub, {}), /<div class="cz-err"><p class="cz-field-error" id="cz-width-error"><\/p><\/div>/);
});
