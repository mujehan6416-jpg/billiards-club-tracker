// 테스트 전용 "메모리 속 가짜 Firestore". 실제 Firestore를 부르지 않고, firebase/firestore에서 앱이 쓰는 함수만
// 같은 모양으로 흉내 낸다(문서 경로 → 데이터 Map). 앱의 진짜 동기화 코드(lib/tournamentSync.ts)를 그대로 통과시켜
// 대회 전체 흐름을 재현하기 위한 것이다. 실제 운영 데이터와는 아무 관계가 없다.
//
// 실제 Firestore와 같게 동작하는 부분(일부러 엄격하게 만들었다):
//  - 값이 undefined인 필드를 저장하면 오류(운영에서 setDoc/update가 거부하는 것과 같다)
//  - 없는 문서를 update하면 오류(not-found)
//  - writeBatch는 전부 성공하거나 전부 실패(원자적), runTransaction은 한 번에 하나씩 실행
//  - deleteField()는 필드를 지우는 표시값
//  - onSnapshot은 등록 즉시 현재 값을 한 번 주고, 이후 그 경로 아래에 변경이 생길 때마다 다시 준다

const DELETE = { __deleteField: true } as const

type Data = Record<string, unknown>
const store = new Map<string, Data>()
const listeners = new Set<{ path: string; kind: 'doc' | 'collection'; fire: () => void }>()
/** 모든 쓰기 기록(분석용): [종류, 경로]. */
export const writeLog: { kind: 'set' | 'update' | 'delete'; path: string }[] = []

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

function assertNoUndefined(value: unknown, where: string): void {
  if (value === undefined) throw new Error(`[fakeFirestore] undefined 값은 저장할 수 없습니다: ${where}`)
  if (value === DELETE) return
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoUndefined(v, `${where}[${i}]`)); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Data)) assertNoUndefined(v, `${where}.${k}`)
  }
}

function applyUpdate(base: Data, patch: Data): Data {
  const next = clone(base)
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete next[k]
    else next[k] = clone(v)
  }
  return next
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
const idOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function docsUnder(collectionPath: string): { id: string; data: Data }[] {
  const prefix = `${collectionPath}/`
  return [...store.entries()]
    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map(([p, d]) => ({ id: idOf(p), data: d }))
}

function notify(changedPaths: string[]): void {
  for (const l of [...listeners]) {
    const hit = changedPaths.some((p) => (l.kind === 'doc' ? p === l.path : parentOf(p) === l.path))
    if (hit) l.fire()
  }
}

type Op = { kind: 'set' | 'update' | 'delete'; path: string; data?: Data; merge?: boolean }

/** 여러 쓰기를 한꺼번에 반영한다. 하나라도 어긋나면(없는 문서 update 등) 아무것도 바꾸지 않는다. */
function commit(ops: Op[]): void {
  const draft = new Map(store)
  for (const op of ops) {
    if (op.kind === 'set') {
      assertNoUndefined(op.data, op.path)
      draft.set(op.path, op.merge ? applyUpdate(draft.get(op.path) ?? {}, op.data!) : clone(op.data!))
    } else if (op.kind === 'update') {
      assertNoUndefined(op.data, op.path)
      const cur = draft.get(op.path)
      if (!cur) {
        const err = new Error(`[fakeFirestore] 문서가 없어 update할 수 없습니다: ${op.path}`) as Error & { code: string }
        err.code = 'not-found'
        throw err
      }
      draft.set(op.path, applyUpdate(cur, op.data!))
    } else {
      draft.delete(op.path)
    }
  }
  store.clear()
  for (const [p, d] of draft) store.set(p, d)
  for (const op of ops) writeLog.push({ kind: op.kind, path: op.path })
  notify(ops.map((o) => o.path))
}

// ── firebase/firestore 흉내 ─────────────────────────────────────────

const ref = (kind: 'doc' | 'collection') => (_db: unknown, ...segments: string[]) => ({ __kind: kind, path: segments.join('/'), id: segments[segments.length - 1] })

