<template>
  <div class="game-room">
    <!-- 等待阶段：显示玩家列表和准备按钮 -->
    <template v-if="gameStatus === 'waiting'">
      <div class="header">
        <h1>房间: {{ room?.name }}</h1>
        <div class="room-info">
          <span>房间号: {{ roomId }}</span>
          <span class="status" :class="room?.status">{{ statusText }}</span>
        </div>
      </div>

      <div class="players-grid">
        <div
          v-for="(player, index) in displayPlayers"
          :key="player?.id || index"
          class="player-slot"
          :class="{
            occupied: player,
            ready: player?.is_ready,
            host: player?.id === room?.host_id,
            current: player?.id === playerStore.id
          }"
        >
          <template v-if="player">
            <div class="player-avatar">{{ player.nickname[0] }}</div>
            <div class="player-name">{{ player.nickname }}</div>
            <div class="player-status">
              <span v-if="player.id === room?.host_id" class="host-badge">房主</span>
              <span v-if="player.id === playerStore.id" class="you-badge">你</span>
              <span class="ready-text" :class="{ active: player.is_ready }">
                {{ player.is_ready ? '已准备' : '等待中' }}
              </span>
            </div>
          </template>
          <template v-else>
            <div class="empty-slot">等待玩家...</div>
          </template>
        </div>
      </div>

      <div class="actions">
        <button
          v-if="canReady"
          @click="toggleReady"
          :class="{ ready: isCurrentPlayerReady }"
        >
          {{ isCurrentPlayerReady ? '取消准备' : '准备' }}
        </button>
        <button
          v-if="canStart"
          @click="startGame"
          class="start-btn"
        >
          开始游戏
        </button>
      </div>

      <!-- 重置/再来一局按钮（房主可见） -->
      <div v-if="room?.status === 'finished' && room?.host_id === playerStore.id" class="reset-section">
        <button @click="requestRematch" class="rematch-btn">
          再来一局
        </button>
      </div>
    </template>

    <!-- 游戏阶段：显示5个视频窗口 + 禁忌词 + 任务 -->
    <template v-else-if="gameStatus === 'playing'">
      <div class="video-header">
        <h1>第 {{ currentRound }} 轮</h1>
        <div class="header-actions">
          <button @click="leaveGame" class="leave-btn">退出</button>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="webrtc.error" class="error-message">
        {{ webrtc.error.value }}
      </div>

      <!-- 本地视频 + 4个远程视频 -->
      <div class="video-grid">
        <!-- 本地视频 -->
        <div class="video-slot local" :class="{ punished: myViolationCount > 0 }">
          <video
            ref="localVideoRef"
            autoplay
            muted
            playsinline
          ></video>
          <div class="video-label">
            {{ playerStore.nickname }} (你)
            <span v-if="!webrtc.localStream.value" class="connecting">连接中...</span>
          </div>
          <!-- 本地玩家看不到自己的禁忌词 -->

          <!-- 惩罚标记 -->
          <div v-if="myViolationCount > 0" class="punishment-overlay">
            <div class="punishment-count">{{ myViolationCount }}/3</div>
            <div class="violations-dots">
              <span v-for="i in 3" :key="i" :class="{ filled: i <= myViolationCount }"></span>
            </div>
          </div>
        </div>

        <!-- 远程视频 -->
        <div
          v-for="player in otherPlayers"
          :key="player.id"
          class="video-slot remote"
          :class="{
            connected: webrtc.remoteStreams.value[player.id],
            punished: playerViolations[player.id] > 0,
            eliminated: playerViolations[player.id] >= 3
          }"
        >
          <video
            :ref="el => remoteVideoRefs[player.id] = el"
            autoplay
            playsinline
          ></video>
          <div class="video-label">
            {{ player.nickname }}
            <span v-if="!webrtc.remoteStreams.value[player.id]" class="connecting">等待连接...</span>
          </div>

          <!-- 显示该玩家的禁忌词 -->
          <div class="taboo-word" v-if="tabooWords[player.nickname]">
            {{ tabooWords[player.nickname] }}
          </div>

          <!-- 惩罚标记（红色X + 计数） -->
          <div v-if="playerViolations[player.id] > 0" class="punishment-overlay">
            <div class="x-mark">✕</div>
            <div class="punishment-count">{{ playerViolations[player.id] }}/3</div>
            <div class="violations-dots">
              <span v-for="i in 3" :key="i" :class="{ filled: i <= playerViolations[player.id] }"></span>
            </div>
          </div>

          <!-- 淘汰特效 -->
          <div v-if="playerViolations[player.id] >= 3" class="eliminated-overlay">
            <div class="eliminated-text">OUT</div>
          </div>

          <!-- 触发禁忌按钮 -->
          <button
            v-if="playerViolations[player.id] < 3"
            class="report-btn"
            @click="reportViolation(player.id, player.nickname)"
            title="举报他说禁忌词"
          >
            ⚠️ 触发
          </button>
        </div>

        <!-- 空槽位（凑不够5人时显示） -->
        <div
          v-for="emptySlot in emptyVideoSlots"
          :key="'empty-' + emptySlot"
          class="video-slot empty"
        >
          <div class="empty-video">等待加入...</div>
          <div class="video-label">空位</div>
        </div>
      </div>

      <!-- 控制栏 -->
      <div class="controls">
        <button @click="toggleMute" :class="{ muted: isMuted }">
          {{ isMuted ? '取消静音' : '静音' }}
        </button>
        <button @click="toggleVideo" :class="{ disabled: isVideoOff }">
          {{ isVideoOff ? '开启视频' : '关闭视频' }}
        </button>
      </div>

      <!-- 任务通知弹窗 -->
      <Transition name="task-popup">
        <div v-if="currentTask" class="task-popup">
          <div class="task-header">
            <span class="task-icon">🎯</span>
            <span>随机任务</span>
          </div>
          <div class="task-content">
            <p class="task-description">{{ currentTask.description }}</p>
            <p v-if="currentTask.target_player_name" class="task-target">
              任务目标：{{ currentTask.target_player_name }}
            </p>
          </div>
          <div class="task-timer">
            <span>剩余 {{ taskCountdown }} 秒</span>
          </div>
        </div>
      </Transition>

      <!-- 惩罚提示弹窗 -->
      <Transition name="punishment-popup">
        <div v-if="showPunishmentAlert" class="punishment-alert" :class="{ eliminated: lastPunishment?.is_eliminated }">
          <div class="alert-icon">{{ lastPunishment?.is_eliminated ? '💀' : '⚠️' }}</div>
          <div class="alert-content">
            <p class="alert-title">{{ lastPunishment?.reported_player_name }} 说了禁忌词！</p>
            <p class="alert-subtitle" v-if="lastPunishment?.is_eliminated">已被淘汰</p>
            <p class="alert-subtitle" v-else>还剩 {{ 3 - (lastPunishment?.violation_count || 0) }} 次机会</p>
          </div>
          <p class="alert-reporter">举报人: {{ lastPunishment?.reporter_name }}</p>
        </div>
      </Transition>

      <!-- 任务历史滚动条（底部） -->
      <div v-if="taskHistory.length > 0" class="task-marquee">
        <div class="marquee-content">
          <span v-for="(task, index) in taskHistory" :key="index" class="marquee-item">
            ✓ {{ task }}
          </span>
        </div>
      </div>
    </template>

    <!-- 游戏结束阶段 -->
    <template v-else-if="gameStatus === 'finished'">
      <div class="game-over">
        <h1>游戏结束</h1>
        <div class="final-results">
          <div v-for="(count, playerId) in finalViolations" :key="playerId" class="result-item">
            <span class="result-name">{{ getPlayerName(playerId) }}</span>
            <span class="result-count">犯规 {{ count }} 次</span>
            <span v-if="count >= 3" class="result-eliminated">淘汰</span>
          </div>
        </div>
        <div v-if="room?.host_id === playerStore.id" class="reset-section">
          <button @click="requestRematch" class="rematch-btn">再来一局</button>
        </div>
        <div v-else class="waiting-rematch">
          等待房主开始新游戏...
        </div>
      </div>
    </template>

    <!-- 消息提示 -->
    <div v-if="message" class="message" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { useRoomStore } from '../stores/room'
