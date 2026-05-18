import { ref } from 'vue'

// 使用动态 hostname，避免硬编码 localhost
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_HOST = window.location.hostname
const WS_PORT = '8000'
const WS_BASE = `${WS_PROTOCOL}//${WS_HOST}:${WS_PORT}/api/ws`

export function useWebSocket(roomId, playerStore, onMessage) {
  const socket = ref(null)
  const isConnected = ref(false)

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

    console.log(`WebSocket connecting with playerId=${currentPlayerId}, nickname=${currentNickname}`)

    const ws = new WebSocket(`${WS_BASE}/${roomId}?player_id=${currentPlayerId}&nickname=${encodeURIComponent(currentNickname)}`)

    ws.onopen = () => {
      isConnected.value = true
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      onMessage(data)
    }

    ws.onclose = () => {
      isConnected.value = false
      console.log('WebSocket disconnected')
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    socket.value = ws
  }

  function send(data) {
    if (socket.value && socket.value.readyState === WebSocket.OPEN) {
      socket.value.send(JSON.stringify(data))
    }
  }

  function disconnect() {
    if (socket.value) {
      socket.value.close()
    }
  }

  return { connect, send, disconnect, isConnected }
}