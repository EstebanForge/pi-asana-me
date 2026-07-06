// Minimal Asana REST client. Plain fetch under the hood; no SDK, no OAuth, no
// token refresh - PAT is long-lived. Mirrors the style of pi-deepwiki's
// lib/api.ts: one call function, rich error class, JSON in / JSON out.
//
// Asana's REST shape: every endpoint returns either
//   { "data": <object> }    (single resource)
//   { "data": [ ... ] }     (collection)
//   { "errors": [ {message, help?} ] }   (failure)
// We unwrap `data` and surface `errors[0].message` on failure. Status codes
// follow the usual REST conventions; we map the interesting ones to friendly
// strings (401, 404, 429, 5xx).

import { getAsanaToken } from "./auth";

const DEFAULT_BASE_URL = "https://app.asana.com/api/1.0";
const REQUEST_TIMEOUT_MS = 30_000;

export interface CallOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  // When true, do not unwrap the {data: ...} envelope. Returns the full JSON
  // body so callers can read pagination tokens (next_page.offset) and any
  // other side-channel fields. Defaults to false (unwraps as before).
  raw?: boolean;
}

interface AsanaErrorBody {
  errors?: Array<{ message?: string; help?: string }>;
}

// Shape returned by Asana for typeahead / list endpoints. Each entry carries a
// `resource_type` discriminator (e.g. "task", "project", "user", "tag").
export interface AsanaTypeaheadItem {
  resource_type: string;
  gid: string;
 name?: string;
  [k: string]: unknown;
}

// Result of a single paged fetch via callAsanaPaged: the unwrapped `data` plus
// the cursor for the next page (undefined when there are no more pages).
export interface PagedResult<T> {
  data: T;
  nextOffset?: string;
}

// Paged envelope for Asana collection endpoints (stories, tasks, projects,
// ...). `next_page` is null/absent on the final page.
interface PagedEnvelope<T> {
  data: T;
  next_page?: { offset?: string; path?: string; uri?: string } | null;
}

export class AsanaError extends Error {
  readonly status: number;
  readonly isRateLimited: boolean;
  readonly isAuthError: boolean;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AsanaError";
    this.status = status;
    this.isRateLimited = status === 429;
    this.isAuthError = status === 401 || status === 403;
  }
}

function friendlyStatus(status: number, body: AsanaErrorBody | null): string {
  const upstream = body?.errors?.[0]?.message;
  switch (status) {
    case 400:
      return `Asana rejected the request (HTTP 400). ${upstream ?? "Check parameter names and values."}`;
    case 401:
      return `Asana denied access (HTTP 401). ${upstream ?? "ASANA_ACCESS_TOKEN is missing, invalid, or revoked. Generate a new personal access token at https://app.asana.com/0/my-apps."}`;
    case 403:
      return `Asana denied access (HTTP 403). ${upstream ?? "Your PAT lacks permission for this action or the workspace is not yours. Check sharing on the target resource."}`;
    case 404:
      return `Asana resource not found (HTTP 404). ${upstream ?? "The GID does not exist or has been deleted. Verify the GID with asana_search_objects."}`;
    case 429:
      return `Asana rate limit reached (HTTP 429). ${upstream ?? "Personal access tokens share a pool; wait a few seconds and retry."}`;
    default:
      if (status >= 500) {
        return `Asana server error (HTTP ${status}). ${upstream ?? "Retry shortly."}`;
      }
      return `Asana request failed (HTTP ${status}). ${upstream ?? "No further detail."}`;
  }
}

function buildUrl(
  base: string,
  path: string,
  query: CallOptions["query"],
): string {
  // Allow the path to be provided as either "/foo" or "foo" for caller comfort.
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// Call Asana and return the unwrapped `data` field. Collections come back as
// arrays; objects as objects. Throws AsanaError on any failure, including
// transport-level timeouts and non-2xx HTTP.
export async function callAsana<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: CallOptions = {},
): Promise<T> {
  const token = getAsanaToken();
  const url = buildUrl(DEFAULT_BASE_URL, path, options.query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    // Asana REST requires every write body to be wrapped under a top-level
    // `data` key. Wrapping once, centrally, keeps every tool caller free of
    // envelope ceremony. The response side already mirrors this with the
    // `{data: ...}` unwrap below.
    body = JSON.stringify({ data: options.body });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      throw new AsanaError(
        `Asana request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Retry; if persistent, check the network or the Asana status page.`,
      );
    }
    throw new AsanaError(`Network error reaching Asana: ${msg}`);
  }

  try {
    if (!response.ok) {
      let parsed: AsanaErrorBody | null = null;
      const text = await response.text();
      try {
        parsed = JSON.parse(text) as AsanaErrorBody;
      } catch {
        // Body was not JSON; surface raw text via friendlyStatus fallback.
      }
      throw new AsanaError(friendlyStatus(response.status, parsed), response.status);
    }

    // 204 No Content (rare in Asana but possible for DELETE): nothing to parse.
    if (response.status === 204) return undefined as T;

    const json = (await response.json()) as
      | { data?: T; next_page?: unknown }
      | T;
    if (options.raw) {
      return json as T;
    }
    if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
      return (json as { data: T }).data;
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

// Like callAsana, but for paged collection endpoints. Returns the unwrapped
// `data` array alongside the `next_page.offset` cursor so callers can walk all
// pages. Use this instead of callAsana whenever the endpoint may paginate.
// Same error handling, timeout, and auth as callAsana.
export async function callAsanaPaged<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: CallOptions = {},
): Promise<PagedResult<T>> {
  const token = getAsanaToken();
  const url = buildUrl(DEFAULT_BASE_URL, path, options.query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ data: options.body });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      throw new AsanaError(
        `Asana request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Retry; if persistent, check the network or the Asana status page.`,
      );
    }
    throw new AsanaError(`Network error reaching Asana: ${msg}`);
  }

  try {
    if (!response.ok) {
      let parsed: AsanaErrorBody | null = null;
      const text = await response.text();
      try {
        parsed = JSON.parse(text) as AsanaErrorBody;
      } catch {
        // Body was not JSON; surface raw text via friendlyStatus fallback.
      }
      throw new AsanaError(friendlyStatus(response.status, parsed), response.status);
    }

    if (response.status === 204) return { data: undefined as T };

    const json = (await response.json()) as PagedEnvelope<T> | T;
    if (
      json &&
      typeof json === "object" &&
      "data" in (json as Record<string, unknown>)
    ) {
      const env = json as PagedEnvelope<T>;
      return { data: env.data, nextOffset: env.next_page?.offset ?? undefined };
    }
    return { data: json as T };
  } finally {
    clearTimeout(timer);
  }
}