import { useWebSocket } from '../api/websocket'
import { useWebRTC } from '../utils/webrtc'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const roomStore = useRoomStore()

const roomId = computed(() => route.params.id)
const room = computed(() => roomStore.currentRoom)
const message = ref('')
const messageType = ref('')

// 游戏状态：waiting / playing / finished
const gameStatus = ref('waiting')
const currentRound = ref(1)

// 禁忌词 {nickname: word}
const tabooWords = ref({})
const myTabooWord = ref('')

// 惩罚状态追踪 {player_id: violation_count}
const playerViolations = ref({})
const myViolationCount = computed(() => playerViolations.value[playerStore.id] || 0)

// 惩罚提示弹窗
const showPunishmentAlert = ref(false)
const lastPunishment = ref(null)
let punishmentAlertTimer = null

// 任务相关
const currentTask = ref(null)
const taskCountdown = ref(0)
const taskHistory = ref([])
let taskTimer = null
let countdownTimer = null

// 最终结果
const finalViolations = ref({})

// 视频相关 refs
const localVideoRef = ref(null)
const remoteVideoRefs = ref({})

// 音视频控制
const isMuted = ref(false)
const isVideoOff = ref(false)

// WebRTC 实例
const webrtc = useWebRTC()

// 其他玩家（除自己外）
const otherPlayers = computed(() => {
  return room.value?.players?.filter(p => p.id !== playerStore.id) || []
})

