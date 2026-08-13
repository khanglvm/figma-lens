import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveTokenSync } from "./credentials.js";

export class FigmaApiError extends Error {
  constructor(message, { status, details, rate } = {}) {
    super(message);
    this.name = "FigmaApiError";
    this.status = status;
    this.details = details;
    this.rate = rate;
  }
}

export function readRateHeaders(headers) {
  const get = (name) => headers.get(name) ?? undefined;
  return {
    retryAfter: get("retry-after"),
    planTier: get("x-figma-plan-tier"),
    limitType: get("x-figma-rate-limit-type"),
    upgradeUrl: get("x-figma-upgrade-link"),
    requestId: get("x-figma-rest-api-request-id"),
  };
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function retryAfterMilliseconds(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const TRANSIENT_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const transientStatus = (status) => TRANSIENT_STATUSES.has(status);
const defaultSleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function queryUrl(baseUrl, path, query = {}) {
  const url = new URL(path, `${baseUrl.replace(/\/$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function cancelBody(body) {
  await body?.cancel().catch(() => {});
}

function responseSizeError({ resource, maxResponseBytes, observedBytes, status, rate }) {
  const size = observedBytes === undefined ? `more than ${maxResponseBytes}` : observedBytes;
  return new FigmaApiError(
    `${resource} is ${size} bytes, above the ${maxResponseBytes} byte safety limit. Use a node link or --depth.`,
    { status, rate },
  );
}

async function readBoundedBytes(response, { maxResponseBytes, resource, rate }) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await cancelBody(response.body);
    throw responseSizeError({
      resource,
      maxResponseBytes,
      observedBytes: contentLength,
      status: response.status,
      rate,
    });
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextTotal = totalBytes + value.byteLength;
      if (nextTotal > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw responseSizeError({
          resource,
          maxResponseBytes,
          observedBytes: nextTotal,
          status: response.status,
          rate,
        });
      }
      chunks.push(value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class FigmaApi {
  constructor({
    token,
    baseUrl = "https://api.figma.com",
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
    randomImpl = Math.random,
    maxRetries = envNumber("FIGMA_MAX_RETRIES", 2),
    maxRetryAfterMs = envNumber("FIGMA_MAX_RETRY_AFTER_MS", 5_000),
    timeoutMs = envNumber("FIGMA_REQUEST_TIMEOUT_MS", 30_000),
    maxResponseBytes = envNumber("FIGMA_MAX_RESPONSE_BYTES", 128 * 1024 * 1024),
  } = {}) {
    this.token = resolveTokenSync({ token }).token;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.randomImpl = randomImpl;
    this.maxRetries = maxRetries;
    this.maxRetryAfterMs = maxRetryAfterMs;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.calls = [];
  }

  authHeaders() {
    if (!this.token) {
      throw new FigmaApiError("No Figma token is configured. Run `figma-lens auth login`, set FIGMA_TOKEN, or use --token-stdin/--token-file.");
    }
    return { "X-Figma-Token": this.token, Accept: "application/json" };
  }

  retryDelay(attempt, retryAfter) {
    const explicit = retryAfterMilliseconds(retryAfter);
    if (explicit !== undefined) return explicit;
    return Math.min(2_000, 250 * (2 ** attempt) + Math.floor(this.randomImpl() * 100));
  }

  async timedFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async request(path, query) {
    const url = queryUrl(this.baseUrl, path, query);
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.timedFetch(url, { headers: this.authHeaders() });
      } catch (error) {
        this.calls.push({ path, status: 0, attempt: attempt + 1, networkError: error?.name ?? "Error" });
        if (attempt < this.maxRetries) {
          await this.sleepImpl(this.retryDelay(attempt));
          continue;
        }
        throw new FigmaApiError(`Figma API network failure after ${attempt + 1} attempt(s): ${error.message}`, {
          status: 0,
        });
      }

      const rate = readRateHeaders(response.headers);
      this.calls.push({ path, status: response.status, attempt: attempt + 1, rate });
      const retryAfterMs = retryAfterMilliseconds(rate.retryAfter);
      const shortRateLimit = response.status === 429 && retryAfterMs !== undefined && retryAfterMs <= this.maxRetryAfterMs;
      if (!response.ok && attempt < this.maxRetries && (transientStatus(response.status) || shortRateLimit)) {
        await response.body?.cancel().catch(() => {});
        await this.sleepImpl(this.retryDelay(attempt, rate.retryAfter));
        continue;
      }

      if (response.ok) {
        const bytes = await readBoundedBytes(response, {
          maxResponseBytes: this.maxResponseBytes,
          resource: "Figma response",
          rate,
        });
        return { data: decodeJson(bytes), rate };
      }

      const bytes = await readBoundedBytes(response, {
        maxResponseBytes: this.maxResponseBytes,
        resource: "Figma error response",
        rate,
      });
      const text = new TextDecoder().decode(bytes);
      let body = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {}
      const remoteMessage = body?.err ?? body?.message ?? response.statusText;
      let hint = "";
      if (response.status === 404) {
        hint = " Verify that the token owner can open the file and that the link is current.";
      } else if (response.status === 429) {
        hint = rate.retryAfter ? ` Retry after ${rate.retryAfter} seconds.` : " Retry later.";
      }
      throw new FigmaApiError(`Figma API ${response.status}: ${remoteMessage}.${hint}`, {
        status: response.status,
        details: body,
        rate,
      });
    }
    throw new FigmaApiError("Figma request failed unexpectedly");
  }

  me() {
    return this.request("v1/me");
  }

  getFile(fileKey, { depth } = {}) {
    return this.request(`v1/files/${encodeURIComponent(fileKey)}`, { depth });
  }

  getNodes(fileKey, nodeIds, { depth } = {}) {
    return this.request(`v1/files/${encodeURIComponent(fileKey)}/nodes`, {
      ids: nodeIds.join(","),
      depth,
    });
  }

  getRenders(fileKey, nodeIds, { format = "png", scale = 2, useAbsoluteBounds = false } = {}) {
    return this.request(`v1/images/${encodeURIComponent(fileKey)}`, {
      ids: nodeIds.join(","),
      format,
      scale,
      use_absolute_bounds: useAbsoluteBounds,
    });
  }

  getImageFills(fileKey) {
    return this.request(`v1/files/${encodeURIComponent(fileKey)}/images`);
  }

  async download(url, destination, { detectExtension = false } = {}) {
    let response;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        response = await this.timedFetch(url);
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleepImpl(this.retryDelay(attempt));
          continue;
        }
        throw new FigmaApiError(`Asset download network failure: ${error.message}`, { status: 0 });
      }
      if (response.ok && response.body) {
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
          await cancelBody(response.body);
          throw responseSizeError({
            resource: "Asset download",
            maxResponseBytes: this.maxResponseBytes,
            observedBytes: contentLength,
            status: response.status,
          });
        }
        break;
      }
      if (attempt < this.maxRetries && transientStatus(response.status)) {
        await response.body?.cancel().catch(() => {});
        await this.sleepImpl(this.retryDelay(attempt, response.headers.get("retry-after")));
        continue;
      }
      throw new FigmaApiError(`Asset download failed: HTTP ${response.status}`, { status: response.status });
    }
    const contentType = response.headers.get("content-type")?.split(";")[0];
    const extension = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
    }[contentType];
    const finalDestination = detectExtension && extension ? `${destination}${extension}` : destination;
    await mkdir(dirname(finalDestination), { recursive: true });
    const temporary = `${finalDestination}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    let reader;
    let totalBytes = 0;
    try {
      handle = await open(temporary, "wx");
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const nextTotal = totalBytes + value.byteLength;
        if (nextTotal > this.maxResponseBytes) {
          await reader.cancel().catch(() => {});
          throw responseSizeError({
            resource: "Asset download",
            maxResponseBytes: this.maxResponseBytes,
            observedBytes: nextTotal,
            status: response.status,
          });
        }
        await handle.write(value);
        totalBytes = nextTotal;
      }
      reader.releaseLock();
      reader = undefined;
      await handle.close();
      handle = undefined;
      await rename(temporary, finalDestination);
    } catch (error) {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return { path: finalDestination, contentType };
  }
}
