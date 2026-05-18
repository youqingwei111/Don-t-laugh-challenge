import { ref } from 'vue'

// 动态生成 WebSocket 地址，指向当前主机（Vite dev server）
// Vite 会自动代理 /api/ws 到后端 8000 端口
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}`

// 心跳间隔（毫秒）
const HEARTBEAT_INTERVAL = 30000

export function useWebSocket(roomId, playerStore, onMessage) {
  const socket = ref(null)
  const isConnected = ref(false)
  let heartbeatTimer = null

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (socket.value && socket.value.readyState === WebSocket.OPEN) {
        console.log('[Heartbeat] Sending ping to server')
        socket.value.send(JSON.stringify({ type: 'ping' }))
      } else {
        console.warn('[Heartbeat] Cannot send ping, socket not open. readyState:', socket.value?.readyState)
      }
    }, HEARTBEAT_INTERVAL)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function connect() {
    // 动态读取 playerStore 的最新值，而不是在 setup 时捕获
    const currentPlayerId = playerStore.id
    const currentNickname = playerStore.nickname

    // 安全守卫：防止用空信息发起连接
    if (!currentPlayerId || !currentNickname) {
      console.error('WebSocket connect blocked: player_id or nickname is empty')
      console.error('Current playerStore state:', {
        id: playerStore.id,
        nickname: playerStore.nickname,
        roomId: playerStore.roomId
      })
      throw new Error('玩家信息不完整，无法连接WebSocket')
    }

    const wsUrl = `${WS_BASE}/api/ws/${roomId}?player_id=${currentPlayerId}&nickname=${encodeURIComponent(currentNickname)}`
    console.log(`[WebSocket] Connecting to ${wsUrl}`)

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      isConnected.value = true
      console.log('[WebSocket] Connected successfully')
      // 连接成功后启动心跳
      startHeartbeat()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('[WS RECEIVE]', data)
        // 忽略 pong 响应，只打日志
        if (data.type === 'pong') {
          console.log('[Heartbeat] Received pong from server')
          return
        }
        onMessage(data)
      } catch (e) {
        console.error('[WebSocket] Failed to parse message:', e)
      }
    }

    ws.onclose = (event) => {
      isConnected.value = false
      stopHeartbeat()
      console.log(`[WebSocket] Disconnected. code=${event.code}, reason=${event.reason}`)
    }

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error)
    }

    socket.value = ws
  }

  function send(data) {
    console.log(`[WebSocket] send() called with type=${data.type}`)

    if (!socket.value) {
      console.error('[WebSocket] Cannot send: socket is null')
      return false
    }

    if (socket.value.readyState !== WebSocket.OPEN) {
      console.error(`[WebSocket] Cannot send: socket not open. readyState=${socket.value.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`)
      return false
    }

    try {
      socket.value.send(JSON.stringify(data))
      console.log(`[WebSocket] Successfully sent: ${data.type}`)
      return true
    } catch (e) {
      console.error('[WebSocket] Send failed:', e)
      return false
    }
  }

  function disconnect() {
    stopHeartbeat()
    if (socket.value) {
      console.log('[WebSocket] Manual disconnect')
      socket.value.close()
      socket.value = null
    }
  }

  return { connect, send, disconnect, isConnected }
}