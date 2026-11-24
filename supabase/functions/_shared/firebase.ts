import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "npm:jose@6.2.16";

const FIREBASE_JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/projects";
const FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_PAGE_SIZE = 1_000;
const MAX_RESULTS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

const firebaseJwks = createRemoteJWKSet(FIREBASE_JWKS_URL, {
  timeoutDuration: 5_000,
});

export type VerifiedFirebaseUser = {
  uid: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
};

export type FirestoreDocument = {
  id: string;
  data: Record<string, unknown>;
};

export type FirebaseAuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
};

export class FirebaseTokenError extends Error {
  constructor() {
    super("The Firebase ID token is invalid or expired.");
    this.name = "FirebaseTokenError";
  }
}

export class FirebaseUserNotFoundError extends Error {
  constructor() {
    super("The Firebase Authentication user was not found.");
    this.name = "FirebaseUserNotFoundError";
  }
}

export class FirebaseServiceError extends Error {
  readonly reason: string;

  constructor(reason = "firebase-service-failed") {
    super("The Firebase service request failed.");
    this.name = "FirebaseServiceError";
    this.reason = /^[a-z0-9-]{1,80}$/.test(reason) ? reason : "firebase-service-failed";
  }
}

export class FirebaseConfigurationError extends Error {
  readonly reason: string;

  constructor(reason = "configuration") {
    super("Firebase server configuration is invalid.");
    this.name = "FirebaseConfigurationError";
    this.reason = /^[a-z0-9-]{1,80}$/.test(reason) ? reason : "configuration";
  }
}

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type GoogleErrorMode = "return-null" | "ignore-user-not-found" | "throw-user-not-found";

let serviceAccountCache: ServiceAccount | null = null;
let signingKeyPromise: Promise<CryptoKey> | null = null;
let accessTokenCache: { token: string; expiresAt: number } | null = null;
let accessTokenPromise: Promise<string> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredProjectId(): string {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID")?.trim();
  if (!projectId || projectId.length > 128 || projectId.includes("/")) {
    throw new FirebaseConfigurationError("project-id-invalid");
  }
  return projectId;
}

function loadServiceAccount(projectId: string): ServiceAccount {
  if (serviceAccountCache) {
    if (serviceAccountCache.projectId !== projectId) {
      throw new FirebaseConfigurationError("service-account-project-mismatch");
    }
    return serviceAccountCache;
  }

  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new FirebaseConfigurationError("service-account-secret-missing");

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new FirebaseConfigurationError("service-account-json-invalid");
    if (typeof parsed.project_id !== "string") {
      throw new FirebaseConfigurationError("service-account-project-id-missing");
    }
    if (parsed.project_id !== projectId) {
      throw new FirebaseConfigurationError("service-account-project-mismatch");
    }
    if (typeof parsed.client_email !== "string" || !parsed.client_email.trim()) {
      throw new FirebaseConfigurationError("service-account-client-email-missing");
    }
    if (typeof parsed.private_key !== "string" || !parsed.private_key.includes("BEGIN PRIVATE KEY")) {
      throw new FirebaseConfigurationError("service-account-private-key-missing-or-invalid");
    }

    serviceAccountCache = {
      projectId,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
    return serviceAccountCache;
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    throw new FirebaseConfigurationError("service-account-json-invalid");
  }
}

async function getSigningKey(account: ServiceAccount): Promise<CryptoKey> {
  const pending = signingKeyPromise || importPKCS8(account.privateKey, "RS256");
  signingKeyPromise = pending;
  try {
    return await pending;
  } catch {
    if (signingKeyPromise === pending) signingKeyPromise = null;
    throw new FirebaseConfigurationError("service-account-private-key-invalid");
  }
}

async function requestGoogleAccessToken(): Promise<string> {
  const projectId = requiredProjectId();
  const account = loadServiceAccount(projectId);
  const now = Math.floor(Date.now() / 1_000);
  let assertion: string;

  try {
    assertion = await new SignJWT({ scope: CLOUD_PLATFORM_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.clientEmail)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3_600)
      .sign(await getSigningKey(account));
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    throw new FirebaseConfigurationError("service-account-signing-failed");
  }

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseServiceError("oauth-network");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FirebaseServiceError("oauth-invalid-response");
  }
  if (!response.ok) throw new FirebaseServiceError(`oauth-http-${response.status}`);
  if (
    !isRecord(payload) ||
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    !Number.isFinite(Number(payload.expires_in))
  ) {
    throw new FirebaseServiceError("oauth-invalid-response");
  }

  const expiresIn = Math.max(0, Number(payload.expires_in));
  accessTokenCache = {
    token: payload.access_token,
    expiresAt: now + expiresIn,
  };
  return payload.access_token;
}

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60) {
    return accessTokenCache.token;
  }
  if (!accessTokenPromise) {
    accessTokenPromise = requestGoogleAccessToken().finally(() => {
      accessTokenPromise = null;
    });
  }
  return await accessTokenPromise;
}

function isUserNotFoundPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !isRecord(payload.error)) return false;
  const error = payload.error;
  const candidates: unknown[] = [error.status, error.message];
  if (Array.isArray(error.errors)) {
    for (const item of error.errors) {
      if (isRecord(item)) candidates.push(item.reason, item.message);
    }
  }
  return candidates.some((candidate) => {
    if (typeof candidate !== "string") return false;
    const code = candidate.trim().toUpperCase().split(/[\s:]/, 1)[0];
    return code === "USER_NOT_FOUND" || code === "NOT_FOUND";
  });
}

async function googleJson(
  url: string,
  body: Record<string, unknown>,
  missingMode: GoogleErrorMode = "throw-user-not-found",
  provider = "google-api",
): Promise<Record<string, unknown> | null> {
  const accessToken = await getGoogleAccessToken();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseServiceError(`${provider}-network`);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new FirebaseServiceError(`${provider}-invalid-response`);
  }

  if (!response.ok) {
    const missing = response.status === 404 || isUserNotFoundPayload(payload);
    if (missing && missingMode === "return-null") return null;
    if (missing && missingMode === "ignore-user-not-found") return null;
    if (missing) throw new FirebaseUserNotFoundError();
    throw new FirebaseServiceError(`${provider}-http-${response.status}`);
  }
  if (!isRecord(payload)) throw new FirebaseServiceError(`${provider}-invalid-response`);
  return payload;
}

function isJoseVerificationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== "string") return false;
  if (code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID") return false;
  return /^(ERR_JWT_|ERR_JWS_|ERR_JWK_|ERR_JWKS_NO_MATCHING_KEY|ERR_JOSE_)/.test(code);
}

export async function verifyFirebaseToken(req: Request): Promise<VerifiedFirebaseUser> {
  const projectId = requiredProjectId();
  const authorization = req.headers.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 16_384) throw new FirebaseTokenError();

  try {
    const { payload } = await jwtVerify(match[1], firebaseJwks, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: ["aud", "iss", "exp", "sub"],
    });
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length < 1 ||
      payload.sub.length > 128 ||
      payload.sub.includes("/") ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now() / 1_000
    ) {
      throw new FirebaseTokenError();
    }

    const user: VerifiedFirebaseUser = { ...payload, uid: payload.sub };
    if (typeof payload.email === "string") user.email = payload.email;
    if (typeof payload.name === "string") user.name = payload.name;
    return user;
  } catch (error) {
    if (error instanceof FirebaseTokenError) throw error;
    if (error instanceof TypeError || !isJoseVerificationFailure(error)) {
      throw new FirebaseServiceError();
    }
    throw new FirebaseTokenError();
  }
}

function validatePath(path: string, documentPath: boolean): string[] {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.endsWith("/")) {
    throw new FirebaseServiceError();
  }
  const segments = path.split("/");
  if (
    segments.length > 100 ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    (documentPath ? segments.length % 2 !== 0 : segments.length % 2 !== 1)
  ) {
    throw new FirebaseServiceError();
  }
  return segments;
}

