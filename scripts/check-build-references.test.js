import { describe, expect, it } from "vitest";
import { buildQuery } from "../vite.config.js";
import { checkReferences, findReferences } from "./check-build-references.mjs";

/** Run buildQuery()'s generateBundle over a fake Rollup bundle. */
function addQueries(bundle) {
  buildQuery().generateBundle.handler({}, bundle);
  return bundle;
}

function fakeBundle(sharedCode = "export const a = 1;") {
  return {
    "assets/embed.js": { type: "chunk", fileName: "assets/embed.js", code: 'import{a}from"./shared.js";' },
    "assets/shared.js": {
      type: "chunk",
      fileName: "assets/shared.js",
      code: `${sharedCode}const l=()=>import(\`./edra-agriculture.js\`);const s="src/embed/main.js";`,
    },
    "assets/edra-agriculture.js": { type: "chunk", fileName: "assets/edra-agriculture.js", code: "" },
    "assets/embed.css": { type: "asset", fileName: "assets/embed.css", source: "a{}" },
    "embed.html": {
      type: "asset",
      fileName: "embed.html",
      source:
        '<script type="module" src="./assets/embed.js"></script>' +
        '<link rel="modulepreload" href="/base/assets/shared.js"><link rel="stylesheet" href="./assets/embed.css">' +
        "<!-- built from src/embed/main.js -->",
    },
  };
}

describe("buildQuery", () => {
  it("gives every reference between the build's files one ?v= build id", () => {
    const bundle = addQueries(fakeBundle());
    const [query] = bundle["embed.html"].source.match(/\?v=[0-9a-f]{10}/);
    expect(bundle["embed.html"].source).toBe(
      `<script type="module" src="./assets/embed.js${query}"></script>` +
        `<link rel="modulepreload" href="/base/assets/shared.js${query}"><link rel="stylesheet" href="./assets/embed.css${query}">` +
        "<!-- built from src/embed/main.js -->",
    );
    expect(bundle["assets/embed.js"].code).toBe(`import{a}from"./shared.js${query}";`);
    expect(bundle["assets/shared.js"].code).toContain(`import(\`./edra-agriculture.js${query}\`)`);
    // A string that only ends in an output's name is not a reference.
    expect(bundle["assets/shared.js"].code).toContain('"src/embed/main.js"');
  });

  it("changes the build id when any file changes, and only then", () => {
    const id = (bundle) => addQueries(bundle)["embed.html"].source.match(/\?v=([0-9a-f]+)/)[1];
    expect(id(fakeBundle())).toBe(id(fakeBundle()));
    expect(id(fakeBundle("export const b = 2;"))).not.toBe(id(fakeBundle()));
  });
});

describe("checkReferences", () => {
  const names = ["embed.js", "shared.js"];

  it("passes a build whose references share one build id", () => {
    const files = [
      { file: "embed.html", text: '<script src="./assets/embed.js?v=abc123"></script>' },
      { file: "assets/embed.js", text: 'import"./shared.js?v=abc123";' },
    ];
    expect(checkReferences(files, names)).toEqual([]);
  });

  it("fails a reference with no build id, and two different build ids", () => {
    expect(
      checkReferences([{ file: "embed.html", text: '<script src="./assets/embed.js"></script>' }], names),
    ).toEqual(['embed.html: "./assets/embed.js" has no ?v= build id']);
    expect(
      checkReferences(
        [
          { file: "embed.html", text: '<script src="./assets/embed.js?v=aaa"></script>' },
          { file: "assets/embed.js", text: 'import"./shared.js?v=bbb";' },
        ],
        names,
      ),
    ).toEqual(["References carry 2 different build ids: ?v=aaa, ?v=bbb"]);
  });

  it("fails when it finds no references at all", () => {
    expect(checkReferences([{ file: "embed.html", text: "<p>empty</p>" }], names)).toHaveLength(1);
  });

  it("finds only real reference forms", () => {
    expect(
      findReferences('"./shared.js" "assets/embed.js?v=1" "src/x/embed.js" "xshared.js"', names),
    ).toEqual([
      { path: "./shared.js", name: "shared.js", query: null },
      { path: "assets/embed.js", name: "embed.js", query: "?v=1" },
    ]);
  });
});
