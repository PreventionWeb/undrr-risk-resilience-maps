import { describe, expect, it, vi } from "vitest";
import { classifyMessage, createMessageBridge, MESSAGE_TYPE, MESSAGE_VERSION } from "./messaging.js";

const HOST = "https://www.undrr.org";

/**
 * A stand-in embed window: its own listener list, and a `parent` that records
 * what was posted to it and with which target origin.
 */
function fakeEmbedWindow({ framed = true } = {}) {
  const target = new EventTarget();
  const posted = [];
  const parent = framed ? { postMessage: (data, origin) => posted.push({ data, origin }) } : target;
  target.parent = parent;
  target.posted = posted;
  /** Deliver a message event as the browser would, from `origin` and `source`. */
  target.deliver = (data, { origin = HOST, source = parent } = {}) => {
    const event = new Event("message");
    Object.assign(event, { data, origin, source });
    target.dispatchEvent(event);
  };
  return target;
}

const envelope = (name, payload = {}, extra = {}) => ({
  type: MESSAGE_TYPE,
  v: MESSAGE_VERSION,
  name,
  payload,
  ...extra,
});

describe("classifyMessage", () => {
  const parent = {};
  const context = { parentOrigin: HOST, parent, instance: "map-1" };
  const event = (data, over = {}) => ({ data, origin: HOST, source: parent, ...over });

  it("accepts a well-formed command from the configured parent", () => {
    expect(classifyMessage(event(envelope("set-tab", { tab: "hazard" }, { id: "a1" })), context)).toEqual({
      ok: true,
      name: "set-tab",
      payload: { tab: "hazard" },
      id: "a1",
    });
  });

  it("refuses everything when no parent origin is configured", () => {
    expect(classifyMessage(event(envelope("set-tab")), { ...context, parentOrigin: null })).toEqual({
      ok: false,
      reason: "foreign-origin",
    });
  });

  it("refuses another origin, even with a perfect envelope", () => {
    expect(classifyMessage(event(envelope("set-tab"), { origin: "https://evil.example" }), context)).toEqual({
      ok: false,
      reason: "foreign-origin",
    });
  });

  it("refuses a window that is not the parent (a sibling frame or an opener)", () => {
    expect(classifyMessage(event(envelope("set-tab"), { source: {} }), context)).toEqual({
      ok: false,
      reason: "foreign-source",
    });
  });

  it("refuses everything when there is no parent to compare the source against", () => {
    // Finding 4: the source check used to be skipped when `parent` was null,
    // which the bridge never does — but this function is exported as the
    // security surface, so it has to fail closed on its own.
    for (const parentRef of [null, undefined]) {
      expect(classifyMessage(event(envelope("set-tab")), { ...context, parent: parentRef })).toEqual({
        ok: false,
        reason: "foreign-source",
      });
    }
  });

  it("ignores traffic that is not this protocol", () => {
    for (const data of [
      null,
      "hello",
      42,
      [],
      { type: "webpackHotUpdate" },
      { type: MESSAGE_TYPE.toUpperCase() },
    ]) {
      expect(classifyMessage(event(data), context).ok).toBe(false);
      expect(classifyMessage(event(data), context).reason).toBe("not-ours");
    }
  });

  it("reports an unsupported version rather than guessing", () => {
    expect(classifyMessage(event({ ...envelope("set-tab"), v: 99 }), context)).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
    expect(classifyMessage(event({ ...envelope("set-tab"), v: "1" }), context).reason).toBe(
      "unsupported-version",
    );
  });

  it("ignores a message addressed to another frame, and accepts one addressed to none", () => {
    expect(classifyMessage(event(envelope("set-tab", {}, { instance: "map-2" })), context).reason).toBe(
      "other-instance",
    );
    expect(classifyMessage(event(envelope("set-tab", {}, { instance: "map-1" })), context).ok).toBe(true);
    expect(classifyMessage(event(envelope("set-tab")), context).ok).toBe(true);
  });

  it("accepts only the documented command names", () => {
    for (const name of ["set-layers", "set-tab", "get-state"]) {
      expect(classifyMessage(event(envelope(name)), context).ok).toBe(true);
    }
    // Outbound names are not commands, and neither is anything invented.
    for (const name of ["state", "ready", "resize", "error", "eval", "", 1, undefined]) {
      expect(classifyMessage(event(envelope(name)), context).reason).toBe("unknown-name");
    }
  });

  it("rejects a payload that is not an object, and defaults a missing one", () => {
    expect(classifyMessage(event(envelope("set-layers", "layers")), context).reason).toBe("malformed");
    expect(classifyMessage(event({ ...envelope("get-state"), payload: undefined }), context)).toEqual({
      ok: true,
      name: "get-state",
      payload: {},
      id: undefined,
    });
  });

  it("drops an id that is not a short string", () => {
    expect(classifyMessage(event(envelope("get-state", {}, { id: 7 })), context).id).toBeUndefined();
    expect(
      classifyMessage(event(envelope("get-state", {}, { id: "x".repeat(65) })), context).id,
    ).toBeUndefined();
  });
});

