// A thin Firestore REST client that acts as the signed-in user. Every request
// carries the user's own Firebase ID token, so firestore.rules decide what it
// may read and write, exactly as for the web app. No Admin SDK, no service
// account.

export type Doc = Record<string, unknown>;

export class FirestoreError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'FirestoreError';
  }
  get permissionDenied() { return this.status === 403 || this.code === 'PERMISSION_DENIED'; }
  get notFound() { return this.status === 404 || this.code === 'NOT_FOUND'; }
}

// ─── Value encoding ──────────────────────────────────────────────────────────
// Firestore REST wraps every value ({stringValue: "x"}, {integerValue: "3"}…).
// Numbers are written the way the JS SDK writes them: whole numbers as
// integers, everything else as doubles. Timestamps come back as milliseconds,
// like the app's toMillis().

type Value = Record<string, unknown>;

export function encodeValue(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Doc) } };
  throw new Error(`Can't store a ${typeof v} in Firestore`);
}

export function encodeFields(doc: Doc): Record<string, Value> {
  const fields: Record<string, Value> = {};
  for (const [k, v] of Object.entries(doc)) if (v !== undefined) fields[k] = encodeValue(v);
  return fields;
}

export function decodeValue(v: Value): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue as string);
  if ('arrayValue' in v) return ((v.arrayValue as { values?: Value[] }).values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields((v.mapValue as { fields?: Record<string, Value> }).fields ?? {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return undefined;
}

export function decodeFields(fields: Record<string, Value>): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

type RawDoc = { name: string; fields?: Record<string, Value> };

const idOf = (name: string) => name.slice(name.lastIndexOf('/') + 1);
const toDoc = (raw: RawDoc): Doc & { id: string } => ({ ...decodeFields(raw.fields ?? {}), id: idOf(raw.name) });

// ─── Writes ──────────────────────────────────────────────────────────────────

export type Write = {
  /** Path below /documents, e.g. "groups/ABC123/expenses/<id>" */
  path: string;
  data: Doc;
  /** Create only: fail if the document already exists (like the rules' `create`). */
  mustNotExist?: boolean;
  /** Update only these fields; the document must exist. */
  updateFields?: string[];
  /** Fields set to the server's time (serverTimestamp() in the JS SDK). */
  serverTime?: string[];
};

// ─── Client ──────────────────────────────────────────────────────────────────

export type FirestoreOptions = {
  projectId: string;
  idToken: string;
  /** e.g. "127.0.0.1:8080" to talk to the emulator */
  emulatorHost?: string;
  fetch?: typeof fetch;
};

export class Firestore {
  private readonly root: string;   // .../databases/(default)
  private readonly docsUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: FirestoreOptions) {
    const origin = opts.emulatorHost ? `http://${opts.emulatorHost}` : 'https://firestore.googleapis.com';
    this.root = `projects/${opts.projectId}/databases/(default)`;
    this.docsUrl = `${origin}/v1/${this.root}/documents`;
    // Called detached: Workers reject fetch invoked as a method of another object
    const f = opts.fetch ?? fetch;
    this.fetchFn = (input, init) => f(input, init);
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.opts.idToken}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { status?: string; message?: string } };
      throw new FirestoreError(res.status, body.error?.status ?? '', body.error?.message ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  /** One document, or null when it doesn't exist. */
  async get(path: string): Promise<(Doc & { id: string }) | null> {
    try {
      return toDoc(await this.call<RawDoc>(`${this.docsUrl}/${path}`));
    } catch (err) {
      if (err instanceof FirestoreError && err.notFound) return null;
      throw err;
    }
  }

  /** Every document in a collection, following pages. */
  async list(collectionPath: string): Promise<(Doc & { id: string })[]> {
    const out: (Doc & { id: string })[] = [];
    let pageToken = '';
    do {
      const qs = new URLSearchParams({ pageSize: '300' });
      if (pageToken) qs.set('pageToken', pageToken);
      const page = await this.call<{ documents?: RawDoc[]; nextPageToken?: string }>(`${this.docsUrl}/${collectionPath}?${qs}`);
      out.push(...(page.documents ?? []).map(toDoc));
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  /** Top-level documents in `collection` whose array field contains `value`. */
  async whereArrayContains(collection: string, field: string, value: string): Promise<(Doc & { id: string })[]> {
    const rows = await this.call<{ document?: RawDoc }[]>(`${this.docsUrl}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'ARRAY_CONTAINS', value: encodeValue(value) } },
        },
      }),
    });
    return rows.filter(r => r.document).map(r => toDoc(r.document!));
  }

  /** Applies all writes atomically (one batch, like writeBatch().commit()). */
  async commit(writes: Write[]): Promise<void> {
    await this.call(`${this.docsUrl}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: writes.map(w => ({
          update: { name: `${this.root}/documents/${w.path}`, fields: encodeFields(w.data) },
          ...(w.updateFields ? { updateMask: { fieldPaths: w.updateFields } } : {}),
          ...(w.mustNotExist ? { currentDocument: { exists: false } } : w.updateFields ? { currentDocument: { exists: true } } : {}),
          ...(w.serverTime?.length
            ? { updateTransforms: w.serverTime.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }
            : {}),
        })),
      }),
    });
  }
}
