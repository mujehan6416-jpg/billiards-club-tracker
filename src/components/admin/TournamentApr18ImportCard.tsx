import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { AdminAuthLogin } from './AdminAuthLogin'
import { fetchTournaments } from '../../lib/tournamentSync'
import { buildApr18ImportPlan } from '../../lib/tournamentApr18Import'
import type { Apr18ImportPlan, Apr18ImportSpec } from '../../lib/tournamentApr18Import'
import type { AppState } from '../../types'

/**
 * 관리자 전용 "2026-04-18 과거 대회 가져오기" 카드 (설정 탭, 관리자 로그인 시에만 보인다).
 *
 * 이번 두 대회(제2회 회장배 당구대회 / 챌린전)의 실제 선수명·점수는 이 파일에 전혀 없다.
 * 관리자가 로컬 컴퓨터에만 있는 JSON 파일(scripts/ 아래 — .gitignore로 저장소에서 제외됨)을
 * 화면에서 직접 선택해서 불러온다. 그래서 실명·점수가 배포되는 JS 번들에 들어가지 않는다.
 *
 * ⚠ 이번 단계는 dry-run(미리보기·검증)까지만 한다. "실제 적용" 버튼은 있지만 항상 비활성화돼
 * 있고 어떤 Firestore 쓰기 함수와도 연결돼 있지 않다 — 다음 단계에서 사용자 승인을 받은 뒤에만
 * 연결한다.
 */
export function TournamentApr18ImportCard() {
  const status = useAdminAuthStore((s) => s.status)

  const [spec, setSpec] = useState<Apr18ImportSpec | null>(null)
  const [fileError, setFileError] = useState('')
  const [plan, setPlan] = useState<Apr18ImportPlan | null>(null)
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
    setFileError(''); setPlan(null); setMessage('')
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
    setBusy(true); setMessage(''); setPlan(null)
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

      {/* ③ 실제 적용 — 이번 단계에서는 항상 비활성화. 어떤 Firestore 쓰기 함수와도 연결돼 있지 않다. */}
      {plan?.ok && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>③ 실제 적용</div>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 4 }}>
            실제 운영 데이터에 대회 2개와 실제 경기 {plan.totalActualGameCount}건을 추가합니다.
            부전진출 {plan.totalByeCount}건은 경기 실적에 포함되지 않습니다.
          </span>
          <button className="block" style={{ marginTop: 8 }} disabled title="다음 단계에서 사용자 승인 후 연결됩니다.">
            실제 적용 (이번 단계에서는 비활성화됨)
          </button>
        </div>
      )}

      {message && <span style={{ fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.5 }}>{message}</span>}
      {fileError && <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>{fileError}</span>}
    </div>
  )
}
