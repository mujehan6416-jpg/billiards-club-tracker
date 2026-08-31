import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { AdminAuthLogin } from './AdminAuthLogin'
import { fetchTournaments } from '../../lib/tournamentSync'
import { buildApr18ImportPlan, evaluateApplyEligibility } from '../../lib/tournamentApr18Import'
import type { Apr18ApplyResult, Apr18ImportPlan, Apr18ImportSpec } from '../../lib/tournamentApr18Import'
import { applyApr18ImportLive } from '../../lib/tournamentApr18ApplyFirestore'
import type { AppState } from '../../types'

const APPLY_CONFIRM_PHRASE = '2026-04-18 대회 적용'

/**
 * 관리자 전용 "2026-04-18 과거 대회 가져오기" 카드 (설정 탭, 관리자 로그인 시에만 보인다).
 *
 * 이번 두 대회(제2회 회장배 당구대회 / 챌린전)의 실제 선수명·점수는 이 파일에 전혀 없다.
 * 관리자가 로컬 컴퓨터에만 있는 JSON 파일을 화면에서 직접 선택해서 불러온다. 그래서
 * 실명·점수가 배포되는 JS 번들에 들어가지 않는다.
 *
 * "실제 적용" 버튼은 evaluateApplyEligibility()가 요구하는 모든 조건(회원 매핑 14/14,
 * 대회·경기 중복 0, 목표 경기 수 23·부전진출 3, 관리자 인증)을 만족할 때만 활성화되고,
 * 누르면 즉시 쓰지 않고 확인 문구를 정확히 입력해야 실행된다(기존 MemberIndexBackfillCard와
 * 같은 패턴). 실행 시점에도 applyApr18Import()가 서버 상태를 다시 읽어 한 번 더 확인한다.
 */