function firestoreDocumentsBase(projectId: string): string {
  return `${FIRESTORE_URL}/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function encodeSegments(segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function decodeFirestoreValue(value: unknown, depth = 0): unknown {
  if (!isRecord(value) || depth > 20) return null;
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) {
    const raw = value.integerValue;
    const number = typeof raw === "string" ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(number) ? number : String(raw);
  }
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "referenceValue")) return value.referenceValue;
  if (Object.hasOwn(value, "bytesValue")) return value.bytesValue;
  if (Object.hasOwn(value, "geoPointValue") && isRecord(value.geoPointValue)) {
    return {
      latitude: value.geoPointValue.latitude,
      longitude: value.geoPointValue.longitude,
    };
  }
  if (Object.hasOwn(value, "arrayValue")) {
    const arrayValue = value.arrayValue;
    const values = isRecord(arrayValue) && Array.isArray(arrayValue.values)
      ? arrayValue.values
      : [];
    return values.map((item) => decodeFirestoreValue(item, depth + 1));
  }
  if (Object.hasOwn(value, "mapValue")) {
    const mapValue = value.mapValue;
    const fields = isRecord(mapValue) && isRecord(mapValue.fields) ? mapValue.fields : {};
    return Object.fromEntries(
      Object.entries(fields).map(([key, item]) => [key, decodeFirestoreValue(item, depth + 1)]),
    );
  }
  return null;
}

function decodeFirestoreDocument(document: unknown): FirestoreDocument {
  if (!isRecord(document) || typeof document.name !== "string") {
    throw new FirebaseServiceError();
  }
  const id = document.name.slice(document.name.lastIndexOf("/") + 1);
  if (!id) throw new FirebaseServiceError();
  const fields = isRecord(document.fields) ? document.fields : {};
  return {
    id,
    data: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
    ),
  };
}

function firestoreFieldPath(field: string): string {
  if (!field || field.startsWith("__") && field.endsWith("__")) {
    throw new FirebaseServiceError();
  }
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)
    ? field
    : `\`${field.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function encodeFirestoreValue(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 20 || value === undefined) throw new FirebaseServiceError();
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FirebaseServiceError();
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new FirebaseServiceError();
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeFirestoreValue(item, depth + 1)),
      },
    };
  }
  if (isRecord(value)) {
    const fields = Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, encodeFirestoreValue(item, depth + 1)]),
    );
    return { mapValue: { fields } };
  }
  throw new FirebaseServiceError();
}

function resultLimit(limit?: number): number {
  if (limit === undefined) return MAX_RESULTS;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_RESULTS) {
    throw new FirebaseServiceError();
  }
  return limit;
}

async function firestoreRequest(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const accessToken = await getGoogleAccessToken();
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseServiceError("firestore-network");
  }
}

async function firestoreJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new FirebaseServiceError(`firestore-http-${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FirebaseServiceError("firestore-invalid-response");
  }
  if (!isRecord(payload)) throw new FirebaseServiceError("firestore-invalid-response");
  return payload;
}

export async function firestoreGet(path: string): Promise<FirestoreDocument | null> {
  const segments = validatePath(path, true);
  const url = `${firestoreDocumentsBase(requiredProjectId())}/${encodeSegments(segments)}`;
  const response = await firestoreRequest(url, { method: "GET" });
  if (response.status === 404) return null;
  return decodeFirestoreDocument(await firestoreJsonResponse(response));
}

export async function firestoreList(
  path: string,
  limit?: number,
): Promise<Array<FirestoreDocument>> {
  const segments = validatePath(path, false);
  const maxResults = resultLimit(limit);
  if (maxResults === 0) return [];

  const projectId = requiredProjectId();
  const baseUrl = `${firestoreDocumentsBase(projectId)}/${encodeSegments(segments)}`;
  const documents: FirestoreDocument[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  while (documents.length < maxResults) {
    const pageSize = Math.min(MAX_PAGE_SIZE, maxResults - documents.length);
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await firestoreRequest(url.toString(), { method: "GET" });
    const payload = await firestoreJsonResponse(response);
    const page = Array.isArray(payload.documents) ? payload.documents : [];
    for (const document of page) documents.push(decodeFirestoreDocument(document));

    const nextPageToken = typeof payload.nextPageToken === "string"
      ? payload.nextPageToken
      : "";
    if (!nextPageToken) return documents;
    if (seenPageTokens.has(nextPageToken)) throw new FirebaseServiceError();
    seenPageTokens.add(nextPageToken);

    if (documents.length >= maxResults) {
      if (limit === undefined) throw new FirebaseServiceError();
      return documents;
    }
    pageToken = nextPageToken;
  }
  return documents;
}

export async function firestoreQueryString(
  path: string,
  field: string,
  value: string,
  limit?: number,
): Promise<Array<FirestoreDocument>> {
  const segments = validatePath(path, false);
  if (typeof value !== "string") throw new FirebaseServiceError();
  const fieldPath = firestoreFieldPath(field);
  const maxResults = resultLimit(limit);
  if (maxResults === 0) return [];

  const projectId = requiredProjectId();
  const collectionId = segments.at(-1)!;
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.length ? `/${encodeSegments(parentSegments)}` : "";
  const url = `${firestoreDocumentsBase(projectId)}${parentPath}:runQuery`;
  const documents: FirestoreDocument[] = [];
  const seenCursorNames = new Set<string>();
  let afterName: string | undefined;

  while (documents.length < maxResults) {
    const pageSize = Math.min(MAX_PAGE_SIZE, maxResults - documents.length);
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op: "EQUAL",
          value: { stringValue: value },
        },
      },
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: pageSize,
    };
    if (afterName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: afterName }],
        before: false,
      };
    }

    const response = await firestoreRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!response.ok) throw new FirebaseServiceError(`firestore-http-${response.status}`);

    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      throw new FirebaseServiceError("firestore-invalid-response");
    }
    if (!Array.isArray(rows)) throw new FirebaseServiceError("firestore-invalid-response");

    const pageDocuments = rows
      .filter((row) => isRecord(row) && isRecord(row.document))
      .map((row) => decodeFirestoreDocument((row as Record<string, unknown>).document));
    if (pageDocuments.length === 0) return documents;
    documents.push(...pageDocuments);

    const lastRow = [...rows].reverse().find((row) => isRecord(row) && isRecord(row.document));
    const lastDocument = isRecord(lastRow) && isRecord(lastRow.document) ? lastRow.document : null;
    const lastName = typeof lastDocument?.name === "string" ? lastDocument.name : "";
    const isDone = rows.some((row) => isRecord(row) && row.done === true);
    if (isDone) return documents.slice(0, maxResults);
    if (!lastName || seenCursorNames.has(lastName)) throw new FirebaseServiceError();
    seenCursorNames.add(lastName);
    afterName = lastName;

    if (documents.length >= maxResults) {
      if (limit === undefined && !isDone) throw new FirebaseServiceError();
      return documents.slice(0, maxResults);
    }
  }
  return documents;
}

