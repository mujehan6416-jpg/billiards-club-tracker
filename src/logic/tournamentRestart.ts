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
      return { selectable: false, reason: '참가자가 이미 확정된 대회입니다. 참가자 확정을 먼저 취소해야 추가할 수 있습니다.' }
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