// 空视频槽位（5人以内时补充空位）
const emptyVideoSlots = computed(() => {
  const total = 5
  const occupied = 1 + otherPlayers.value.length
  return Array(Math.max(0, total - occupied)).fill(0).map((_, i) => i)
})

const displayPlayers = computed(() => {
  const players = room.value?.players || []
  const slots = Array(5).fill(null)
  players.forEach((p, i) => {
    if (i < 5) slots[i] = p
  })
  return slots
})

const isCurrentPlayerReady = computed(() => {
  const p = room.value?.players.find(pl => pl.id === playerStore.id)
  return p?.is_ready || false
})

const canReady = computed(() => {
  return room.value?.status === 'waiting'
})

const canStart = computed(() => {
  return room.value?.host_id === playerStore.id &&
         room.value?.players.length >= 1
})

const statusText = computed(() => {
  const status = room.value?.status
  if (status === 'waiting') return '等待中'
  if (status === 'playing') return '游戏中'
  if (status === 'finished') return '已结束'
  return status
})

// -------------------- 辅助函数 --------------------
function getPlayerName(playerId) {
  const player = room.value?.players?.find(p => p.id === playerId)
  return player?.nickname || '未知玩家'
}

// -------------------- WebSocket 消息处理 --------------------
function handleMessage(data) {
  switch (data.type) {
    case 'player_joined':
    case 'player_left':
    case 'player_ready':
      roomStore.currentRoom = {
        ...room.value,
        players: data.players
      }
      showMessage(`${data.nickname || data.player_name} ${data.type === 'player_joined' ? '加入了' : '离开了'}`)
      break

    case 'room_state':
      roomStore.currentRoom = data.room
      break

    case 'waiting_players':
    case 'all_ready':
      showMessage(data.message, data.type === 'all_ready' ? 'success' : 'info')
      break

    case 'game_start':
      roomStore.currentRoom = { ...room.value, status: 'playing' }
      gameStatus.value = 'playing'
      currentRound.value = data.round || 1
      // 重置惩罚状态
      playerViolations.value = {}
      finalViolations.value = {}
      showMessage('游戏开始！正在连接视频...', 'success')
      setTimeout(() => initWebRTC(), 100)
      break

    case 'taboo_words':
      tabooWords.value = data.words
      myTabooWord.value = data.my_word
      console.log('禁忌词已更新:', tabooWords.value)
      break

    case 'new_task':
      currentTask.value = {
        id: data.task.id,
        description: data.task.description,
        target_player_id: data.task.target_player_id,
        target_player_name: data.task.target_player_name
      }
      currentRound.value = data.round || currentRound.value
      startTaskCountdown()
      taskHistory.value.unshift(data.task.description)
      if (taskHistory.value.length > 10) {
        taskHistory.value.pop()
      }
      break

    case 'violation_punished':
      // 更新惩罚计数
      playerViolations.value[data.reported_player_id] = data.violation_count

      // 显示惩罚提示
      lastPunishment.value = data
      showPunishmentAlert.value = true
      if (punishmentAlertTimer) clearTimeout(punishmentAlertTimer)
      punishmentAlertTimer = setTimeout(() => {
        showPunishmentAlert.value = false
      }, 3000)
      break

    case 'player_eliminated':
      // 玩家被淘汰
      playerViolations.value[data.player_id] = 3
      showMessage(`${data.player_name} 已被淘汰！`, 'error')
      break

    case 'game_end':
      gameStatus.value = 'finished'
      roomStore.currentRoom = { ...room.value, status: 'finished' }
      finalViolations.value = { ...playerViolations.value }
      showMessage('游戏结束！', 'success')
      break

    case 'game_reset':
      // 游戏重置
      gameStatus.value = 'waiting'
      playerViolations.value = {}
      currentTask.value = null
      taskHistory.value = []
      currentRound.value = 1
      roomStore.currentRoom = data.room
      showMessage('游戏已重置，等待准备...', 'info')
      break

    // WebRTC 信令处理
    case 'offer':
      handleIncomingOffer(data)
      break

    case 'answer':
      handleIncomingAnswer(data)
      break

    case 'ice-candidate':
      handleIncomingIceCandidate(data)
      break

    case 'chat':
      console.log(`${data.nickname}: ${data.message}`)
      break
  }
}

