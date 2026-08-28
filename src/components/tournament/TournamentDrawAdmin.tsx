import { useState } from 'react'
import type { Tournament, TournamentDrawEntry, TournamentMatch, TournamentParticipant } from '../../types/tournament'
import { validateDrawEntries } from '../../logic/tournamentDraw'
import { TournamentBracketView } from './TournamentBracketView'

/**
 * 관리자 전용 — 추첨 준비 → 오프라인 추첨번호 입력 → 대진표 미리보기 → 대진 확정,
 * 그리고 참가자 확정 취소 · 대진 확정 취소.
 *
 * ⚠ 번호↔실제 자리 매핑(TournamentDrawMapping)은 이 컴포넌트에 인자로 들어오지 않는다.
 * "번호 범위 1~N"까지만 화면에 보여주면 되고, 실제 매핑은 부모(TournamentTab)가 대진표
 * 미리보기를 계산할 때만 잠깐 불러 써서 TournamentMatch[]로 바꾼 뒤 버린다 — 그래서 이
 * 컴포넌트도, 여기서 렌더링하는 TournamentBracketView도 raw mapping을 가질 방법이 없다.
 */
export function TournamentDrawAdmin({
  tournament, enteredParticipants, matches, nameOf, busy,
  onPrepareDraw, onSaveDrawNumbers, onBuildPreview, onConfirmBracket,
  onReopenEntries, onCancelBracket,
}: {
  tournament: Tournament
  /** entryStatus === 'entered'인 참가자만. drawNumber가 있으면 이미 저장된 상태다. */
  enteredParticipants: TournamentParticipant[]
  /**
   * drawReady일 때는 "대진표 확인"을 눌러 계산한 미리보기(아직 저장 전), bracketFixed일 때는
   * 서버에서 읽어온 확정 대진. 아직 아무것도 계산/확정되지 않았으면 null.
   */
  matches: TournamentMatch[] | null
  nameOf: (participantId: string | null) => string
  busy?: boolean
  onPrepareDraw: () => void
  onSaveDrawNumbers: (entries: TournamentDrawEntry[]) => void
  onBuildPreview: () => void
  onConfirmBracket: () => void
  onReopenEntries: () => void
  onCancelBracket: () => void
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})

  const status = tournament.status
  const participantCount = enteredParticipants.length

  const reopenEntries = () => {
    if (window.confirm('참가자 확정을 취소하면 회원이 다시 참가/불참을 바꿀 수 있고, 지금까지 입력한 추첨번호는 모두 사라집니다.\n계속할까요?')) {
      onReopenEntries()
    }
  }

  // ── entryClosed: 아직 추첨 준비 전 ──
  if (status === 'entryClosed') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>추첨 및 대진 준비</span>
        <span className="muted" style={{ fontSize: 13 }}>참가자 {participantCount}명이 확정되었습니다.</span>
        <button className="primary block" style={{ fontSize: 16, padding: 14 }} disabled={busy} onClick={onPrepareDraw}>
          추첨 준비
        </button>
        <button className="block" style={{ fontSize: 14 }} disabled={busy} onClick={reopenEntries}>
          참가자 확정 취소
        </button>
      </div>
    )
  }

  // ── drawReady: 번호 입력 중이거나 미리보기 단계 ──
  if (status === 'drawReady') {
    if (matches) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TournamentBracketView matches={matches} nameOf={nameOf} isPreview />
          <div className="card col-card">
            <button
              className="primary block" style={{ fontSize: 16, padding: 14 }} disabled={busy}
              onClick={() => {
                if (window.confirm(
                  '대진을 확정하면 참가자별 번호를 개별 수정할 수 없습니다.\n잘못된 경우 대진 전체를 취소하고 다시 진행해야 합니다.\n확정하시겠습니까?',
                )) {
                  onConfirmBracket()
                }
              }}
            >
              대진 확정
            </button>
            <button className="block" style={{ fontSize: 14 }} disabled={busy} onClick={reopenEntries}>
              참가자 확정 취소
            </button>
          </div>
        </div>
      )
    }

    const allSaved = enteredParticipants.every((p) => p.drawNumber !== undefined)

    // ⚠ 버그 수정: 예전에는 이 화면에 새로 입력한 값(inputs)만으로 entries를 만들었다.
    // 그래서 일부 참가자가 이전 세션(또는 새로고침 전)에 이미 번호를 저장해 둔 상태로
    // 이 화면을 다시 열면 — 화면에는(아래 124번째 줄과 같은 fallback으로) 기존 번호가
    // 정상적으로 보이는데도 — 그 참가자는 entries에 아예 들어가지 않아 "번호 저장"
    // 버튼이 영원히 비활성 상태로 남았다(전부 다시 타이핑해야만 저장이 가능했다).
    // 화면에 보이는 값과 저장 대상을 항상 같은 fallback 규칙으로 맞춘다.
    const entries: TournamentDrawEntry[] = enteredParticipants
      .map((p) => {
        const raw = inputs[p.id] ?? (p.drawNumber !== undefined ? String(p.drawNumber) : undefined)
        if (raw === undefined) return null
        const drawNumber = parseInt(raw, 10)
        return Number.isInteger(drawNumber) ? { participantId: p.id, drawNumber } : null
      })
      .filter((e): e is TournamentDrawEntry => e !== null)

    // 즉시 안내용 — 아직 다 채우지 않았어도 "지금까지 입력된 것" 안에서 중복만 가볍게 찾는다.
    // (완전한 검증은 아래 validateDrawEntries가 전부 채워졌을 때만 한다.)
    const duplicateNumbers = new Set<number>()
    {
      const seen = new Set<number>()
      for (const e of entries) {
        if (seen.has(e.drawNumber)) duplicateNumbers.add(e.drawNumber)
        seen.add(e.drawNumber)
      }
    }

    const isComplete = entries.length === enteredParticipants.length
    const checked = isComplete ? validateDrawEntries(enteredParticipants.map((p) => p.id), entries) : null
    const canSave = checked?.ok === true

    const filledCount = enteredParticipants.filter((p) => inputs[p.id]?.trim() || p.drawNumber !== undefined).length

    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>오프라인 추첨번호 입력</span>
        <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          현장에서 나눠 준 번호표(1번~{participantCount}번)를 참가자별로 입력해 주세요.
        </span>
        <span className="muted" style={{ fontSize: 13 }}>입력 완료 {filledCount} / {participantCount}명</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {enteredParticipants.map((p) => {
            const value = inputs[p.id] ?? (p.drawNumber !== undefined ? String(p.drawNumber) : '')
            const num = parseInt(value, 10)
            const isDuplicate = Number.isInteger(num) && duplicateNumbers.has(num)
            const isOutOfRange = Number.isInteger(num) && (num < 1 || num > participantCount)
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {p.displayNameSnapshot}
                </span>
                <input
                  type="number" min={1} max={participantCount} inputMode="numeric"
                  aria-label={`${p.displayNameSnapshot} 추첨번호`}
                  value={value}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                  style={{
                    width: 64, fontSize: 18, textAlign: 'center',
                    borderColor: isDuplicate || isOutOfRange ? 'var(--danger)' : undefined,
                  }}
                />
              </div>
            )
          })}
        </div>

        {duplicateNumbers.size > 0 && (
          <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
            {[...duplicateNumbers].sort((a, b) => a - b).join(', ')}번은 이미 사용된 번호입니다.
          </span>
        )}
        {isComplete && checked && !checked.ok && duplicateNumbers.size === 0 && (
          <span style={{ fontSize: 13, color: 'var(--danger)' }}>{checked.message}</span>
        )}
        {allSaved && (
          <span style={{ fontSize: 13, color: '#0f6e56', fontWeight: 600 }}>✅ 번호 입력이 저장되었습니다.</span>
        )}

        <button
          className="primary block" style={{ fontSize: 16, padding: 14 }}
          disabled={busy || !canSave}
          onClick={() => onSaveDrawNumbers(entries)}
        >
          번호 저장
        </button>

        {allSaved && (
          <button className="block" style={{ fontSize: 16, padding: 14 }} disabled={busy} onClick={onBuildPreview}>
            대진표 확인
          </button>
        )}

        <button className="block" style={{ fontSize: 14 }} disabled={busy} onClick={reopenEntries}>
          참가자 확정 취소
        </button>
      </div>
    )
  }

  // ── bracketFixed 이후: 대진 자체는 TournamentTab이 공통 화면(TournamentBracketView)으로
  // 회원과 함께 보여주므로 여기서는 취소 버튼만 둔다(같은 대진표를 두 번 그리지 않는다). ──
  if (status === 'bracketFixed') {
    return (
      <div className="card col-card">
        <span className="muted" style={{ fontSize: 13 }}>대진이 확정되어 회원에게 공개되었습니다.</span>
        <button
          className="danger block" style={{ fontSize: 14 }} disabled={busy}
          onClick={() => {
            if (window.confirm(
              '대진 확정을 취소하면 지금까지의 대진·추첨 정보가 모두 사라지고 처음부터 다시 진행해야 합니다.\n계속할까요?',
            )) {
              onCancelBracket()
            }
          }}
        >
          대진 확정 취소
        </button>
      </div>
    )
  }

  return null
}
