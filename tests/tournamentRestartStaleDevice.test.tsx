import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// "리스타트 대회가 앱에서 안 열렸다"의 원인 후보를 재현하는 시험 — 오래된 화면(다른 기기)·같은 이름 대회·참가자 목록 갱신.
// 기기 B = 본선 대회 화면을 먼저 열어 둔 관리자 화면(TournamentTab). 기기 A = 같은 서버에 직접 쓰는 다른 기기(동기화 함수 직접 호출).
// 운영 Firestore는 건드리지 않는다(tests/fixtures/fakeFirestore.ts의 메모리 저장소). 선수는 "가상선수NN"이다.
// ─────────────────────────────────────────────────────────────────────────────

vi.hoisted(() => { process.env.RTL_SKIP_AUTO_CLEANUP = 'true' })

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  const { firestoreFake } = await import('./fixtures/fakeFirestore')
  return { ...actual, ...firestoreFake }
})

import { TournamentTab } from '../src/tabs/TournamentTab'
import {
  approveTournamentMatch, confirmTournamentBracket, confirmTournamentEntries, createMissingParticipants, createRestartBracket, createTournament,
  ensureTournamentDoc, fetchTournamentMatches, fetchTournamentParticipants, fetchTournaments, prepareTournamentDraw, saveTournamentDrawMapping,
  saveTournamentDrawNumbers, setParticipantEntryStatus, submitTournamentMatchResult, syncRestartJoiners, verifyTournamentMatchResult, writeTournamentParticipant,
} from '../src/lib/tournamentSync'
import { buildEmptyBracket, buildTournamentMatches } from '../src/logic/tournamentBracket'
import { buildSeatsFromDraw, createTournamentParticipant } from '../src/logic/tournamentDraw'
import { buildRestartTournament, findRestartTarget, restartTournamentId, restartTournamentName } from '../src/logic/tournamentRestart'
import { analyzeRestartSource, buildRestartBracket, restartFirstRoundStatus } from '../src/logic/tournamentRestartBracket'
import { roundLabel } from '../src/components/tournament/tournamentDisplay'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { rawGet, rawList, rawSet, resetFakeFirestore } from './fixtures/fakeFirestore'
import { seededRng } from './fixtures/restartMain'
import type { Member } from '../src/types'
import type { Tournament, TournamentMatch } from '../src/types/tournament'

const CLUB = 'skkubc'
const MAIN = 'stale-main'
const RESTART = restartTournamentId(MAIN)
const MAIN_NAME = '시험 대회'
const RESTART_NAME = restartTournamentName(MAIN_NAME)
const mid = (n: number) => `m${String(n).padStart(2, '0')}`
const nm = (n: number) => `가상선수${String(n).padStart(2, '0')}`
const members = (): Member[] => Array.from({ length: 8 }, (_, i) => ({
  id: mid(i + 1), name: nm(i + 1), handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true,
}))
let clock = Date.parse('2026-10-06T01:00:00.000Z')
const at = () => new Date((clock += 60_000)).toISOString()

