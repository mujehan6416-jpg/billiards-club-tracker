import { useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { exportCsv, exportHandicapCsv, exportJson, importHandicapCsv, importJson } from '../lib/backup'
import { uploadToCloud, downloadFromCloud } from '../lib/cloudSync'
import { todayStr } from '../lib/date'

export function SettingsTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const replaceAll = useApp((s) => s.replaceAll)
  const applyHandicapCsv = useApp((s) => s.applyHandicapCsv)
  const touchBackup = useApp((s) => s.touchBackup)

  const fileRef = useRef<HTMLInputElement>(null)
  const hcapFileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [syncing, setSyncing] = useState(false)

  const onExportJson = () => {
    exportJson({ members, sessions, settings }, todayStr())
    touchBackup()
    setMsg('JSON 백업 파일을 다운로드했습니다.')
  }

  const onExportCsv = () => {
    exportCsv(sessions, members, todayStr())
    touchBackup()
    setMsg('CSV 파일을 다운로드했습니다.')
  }

  const onExportHandicapCsv = () => {
    exportHandicapCsv(members, todayStr())
    setMsg('핸디 이력 CSV를 다운로드했습니다.')
  }

  const onImport = async (file: File) => {
    try {
      const state = await importJson(file)
      if (!confirm('현재 데이터를 백업 파일로 전체 교체합니다. 계속할까요?')) return
      replaceAll(state)
      setMsg('백업을 복원했습니다.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '불러오기에 실패했습니다.')
    }
  }

  const onImportHandicap = async (file: File) => {
    try {
      const rows = await importHandicapCsv(file)
      const unknownNames = rows
        .map((r) => r.name)
        .filter((n, i, a) => a.indexOf(n) === i)
        .filter((n) => !members.some((m) => m.name === n))
      let confirmMsg = `${rows.length}개 행을 불러옵니다.`
      if (unknownNames.length > 0) {
        confirmMsg += `\n\n※ 등록된 회원이 없어 무시되는 이름: ${unknownNames.join(', ')}`
      }
      if (!confirm(confirmMsg + '\n\n계속할까요?')) return
      applyHandicapCsv(rows)
      setMsg(`핸디 이력 ${rows.length}개 행을 반영했습니다.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일 처리에 실패했습니다.')
    }
  }

  const onUploadCloud = async () => {
    if (!confirm('현재 데이터를 클라우드에 저장합니다. 계속할까요?')) return
    setSyncing(true)
    try {
      await uploadToCloud({ members, sessions, settings })
      setMsg('클라우드에 저장했습니다.')
    } catch (e) {
      setMsg('클라우드 저장 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSyncing(false)
    }
  }

  const onDownloadCloud = async () => {
    if (!confirm('클라우드 데이터를 불러옵니다. 현재 데이터가 교체됩니다. 계속할까요?')) return
    setSyncing(true)
    try {
      const state = await downloadFromCloud()
      if (!state) { setMsg('클라우드에 저장된 데이터가 없습니다.'); return }
      replaceAll(state)
      setMsg('클라우드에서 불러왔습니다.')
    } catch (e) {
      setMsg('클라우드 불러오기 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="tab">
      <h2 className="tab-title">설정 · 백업</h2>

      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>☁️ 클라우드 동기화</span>
        <span className="muted">PC와 휴대폰 간 데이터를 맞출 때 사용하세요.</span>
        <button className="primary block" disabled={syncing} onClick={onUploadCloud}>
          {syncing ? '처리 중...' : '클라우드에 저장 (업로드)'}
        </button>
        <button className="block" disabled={syncing} onClick={onDownloadCloud}>
          {syncing ? '처리 중...' : '클라우드에서 불러오기 (다운로드)'}
        </button>
      </div>

      <div className="card col-card">
        <span className="muted">
          마지막 백업: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ko-KR') : '없음'}
        </span>
        <button className="primary block" onClick={onExportJson}>JSON 백업 다운로드</button>
        <button className="block" onClick={onExportCsv}>CSV 다운로드 (엑셀용)</button>
        <button className="block" onClick={() => fileRef.current?.click()}>백업 불러오기 (JSON)</button>
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

      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>핸디 이력 파일</span>
        <span className="muted">
          CSV 형식: <code>이름,날짜,핸디</code> (날짜는 YYYY-MM-DD)<br />
          예) <code>김철수,2026-03-15,22</code>
        </span>
        <button className="block" onClick={onExportHandicapCsv}>핸디 이력 CSV 다운로드</button>
        <button className="primary block" onClick={() => hcapFileRef.current?.click()}>핸디 이력 CSV 업로드</button>
        <input
          ref={hcapFileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportHandicap(f)
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
            if (confirm('모든 회원·경기 기록이 삭제됩니다. 되돌릴 수 없습니다.')) {
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