const docSnap = (path: string) => {
  const data = store.get(path)
  return { id: idOf(path), exists: () => data !== undefined, data: () => (data === undefined ? undefined : clone(data)) }
}
const querySnap = (path: string) => {
  const docs = docsUnder(path).map((d) => ({ id: d.id, data: () => clone(d.data) }))
  return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false } }
}

let txQueue: Promise<unknown> = Promise.resolve()

export const firestoreFake = {
  doc: ref('doc'),
  collection: ref('collection'),
  getDoc: async (r: { path: string }) => docSnap(r.path),
  getDocs: async (r: { path: string }) => querySnap(r.path),
  setDoc: async (r: { path: string }, data: Data, options?: { merge?: boolean }) => commit([{ kind: 'set', path: r.path, data, merge: options?.merge }]),
  updateDoc: async (r: { path: string }, data: Data) => commit([{ kind: 'update', path: r.path, data }]),
  deleteDoc: async (r: { path: string }) => commit([{ kind: 'delete', path: r.path }]),
  deleteField: () => DELETE,
  writeBatch: () => {
    const ops: Op[] = []
    const batch = {
      set: (r: { path: string }, data: Data, options?: { merge?: boolean }) => { ops.push({ kind: 'set', path: r.path, data, merge: options?.merge }); return batch },
      update: (r: { path: string }, data: Data) => { ops.push({ kind: 'update', path: r.path, data }); return batch },
      delete: (r: { path: string }) => { ops.push({ kind: 'delete', path: r.path }); return batch },
      commit: async () => commit(ops),
    }
    return batch
  },
  runTransaction: <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = txQueue.then(async () => {
      const ops: Op[] = []
      const tx = {
        get: async (r: { path: string }) => docSnap(r.path),
        set: (r: { path: string }, data: Data) => { ops.push({ kind: 'set', path: r.path, data }) },
        update: (r: { path: string }, data: Data) => { ops.push({ kind: 'update', path: r.path, data }) },
        delete: (r: { path: string }) => { ops.push({ kind: 'delete', path: r.path }) },
      }
      const result = await fn(tx)
      if (ops.length > 0) commit(ops)
      return result
    })
    txQueue = run.then(() => undefined, () => undefined)
    return run as Promise<T>
  },
  onSnapshot: (r: { path: string; __kind: 'doc' | 'collection' }, onNext: (snap: unknown) => void) => {
    const fire = () => onNext(r.__kind === 'doc' ? { ...docSnap(r.path), metadata: { fromCache: false, hasPendingWrites: false } } : querySnap(r.path))
    const entry = { path: r.path, kind: r.__kind, fire }
    listeners.add(entry)
    queueMicrotask(() => { if (listeners.has(entry)) fire() })
    return () => { listeners.delete(entry) }
  },
}

// ── 테스트용 도구 ───────────────────────────────────────────────────

export function resetFakeFirestore(): void {
  store.clear()
  listeners.clear()
  writeLog.length = 0
  txQueue = Promise.resolve()
}
/** 경로 하나의 문서(복사본). 없으면 undefined. */
export const rawGet = (path: string): Data | undefined => { const d = store.get(path); return d ? clone(d) : undefined }
/** 컬렉션 경로 아래 문서 전체(id 포함 복사본). */
export const rawList = (collectionPath: string): (Data & { __id: string })[] =>
  docsUnder(collectionPath).map((d) => ({ ...clone(d.data), __id: d.id }))
/** 앞부분이 같은 모든 경로(문서 + 하위 문서). 삭제 후 잔존 확인용. */
export const rawPathsWithPrefix = (prefix: string): string[] => [...store.keys()].filter((p) => p === prefix || p.startsWith(`${prefix}/`))
/** 테스트가 서버에 직접 문서를 심을 때(다른 기기·다른 대회 흉내). */
export function rawSet(path: string, data: Data): void { assertNoUndefined(data, path); store.set(path, clone(data)); notify([path]) }
