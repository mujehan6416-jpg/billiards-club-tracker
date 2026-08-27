import { useState } from 'react'
import type { TournamentMatch } from '../../types/tournament'
import { matchMemberStatusMessage, rateDisplay } from './tournamentDisplay'

/**
 * 경기 1건 상세 화면. 대진표에서 경기를 누르면 이 패널이 열린다.
 *
 * 회원 화면(결과 입력 → 확인 → 수정 요청)과 관리자 화면(직권 확인 → 정정 → 최종 승인 →
 * 기권 처리)을 한 컴포넌트 안에서 뷰어 신원에 따라 나눈다 — 둘 다 "지금 이 경기가 어느
 * 상태인가"를 같은 기준으로 보고 판단해야 하므로 화면을 둘로 쪼개면 오히려 어긋나기 쉽다.
 *
 * 실제 승인·거부 판정은 전부 상위(TournamentTab)가 logic/tournamentMatch.ts를 통해서만
 * 한다 — 이 컴포넌트는 판정하지 않고, 사용자가 고른 입력을 그대로 콜백에 넘기기만 한다.
 */
export function TournamentMatchPanel({
  match, nameOf, viewerMemberId, isAdmin, busy, error,
  onClose, onSubmitResult, onVerify, onRequestCorrection,
  onAdminVerify, onAdminCorrect, onApprove, onForfeit,
}: {
  match: TournamentMatch
  nameOf: (participantId: string | null) => string
  /** 로그인한 회원(없으면 손님/미로그인). */
  viewerMemberId?: string
  isAdmin: boolean
  busy?: boolean
  error?: string
  onClose: () => void
  onSubmitResult: (scoreA: number | string, scoreB: number | string) => void
  onVerify: () => void
  onRequestCorrection: () => void
  onAdminVerify: () => void
  onAdminCorrect: (scoreA: number | string, scoreB: number | string) => void
  onApprove: (officialWinnerParticipantId?: string) => void
  onForfeit: (winnerParticipantId: string) => void
}) {
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [correctA, setCorrectA] = useState('')
  const [correctB, setCorrectB] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [tieWinnerId, setTieWinnerId] = useState<string | null>(null)

  const nameA = nameOf(match.playerAParticipantId)
  const nameB = nameOf(match.playerBParticipantId)
  const isPlayer = !!viewerMemberId && (viewerMemberId === match.playerAMemberId || viewerMemberId === match.playerBMemberId)
  const isSubmitter = !!viewerMemberId && viewerMemberId === match.resultLog?.submittedByMemberId
  const correctionRequested = !!match.resultLog?.correctionRequested
  const isTie = match.status === 'awaitingApproval' && match.calculatedWinnerParticipantId === null
    && match.scoreA !== null && match.scoreB !== null

  return (
    <div className="card col-card" style={{ gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>경기 상세</span>
        <button type="button" onClick={onClose} style={{ fontSize: 13 }}>닫기</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{nameA}</span>
        <span className="vs">vs</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{nameB}</span>
      </div>

      {error && <p className="info-msg">{error}</p>}

      {match.status === 'official' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {match.resultType === 'forfeit' && <span style={{ fontSize: 13, fontWeight: 600 }}>기권승으로 확정되었습니다.</span>}
          {match.scoreA !== null && match.playerAHandicapSnapshot !== null && (
            <span style={{ fontSize: 14 }}>{nameA} {rateDisplay(match.scoreA, match.playerAHandicapSnapshot)}</span>
          )}
          {match.scoreB !== null && match.playerBHandicapSnapshot !== null && (
            <span style={{ fontSize: 14 }}>{nameB} {rateDisplay(match.scoreB, match.playerBHandicapSnapshot)}</span>
          )}
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>
            ✅ 공식 결과 · 승자: {nameOf(match.officialWinnerParticipantId ?? null)}
          </span>
        </div>
      ) : (
        <>
          {!isAdmin && (
            <span className="muted" style={{ fontSize: 14 }}>{matchMemberStatusMessage(match, viewerMemberId)}</span>
          )}

          {/* ── 회원: 결과 입력 ── */}
          {isPlayer && match.status === 'awaitingResult' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
                {nameA} 점수
                <input
                  type="number" inputMode="numeric" value={scoreA}
                  onChange={(e) => setScoreA(e.target.value)}
                  style={{ fontSize: 20, padding: 12, textAlign: 'center' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
                {nameB} 점수
                <input
                  type="number" inputMode="numeric" value={scoreB}
                  onChange={(e) => setScoreB(e.target.value)}
                  style={{ fontSize: 20, padding: 12, textAlign: 'center' }}
                />
              </label>
              <button
                className="primary block" style={{ fontSize: 16, padding: 14 }}
                disabled={busy || scoreA === '' || scoreB === ''}
                onClick={() => onSubmitResult(scoreA, scoreB)}
              >
                결과 입력
              </button>
            </div>
          )}

          {/* ── 회원: 상대 확인/수정 요청 ── */}
          {isPlayer && !isSubmitter && match.status === 'awaitingVerification' && !correctionRequested && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {match.scoreA !== null && match.playerAHandicapSnapshot !== null && (
                <span style={{ fontSize: 14 }}>{nameA} {rateDisplay(match.scoreA, match.playerAHandicapSnapshot)}</span>
              )}
              {match.scoreB !== null && match.playerBHandicapSnapshot !== null && (
                <span style={{ fontSize: 14 }}>{nameB} {rateDisplay(match.scoreB, match.playerBHandicapSnapshot)}</span>
              )}
              <button className="primary block" style={{ fontSize: 16, padding: 14 }} disabled={busy} onClick={onVerify}>
                결과가 맞습니다
              </button>
              <button className="block" style={{ fontSize: 14 }} disabled={busy} onClick={onRequestCorrection}>
                결과가 다릅니다 (수정 요청)
              </button>
            </div>
          )}

          {/* ── 관리자 ── */}
          {isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {match.scoreA !== null && match.playerAHandicapSnapshot !== null && (
                <span style={{ fontSize: 14 }}>{nameA} {rateDisplay(match.scoreA, match.playerAHandicapSnapshot)}</span>
              )}
              {match.scoreB !== null && match.playerBHandicapSnapshot !== null && (
                <span style={{ fontSize: 14 }}>{nameB} {rateDisplay(match.scoreB, match.playerBHandicapSnapshot)}</span>
              )}

              {correctionRequested && (
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700 }}>
                  ⚠ 상대가 결과 수정을 요청했습니다. 점수를 확인하고 정정해 주세요.
                </span>
              )}

              {match.status === 'awaitingVerification' && !correctionRequested && (
                <button
                  className="block" style={{ fontSize: 14 }} disabled={busy}
                  onClick={() => { if (window.confirm('회원 확인 없이 관리자가 직접 이 결과를 확인 처리하시겠습니까?')) onAdminVerify() }}
                >
                  관리자 직권 확인
                </button>
              )}

              {(correcting || correctionRequested) && match.status !== 'awaitingResult' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
                    {nameA} 점수(정정)
                    <input type="number" inputMode="numeric" value={correctA} onChange={(e) => setCorrectA(e.target.value)} style={{ fontSize: 18, padding: 10, textAlign: 'center' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
                    {nameB} 점수(정정)
                    <input type="number" inputMode="numeric" value={correctB} onChange={(e) => setCorrectB(e.target.value)} style={{ fontSize: 18, padding: 10, textAlign: 'center' }} />
                  </label>
                  <button
                    className="primary block" style={{ fontSize: 15, padding: 12 }}
                    disabled={busy || correctA === '' || correctB === ''}
                    onClick={() => { onAdminCorrect(correctA, correctB); setCorrecting(false) }}
                  >
                    정정 내용 저장
                  </button>
                </div>
              ) : match.status !== 'awaitingResult' && (
                <button className="block" style={{ fontSize: 13 }} disabled={busy} onClick={() => setCorrecting(true)}>
                  점수 정정
                </button>
              )}

              {match.status === 'awaitingApproval' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {isTie && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700 }}>
                        두 선수의 달성률이 같습니다. 승자를 직접 골라 주세요.
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className={tieWinnerId === match.playerAParticipantId ? 'primary grow' : 'grow'}
                          onClick={() => setTieWinnerId(match.playerAParticipantId)}
                        >
                          {nameA} 승리
                        </button>
                        <button
                          className={tieWinnerId === match.playerBParticipantId ? 'primary grow' : 'grow'}
                          onClick={() => setTieWinnerId(match.playerBParticipantId)}
                        >
                          {nameB} 승리
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    className="primary block" style={{ fontSize: 16, padding: 14 }}
                    disabled={busy || (isTie && !tieWinnerId)}
                    onClick={() => {
                      if (window.confirm('이 경기 결과를 공식 확정하고 승자를 다음 라운드에 반영하시겠습니까?')) {
                        onApprove(tieWinnerId ?? undefined)
                      }
                    }}
                  >
                    최종 승인
                  </button>
                </div>
              )}

              {match.playerAParticipantId && match.playerBParticipantId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <span className="muted" style={{ fontSize: 12 }}>한쪽이 나오지 못했을 때만 사용하세요.</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="grow" style={{ fontSize: 13 }} disabled={busy}
                      onClick={() => {
                        if (window.confirm(`${nameA} 회원을 기권 처리하고 ${nameB} 회원을 승자로 확정하시겠습니까?`)) {
                          onForfeit(match.playerBParticipantId!)
                        }
                      }}
                    >
                      {nameA} 기권 처리
                    </button>
                    <button
                      className="grow" style={{ fontSize: 13 }} disabled={busy}
                      onClick={() => {
                        if (window.confirm(`${nameB} 회원을 기권 처리하고 ${nameA} 회원을 승자로 확정하시겠습니까?`)) {
                          onForfeit(match.playerAParticipantId!)
                        }
                      }}
                    >
                      {nameB} 기권 처리
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
