/**
 * WebRTC 工具模块 - 处理 1 对 1 的视频通话连接
 *
 * WebRTC 连接建立流程（Mesh 架构，5人以内适用）:
 *   1. 本地获取摄像头权限，展示本地视频
 *   2. 收到 game_start 后，为房间内每个其他玩家创建 RTCPeerConnection
 *   3. 创建 offer SDP，通过 WebSocket 发送给对方
 *   4. 对方收到 offer，设置为远端描述，创建 answer SDP，发送回去
 *   5. 双方交换 ICE candidate，找到最优传输路径
 *   6. 连接建立成功，播放对方视频
 *
 * 关键概念:
 *   - RTCPeerConnection: 代表一个 WebRTC 连接端点
 *   - SDP (Session Description Protocol): 描述媒体能力（codec、分辨率等）
 *   - ICE Candidate: 候选的网络地址（公网IP、端口、传输协议等）
 *   - TURN/STUN: 用于 NAT 穿透的服务器
 */

import { ref } from 'vue'

// ICE 服务器配置 - 用于 NAT 穿透
// STUN: 获得公网 IP 地址
// TURN: 中继服务器（当直接 P2P 无法连接时使用）
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

/**
 * 创建 RTCPeerConnection 实例
 * @returns RTCPeerConnection
 */
function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    // 禁用 BUNDLE 可以避免多路复用问题，方便调试
    // bundlePolicy: 'max-compat'
  })
}

/**
 * 封装 WebRTC 连接管理逻辑
 * 每个远程玩家对应一个 RTCPeerConnection
 */
