export const rawFixture = {
  name: "Checkout",
  lastModified: "2026-08-12T00:00:00Z",
  version: "42",
  nodes: {
    "1:2": {
      document: {
        id: "1:2",
        name: "Payment card",
        type: "FRAME",
        absoluteBoundingBox: { x: 100, y: 200, width: 320, height: 180 },
        layoutMode: "VERTICAL",
        itemSpacing: 16,
        paddingTop: 24,
        paddingRight: 24,
        paddingBottom: 24,
        paddingLeft: 24,
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [
          {
            id: "1:3",
            name: "Card title",
            type: "TEXT",
            characters: "Payment details",
            absoluteBoundingBox: { x: 124, y: 224, width: 180, height: 24 },
            style: { fontFamily: "Inter", fontSize: 18, fontWeight: 600, lineHeightPx: 24 },
            fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
          },
          {
            id: "1:4",
            name: "Card artwork",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 124, y: 264, width: 272, height: 80 },
            fills: [{ type: "IMAGE", imageRef: "image-ref-123", scaleMode: "FILL" }],
          },
        ],
      },
      components: {},
      styles: {},
    },
  },
};

