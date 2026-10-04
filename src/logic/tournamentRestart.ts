import type { Tournament, TournamentMatch, TournamentParticipant } from '../types/tournament'

// "본선 탈락자를 별도의 리스타트 대회 참가자로 보내기" 판정 로직.
//
// 본선과 리스타트는 서로 별개의 대회(Tournament)다. 이 파일은 둘을 잇는 규칙만 담는다 —
// 어떤 선수를 보낼 수 있는지(후보), 어떤 대회로 보낼 수 있는지(대상), 누구를 실제로 추가할지(계획).
// 자동으로 보내지 않는다: 후보를 보여줄 뿐이고, 보낼 사람은 운영진이 직접 고른다.
//
// ⚠ 제한사항(이번 버전): 이미 보낸 뒤 본선 결과를 정정해도 리스타트 쪽 참가자는 자동으로
// 바뀌지 않는다. 필요하면 리스타트 대회의 기존 참가자 관리에서 운영진이 직접 조정한다.

export interface RestartCandidate {
  memberId: string
  participantId: string
  name: string
}

/**
 * 리스타트 후보 = 최종 승인(official)된 실제 경기의 패자.
 * 승인 전 경기, 아직 안 치른 경기, 부전승은 후보가 아니다. 호출 시점의 경기 데이터로
 * 매번 다시 계산하므로 결과가 정정되면 후보도 그에 맞게 바뀐다.
 * 같은 회원은 memberId 기준으로 한 번만 나온다(이름 문자열로 판단하지 않는다).
 */