// -------------------- 举报触发禁忌词 --------------------
function reportViolation(targetPlayerId, targetNickname) {
  if (confirm(`确定要举报 "${targetNickname}" 说了禁忌词吗？`)) {
    send({
      type: 'report_violation',
      reported_player_id: targetPlayerId
    })
  }
}

// -------------------- 请求重来一局 --------------------
function requestRematch() {
  send({ type: 'request_rematch' })
}

// -------------------- 任务倒计时 --------------------
function startTaskCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  if (taskTimer) clearTimeout(taskTimer)

  taskCountdown.value = 30

  countdownTimer = setInterval(() => {
    taskCountdown.value--
    if (taskCountdown.value <= 0) {
      clearInterval(countdownTimer)
    }
  }, 1000)

  taskTimer = setTimeout(() => {
    currentTask.value = null
  }, 30000)
}

// -------------------- WebRTC 信令回调 --------------------
function sendOffer(targetId, offer) {
  send({ type: 'offer', target_id: targetId, offer, from_nickname: playerStore.nickname })
}

function sendAnswer(targetId, answer) {
  send({ type: 'answer', target_id: targetId, answer })
}

function sendIceCandidate(data) {
  send({ type: 'ice-candidate', ...data })
}

// -------------------- 初始化 WebRTC --------------------
async function initWebRTC() {
  try {
    await webrtc.getLocalStream()

    if (localVideoRef.value && webrtc.localStream.value) {
      localVideoRef.value.srcObject = webrtc.localStream.value
    }

    for (const player of otherPlayers.value) {
      webrtc.createConnection(
        player.id,
        playerStore.id,
        playerStore.nickname,
        sendOffer,
        sendAnswer,
        sendIceCandidate
      )

      await nextTick()
      webrtc.createAndSendOffer(player.id)
    }

  } catch (err) {
    console.error('初始化 WebRTC 失败:', err)
    webrtc.error.value = '视频初始化失败，请检查摄像头权限'
  }
}

