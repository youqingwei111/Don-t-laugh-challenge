import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'game_player_info'

export const usePlayerStore = defineStore('player', () => {
  const id = ref('')
  const nickname = ref('')
  const roomId = ref('')
  const isHost = ref(false)

  // 初始化时从 localStorage 恢复状态
  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        id.value = data.id || ''
        nickname.value = data.nickname || ''
        roomId.value = data.roomId || ''
        isHost.value = data.isHost || false
      }
    } catch (e) {
      console.error('Failed to load player info from localStorage:', e)
    }
  }

  // 保存到 localStorage
  function saveToStorage() {
    try {
      const data = {
        id: id.value,
        nickname: nickname.value,
        roomId: roomId.value,
        isHost: isHost.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Failed to save player info to localStorage:', e)
    }
  }

  function setPlayer(playerId, playerNickname, playerRoomId = '', host = false) {
    id.value = playerId
    nickname.value = playerNickname
    roomId.value = playerRoomId
    isHost.value = host
    saveToStorage()
  }

  function setRoomId(newRoomId) {
    roomId.value = newRoomId
    saveToStorage()
  }

  function setHost(host) {
    isHost.value = host
    saveToStorage()
  }

  function clearPlayer() {
    id.value = ''
    nickname.value = ''
    roomId.value = ''
    isHost.value = false
    localStorage.removeItem(STORAGE_KEY)
  }

  function isValid() {
    return !!(id.value && nickname.value)
  }

  // 页面加载时自动恢复状态
  loadFromStorage()

  return {
    id,
    nickname,
    roomId,
    isHost,
    setPlayer,
    setRoomId,
    setHost,
    clearPlayer,
    isValid,
    loadFromStorage
  }
})