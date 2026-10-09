/** Browser APIs jsdom lacks, which the client (and CodeMirror) use. */

if (typeof globalThis.matchMedia !== "function")
  globalThis.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;

if (typeof CSS === "undefined" || typeof CSS.escape !== "function")
  Object.assign(globalThis, {
    CSS: { ...(globalThis as { CSS?: object }).CSS, escape: (value: string) => value.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });

// CodeMirror measures text through ranges.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Element.prototype.scrollIntoView ??= () => undefined;
