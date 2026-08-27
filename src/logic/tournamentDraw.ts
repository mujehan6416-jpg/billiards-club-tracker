import type { Member } from '../types'
import type {
  TournamentDrawEntry, TournamentDrawMapping, TournamentEntryStatus, TournamentParticipant,
  TournamentResult, TournamentSeat,
} from '../types/tournament'
import { calculateBracketSize, generateByeSlots, shuffleWithRng } from './tournamentBracket'

// 오프라인 번호 추첨을 대진에 반영하는 순수 로직.
//
// 이 앱은 번호 추첨을 하지 않는다 — 추첨은 대회 현장에서 종이 제비 등으로 직접 하고,
// 관리자가 그 결과(참가자별 번호)를 나중에 앱에 입력한다. 그래서 여기에는 번호 선점·
// 동시 선택 같은 온라인 추첨용 처리가 없다.
//
// 핵심은 "참가자가 보는 번호"와 "실제 대진 자리"를 떼어 놓는 것이다.
//
//   추첨번호(1..참가자수)  →  numberToSlot (관리자 전용)  →  실제 슬롯(1..bracketSize)
//
// 이렇게 해야 현장에서 2번을 뽑은 사람이 그 번호가 어느 자리로 가는지, 부전승과 이어지는지
// 알 수 없다. 그래서 TournamentDrawMapping은 회원에게 공개되는 어떤 문서에도 넣지 않는다
// (향후 저장 위치: clubs/{clubId}/tournaments/{tournamentId}/private/draw — 관리자 전용).

/**
 * 회원 한 명을 이 대회의 참가자로 만든다 — 이름과 기본 핸디를 **그 시점 값으로 복사**한다.
 *
 * 회원 원본을 참조만 하면 관리자가 회원을 개명·삭제했을 때 과거 대회 기록이 무너진다
 * (lib/splitFirestore.ts의 syncSplitChanges는 삭제된 회원의 서버 문서까지 지운다).
 * 대회 적용 핸디는 따로 정하지 않으면 참가 시점의 기본 핸디로 시작하고, 대회 시작 전까지
 * 관리자가 조정할 수 있다.
 */
export function createTournamentParticipant(
  member: Pick<Member, 'id' | 'name' | 'handicap'>,
  input: { participantId: string; tournamentHandicap?: number; entryStatus?: TournamentEntryStatus },
): TournamentParticipant {
  return {
    id: input.participantId,
    memberId: member.id,
    displayNameSnapshot: member.name,
    baseHandicapSnapshot: member.handicap,
    tournamentHandicap: input.tournamentHandicap ?? member.handicap,
    entryStatus: input.entryStatus ?? 'noResponse',
  }
}

/**
 * 대회 규모·부전승 자리·번호↔슬롯 매핑을 한 번에 만든다. **번호 추첨 전에** 실행한다.
 *
 * 참가자 정보를 인자로 받지 않는다 — 참가 인원 수만 있으면 되고, 그래야 특정 회원에게
 * 유리한 배치가 구조적으로 불가능하다.
 *
 * rng를 주입할 수 있어 테스트에서는 항상 같은 결과가 나온다.
 */
export function createDrawMapping(
  participantCount: number,
  rng: () => number = Math.random,
): TournamentResult<TournamentDrawMapping> {
  const size = calculateBracketSize(participantCount)
  if (!size.ok) return size
  const { bracketSize, byeCount } = size.value

  const byes = generateByeSlots(bracketSize, byeCount, rng)
  if (!byes.ok) return byes
  const byeSlots = byes.value

  const byeSet = new Set(byeSlots)
  const openSlots = Array.from({ length: bracketSize }, (_, i) => i + 1).filter((s) => !byeSet.has(s))
  if (openSlots.length !== participantCount) {
    return { ok: false, message: '빈 자리 수와 참가 인원이 맞지 않습니다.' }
  }

  const assigned = shuffleWithRng(openSlots, rng)
  const numberToSlot: Record<number, number> = {}
  for (let drawNumber = 1; drawNumber <= participantCount; drawNumber++) {
    numberToSlot[drawNumber] = assigned[drawNumber - 1]
  }

  return { ok: true, value: { bracketSize, numberToSlot, byeSlots } }
}

