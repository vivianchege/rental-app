import {
  authDeleteUser,
  authGetUser,
  authSetDisabled,
  FirebaseConfigurationError,
  FirebaseServiceError,
  FirebaseTokenError,
  FirebaseUserNotFoundError,
  firestoreGet,
  firestoreQueryString,
  firestoreSet,
  verifyFirebaseToken,
  type FirebaseAuthUser,
  type FirestoreDocument,
  type VerifiedFirebaseUser,
} from "../_shared/firebase.ts";

const LEGACY_LANDLORD_UID = "b4HMBcL0WXT3Qg2vunj5ITZOVb72";
const LEGACY_MANAGER_UIDS = [
  "CG6wl2NaTcdLHyGlXHk4w9eCU653",
  "N8wEpIJvUZRmD6WoYYxqpUiiLhj2",
];
const MAIN_WORKSPACE_ID = "main-workspace";
const MAX_REQUEST_BYTES = 16_384;
const AUTH_LOOKUP_CONCURRENCY = 20;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type Actor = {
  uid: string;
  workspaceId: string;
};

type ManagerCandidate = {
  uid: string;
  profile: FirestoreDocument | null;
};

class EndpointError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EndpointError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function badRequest(message = "The request is invalid."): never {
  throw new EndpointError(400, "invalid-request", message);
}

function forbidden(): never {
  throw new EndpointError(403, "forbidden", "This account is not allowed to manage these accounts.");
}

function notFound(): never {
  throw new EndpointError(404, "not-found", "The manager account was not found in this workspace.");
}

function own(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function roleFrom(source: Record<string, unknown> | undefined, key: string): string | null {
  if (!source || !own(source, key)) return null;
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "";
  if (!value.trim()) return null;
  return value.trim().toUpperCase();
}

function optionalWorkspaceFrom(
  source: Record<string, unknown> | undefined,
): string | null {
  if (!source || !own(source, "workspaceId")) return null;
  const value = source.workspaceId;
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 120 ||
    value.includes("/")
  ) {
    forbidden();
  }
  return value;
}

function ensureRoleSources(
  token: VerifiedFirebaseUser,
  authUser: FirebaseAuthUser,
  profile: FirestoreDocument | null,
  expectedRole: "LANDLORD" | "MANAGER",
): void {
  const roles = [
    roleFrom(token, "role"),
    roleFrom(authUser.customClaims, "role"),
    roleFrom(profile?.data, "role"),
  ];
  if (roles.some((role) => role !== null && role !== expectedRole)) forbidden();
}

async function requireLandlord(token: VerifiedFirebaseUser): Promise<Actor> {
  const authUser = await authGetUser(token.uid);
  if (!authUser || authUser.disabled) {
    throw new EndpointError(401, "unauthorized", "Sign in with an available landlord account.");
  }

  const profile = await firestoreGet(`users/${token.uid}`);
  const claims = authUser.customClaims || {};
  if (
    profile?.data.disabled === true || profile?.data.deleted === true ||
    claims.disabled === true || claims.accessDisabled === true ||
    token.disabled === true || token.accessDisabled === true
  ) {
    throw new EndpointError(403, "forbidden", "This landlord account is disabled or unavailable.");
  }
  const isLegacyLandlord = token.uid === LEGACY_LANDLORD_UID;
  ensureRoleSources(token, authUser, profile, "LANDLORD");

  const profileWorkspace = optionalWorkspaceFrom(profile?.data);
  const claimsWorkspace = optionalWorkspaceFrom(authUser.customClaims);
  const tokenWorkspace = optionalWorkspaceFrom(token);

  if (isLegacyLandlord) {
    if (
      (profileWorkspace !== null && profileWorkspace !== MAIN_WORKSPACE_ID) ||
      (claimsWorkspace !== null && claimsWorkspace !== MAIN_WORKSPACE_ID) ||
      (tokenWorkspace !== null && tokenWorkspace !== MAIN_WORKSPACE_ID)
    ) {
      forbidden();
    }
    return { uid: token.uid, workspaceId: MAIN_WORKSPACE_ID };
  }

  if (!profile || roleFrom(profile.data, "role") !== "LANDLORD" || !profileWorkspace) {
    forbidden();
  }
  if (
    (claimsWorkspace !== null && claimsWorkspace !== profileWorkspace) ||
    (tokenWorkspace !== null && tokenWorkspace !== profileWorkspace)
  ) {
    forbidden();
  }
  return { uid: token.uid, workspaceId: profileWorkspace };
}

