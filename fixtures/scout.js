export const scoutRawFixture = {
  name: "Synthetic workspace flows",
  lastModified: "2026-08-12T00:00:00Z",
  version: "84",
  nodes: {
    "10:1": {
      document: {
        id: "10:1",
        name: "Workspace management flows",
        type: "SECTION",
        absoluteBoundingBox: { x: 0, y: 0, width: 3600, height: 1200 },
        children: [
          {
            id: "10:2",
            name: "Project list",
            type: "FRAME",
            absoluteBoundingBox: { x: 40, y: 80, width: 1280, height: 800 },
            children: [
              {
                id: "10:20",
                name: "Page title",
                type: "TEXT",
                characters: "Project overview",
                absoluteBoundingBox: { x: 80, y: 120, width: 300, height: 40 },
                style: { fontFamily: "Inter", fontSize: 28, fontWeight: 700 },
              },
            ],
          },
          {
            id: "10:3",
            name: "Create project - Smart template",
            type: "FRAME",
            absoluteBoundingBox: { x: 1400, y: 80, width: 1280, height: 900 },
            children: [
              {
                id: "10:30",
                name: "Modal title",
                type: "TEXT",
                characters: "Create Project",
                absoluteBoundingBox: { x: 1440, y: 120, width: 300, height: 40 },
                style: { fontFamily: "Inter", fontSize: 28, fontWeight: 700 },
              },
              {
                id: "10:31",
                name: "Smart template option",
                type: "COMPONENT",
                absoluteBoundingBox: { x: 1440, y: 200, width: 520, height: 96 },
                children: [
                  {
                    id: "10:33",
                    name: "Icon / Sparkles",
                    type: "VECTOR",
                    absoluteBoundingBox: { x: 1452, y: 220, width: 16, height: 16 },
                  },
                  {
                    id: "10:32",
                    name: "Option label",
                    type: "TEXT",
                    characters: "Smart template",
                    absoluteBoundingBox: { x: 1480, y: 220, width: 320, height: 32 },
                    style: { fontFamily: "Inter", fontSize: 18, fontWeight: 600 },
                  },
                ],
              },
              {
                id: "10:34",
                name: "Dormant AI variant",
                type: "FRAME",
                visible: false,
                absoluteBoundingBox: { x: 1440, y: 320, width: 520, height: 160 },
                children: [
                  {
                    id: "10:35",
                    name: "AI label",
                    type: "TEXT",
                    characters: "AI helper",
                    absoluteBoundingBox: { x: 1460, y: 340, width: 200, height: 32 },
                    style: { fontFamily: "Inter", fontSize: 18, fontWeight: 600 },
                  },
                  {
                    id: "10:36",
                    name: "Avatar",
                    type: "ELLIPSE",
                    absoluteBoundingBox: { x: 1460, y: 390, width: 64, height: 64 },
                  },
                ],
              },
            ],
          },
          {
            id: "10:4",
            name: "Import tasks from spreadsheet",
            type: "FRAME",
            absoluteBoundingBox: { x: 2760, y: 80, width: 720, height: 600 },
            children: [
              {
                id: "10:40",
                name: "Upload title",
                type: "TEXT",
                characters: "Import spreadsheet (xlsx, xls)",
                absoluteBoundingBox: { x: 2800, y: 120, width: 320, height: 36 },
                style: { fontFamily: "Inter", fontSize: 22, fontWeight: 600 },
              },
            ],
          },
        ],
      },
      components: {},
      styles: {},
    },
  },
};

export const flowWrapperRawFixture = {
  name: "Synthetic document flow",
  lastModified: "2026-08-12T00:00:00Z",
  version: "235",
  nodes: {
    "18:1": {
      document: {
        id: "18:1",
        name: "Workspace document details",
        type: "SECTION",
        absoluteBoundingBox: { x: 0, y: 0, width: 5939, height: 6848 },
        children: [
          {
            id: "18:2",
            name: "Flow arrow",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 100, y: 100, width: 1936, height: 506 },
            children: [{ id: "18:20", name: "line", type: "VECTOR" }],
          },
          {
            id: "18:3",
            name: "Doc typo",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 100, y: 700, width: 2524, height: 120 },
            children: [{ id: "18:30", name: "Content", type: "FRAME" }],
          },
          {
            id: "18:4",
            name: "Flow shape",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 100, y: 900, width: 340, height: 165 },
            children: [{
              id: "18:40",
              name: "text",
              type: "TEXT",
              characters: "Editor/Viewer",
              absoluteBoundingBox: { x: 120, y: 920, width: 240, height: 42 },
            }],
          },
          {
            id: "18:5",
            name: "Document tab - Permission denied",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 900, y: 400, width: 1440, height: 900 },
            children: [{
              id: "18:50",
              name: "Container",
              type: "FRAME",
              absoluteBoundingBox: { x: 900, y: 464, width: 1440, height: 836 },
            }],
          },
          {
            id: "18:6",
            name: "Document tab - Default",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 900, y: 1900, width: 1440, height: 900 },
            children: [{
              id: "18:60",
              name: "Container",
              type: "FRAME",
              absoluteBoundingBox: { x: 900, y: 1964, width: 1440, height: 836 },
            }],
          },
          {
            id: "18:7",
            name: "[Dialog] Upgrade plan",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 2500, y: 1900, width: 1440, height: 900 },
            children: [{
              id: "18:70",
              name: "Dialog",
              type: "INSTANCE",
              absoluteBoundingBox: { x: 2964, y: 2100, width: 512, height: 448 },
            }],
          },
          {
            id: "18:8",
            name: "Flow status",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 1500, y: 1840, width: 129, height: 50 },
            children: [{
              id: "18:80",
              name: "text",
              type: "TEXT",
              characters: "HOVER",
              absoluteBoundingBox: { x: 1520, y: 1850, width: 90, height: 32 },
            }],
          },
          {
            id: "18:9",
            name: "Document summary",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 900, y: 1350, width: 1136, height: 432 },
            children: [{
              id: "18:90",
              name: "Main info",
              type: "FRAME",
              absoluteBoundingBox: { x: 924, y: 1374, width: 1088, height: 384 },
            }],
          },
          {
            id: "18:10",
            name: "Dialog / Close Icon",
            type: "INSTANCE",
            absoluteBoundingBox: { x: 4000, y: 100, width: 16, height: 16 },
          },
        ],
      },
      components: {},
      styles: {},
    },
  },
};
