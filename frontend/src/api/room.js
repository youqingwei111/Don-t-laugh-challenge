import axios from 'axios'

const api = axios.create({
  baseURL: '/api'
})

export const roomApi = {
  createRoom(name, hostId, hostNickname) {
    return api.post('/rooms/', null, {
      params: { name, host_id: hostId, host_nickname: hostNickname }
    })
  },

  getRoom(roomId) {
    return api.get(`/rooms/${roomId}`)
  },

  joinRoom(roomId, playerId, nickname) {
    return api.post(`/rooms/${roomId}/join`, null, {
      params: { player_id: playerId, nickname }
    })
  }
}

export default api