/**
 * 관리자가 입력한 추첨 결과를 검증한다.
 *
 * 하나라도 어긋나면 **전체를 실패로 돌려준다** — 일부만 반영하면 대진이 반쯤 만들어진 채
 * 남아서 무엇이 맞는지 알 수 없게 된다. 순수 함수라 실패 시 아무것도 바뀌지 않는다.
 *
 * 번호 범위는 1..참가자수다(대진 규모가 아니다) — 참가자끼리만 번호를 나눠 갖고,
 * 남는 자리는 부전승이 되기 때문이다.
 */
export function validateDrawEntries(
  participantIds: string[],
  entries: TournamentDrawEntry[],
): TournamentResult<TournamentDrawEntry[]> {
  const participantCount = participantIds.length
  if (participantCount < 2) {
    return { ok: false, message: '대회를 만들려면 참가자가 2명 이상이어야 합니다.' }
  }

  const validIds = new Set(participantIds)
  const seenParticipants = new Set<string>()
  const seenNumbers = new Set<number>()

  for (const entry of entries) {
    if (!validIds.has(entry.participantId)) {
      return { ok: false, message: '이 대회의 참가자가 아닌 사람이 들어 있습니다.' }
    }
    if (seenParticipants.has(entry.participantId)) {
      return { ok: false, message: '같은 참가자에게 번호가 두 번 배정되었습니다.' }
    }
    if (!Number.isInteger(entry.drawNumber)) {
      return { ok: false, message: '추첨번호는 정수여야 합니다.' }
    }
    if (entry.drawNumber < 1 || entry.drawNumber > participantCount) {
      return { ok: false, message: `추첨번호는 1번부터 ${participantCount}번까지만 쓸 수 있습니다.` }
    }
    if (seenNumbers.has(entry.drawNumber)) {
      return { ok: false, message: `${entry.drawNumber}번을 두 사람이 함께 가지고 있습니다.` }
    }
    seenParticipants.add(entry.participantId)
    seenNumbers.add(entry.drawNumber)
  }

  if (seenParticipants.size !== participantCount) {
    const missing = participantCount - seenParticipants.size
    return { ok: false, message: `아직 번호를 받지 못한 참가자가 ${missing}명 있습니다.` }
  }

  return { ok: true, value: entries.map((e) => ({ ...e })) }
}

/** 추첨번호 하나를 실제 대진 자리로 바꾼다. 매핑에 없는 번호면 null. */
export function resolveSlotNumber(mapping: TournamentDrawMapping, drawNumber: number): number | null {
  return mapping.numberToSlot[drawNumber] ?? null
}

/**
 * 검증을 통과한 추첨 결과 + 비공개 매핑 → 대진에 그대로 넣을 수 있는 좌석 배정.
 *
 * 이때 참가자의 tournamentHandicap을 좌석에 복사한다. 이 값이 경기의 핸디 스냅샷이 되므로,
 * 나중에 참가자의 tournamentHandicap이나 회원 기본 핸디가 바뀌어도 이미 만들어진 경기의
 * 계산 결과는 달라지지 않는다.
 */
export function buildSeatsFromDraw(
  participants: TournamentParticipant[],
  entries: TournamentDrawEntry[],
  mapping: TournamentDrawMapping,
): TournamentResult<TournamentSeat[]> {
  const checked = validateDrawEntries(participants.map((p) => p.id), entries)
  if (!checked.ok) return checked

  const byId = new Map(participants.map((p) => [p.id, p]))
  const seats: TournamentSeat[] = []

  for (const entry of checked.value) {
    const participant = byId.get(entry.participantId)!
    const slotNumber = resolveSlotNumber(mapping, entry.drawNumber)
    if (slotNumber === null) {
      return { ok: false, message: `${entry.drawNumber}번에 해당하는 대진 자리가 없습니다.` }
    }
    if (!Number.isFinite(participant.tournamentHandicap) || participant.tournamentHandicap < 1) {
      return { ok: false, message: '대회 적용 핸디는 1 이상이어야 합니다.' }
    }
    seats.push({
      participantId: participant.id,
      memberId: participant.memberId,
      handicap: participant.tournamentHandicap,
      slotNumber,
    })
  }

  return { ok: true, value: seats }
}
