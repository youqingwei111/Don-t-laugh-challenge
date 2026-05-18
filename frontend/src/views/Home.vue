<template>
  <div class="home">
    <h1>互动游戏</h1>
    <div class="form">
      <input v-model="nickname" placeholder="输入你的昵称" />
      <button @click="createRoom" :disabled="isLoading">创建房间</button>
      <div class="divider">或者</div>
      <input v-model="roomId" placeholder="输入房间号加入" />
      <button @click="joinRoom" :disabled="isLoading">加入房间</button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="isLoading" class="loading">处理中...</div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { useRoomStore } from '../stores/room'

const router = useRouter()
const playerStore = usePlayerStore()
const roomStore = useRoomStore()

const nickname = ref('')
const roomId = ref('')
const isLoading = ref(false)
const error = ref('')

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

async function createRoom() {
  error.value = ''
  if (!nickname.value.trim()) {
    error.value = '请输入昵称'
    return
  }

  isLoading.value = true
  try {
    const playerId = generateId()
    const roomName = '房间' + Date.now()

    // 1. 先设置玩家信息到 store 和 localStorage
    playerStore.setPlayer(playerId, nickname.value, '', true)

    // 2. 然后创建房间
    await roomStore.createRoom(roomName, playerId, nickname.value)

    // 3. 确保 roomId 已保存
    playerStore.setRoomId(roomStore.currentRoom.id)

    // 4. 验证状态完整性后再跳转
    if (!playerStore.isValid()) {
      throw new Error('玩家信息保存失败')
    }

    // 5. 确认跳转
    router.push(`/room/${roomStore.currentRoom.id}`)
  } catch (e) {
    error.value = e.message || '创建房间失败'
    playerStore.clearPlayer()
  } finally {
    isLoading.value = false
  }
}

async function joinRoom() {
  error.value = ''
  if (!nickname.value.trim()) {
    error.value = '请输入昵称'
    return
  }
  if (!roomId.value.trim()) {
    error.value = '请输入房间号'
    return
  }

  isLoading.value = true
  try {
    const playerId = generateId()

    // 1. 先设置玩家信息到 store 和 localStorage（roomId 暂时为空）
    playerStore.setPlayer(playerId, nickname.value, '', false)

    // 2. 加入房间 API
    await roomStore.joinRoom(roomId.value, playerId, nickname.value)

    // 3. 确认房间加入成功后再保存 roomId
    playerStore.setRoomId(roomId.value)

    // 4. 验证状态完整性后再跳转
    if (!playerStore.isValid()) {
      throw new Error('玩家信息保存失败')
    }

    // 5. 确认跳转
    router.push(`/room/${roomId.value}`)
  } catch (e) {
    error.value = e.message || '加入房间失败'
    playerStore.clearPlayer()
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;
}

h1 {
  font-size: 2rem;
  color: #333;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 280px;
}

input {
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 16px;
}

button {
  padding: 12px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #3a7bc8;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.divider {
  text-align: center;
  color: #999;
  font-size: 14px;
}

.error {
  color: #f44336;
  font-size: 14px;
}

.loading {
  color: #666;
  font-size: 14px;
}
</style>