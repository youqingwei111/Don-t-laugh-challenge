<template>
  <div class="room">
    <h1>房间: {{ room?.name }}</h1>
    <p>房间号: {{ room?.id }}</p>
    <p>状态: {{ room?.status }}</p>

    <div class="players">
      <h2>玩家列表</h2>
      <div v-for="player in room?.players" :key="player.id" class="player">
        <span>{{ player.nickname }}</span>
        <span :class="{ ready: player.is_ready }">
          {{ player.is_ready ? '已准备' : '未准备' }}
        </span>
      </div>
    </div>

    <button @click="toggleReady">
      {{ isReady ? '取消准备' : '准备' }}
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useRoomStore } from '../stores/room'
import { usePlayerStore } from '../stores/player'

const route = useRoute()
const roomStore = useRoomStore()
const playerStore = usePlayerStore()

const room = computed(() => roomStore.currentRoom)

const isReady = computed(() => {
  const p = room.value?.players.find(pl => pl.id === playerStore.id)
  return p?.is_ready || false
})

onMounted(async () => {
  await roomStore.fetchRoom(route.params.id)
})

function toggleReady() {
  const player = room.value?.players.find(p => p.id === playerStore.id)
  if (player) {
    player.is_ready = !player.is_ready
  }
}
</script>

<style scoped>
.room {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 10px;
}

.players {
  margin: 20px 0;
}

.player {
  display: flex;
  justify-content: space-between;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.ready {
  color: #4a90d9;
}

button {
  padding: 12px 24px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
}
</style>