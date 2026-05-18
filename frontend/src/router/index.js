import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import GameRoom from '../views/GameRoom.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home
    },
    {
      path: '/room/:id',
      name: 'room',
      component: GameRoom
    }
  ]
})

export default router