describe("createMessageBridge", () => {
  it("posts to the configured origin and never to *", () => {
    const windowRef = fakeEmbedWindow();
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST, instance: "map-1" });

    expect(bridge.post("ready", { version: 1, tabs: ["hazard"], layers: ["landslides"] })).toBe(true);

    expect(windowRef.posted).toEqual([
      {
        origin: HOST,
        data: {
          type: MESSAGE_TYPE,
          v: MESSAGE_VERSION,
          name: "ready",
          payload: { version: 1, tabs: ["hazard"], layers: ["landslides"] },
          instance: "map-1",
        },
      },
    ]);
  });

  it("echoes the request id on a reply and leaves it out otherwise", () => {
    const windowRef = fakeEmbedWindow();
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST });

    bridge.post("state", { tab: "hazard", layers: [] }, { id: "req-1" });
    bridge.post("state", { tab: "hazard", layers: [] });

    expect(windowRef.posted[0].data.id).toBe("req-1");
    expect("id" in windowRef.posted[1].data).toBe(false);
    expect("instance" in windowRef.posted[1].data).toBe(false);
  });

  it("refuses to post a name that is not in the outbound schema", () => {
    const windowRef = fakeEmbedWindow();
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST });

    expect(bridge.post("set-tab", { tab: "hazard" })).toBe(false);
    // `resize` left the v1 schema (finding 7): in a frame-filling embed the hint
    // only ever reported the height the host had already set.
    expect(bridge.post("resize", { height: 600 })).toBe(false);
    expect(windowRef.posted).toEqual([]);
  });

  it("is disabled, in both directions, with no parent origin", () => {
    const windowRef = fakeEmbedWindow();
    const onCommand = vi.fn();
    const bridge = createMessageBridge({ windowRef, parentOrigin: null, onCommand });

    expect(bridge.enabled).toBe(false);
    expect(bridge.post("ready", {})).toBe(false);
    windowRef.deliver(envelope("set-tab", { tab: "hazard" }));

    expect(onCommand).not.toHaveBeenCalled();
    expect(windowRef.posted).toEqual([]);
  });

  it("is disabled when the page is not framed at all", () => {
    const windowRef = fakeEmbedWindow({ framed: false });
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST });

    expect(bridge.enabled).toBe(false);
    expect(bridge.post("ready", {})).toBe(false);
  });

  it("delivers a valid command and ignores one from a wrong origin", () => {
    const windowRef = fakeEmbedWindow();
    const onCommand = vi.fn();
    createMessageBridge({ windowRef, parentOrigin: HOST, onCommand });

    windowRef.deliver(envelope("set-tab", { tab: "hazard" }));
    windowRef.deliver(envelope("set-tab", { tab: "exposure" }), { origin: "https://evil.example" });

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({ name: "set-tab", payload: { tab: "hazard" } });
  });

  it("answers an unsupported version and stays silent about everything else", () => {
    const windowRef = fakeEmbedWindow();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMessageBridge({ windowRef, parentOrigin: HOST, onCommand: () => {} });

    windowRef.deliver({ ...envelope("set-tab"), v: 99 });
    windowRef.deliver({ type: "something-else" });
    windowRef.deliver(envelope("nonsense"));

    expect(windowRef.posted).toHaveLength(1);
    expect(windowRef.posted[0].data).toMatchObject({
      name: "error",
      payload: { code: "unsupported-version" },
    });
    consoleWarn.mockRestore();
  });

  it("answers an unsupported version once, however often it arrives", () => {
    // Finding 5: a host looping in the wrong version used to get a reply per
    // message — 2,000 messages, 2,000 replies. One answer is what it needs.
    const windowRef = fakeEmbedWindow();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMessageBridge({ windowRef, parentOrigin: HOST, onCommand: () => {} });

    for (let i = 0; i < 2000; i += 1) windowRef.deliver({ ...envelope("set-tab"), v: 2 });

    expect(windowRef.posted).toHaveLength(1);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });

  it("reports a throwing command instead of letting it escape the listener", () => {
    const windowRef = fakeEmbedWindow();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    createMessageBridge({
      windowRef,
      parentOrigin: HOST,
      onCommand: () => {
        throw new Error("boom");
      },
    });

    expect(() => windowRef.deliver(envelope("set-tab", { tab: "hazard" }, { id: "r1" }))).not.toThrow();
    expect(windowRef.posted[0].data).toMatchObject({
      name: "error",
      id: "r1",
      payload: { code: "command-failed" },
    });
    consoleError.mockRestore();
  });

  it("stops listening and posting after destroy", () => {
    const windowRef = fakeEmbedWindow();
    const onCommand = vi.fn();
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST, onCommand });

    bridge.destroy();
    windowRef.deliver(envelope("set-tab", { tab: "hazard" }));

    expect(onCommand).not.toHaveBeenCalled();
    expect(bridge.post("state", {})).toBe(false);
  });

  it("survives a parent that refuses the message", () => {
    const windowRef = fakeEmbedWindow();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    windowRef.parent.postMessage = () => {
      throw new Error("DataCloneError");
    };
    const bridge = createMessageBridge({ windowRef, parentOrigin: HOST });

    expect(bridge.post("state", { tab: "hazard", layers: [] })).toBe(false);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