export function TournamentApr18ImportCard() {
  const status = useAdminAuthStore((s) => s.status)
  const adminUid = useAdminAuthStore((s) => s.uid)

  const [spec, setSpec] = useState<Apr18ImportSpec | null>(null)
  const [fileError, setFileError] = useState('')
  const [plan, setPlan] = useState<Apr18ImportPlan | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [applyResult, setApplyResult] = useState<Apr18ApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  if (status !== 'authorizedAdmin') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>🗄 2026-04-18 과거 대회 가져오기</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>
          이 기능을 쓰려면 관리자 로그인이 필요합니다.
        </span>
        <AdminAuthLogin />
      </div>
    )
  }

  const onSelectFile = async (file: File | undefined) => {
    setFileError(''); setPlan(null); setMessage(''); setApplyResult(null); setConfirmText('')
    if (!file) { setSpec(null); return }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Apr18ImportSpec
      if (!parsed.participants || !parsed.regular || !parsed.challenger) {
        throw new Error('shape')
      }
      setSpec(parsed)
    } catch {
      setSpec(null)
      setFileError('파일을 읽지 못했습니다. 정기대회·챌린전 대진 데이터가 담긴 JSON 파일인지 확인해 주세요.')
    }
  }

  // 미리보기(dry-run) — 서버에 아무것도 쓰지 않는다. 회원 목록·모임 기록은 이미 로그인 시
  // 불러온 로컬 상태를 그대로 쓰고, 대회 중복 검사만 지금 서버에서 읽어 온다(읽기 전용).
  const onPreview = async () => {
    if (!spec) return
    setBusy(true); setMessage(''); setPlan(null); setApplyResult(null); setConfirmText('')
    try {
      const state = useApp.getState() as unknown as AppState
      const existingTournaments = await fetchTournaments()
      const result = buildApr18ImportPlan(spec, {
        members: state.members,
        existingSessions: state.sessions,
        existingTournaments,
      })
      setPlan(result)
      setMessage(
        result.ok
          ? '검증을 통과했습니다. 아래 결과를 확인해 주세요. (서버에는 아직 아무것도 저장하지 않았습니다.)'
          : '검증에서 문제를 발견했습니다. 아래 목록을 확인해 주세요. (서버에는 아무것도 저장하지 않았습니다.)',
      )
    } catch {
      setFileError('중복 검사를 위한 대회 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const eligibility = plan ? evaluateApplyEligibility(plan, status === 'authorizedAdmin') : null
  const canApply = !!eligibility?.eligible && confirmText === APPLY_CONFIRM_PHRASE && !busy && !applyResult?.ok

  const onApply = async () => {
    if (!plan || !eligibility?.eligible || !adminUid) return
    if (!window.confirm(
      `실제 운영 데이터에\n대회 2개와 실제 경기 ${plan.totalActualGameCount}건을 추가합니다.\n`
      + `부전진출 ${plan.totalByeCount}건은 대진표에만 표시되고\n회원 경기 실적에는 포함되지 않습니다.\n\n계속할까요?`,
    )) return

    setBusy(true); setMessage(''); setApplyResult(null)
    try {
      const result = await applyApr18ImportLive(spec!, adminUid)
      setApplyResult(result)
      if (result.ok) {
        setConfirmText('')
        setMessage(`적용을 완료했습니다. (대회 ${result.summary?.tournaments}개, 실제 경기 ${result.summary?.actualGames}건, 부전진출 ${result.summary?.byeAdvances}건)`)
      } else {
        setFileError(result.message)
      }
    } catch {
      setFileError('적용 중 오류가 발생했습니다. 운영 데이터가 바뀌지 않았을 수 있으니, 검증 미리보기부터 다시 확인해 주세요.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🗄 2026-04-18 과거 대회 가져오기</span>
      <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        제2회 회장배 당구대회·챌린전의 과거 대진 데이터를 정식 대회·경기 기록으로 등록합니다.
        선수명·점수 원본은 이 화면에서 직접 선택하는 로컬 JSON 파일에만 있고, 앱에는 저장되어
        배포되지 않습니다.
      </span>

      {/* ① 데이터 파일 선택 */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>① 대진 데이터 파일 선택</div>
        <input
          ref={fileInputRef}
          type="file" accept="application/json"
          style={{ marginTop: 8 }}
          onChange={(e) => void onSelectFile(e.target.files?.[0])}
        />
        {spec && <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 6 }}>파일을 불러왔습니다.</span>}
      </div>

      {/* ② 미리보기(dry-run) */}
      {spec && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>② 검증 미리보기 (dry-run — 저장하지 않음)</div>
          <button className="primary block" style={{ marginTop: 8 }} disabled={busy} onClick={() => void onPreview()}>
            {busy ? '확인 중...' : '검증 미리보기 실행'}
          </button>
        </div>
      )}

      {plan && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>미리보기 결과</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>회원 이름 매핑</span>
            <span style={{ fontWeight: 600 }}>{plan.mapping.mappedCount} / {plan.mapping.totalCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>대회(정기대회 + 챌린전)</span>
            <span style={{ fontWeight: 600 }}>{plan.totalTournamentCount}개</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>실제 경기(정기대회 {plan.regular.actualGameCount} + 챌린전 {plan.challenger.actualGameCount})</span>
            <span style={{ fontWeight: 600 }}>{plan.totalActualGameCount}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>부전승/부전진출(경기 실적 미포함)</span>
            <span style={{ fontWeight: 600 }}>{plan.totalByeCount}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>검사 결과</span>
            <span style={{ fontWeight: 600, color: plan.ok ? 'var(--green-dark)' : '#c0392b' }}>
              {plan.ok ? '통과 — 적용 가능한 상태' : '문제 있음 — 적용 불가'}
            </span>
          </div>

          {plan.issues.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {plan.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {issue}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ③ 실제 적용 — 아래 조건을 모두 만족해야만 버튼이 켜진다. 누르면 즉시 쓰지 않고
          브라우저 확인 + 확인 문구 입력을 모두 거쳐야 한다. 실행 시점에 서버 상태를 다시
          읽어 한 번 더 확인하므로, 여기서 눌러도 조건이 그새 깨졌으면 아무것도 쓰지 않는다. */}
      {plan && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>③ 실제 적용</div>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 4 }}>
            실제 운영 데이터에 대회 2개와 실제 경기 {plan.totalActualGameCount}건을 추가합니다.
            부전진출 {plan.totalByeCount}건은 대진표에만 표시되고 회원 경기 실적에는 포함되지 않습니다.
          </span>

          {eligibility && !eligibility.eligible && (
            <div style={{ marginTop: 8 }}>
              {eligibility.reasons.map((reason, i) => (
                <div key={i} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {reason}</div>
              ))}
            </div>
          )}

          {eligibility?.eligible && !applyResult?.ok && (
            <>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 8 }}>
                실행하려면 아래 칸에 <b>{APPLY_CONFIRM_PHRASE}</b> 라고 정확히 입력해 주세요.
              </span>
              <input
                type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder={APPLY_CONFIRM_PHRASE} aria-label="적용 확인 문구"
                style={{ width: '100%', marginTop: 6, fontSize: 15, padding: '10px 12px' }}
              />
            </>
          )}

          <button className="block" style={{ marginTop: 8 }} disabled={!canApply} onClick={() => void onApply()}>
            {busy ? '처리 중...' : applyResult?.ok ? '적용 완료됨' : '실제 적용'}
          </button>
        </div>
      )}

      {message && <span style={{ fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.5 }}>{message}</span>}
      {fileError && <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>{fileError}</span>}
    </div>
  )
}