export function useWebRTC() {
  // 本地媒体流（摄像头）
  const localStream = ref(null)

  // 远程玩家 ID -> RTCPeerConnection
  const peerConnections = ref({})

  // 远程玩家 ID -> 他们的媒体流
  const remoteStreams = ref({})

  // 错误信息
  const error = ref(null)

  /**
   * 获取本地摄像头权限并返回媒体流
   * @returns {Promise<MediaStream>}
   */
  async function getLocalStream() {
    try {
      // 请求摄像头和麦克风权限
      // constraints 详细指定了视频参数，避免兼容性问题
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
          // 使用前置摄像头（如果存在）
          // facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      localStream.value = stream
      return stream

    } catch (err) {
      console.error('获取摄像头权限失败:', err)
      error.value = '无法访问摄像头，请检查浏览器权限设置'
      throw err
    }
  }

  /**
   * 为指定玩家创建 WebRTC 连接
   * @param {string} targetPlayerId - 目标玩家 ID
   * @param {string} localPlayerId - 本地玩家 ID（用于标识）
   * @param {string} localNickname - 本地昵称（用于显示）
   * @param {Function} onSendOffer - 发送 offer 的回调
   * @param {Function} onSendAnswer - 发送 answer 的回调
   * @param {Function} onSendIceCandidate - 发送 ICE candidate 的回调
   * @returns {RTCPeerConnection}
   */
  function createConnection(targetPlayerId, localPlayerId, localNickname, onSendOffer, onSendAnswer, onSendIceCandidate) {
    // 如果已存在连接，直接返回
    if (peerConnections.value[targetPlayerId]) {
      return peerConnections.value[targetPlayerId]
    }

    const pc = createPeerConnection()

    // ---- 添加本地媒体轨道到连接 ----
    // 这样对方才能收到我们的视频/音频
    if (localStream.value) {
      localStream.value.getTracks().forEach(track => {
        pc.addTrack(track, localStream.value)
      })
    }

    // ---- 处理接收到远程视频轨道 ----
    // 当对方添加视频轨道时，我们会收到这个事件
    pc.ontrack = (event) => {
      console.log(`收到 ${targetPlayerId} 的视频轨道:`, event.streams[0])
      remoteStreams.value[targetPlayerId] = event.streams[0]
    }

    // ---- 处理 ICE 候选地址 ----
    // 每次发现一个新的候选地址时触发
    // 需要通过 WebSocket 发送给对方
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`ICE candidate for ${targetPlayerId}:`, event.candidate)
        onSendIceCandidate({
          target_id: targetPlayerId,
          candidate: event.candidate
        })
      }
    }

    // ---- 处理连接状态变化 ----
    // 用于调试连接问题
    pc.onconnectionstatechange = () => {
      console.log(`与 ${targetPlayerId} 的连接状态: ${pc.connectionState}`)
      if (pc.connectionState === 'failed') {
        error.value = `与 ${targetPlayerId} 的连接失败`
      }
    }

    // ---- 处理 ICE 连接状态变化 ----
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE 连接状态 (${targetPlayerId}): ${pc.iceConnectionState}`)
    }

    // 保存连接
    peerConnections.value[targetPlayerId] = pc

    return pc
  }

  /**
   * 创建并发送 offer
   * @param {string} targetPlayerId - 目标玩家 ID
   */
  async function createAndSendOffer(targetPlayerId) {
    const pc = peerConnections.value[targetPlayerId]
    if (!pc) {
      console.error(`无法创建 offer: ${targetPlayerId} 的连接不存在`)
      return
    }

    try {
      // 创建 offer SDP
      // 可选参数: offerToReceiveAudio/Video 是否愿意接收音视频
      const offer = await pc.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1
      })

      // 设置为本地描述
      // 这步很重要，不设置的话 offer SDP 不会生效
      await pc.setLocalDescription(offer)

      console.log(`创建 offer 成功，发送给 ${targetPlayerId}`)

    } catch (err) {
      console.error(`创建 offer 失败:`, err)
      error.value = '创建连接失败'
    }
  }

  /**
   * 处理收到的 offer（作为被呼叫方）
   * @param {string} fromId - 发送者 ID
   * @param {string} fromNickname - 发送者昵称
   * @param {Object} offer - SDP offer 对象
   * @param {Function} onSendAnswer - 发送 answer 的回调
   */
  async function handleOffer(fromId, fromNickname, offer, onSendAnswer) {
    // 确保连接已创建
    // 如果还没连接，先创建（被动方也需要创建连接）
    if (!peerConnections.value[fromId]) {
      console.log(`收到来自 ${fromNickname} 的 offer，创建连接`)
      // 这里的回调暂时传空，后续会通过 handleAnswer 设置正确的回调
      createConnection(fromId, '', '', () => {}, () => {}, () => {})
    }

    const pc = peerConnections.value[fromId]
    if (!pc) return

    try {
      // 将收到的 offer SDP 设置为远端描述
      await pc.setRemoteDescription(new RTCSessionDescription(offer))

      // 创建 answer SDP
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      console.log(`创建 answer 成功，发送给 ${fromId}`)

      // 发送 answer 给对方
      onSendAnswer({
        target_id: fromId,
        answer: answer
      })

    } catch (err) {
      console.error(`处理 offer 失败:`, err)
      error.value = '处理连接请求失败'
    }
  }

  /**
   * 处理收到的 answer
   * @param {string} fromId - 发送者 ID
   * @param {Object} answer - SDP answer 对象
   */
  async function handleAnswer(fromId, answer) {
    const pc = peerConnections.value[fromId]
    if (!pc) {
      console.error(`无法处理 answer: ${fromId} 的连接不存在`)
      return
    }

    try {
      // 将收到的 answer SDP 设置为远端描述
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
      console.log(`收到 ${fromId} 的 answer，连接建立中...`)

    } catch (err) {
      console.error(`处理 answer 失败:`, err)
      error.value = '建立连接失败'
    }
  }

  /**
   * 处理收到的 ICE candidate
   * @param {string} fromId - 发送者 ID
   * @param {Object} candidate - ICE candidate 对象
   */
  async function handleIceCandidate(fromId, candidate) {
    const pc = peerConnections.value[fromId]
    if (!pc) {
      console.error(`无法处理 ICE candidate: ${fromId} 的连接不存在`)
      return
    }

    try {
      // 将收到的 ICE candidate 添加到 ICE 代理
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
      console.log(`收到 ${fromId} 的 ICE candidate`)

    } catch (err) {
      console.error(`处理 ICE candidate 失败:`, err)
    }
  }

  /**
   * 关闭指定玩家的连接
   * @param {string} playerId
   */
  function closeConnection(playerId) {
    const pc = peerConnections.value[playerId]
    if (pc) {
      pc.close()
      delete peerConnections.value[playerId]
    }
    delete remoteStreams.value[playerId]
  }

  /**
   * 关闭所有连接，释放资源
   */
  function closeAllConnections() {
    // 关闭所有 peer connection
    Object.keys(peerConnections.value).forEach(playerId => {
      closeConnection(playerId)
    })

    // 停止本地媒体流
    if (localStream.value) {
      localStream.value.getTracks().forEach(track => track.stop())
      localStream.value = null
    }

    error.value = null
  }

  return {
    localStream,
    peerConnections,
    remoteStreams,
    error,
    getLocalStream,
    createConnection,
    createAndSendOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closeConnection,
    closeAllConnections
  }
}