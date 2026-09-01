import { doc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { fetchAdminDoc } from './adminAuth'
import { loadSplitAppState, DEFAULT_CLUB_ID } from './splitFirestore'
import { fetchTournaments } from './tournamentSync'
import { applyNov29Import } from './tournamentNov29Import'
import type { Nov29ApplyResult, Nov29BuiltWrites, Nov29ImportSpec } from './tournamentNov29Import'

// applyNov29Import()(순수 오케스트레이션, Firebase 미사용)를 실제 Firestore와 연결하는
// 아주 얇은 접합부 — tournamentApr18ApplyFirestore.ts와 완전히 같은 패턴이다. 이 파일만
// Firebase를 import한다. 저장 경로도 기존과 정확히 같다(clubs/{clubId}/sessions,
// .../sessions/{id}/games, .../tournaments, .../tournaments/{id}/participants,
// .../tournaments/{id}/matches) — 새 collection·schema가 없다.
async function commitBatch(writes: Nov29BuiltWrites): Promise<void> {
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
  batch.set(doc(db, 'clubs', clubId, 'tournaments', writes.tournament.id), writes.tournament)
  for (const participant of writes.participants) {
    batch.set(doc(db, 'clubs', clubId, 'tournaments', writes.tournament.id, 'participants', participant.id), participant)
  }
  for (const match of writes.matches) {
    batch.set(doc(db, 'clubs', clubId, 'tournaments', writes.tournament.id, 'matches', match.id), match)
  }

  await batch.commit()
}

/** 관리자 화면이 실제로 부르는 함수. 진짜 Firestore 읽기·쓰기를 전부 연결한다. */
export async function applyNov29ImportLive(spec: Nov29ImportSpec, adminUid: string): Promise<Nov29ApplyResult> {
  return applyNov29Import(spec, { adminUid }, {
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