const getMatches = (tid: string) => rawList(`clubs/${CLUB}/tournaments/${tid}/matches`).map(({ __id, ...r }) => { void __id; return r as unknown as TournamentMatch })
const matchBetween = (tid: string, a: number, b: number) => getMatches(tid).find((m) => [m.playerAMemberId, m.playerBMemberId].sort().join() === [mid(a), mid(b)].sort().join())!

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-admin', email: null, adminDisplayName: null, errorMessage: null })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
}
async function settle(times = 4) { for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function openInUi(name: string) {
  const back = screen.queryByText('← 대회 목록')
  if (back) fireEvent.click(back)
  fireEvent.click(await screen.findByText(name))
  await screen.findByText('← 대회 목록')
  await settle()
}
function clickRound(count: number) {
  const label = roundLabel(count)
  const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').replace('✅ ', '') === label)
  if (!btn) throw new Error(`라운드 탭을 찾을 수 없습니다: ${label}`)
  fireEvent.click(btn)
}
const matchCard = (a: string, b: string) => {
  const card = screen.getAllByRole('button').find((x) => x.getAttribute('role') === 'button' && (x.textContent ?? '').includes('경기') && (x.textContent ?? '').includes(a) && (x.textContent ?? '').includes(b))
  if (!card) throw new Error(`경기 카드를 찾을 수 없습니다: ${a} vs ${b}`)
  return card
}

/** 선수 휴대폰: 점수 입력 + 상대 확인까지만 한다. 최종 승인은 따로. */
async function enterResult(tid: string, w: number, l: number) {
  const m = matchBetween(tid, w, l)
  const wIsA = m.playerAMemberId === mid(w)
  await submitTournamentMatchResult(tid, m.id, { byMemberId: m.playerAMemberId!, scoreA: wIsA ? 20 : 5, scoreB: wIsA ? 5 : 20, at: at() }, CLUB)
  await verifyTournamentMatchResult(tid, m.id, { byMemberId: m.playerBMemberId!, at: at() }, CLUB)
  return m
}
/** 기기 A가 관리자로 최종 승인(화면 없이). 승인만으로는 리스타트 합류가 자동으로 일어나지 않는 "다른 기기" 흐름이다. */
async function approveOnDeviceA(tid: string, w: number, l: number) {
  const m = await enterResult(tid, w, l)
  await approveTournamentMatch(tid, m.id, { adminUid: 'uid-admin', at: at() }, CLUB)
}
/** 기기 B(오래 열어 둔 화면)에서 같은 경기를 화면의 "최종 승인" 버튼으로 승인. */
async function approveOnDeviceB(tid: string, w: number, l: number) {
  const m = await enterResult(tid, w, l)
  clickRound(m.playerCountInRound)
  await settle()
  fireEvent.click(matchCard(nm(w), nm(l)))
  fireEvent.click(await screen.findByText('최종 승인'))
  await waitFor(() => expect(getMatches(tid).find((x) => x.id === m.id)!.status).toBe('official'), { timeout: 4000 })
  await settle()
}

/** 기기 A가 앱과 같은 순서로 리스타트를 만든다: 고정 ID 대회 생성 → 1차 탈락자 편입 → 대진 생성 → 합류 가능한 자리 채움. */
async function deviceACreatesRestart() {
  const main = (await fetchTournaments(CLUB)).find((t) => t.id === MAIN)!
  await ensureTournamentDoc(buildRestartTournament(main, at(), 'uid-admin'), CLUB)
  const sourceMatches = await fetchTournamentMatches(MAIN, CLUB)
  const analysis = analyzeRestartSource(sourceMatches)
  if (!analysis.ok) throw new Error(analysis.message)
  const status = restartFirstRoundStatus(analysis.value)
  expect(status.ready).toBe(true)
  for (const l of status.losers) {
    const mem = members().find((x) => x.id === l.memberId)!
    await writeTournamentParticipant(RESTART, createTournamentParticipant(mem, { participantId: mem.id, entryStatus: 'entered' }), CLUB)
  }
  const entered = (await fetchTournamentParticipants(RESTART, CLUB)).filter((p) => p.entryStatus === 'entered')
  const built = buildRestartBracket({
    sourceTournamentId: MAIN, analysis: analysis.value, sourceMatches,
    entrants: entered.map((p) => ({ participantId: p.id, memberId: p.memberId, handicap: p.tournamentHandicap })), rng: seededRng(7),
  })
  if (!built.ok) throw new Error(built.message)
  const { w, entrantCount } = analysis.value
  await createRestartBracket(RESTART, built.value.matches, { sourceTournamentId: MAIN, bracketSize: w * 4, participantCount: entrantCount, at: at() }, CLUB)
  await syncRestartJoiners(RESTART, CLUB)
}

beforeAll(() => { resetFakeFirestore(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterAll(() => { cleanup(); vi.restoreAllMocks() })

describe('리스타트가 안 열리는 문제 — 오래된 화면 · 같은 이름 · 참가자 목록', () => {
  it('0. 준비: 본선 8명 대진을 만들고 1차 4경기(홀수 번호 승)를 승인 — 이 시점에 리스타트는 없다', async () => {
    useApp.setState({ members: members() })
    const t: Tournament = { id: MAIN, name: MAIN_NAME, date: '2026-10-06', timeLimitMinutes: 50, status: 'draft', createdAt: at() }
    await createTournament(t, CLUB)
    await createMissingParticipants(MAIN, members(), CLUB)
    for (let n = 1; n <= 8; n++) await setParticipantEntryStatus(MAIN, mid(n), 'entered', CLUB)
    await confirmTournamentEntries(MAIN, 8, CLUB)
    await prepareTournamentDraw(MAIN, 8, CLUB)
    const mapping = { bracketSize: 8, byeSlots: [] as number[], numberToSlot: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, i + 1])) }
    await saveTournamentDrawMapping(MAIN, mapping, CLUB)
    const entered = (await fetchTournamentParticipants(MAIN, CLUB)).filter((p) => p.entryStatus === 'entered')
    const entries = entered.map((p) => ({ participantId: p.id, drawNumber: Number(p.memberId.slice(1)) }))
    await saveTournamentDrawNumbers(MAIN, entered, entries, CLUB)
    const bracket = buildEmptyBracket(8, { includeThirdPlace: true })
    if (!bracket.ok) throw new Error(bracket.message)
    const seats = buildSeatsFromDraw(entered, entries, mapping)
    if (!seats.ok) throw new Error(seats.message)
    const built = buildTournamentMatches(bracket.value, seats.value)
    if (!built.ok) throw new Error(built.message)
    await confirmTournamentBracket(MAIN, built.value, { bracketSize: 8, at: at() }, CLUB)
    for (const [w, l] of [[1, 2], [3, 4], [5, 6], [7, 8]]) await approveOnDeviceA(MAIN, w, l)
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toBeUndefined()
  })

  it('1. [오래된 화면] 기기 B가 리스타트 생기기 전 목록을 들고 있어도, 기기 A가 만든 뒤 B에서 본선을 승인하면 합류가 이어진다', async () => {
    asAdmin()
    render(<TournamentTab />) // 기기 B: 이 시점의 대회 목록은 본선 1개뿐
    await openInUi(MAIN_NAME)
    await deviceACreatesRestart() // 기기 A가 리스타트를 만든다 — B의 화면은 모른다
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toMatchObject({ status: 'bracketFixed', restartSourceTournamentId: MAIN })
    await approveOnDeviceB(MAIN, 1, 3) // 본선 4강 1경기 승인 → 패자 3번이 리스타트 합류 자리 1번에 들어가야 한다
    await waitFor(() => expect(getMatches(RESTART).find((m) => m.id === 'r2m1')!.playerBMemberId).toBe(mid(3)), { timeout: 3000 })
  })

  it('2. [오래된 화면] B의 대회 목록에 리스타트 대회가 새로고침 없이 보인다', async () => {
    fireEvent.click(await screen.findByText('← 대회 목록'))
    await settle()
    expect(screen.queryByText(RESTART_NAME)).not.toBeNull()
  })

  it('3. [참가자 목록] 리스타트를 한 번 열어 본 뒤 다음 합류자가 들어와도, 다시 열면 합류자 이름이 정상으로 보인다', async () => {
    await openInUi(RESTART_NAME)
    clickRound(4)
    await settle()
    expect(screen.queryByText('알수없음')).toBeNull()
    expect(screen.getAllByText(nm(3)).length).toBeGreaterThan(0)
    await openInUi(MAIN_NAME)
    await approveOnDeviceB(MAIN, 5, 7) // 본선 4강 2경기 → 패자 7번이 합류 자리 2번에
    await waitFor(() => expect(getMatches(RESTART).find((m) => m.id === 'r2m2')!.playerBMemberId).toBe(mid(7)), { timeout: 3000 })
    await openInUi(RESTART_NAME) // 두 번째로 열기
    clickRound(4)
    await settle()
    expect(screen.queryByText('알수없음')).toBeNull()
    expect(screen.getAllByText(nm(7)).length).toBeGreaterThan(0)
  })

  it('4. [새로고침] 화면을 새로 열어도 같은 리스타트를 찾고 열린다(중복 생성 없음)', async () => {
    cleanup()
    asAdmin()
    render(<TournamentTab />)
    await openInUi(RESTART_NAME)
    clickRound(4)
    await settle()
    expect(screen.queryByText('알수없음')).toBeNull()
    expect((await fetchTournaments(CLUB)).filter((t) => t.id.startsWith('restart-'))).toHaveLength(1)
    cleanup()
  })

  it('5. [같은 이름] 고정 ID 리스타트와 이름만 같은 다른 대회가 함께 있어도 고정 ID 쪽을 고른다', async () => {
    const all = await fetchTournaments(CLUB)
    const main = all.find((t) => t.id === MAIN)!
    const decoySameDay: Tournament = { id: 'old-restart-copy', name: ` ${RESTART_NAME} `, date: main.date, timeLimitMinutes: 50, status: 'draft', createdAt: at() }
    const decoyOtherDay: Tournament = { ...decoySameDay, id: 'old-restart-copy-2', date: '2026-09-01' }
    for (const withDecoys of [[...all, decoySameDay], [...all, decoySameDay, decoyOtherDay]]) {
      const r = findRestartTarget(main, withDecoys)
      expect(r.kind).toBe('found')
      if (r.kind === 'found') expect(r.tournament.id).toBe(RESTART)
    }
    // 아직 대진을 만들기 전(초안 상태)인 고정 ID 대회도 이름이 같은 다른 대회보다 우선한다.
    const draftOnly = all.map((t) => (t.id === RESTART ? { ...t, status: 'draft' as const, restartSourceTournamentId: undefined } : t))
    const r2 = findRestartTarget(main, [...draftOnly, decoySameDay])
    expect(r2.kind === 'found' && r2.tournament.id).toBe(RESTART)
  })

  it('6. [같은 이름] 다른 본선에 연결된 리스타트나 다른 본선의 자동 생성 대회는 이 본선의 후보로 잡지 않는다', async () => {
    rawSet(`clubs/${CLUB}/tournaments/other-main`, { id: 'other-main', name: MAIN_NAME, date: '2026-10-06', timeLimitMinutes: 50, status: 'finished', createdAt: at() })
    const all = await fetchTournaments(CLUB)
    const main = { ...all.find((t) => t.id === MAIN)!, id: 'another-new-main' }
    const foreign: Tournament = { id: 'restart-other-main', name: RESTART_NAME, date: main.date, timeLimitMinutes: 50, status: 'bracketFixed', createdAt: at(), restartSourceTournamentId: 'other-main' }
    const r = findRestartTarget(main, [...all.filter((t) => t.id !== RESTART), foreign])
    expect(r.kind).toBe('missing') // 이름이 같아도 다른 본선에 연결된 대회는 가져다 쓰지 않는다
  })
})
