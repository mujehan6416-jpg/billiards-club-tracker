import { doc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { fetchAdminDoc } from './adminAuth'
import { loadSplitAppState, DEFAULT_CLUB_ID } from './splitFirestore'
import { fetchTournaments } from './tournamentSync'
import { applyApr18Import } from './tournamentApr18Import'
import type { Apr18ApplyResult, Apr18BuiltWrites, Apr18ImportSpec } from './tournamentApr18Import'

// applyApr18Import()(순수 오케스트레이션, Firebase 미사용)를 실제 Firestore와 연결하는
// 아주 얇은 접합부. 이 파일만 Firebase를 import한다 — 로직 자체(회원 매핑, 중복 재검사,
// 문서 계산)는 전부 tournamentApr18Import.ts의 순수 함수가 하고, 여기는 그 결과를
// 실제로 어디에 읽고/쓸지만 연결한다.
//
// 저장 경로는 기존 lib/splitFirestore.ts / lib/tournamentSync.ts가 이미 쓰는 경로와
// 정확히 같다(clubs/{clubId}/sessions, .../sessions/{id}/games, .../tournaments,
// .../tournaments/{id}/participants, .../tournaments/{id}/matches) — 새 collection이나
// schema를 만들지 않는다. 다만 이번에는 그 경로들에 대한 쓰기 76건(세션 1 + 경기 23 +
// 대회 2 + 참가자 24 + 경기(대진) 26)을 개별 setDoc이 아니라 **하나의 writeBatch**로
// 묶어서, 일부만 저장되는 상태(대회는 생겼는데 경기가 없는 등)가 생기지 않게 한다.
// Firestore batch commit은 원자적이다 — 전부 성공하거나 전부 실패한다.
async function commitBatch(writes: Apr18BuiltWrites): Promise<void> {
  const clubId = DEFAULT_CLUB_ID
  const batch = writeBatch(db)

  batch.set(doc(db, 'clubs', clubId, 'sessions', writes.session.id), {
    id: writes.session.id,
    date: writes.session.date,
    attendeeIds: writes.session.attendeeIds,
  })

  for (const { sessionId, game } of writes.games) {
    batch.set(doc(db, 'clubs', clubId, 'sessions', sessionId, 'games', game.id), game)
  }
  for (const tournament of writes.tournaments) {
    batch.set(doc(db, 'clubs', clubId, 'tournaments', tournament.id), tournament)
  }
  for (const { tournamentId, participant } of writes.participants) {
    batch.set(doc(db, 'clubs', clubId, 'tournaments', tournamentId, 'participants', participant.id), participant)
  }
  for (const { tournamentId, match } of writes.matches) {
    batch.set(doc(db, 'clubs', clubId, 'tournaments', tournamentId, 'matches', match.id), match)
  }

  await batch.commit()
}

/** 관리자 화면이 실제로 부르는 함수. 진짜 Firestore 읽기·쓰기를 전부 연결한다. */
export async function applyApr18ImportLive(spec: Apr18ImportSpec, adminUid: string): Promise<Apr18ApplyResult> {
  return applyApr18Import(spec, { adminUid }, {
    fetchAdminDoc,
    loadState: async () => {
      const state = await loadSplitAppState()
      return { members: state.members, sessions: state.sessions }
    },
    fetchTournaments,
    commitBatch,
    makeId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  })
}