export async function firestoreSet(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const segments = validatePath(path, true);
  if (!isRecord(data)) throw new FirebaseServiceError();
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;

  const fields: Record<string, unknown> = {};
  const url = new URL(
    `${firestoreDocumentsBase(requiredProjectId())}/${encodeSegments(segments)}`,
  );
  for (const [field, value] of entries) {
    if (!field || field.startsWith("__") && field.endsWith("__")) {
      throw new FirebaseServiceError();
    }
    fields[field] = encodeFirestoreValue(value);
    url.searchParams.append("updateMask.fieldPaths", firestoreFieldPath(field));
  }

  const response = await firestoreRequest(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  await firestoreJsonResponse(response);
}

function identityToolkitUrl(projectId: string, method: string): string {
  return `${IDENTITY_TOOLKIT_URL}/${encodeURIComponent(projectId)}/accounts:${method}`;
}

function decodeCustomClaims(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function authGetUser(uid: string): Promise<FirebaseAuthUser | null> {
  if (typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/")) {
    throw new FirebaseServiceError();
  }
  const result = await googleJson(
    identityToolkitUrl(requiredProjectId(), "lookup"),
    { localId: [uid] },
    "return-null",
    "identity-toolkit",
  );
  const users = Array.isArray(result?.users) ? result.users : [];
  const user = users.find((candidate) => isRecord(candidate) && candidate.localId === uid);
  if (!isRecord(user)) return null;

  const customClaims = decodeCustomClaims(user.customAttributes);
  return {
    uid,
    email: typeof user.email === "string" ? user.email : null,
    displayName: typeof user.displayName === "string" ? user.displayName : null,
    disabled: user.disabled !== false,
    ...(customClaims ? { customClaims } : {}),
  };
}

export async function authSetDisabled(uid: string, disabled: boolean): Promise<void> {
  if (
    typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/") ||
    typeof disabled !== "boolean"
  ) {
    throw new FirebaseServiceError();
  }
  await googleJson(
    identityToolkitUrl(requiredProjectId(), "update"),
    {
      localId: uid,
      disableUser: disabled,
      ...(disabled ? { validSince: String(Math.floor(Date.now() / 1_000)) } : {}),
      returnSecureToken: false,
    },
    "throw-user-not-found",
    "identity-toolkit",
  );
}

export async function authDeleteUser(uid: string): Promise<void> {
  if (typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/")) {
    throw new FirebaseServiceError();
  }
  await googleJson(
    identityToolkitUrl(requiredProjectId(), "delete"),
    { localId: uid },
    "ignore-user-not-found",
    "identity-toolkit",
  );
}