function legacyManagerProfileAllowed(profile: FirestoreDocument | null): boolean {
  if (!profile) return true;
  const data = profile.data;
  if (data.deleted === true) return false;
  if (data.role !== undefined && data.role !== null && data.role !== "MANAGER") return false;
  const workspaceId = data.workspaceId;
  if (workspaceId !== undefined && workspaceId !== null && workspaceId !== "" &&
      workspaceId !== MAIN_WORKSPACE_ID) {
    return false;
  }
  return true;
}

function hasConflictingManagerClaim(authUser: FirebaseAuthUser | null): boolean {
  if (!authUser?.customClaims || !own(authUser.customClaims, "role")) return false;
  return roleFrom(authUser.customClaims, "role") !== "MANAGER";
}

async function getWorkspaceManager(uid: string, actor: Actor): Promise<{
  profile: FirestoreDocument | null;
  authUser: FirebaseAuthUser | null;
}> {
  if (uid === actor.uid || uid === LEGACY_LANDLORD_UID) forbidden();

  const isLegacyManager = LEGACY_MANAGER_UIDS.includes(uid);
  if (isLegacyManager && actor.workspaceId !== MAIN_WORKSPACE_ID) notFound();

  const profile = await firestoreGet(`users/${uid}`);
  if (profile?.data.deleted === true) notFound();

  if (isLegacyManager) {
    if (!legacyManagerProfileAllowed(profile)) notFound();
  } else if (
    !profile ||
    profile.data.role !== "MANAGER" ||
    profile.data.workspaceId !== actor.workspaceId
  ) {
    notFound();
  }

  const authUser = await authGetUser(uid);
  if (hasConflictingManagerClaim(authUser)) notFound();
  if (isLegacyManager && !profile && !authUser) notFound();
  return { profile, authUser };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function managerSummary(
  uid: string,
  profile: FirestoreDocument | null,
  authUser: FirebaseAuthUser | null,
): Record<string, unknown> {
  const data = profile?.data || {};
  const profileDisabled = data.disabled === true;
  const displayName = [
    safeString(data.displayName),
    safeString(data.name),
    safeString(authUser?.displayName),
    safeString(authUser?.email),
    uid,
  ].find((value) => value !== null) || uid;
  const email = safeString(authUser?.email) || safeString(data.email);

  return {
    uid,
    displayName,
    email,
    disabled: authUser ? authUser.disabled : profileDisabled,
    profileDisabled,
    authExists: Boolean(authUser),
    accessStateMismatch: Boolean(authUser && authUser.disabled !== profileDisabled),
  };
}

async function listManagers(actor: Actor): Promise<Record<string, unknown>> {
  const profileDocuments = await firestoreQueryString(
    "users",
    "workspaceId",
    actor.workspaceId,
  );
  const candidates = new Map<string, ManagerCandidate>();

  for (const profile of profileDocuments) {
    if (profile.data.role !== "MANAGER" || profile.data.deleted === true) continue;
    if (LEGACY_MANAGER_UIDS.includes(profile.id) && actor.workspaceId !== MAIN_WORKSPACE_ID) continue;
    candidates.set(profile.id, { uid: profile.id, profile });
  }

  if (actor.workspaceId === MAIN_WORKSPACE_ID) {
    const legacyProfiles = await Promise.all(
      LEGACY_MANAGER_UIDS.map((uid) => firestoreGet(`users/${uid}`)),
    );
    for (let index = 0; index < LEGACY_MANAGER_UIDS.length; index += 1) {
      const uid = LEGACY_MANAGER_UIDS[index];
      const profile = legacyProfiles[index];
      if (legacyManagerProfileAllowed(profile)) {
        candidates.set(uid, { uid, profile });
      }
    }
  }

  const candidateList = [...candidates.values()];
  const managers: Array<Record<string, unknown> | null> = [];
  for (let start = 0; start < candidateList.length; start += AUTH_LOOKUP_CONCURRENCY) {
    const batch = candidateList.slice(start, start + AUTH_LOOKUP_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ uid, profile }) => {
        const authUser = await authGetUser(uid);
        if (!profile && !authUser) return null;
        if (hasConflictingManagerClaim(authUser)) return null;
        return managerSummary(uid, profile, authUser);
      }),
    );
    managers.push(...batchResults);
  }

  const result = managers.filter((manager): manager is Record<string, unknown> => manager !== null);
  result.sort((left, right) =>
    String(left.displayName || "").localeCompare(String(right.displayName || ""))
  );
  return { workspaceId: actor.workspaceId, managers: result };
}

function validateUid(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    value.trim() !== value ||
    value.includes("/")
  ) {
    badRequest("A valid manager UID is required.");
  }
  return value;
}

function assertKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    badRequest("The request contains an unsupported field.");
  }
}