export function restartCandidates(
  matches: TournamentMatch[],
  participants: TournamentParticipant[],
): RestartCandidate[] {
  const byParticipantId = new Map(participants.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const result: RestartCandidate[] = []
  for (const m of matches) {
    if (m.status !== 'official' || m.resultType === 'bye') continue
    const loser = m.officialLoserParticipantId ? byParticipantId.get(m.officialLoserParticipantId) : undefined
    if (!loser || seen.has(loser.memberId)) continue
    seen.add(loser.memberId)
    result.push({ memberId: loser.memberId, participantId: loser.id, name: loser.displayNameSnapshot })
  }
  return result
}

export interface RestartTargetState {
  selectable: boolean
  /** 선택할 수 없을 때 화면에 그대로 보여줄 쉬운 안내 문장. */
  reason?: string
}

/** 이 대회를 리스타트 보내기 대상으로 고를 수 있는지. 참가자 수정이 가능한 대회(참가 신청 중)만 가능하다. */
export function restartTargetState(target: Tournament, currentTournamentId: string): RestartTargetState {
  if (target.id === currentTournamentId) return { selectable: false, reason: '지금 보고 있는 대회입니다.' }
  switch (target.status) {
    case 'draft':
      return { selectable: true }
    case 'bracketFixed':
      return { selectable: false, reason: '이미 대진이 확정된 대회에는 참가자를 추가할 수 없습니다.' }
    case 'finished':
    case 'cancelled':
      return { selectable: false, reason: '이미 종료된 대회입니다.' }
    default:
      return { selectable: false, reason: '연결된 리스타트 대회가 참가자 확정 상태라 추가할 수 없습니다. (리스타트 대회에서 참가자 확정을 취소해야 합니다)' }
  }
}

/** 대상 대회에 이미 '참가' 상태로 있는 회원인지. */
export function isAlreadyInTarget(memberId: string, targetParticipants: TournamentParticipant[]): boolean {
  return targetParticipants.some((p) => p.memberId === memberId && p.entryStatus === 'entered')
}

/** 선택한 회원 중 실제로 추가할 사람과 이미 참가 중이라 건너뛸 사람을 나눈다(선택 중복도 제거). */
export function planRestartTransfer(
  selectedMemberIds: string[],
  targetParticipants: TournamentParticipant[],
): { toAdd: string[]; alreadyIn: string[] } {
  const toAdd: string[] = []
  const alreadyIn: string[] = []
  for (const id of new Set(selectedMemberIds)) {
    ;(isAlreadyInTarget(id, targetParticipants) ? alreadyIn : toAdd).push(id)
  }
  return { toAdd, alreadyIn }
}

// ── 리스타트 대상 대회 자동 결정 ─────────────────────────────────────────────
// 운영진이 "보낼 대회"를 고르지 않는다. 현재 본선 대회 이름 + " 리스타트전"과 이름이 정확히 같은
// 다른 대회를 찾아 연결한다. 이름에 "리스타트"가 들어 있다는 이유로 아무 대회나 고르지 않는다.

/**
 * 이름 비교용 정리 — 눈으로 보면 같은 이름이 글자 구성 차이로 다르게 비교되는 일을 막는다.
 *  - 한글 조합 방식을 통일한다(NFC): 기기·입력기에 따라 "대"가 한 글자로 저장되기도, "ㄷ+ㅐ"로 나뉘어 저장되기도 한다.
 *  - 보이지 않는 문자(제로폭 공백·BOM 등)를 지운다.
 *  - 앞뒤 공백을 지우고 연속 공백(전각·줄바꿈 없는 공백 포함)을 일반 공백 하나로 만든다.
 * 이름이 다른 대회를 느슨하게 맞추지는 않는다(단어·순서·띄어쓰기 위치가 다르면 다른 이름이다).
 */
export function normalizeTournamentName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 본선 대회 이름 → 리스타트 대회 이름. 예: "제28차 부산동문회장배" → "제28차 부산동문회장배 리스타트전" */
export function restartTournamentName(sourceName: string): string {
  return `${normalizeTournamentName(sourceName)} 리스타트전`
}

/**
 * 자동으로 만드는 리스타트 대회의 문서 id — 본선 id에서 정해진다(난수 아님).
 * 두 기기가 동시에 만들려 해도 같은 문서 하나로 합쳐져 중복 대회가 생기지 않는다.
 */
export function restartTournamentId(sourceTournamentId: string): string {
  return `restart-${sourceTournamentId}`
}

/**
 * 자동 생성할 리스타트 대회 문서. 기존 대회 만들기와 같은 필드만 쓰고(새 구조 없음), 본선에서는 이름·날짜·
 * 제한시간만 가져온다. 참가자 문서는 만들지 않는다 — 본선 참가자를 복사하지 않으며, 리스타트 대상자는
 * 본선 1차 탈락자가 최종 승인된 뒤에만 들어온다. 참가자 확정·대진 확정·종료 전(draft)이다.
 */
export function buildRestartTournament(source: Tournament, nowIso: string, adminUid?: string | null): Tournament {
  return {
    id: restartTournamentId(source.id),
    name: restartTournamentName(source.name),
    date: source.date,
    timeLimitMinutes: source.timeLimitMinutes,
    status: 'draft',
    createdAt: nowIso,
    ...(adminUid ? { createdByAdminUid: adminUid } : {}),
  }
}

export type RestartTargetLookup =
  | { kind: 'found'; tournament: Tournament }
  | { kind: 'missing'; expectedName: string; message: string }
  | { kind: 'ambiguous'; expectedName: string; message: string }

/**
 * 현재 본선 대회에 연결할 리스타트 대회를 찾는다.
 * - 현재 대회 자신은 제외한다.
 * - 같은 이름이 둘 이상이면 현재 대회와 날짜가 같은 것을 우선하고, 그래도 둘 이상이면 고르지 않고 중단한다
 *   (운영 데이터 오연결 방지).
 * - 없으면 만들어 달라는 안내를 돌려준다(여기서 새 대회를 만들지 않는다).
 */
export function findRestartTarget(current: Tournament, tournaments: Tournament[]): RestartTargetLookup {
  const expectedName = restartTournamentName(current.name)
  // 이름이 정확히 같은 대회, 또는 이 본선에서 자동 생성한 대회(고정 id — 나중에 이름을 고쳤어도 같은 대회로 본다)
  const autoId = restartTournamentId(current.id)
  const sameName = tournaments.filter((t) => t.id !== current.id && (t.id === autoId || normalizeTournamentName(t.name) === expectedName))
  if (sameName.length === 0) {
    return { kind: 'missing', expectedName, message: `'${expectedName}' 대회가 아직 없습니다.` }
  }
  if (sameName.length === 1) return { kind: 'found', tournament: sameName[0] }
  const sameDate = sameName.filter((t) => t.date === current.date)
  if (sameDate.length === 1) return { kind: 'found', tournament: sameDate[0] }
  return {
    kind: 'ambiguous',
    expectedName,
    message: `같은 이름의 리스타트 대회가 여러 개 있습니다. ('${expectedName}') 불필요한 대회를 정리한 뒤 다시 시도해 주세요.`,
  }
}
