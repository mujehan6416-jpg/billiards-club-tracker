import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// 정기모임 정산·모임(경기결과) 개발용 임시 진입점. import.meta.env.DEV는 운영 빌드에서 항상
// false로 치환되므로 운영 배포에는 절대 나타나지 않는다. 제거할 때는 각 블록과 src/dev/ 폴더만 지우면 된다.
const viteEnv = (import.meta as unknown as { env: { DEV: boolean } }).env
const params = new URLSearchParams(window.location.search)
const isDevSettlementPreview = viteEnv.DEV && params.get('devSettlement') === '1'
const isDevMeetingPreview = viteEnv.DEV && params.get('devMeeting') === '1'
const DevSettlementPreview = isDevSettlementPreview ? lazy(() => import('./dev/DevSettlementPreview')) : null
const DevMeetingPreview = isDevMeetingPreview ? lazy(() => import('./dev/DevMeetingPreview')) : null

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {DevSettlementPreview ? (
      <Suspense fallback={<div style={{ padding: 20 }}>불러오는 중...</div>}>
        <DevSettlementPreview />
      </Suspense>
    ) : DevMeetingPreview ? (
      <Suspense fallback={<div style={{ padding: 20 }}>불러오는 중...</div>}>
        <DevMeetingPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
