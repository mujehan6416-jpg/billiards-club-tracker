import { useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { exportCsv, exportJson, importJson } from '../lib/backup'
import { todayStr } from '../lib/date'

export function SettingsTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const replaceAll = useApp((s) => s.replaceAll)
  const touchBackup = useApp((s) => s.touchBackup)

  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')

  const onExportJson = () => {
    exportJson({ members, sessions, settings }, todayStr())
    touchBackup()
    setMsg('JSON 백업 파일을 내보냈습니다. 공유시트에서 드라이브에 저장하세요.')
  }

  const onExportCsv = () => {
    exportCsv(sessions, members, todayStr())
    touchBackup()
    setMsg('CSV 파일을 내보냈습니다. 구글 시트에서 바로 열 수 있습니다.')
  }

  const onImport = async (file: File) => {
    try {
      const state = await importJson(file)
      if (!confirm('현재 데이터를 백업 파일로 완전히 교체합니다. 진행할까요?')) return
      replaceAll(state)
      setMsg('백업을 복원했습니다.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '가져오기에 실패했습니다.')
    }
  }

  return (
    <div className="tab">
      <h2 className="tab-title">설정 · 백업</h2>

      <div className="card col-card">
        <span className="muted">
          마지막 백업: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ko-KR') : '없음'}
        </span>
        <button className="primary block" onClick={onExportJson}>
          JSON 백업 내보내기
        </button>
        <button className="block" onClick={onExportCsv}>
          CSV 내보내기 (구글 시트용)
        </button>
        <button className="block" onClick={() => fileRef.current?.click()}>
          백업 가져오기 (JSON)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
      </div>

      {msg && <p className="info-msg">{msg}</p>}

      <div className="card col-card">
        <span className="muted">데이터는 이 기기(브라우저)에만 저장됩니다. 정기적으로 백업하세요.</span>
        <button
          className="block danger"
          onClick={() => {
            if (confirm('모든 회원·경기 기록을 삭제합니다. 되돌릴 수 없습니다.')) {
              replaceAll({ members: [], sessions: [], settings: { lastBackupAt: null } })
              setMsg('전체 데이터를 초기화했습니다.')
            }
          }}
        >
          전체 초기화
        </button>
      </div>
    </div>
  )
}
