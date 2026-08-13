import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json");

export const FIGMA_LENS_VERSION = packageMetadata.version;
