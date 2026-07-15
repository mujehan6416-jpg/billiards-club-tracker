import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// 정기모임 정산 개발용 임시 진입점. import.meta.env.DEV는 운영 빌드에서 항상 false로 치환되므로
// 운영 배포에는 절대 나타나지 않는다. 제거할 때는 이 블록과 src/dev/ 폴더만 지우면 된다.
const viteEnv = (import.meta as unknown as { env: { DEV: boolean } }).env
const isDevSettlementPreview =
  viteEnv.DEV && new URLSearchParams(window.location.search).get('devSettlement') === '1'
const DevSettlementPreview = isDevSettlementPreview ? lazy(() => import('./dev/DevSettlementPreview')) : null

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {DevSettlementPreview ? (
      <Suspense fallback={<div style={{ padding: 20 }}>불러오는 중...</div>}>
        <DevSettlementPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