// -------------------- 处理收到的信令消息 --------------------
async function handleIncomingOffer(data) {
  console.log(`收到 ${data.from_nickname} 的 offer`)

  if (!webrtc.peerConnections.value[data.from_id]) {
    webrtc.createConnection(
      data.from_id,
      playerStore.id,
      playerStore.nickname,
      sendOffer,
      sendAnswer,
      sendIceCandidate
    )
  }

  await webrtc.handleOffer(
    data.from_id,
    data.from_nickname,
    data.offer,
    sendAnswer
  )
}

async function handleIncomingAnswer(data) {
  console.log(`收到 ${data.from_id} 的 answer`)
  await webrtc.handleAnswer(data.from_id, data.answer)
}

async function handleIncomingIceCandidate(data) {
  console.log(`收到 ${data.from_id} 的 ICE candidate`)
  await webrtc.handleIceCandidate(data.from_id, data.candidate)
}

// -------------------- 监听远程视频流变化 --------------------
watch(
  () => webrtc.remoteStreams.value,
  async (streams) => {
    await nextTick()
    for (const [playerId, stream] of Object.entries(streams)) {
      const videoEl = remoteVideoRefs.value[playerId]
      if (videoEl && stream) {
        videoEl.srcObject = stream
      }
    }
  },
  { deep: true }
)

// -------------------- 音视频控制 --------------------
function toggleMute() {
  if (webrtc.localStream.value) {
    const audioTrack = webrtc.localStream.value.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      isMuted.value = !audioTrack.enabled
    }
  }
}

function toggleVideo() {
  if (webrtc.localStream.value) {
    const videoTrack = webrtc.localStream.value.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      isVideoOff.value = !videoTrack.enabled
    }
  }
}

// -------------------- 其他 --------------------
function showMessage(msg, type = 'info') {
  message.value = msg
  messageType.value = type
  setTimeout(() => { message.value = '' }, 3000)
}

function leaveGame() {
  webrtc.closeAllConnections()
  gameStatus.value = 'waiting'
  roomStore.currentRoom = { ...room.value, status: 'waiting' }
  currentTask.value = null
  tabooWords.value = {}
  taskHistory.value = []
  playerViolations.value = {}
  if (countdownTimer) clearInterval(countdownTimer)
  if (taskTimer) clearTimeout(taskTimer)
  if (punishmentAlertTimer) clearTimeout(punishmentAlertTimer)
  router.push('/')
}

const { connect, send, disconnect } = useWebSocket(
  roomId.value,
  playerStore,
  handleMessage
)

onMounted(async () => {
  // 安全守卫：检查玩家状态是否完整
  if (!playerStore.isValid()) {
    alert('用户信息丢失，请重新进入房间')
    playerStore.clearPlayer()
    router.push('/')
    return
  }

  // 确保 roomId 与当前路由一致
  playerStore.setRoomId(roomId.value)

  await roomStore.fetchRoom(roomId.value)

  try {
    connect()
  } catch (e) {
    console.error('WebSocket connection failed:', e)
    alert('WebSocket 连接失败: ' + e.message)
    router.push('/')
  }
})

onUnmounted(() => {
  webrtc.closeAllConnections()
  disconnect()
  if (countdownTimer) clearInterval(countdownTimer)
  if (taskTimer) clearTimeout(taskTimer)
  if (punishmentAlertTimer) clearTimeout(punishmentAlertTimer)
})

function toggleReady() {
  send({ type: 'ready', ready: !isCurrentPlayerReady.value })
}

function startGame() {
  send({ type: 'start_game' })
}
</script>

<style scoped>
.game-room {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

/* 等待阶段样式 */
.header {
  margin-bottom: 30px;
}

.header h1 {
  margin-bottom: 10px;
}

.room-info {
  display: flex;
  gap: 20px;
  color: #666;
}

.status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 14px;
}

