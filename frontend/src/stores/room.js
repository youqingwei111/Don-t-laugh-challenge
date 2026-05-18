import { defineStore } from 'pinia'
import { ref } from 'vue'
import { roomApi } from '../api/room'

export const useRoomStore = defineStore('room', () => {
  const currentRoom = ref(null)

  async function createRoom(name, hostId, hostNickname) {
    const response = await roomApi.createRoom(name, hostId, hostNickname)
    currentRoom.value = response.data
    return response.data
  }

  async function fetchRoom(roomId) {
    const response = await roomApi.getRoom(roomId)
    currentRoom.value = response.data
    return response.data
  }

  async function joinRoom(roomId, playerId, nickname) {
    const response = await roomApi.joinRoom(roomId, playerId, nickname)
    currentRoom.value = response.data
    return response.data
  }

  function clearRoom() {
    currentRoom.value = null
  }

  return { currentRoom, createRoom, fetchRoom, joinRoom, clearRoom }
})