async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    badRequest("The request is too large.");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    badRequest("The request body could not be read.");
  }
  if (text.length > MAX_REQUEST_BYTES) badRequest("The request is too large.");

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    badRequest("The request must contain valid JSON.");
  }
  if (!isRecord(value)) badRequest("The request body must be a JSON object.");
  return value;
}

async function setManagerAccess(
  actor: Actor,
  uid: string,
  disabled: boolean,
): Promise<Record<string, unknown>> {
  const manager = await getWorkspaceManager(uid, actor);
  if (!manager.authUser) {
    throw new EndpointError(404, "not-found", "The manager Authentication account was not found.");
  }

  const timestamp = new Date();
  await firestoreSet(`users/${uid}`, {
    role: "MANAGER",
    workspaceId: LEGACY_MANAGER_UIDS.includes(uid) ? MAIN_WORKSPACE_ID : actor.workspaceId,
    disabled,
    accessUpdatedBy: actor.uid,
    accessUpdatedAt: timestamp,
  });

  try {
    await authSetDisabled(uid, disabled);
  } catch (error) {
    if (!disabled) {
      const failClosedAt = new Date();
      await firestoreSet(`users/${uid}`, {
        role: "MANAGER",
        workspaceId: LEGACY_MANAGER_UIDS.includes(uid) ? MAIN_WORKSPACE_ID : actor.workspaceId,
        disabled: true,
        accessUpdatedBy: actor.uid,
        accessUpdatedAt: failClosedAt,
      }).catch(() => undefined);
      await authSetDisabled(uid, true).catch(() => undefined);
    }
    throw error;
  }

  return { uid, disabled };
}

async function deleteManager(
  actor: Actor,
  uid: string,
): Promise<Record<string, unknown>> {
  const manager = await getWorkspaceManager(uid, actor);
  const timestamp = new Date();
  const workspaceId = LEGACY_MANAGER_UIDS.includes(uid) ? MAIN_WORKSPACE_ID : actor.workspaceId;

  await firestoreSet(`users/${uid}`, {
    role: "MANAGER",
    workspaceId,
    disabled: true,
    deleted: true,
    deletedBy: actor.uid,
    deletedAt: timestamp,
    accessUpdatedBy: actor.uid,
    accessUpdatedAt: timestamp,
  });

  if (manager.authUser) {
    try {
      await authSetDisabled(uid, true);
    } catch (error) {
      if (!(error instanceof FirebaseUserNotFoundError)) throw error;
    }
    await authDeleteUser(uid);
  }

  return { uid, deleted: true };
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse(400, {
      code: "invalid-request",
      message: "Only POST requests are supported.",
    });
  }

  try {
    const body = await readRequestBody(request);
    if (typeof body.action !== "string") badRequest("An action is required.");

    const token = await verifyFirebaseToken(request);
    const actor = await requireLandlord(token);

    if (body.action === "list") {
      assertKeys(body, ["action"]);
      return jsonResponse(200, await listManagers(actor));
    }

    if (body.action === "setAccess") {
      assertKeys(body, ["action", "uid", "disabled"]);
      const uid = validateUid(body.uid);
      if (typeof body.disabled !== "boolean") {
        badRequest("The disabled value must be true or false.");
      }
      return jsonResponse(200, await setManagerAccess(actor, uid, body.disabled));
    }

    if (body.action === "delete") {
      assertKeys(body, ["action", "uid"]);
      const uid = validateUid(body.uid);
      return jsonResponse(200, await deleteManager(actor, uid));
    }

    badRequest("The requested action is not supported.");
  } catch (error) {
    if (error instanceof EndpointError) {
      return jsonResponse(error.status, { code: error.code, message: error.message });
    }
    if (error instanceof FirebaseTokenError) {
      return jsonResponse(401, {
        code: "unauthorized",
        message: "A valid Firebase sign-in is required.",
      });
    }
    if (error instanceof FirebaseUserNotFoundError) {
      return jsonResponse(404, {
        code: "not-found",
        message: "The Firebase account was not found.",
      });
    }
    if (error instanceof FirebaseConfigurationError) {
      console.error("manager-accounts Firebase verification failed", { reason: error.reason });
      return jsonResponse(500, {
        code: "internal-error",
        message: "The account operation could not be completed. Please try again.",
      });
    }
    if (error instanceof FirebaseServiceError) {
      console.error("manager-accounts Firebase verification failed", { reason: error.reason });
      return jsonResponse(500, {
        code: "internal-error",
        message: "The account operation could not be completed. Please try again.",
      });
    }
    return jsonResponse(500, {
      code: "internal-error",
      message: "The account operation could not be completed. Please try again.",
    });
  }
}

Deno.serve(handleRequest);
