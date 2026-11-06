import { describe, expect, it, vi } from "vitest";
import { BOM, CRLF, csvCell, csvRow, csvText, saveTextFile } from "./csv.js";

describe("csvCell (RFC 4180)", () => {
  it("leaves plain text and numbers bare", () => {
    expect(csvCell("Region A")).toBe("Region A");
    expect(csvCell(3.14)).toBe("3.14");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(0)).toBe("0");
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvCell("A, B")).toBe('"A, B"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("writes missing and non-finite values as empty cells", () => {
    for (const value of [null, undefined, Number.NaN, Infinity, -Infinity]) expect(csvCell(value)).toBe("");
  });

  it("defuses formulas only when asked, never numeric text", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("=HYPERLINK(1)");
    expect(csvCell("=HYPERLINK(1)", { defuse: true })).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd", { defuse: true })).toBe("'@cmd");
    expect(csvCell("+1+1 ok", { defuse: true })).toBe("'+1+1 ok");
    expect(csvCell("-3.5", { defuse: true })).toBe("-3.5");
    expect(csvCell("=a,b", { defuse: true })).toBe('"\'=a,b"');
  });
});

describe("csvRow / csvText", () => {
  it("joins cells and lines with a BOM and CRLF", () => {
    expect(csvRow(["a", "b,c", 1])).toBe('a,"b,c",1');
    expect(csvText(["x", "y"])).toBe(`${BOM}x${CRLF}y${CRLF}`);
    expect(csvText(["x", "y"], { trailing: false })).toBe(`${BOM}x${CRLF}y`);
  });
});

describe("saveTextFile", () => {
  it("clicks a temporary download link for a blob and revokes it later", () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const clicks = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicks.push([this.download, this.href, this.isConnected]);
    });
    saveTextFile(document, "a,b", "file.csv");
    expect(clicks).toEqual([["file.csv", "blob:test", true]]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
    vi.useRealTimers();
  });
});