.status.waiting { background: #e8e8e8; }
.status.playing { background: #4a90d9; color: white; }
.status.finished { background: #f44336; color: white; }

.players-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-bottom: 30px;
}

.player-slot {
  background: #f5f5f5;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
}

.player-slot.occupied { background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.player-slot.ready { border: 2px solid #4a90d9; }
.player-slot.current { background: #e3f2fd; }

.player-avatar {
  width: 48px;
  height: 48px;
  background: #4a90d9;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  margin-bottom: 8px;
}

.player-name {
  font-weight: 500;
  margin-bottom: 8px;
}

.player-status {
  font-size: 12px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.host-badge, .you-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.host-badge { background: #ff9800; color: white; }
.you-badge { background: #4a90d9; color: white; }

.ready-text { color: #999; }
.ready-text.active { color: #4a90d9; font-weight: 500; }

.empty-slot {
  color: #ccc;
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}

button {
  padding: 14px 32px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

button:not(.start-btn, .leave-btn, .rematch-btn, .report-btn) {
  background: #e8e8e8;
  color: #333;
}

button:not(.start-btn, .leave-btn, .rematch-btn, .report-btn):hover {
  background: #ddd;
}

button.ready {
  background: #4a90d9;
  color: white;
}

.start-btn {
  background: #4caf50;
  color: white;
}

.start-btn:hover {
  background: #45a049;
}

.rematch-btn {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  font-size: 18px;
  padding: 16px 48px;
}

.rematch-btn:hover {
  transform: scale(1.05);
}

.reset-section {
  margin-top: 30px;
  text-align: center;
}

.waiting-rematch {
  margin-top: 20px;
  color: #888;
  font-size: 14px;
}

/* 游戏阶段视频样式 */
.video-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.leave-btn {
  background: #f44336;
  color: white;
}

.error-message {
  background: #ffebee;
  color: #c62828;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.video-slot {
  position: relative;
  aspect-ratio: 4/3;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s;
}

.video-slot video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-slot.local {
  border: 3px solid #4a90d9;
}

/* 惩罚状态：灰度 + 红框 */
.video-slot.punished {
  filter: grayscale(50%) brightness(0.8);
  box-shadow: 0 0 0 3px #f44336;
}

.video-slot.eliminated {
  filter: grayscale(100%) brightness(0.4);
}

.video-slot.connected {
  border: 2px solid #4caf50;
}

.video-label {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0,0,0,0.6);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

/* 禁忌词标签 */
.taboo-word {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #e91e63, #9c27b0);
  color: white;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  white-space: nowrap;
}

.connecting {
  opacity: 0.7;
  font-size: 11px;
}

.empty-video {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 14px;
}

/* 惩罚叠加层 */
.punishment-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(244, 67, 54, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.x-mark {
  font-size: 64px;
  color: #f44336;
  font-weight: bold;
  text-shadow: 0 0 20px rgba(0,0,0,0.5);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

.punishment-count {
  color: white;
  font-size: 18px;
  font-weight: bold;
  margin-top: 8px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

.violations-dots {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.violations-dots span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
  border: 2px solid white;
}

.violations-dots span.filled {
  background: #f44336;
}

/* 淘汰特效 */
.eliminated-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11;
}

.eliminated-text {
  font-size: 36px;
  font-weight: bold;
  color: #f44336;
  text-shadow: 0 0 20px rgba(244, 67, 54, 0.8);
  letter-spacing: 4px;
  animation: eliminatedPulse 0.5s infinite alternate;
}

@keyframes eliminatedPulse {
  from { opacity: 0.5; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1.05); }
}

/* 举报按钮 */
.report-btn {
  position: absolute;
  top: 40px;
  right: 8px;
  background: rgba(255, 152, 0, 0.9);
  color: white;
  border: none;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 20;
}

.video-slot:hover .report-btn {
  opacity: 1;
}

.report-btn:hover {
  background: #ff9800;
}

.controls {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 20px;
}

.controls button {
  background: #333;
  color: white;
  min-width: 100px;
}

.controls button.muted {
  background: #f44336;
}

.controls button.disabled {
  background: #666;
}

/* 任务弹窗 */
.task-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: linear-gradient(145deg, #1a1a2e, #16213e);
  border: 3px solid #e94560;
  border-radius: 16px;
  padding: 24px;
  min-width: 320px;
  max-width: 500px;
  box-shadow: 0 0 40px rgba(233, 69, 96, 0.4);
  z-index: 1000;
  text-align: center;
}

.task-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #e94560;
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 16px;
}

.task-icon {
  font-size: 28px;
}

.task-content {
  background: rgba(255,255,255,0.05);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.task-description {
  font-size: 18px;
  color: white;
  line-height: 1.6;
  margin: 0;
}

.task-target {
  font-size: 14px;
  color: #e94560;
  margin: 12px 0 0 0;
}

.task-timer {
  color: #aaa;
  font-size: 14px;
}

/* 惩罚提示弹窗 */
.punishment-alert {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(145deg, #1a1a2e, #16213e);
  border: 3px solid #ff9800;
  border-radius: 16px;
  padding: 24px;
  min-width: 280px;
  text-align: center;
  box-shadow: 0 0 40px rgba(255, 152, 0, 0.5);
  z-index: 1001;
}

.punishment-alert.eliminated {
  border-color: #f44336;
  box-shadow: 0 0 40px rgba(244, 67, 54, 0.5);
}

.alert-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.alert-content {
  margin-bottom: 12px;
}

.alert-title {
  font-size: 20px;
  color: white;
  font-weight: bold;
  margin: 0 0 8px 0;
}

.alert-subtitle {
  font-size: 14px;
  color: #ff9800;
  margin: 0;
}

.punishment-alert.eliminated .alert-subtitle {
  color: #f44336;
}

.alert-reporter {
  font-size: 12px;
  color: #888;
  margin: 0;
}

/* 弹窗动画 */
.task-popup-enter-active {
  animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.task-popup-leave-active {
  animation: popOut 0.3s ease-in;
}

.punishment-popup-enter-active {
  animation: shakeIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.punishment-popup-leave-active {
  animation: fadeOut 0.3s ease-in;
}

@keyframes popIn {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes popOut {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
}

@keyframes shakeIn {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5) rotate(-10deg); }
  50% { transform: translate(-50%, -50%) scale(1.05) rotate(5deg); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
}

@keyframes fadeOut {
  0% { opacity: 1; }
  100% { opacity: 0; }
}

/* 任务历史滚动条 */
.task-marquee {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(90deg, #1a1a2e, #16213e);
  padding: 12px 0;
  border-top: 2px solid #e94560;
  overflow: hidden;
}

.marquee-content {
  display: flex;
  gap: 30px;
  animation: marquee 30s linear infinite;
  white-space: nowrap;
}

.marquee-item {
  color: #aaa;
  font-size: 14px;
}

@keyframes marquee {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}

/* 游戏结束 */
.game-over {
  text-align: center;
  padding: 40px;
}

.game-over h1 {
  font-size: 36px;
  margin-bottom: 30px;
}

.final-results {
  background: #f5f5f5;
  border-radius: 12px;
  padding: 20px;
  max-width: 400px;
  margin: 0 auto 30px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #eee;
}

.result-item:last-child {
  border-bottom: none;
}

.result-name {
  font-weight: 500;
  font-size: 16px;
}

.result-count {
  color: #666;
}

.result-eliminated {
  color: #f44336;
  font-weight: bold;
}

/* 消息提示 */
.message {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  animation: fadeIn 0.3s;
}

.message.info { background: #e8e8e8; color: #333; }
.message.success { background: #4caf50; color: white; }
.message.error { background: #f44336; color: white; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>