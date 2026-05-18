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

  // ICE 候选者队列：解决竞态条件（candidate 在 setRemoteDescription 之前到达）
  const iceCandidateQueues = ref({})

  // 发送回调的引用（由 GameRoom 在创建连接时传入）
  let sendOfferCallback = null
  let sendAnswerCallback = null
  let sendIceCandidateCallback = null

  /**
   * 获取本地摄像头权限并返回媒体流
   * @returns {Promise<MediaStream>}
   */
  async function getLocalStream() {
    try {
      // 安全检查：navigator.mediaDevices 在非安全环境（HTTP）下可能为 undefined
      if (!navigator.mediaDevices) {
        const errMsg = '浏览器安全限制：请使用 HTTPS 或 localhost 访问以开启摄像头'
        console.error('getLocalStream failed:', errMsg)
        error.value = errMsg
        throw new Error(errMsg)
      }

      // 请求摄像头和麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
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
      if (err.message.includes('浏览器安全限制')) {
        error.value = err.message
      } else {
        error.value = '无法访问摄像头，请检查浏览器权限设置'
      }
      throw err
    }
  }

  /**
   * 设置发送回调（由 GameRoom 调用一次）
   */
  function setSendCallbacks(offerCb, answerCb, iceCb) {
    sendOfferCallback = offerCb
    sendAnswerCallback = answerCb
    sendIceCandidateCallback = iceCb
    console.log('[WebRTC] Send callbacks registered')
  }

  /**
   * 处理 ICE 候选者队列
   * 当 remoteDescription 设置好后，调用此方法消费队列
   */
  async function processIceCandidateQueue(playerId) {
    const pc = peerConnections.value[playerId]
    if (!pc) return

    const queue = iceCandidateQueues.value[playerId] || []
    console.log(`[WebRTC] Processing ICE queue for ${playerId}, ${queue.length} candidates`)

    while (queue.length > 0) {
      const candidate = queue.shift()
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        console.log(`[WebRTC] Queued ICE candidate added for ${playerId}`)
      } catch (err) {
        console.error(`[WebRTC] Failed to add queued ICE candidate:`, err)
      }
    }
  }

  /**
   * 为指定玩家创建 WebRTC 连接
   * 必须在 localStream 准备好之后才能调用！
   */
  function createConnection(targetPlayerId) {
    // 如果已存在连接，直接返回
    if (peerConnections.value[targetPlayerId]) {
      return peerConnections.value[targetPlayerId]
    }

    // 致命检查：localStream 必须已经获取到
    if (!localStream.value) {
      console.error('[WebRTC] 致命错误：尝试创建连接时，本地视频流尚未获取到！')
      error.value = '本地视频流未就绪，无法创建连接'
      throw new Error('localStream is null - must call getLocalStream() first')
    }

    // 初始化 ICE 候选者队列
    iceCandidateQueues.value[targetPlayerId] = []

    const pc = createPeerConnection()

    // ---- 挂载本地媒体轨道到连接 ----
    console.log('[WebRTC] 挂载本地媒体轨道到连接')
    localStream.value.getTracks().forEach(track => {
      pc.addTrack(track, localStream.value)
      console.log(`[WebRTC] addTrack: ${track.kind}, label: ${track.label}`)
    })

    // ---- 处理接收到远程视频轨道 ----
    pc.ontrack = (event) => {
      console.log(`[WebRTC] 收到 ${targetPlayerId} 的视频轨道`)
      remoteStreams.value[targetPlayerId] = event.streams[0]
    }

    // ---- 处理 ICE 候选地址 ----
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] ICE candidate for ${targetPlayerId}:`, event.candidate)
        if (sendIceCandidateCallback) {
          sendIceCandidateCallback({
            target_id: targetPlayerId,
            candidate: event.candidate
          })
        }
      }
    }

    // ---- 处理连接状态变化 ----
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] 与 ${targetPlayerId} 的连接状态: ${pc.connectionState}`)
      if (pc.connectionState === 'failed') {
        error.value = `与 ${targetPlayerId} 的连接失败`
      }
    }

    // ---- 处理 ICE 连接状态变化 ----
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE 连接状态 (${targetPlayerId}): ${pc.iceConnectionState}`)
    }

    // 保存连接
    peerConnections.value[targetPlayerId] = pc
    console.log(`[WebRTC] Created connection for ${targetPlayerId}`)

    return pc
  }

  /**
   * 创建并发送 offer（主动呼叫方）
   */
  async function createAndSendOffer(targetPlayerId) {
    const pc = peerConnections.value[targetPlayerId]
    if (!pc) {
      console.error(`[WebRTC] 无法创建 offer: ${targetPlayerId} 的连接不存在`)
      return
    }

    try {
      // 创建 offer SDP
      const offer = await pc.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1
      })

      // 设置为本地描述
      await pc.setLocalDescription(offer)
      console.log(`[WebRTC] Offer created, local description set for ${targetPlayerId}`)

      // 真正发送 offer 给对方！传递两个独立参数
      if (sendOfferCallback) {
        console.log(`[WebRTC] Sending offer to ${targetPlayerId}`)
        sendOfferCallback(targetPlayerId, pc.localDescription)
      } else {
        console.error(`[WebRTC] sendOfferCallback is null!`)
      }

    } catch (err) {
      console.error(`[WebRTC] 创建 offer 失败:`, err)
      error.value = '创建连接失败'
    }
  }

  /**
   * 处理收到的 offer（被呼叫方）
   */
  async function handleOffer(fromId, fromNickname, offer) {
    console.log(`[WebRTC] 收到来自 ${fromNickname} (${fromId}) 的 offer`)

    // 确保连接已创建
    if (!peerConnections.value[fromId]) {
      console.log(`[WebRTC] 为 ${fromId} 创建连接（被动方）`)
      createConnection(fromId)
    }

    const pc = peerConnections.value[fromId]
    if (!pc) {
      console.error(`[WebRTC] 无法处理 offer: 连接不存在`)
      return
    }

    try {
      // 将收到的 offer SDP 设置为远端描述
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      console.log(`[WebRTC] Remote description set for ${fromId} (from offer)`)

      // 处理队列中的 ICE candidate（可能在 setRemoteDescription 之前到达）
      await processIceCandidateQueue(fromId)

      // 创建 answer SDP
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log(`[WebRTC] Answer created for ${fromId}`)

      // 发送 answer 给对方！传递两个独立参数
      if (sendAnswerCallback) {
        console.log(`[WebRTC] Sending answer to ${fromId}`)
        sendAnswerCallback(fromId, pc.localDescription)
      } else {
        console.error(`[WebRTC] sendAnswerCallback is null!`)
      }

    } catch (err) {
      console.error(`[WebRTC] 处理 offer 失败:`, err)
      error.value = '处理连接请求失败'
    }
  }

  /**
   * 处理收到的 answer
   */
  async function handleAnswer(fromId, answer) {
    console.log(`[WebRTC] 收到 ${fromId} 的 answer`)
    const pc = peerConnections.value[fromId]
    if (!pc) {
      console.error(`[WebRTC] 无法处理 answer: ${fromId} 的连接不存在`)
      return
    }

    try {
      // 将收到的 answer SDP 设置为远端描述
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
      console.log(`[WebRTC] Remote description set for ${fromId} (from answer)`)

      // 处理队列中的 ICE candidate
      await processIceCandidateQueue(fromId)

    } catch (err) {
      console.error(`[WebRTC] 处理 answer 失败:`, err)
      error.value = '建立连接失败'
    }
  }

  /**
   * 处理收到的 ICE candidate
   * 解决竞态条件：如果 remoteDescription 还没设置好，先放入队列
   */
  async function handleIceCandidate(fromId, candidate) {
    const pc = peerConnections.value[fromId]
    if (!pc) {
      console.error(`[WebRTC] 无法处理 ICE candidate: ${fromId} 的连接不存在`)
      return
    }

    try {
      // 检查 remoteDescription 是否已设置
      if (pc.remoteDescription === null || pc.remoteDescription === undefined) {
        // 还没设置好，先放入队列
        if (!iceCandidateQueues.value[fromId]) {
          iceCandidateQueues.value[fromId] = []
        }
        iceCandidateQueues.value[fromId].push(candidate)
        console.log(`[WebRTC] ICE candidate queued for ${fromId} (remoteDescription not ready yet), queue size: ${iceCandidateQueues.value[fromId].length}`)
      } else {
        // remoteDescription 已设置，直接添加
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        console.log(`[WebRTC] ICE candidate added for ${fromId}`)
      }
    } catch (err) {
      console.error(`[WebRTC] 处理 ICE candidate 失败:`, err)
    }
  }

  /**
   * 关闭指定玩家的连接
   */
  function closeConnection(playerId) {
    const pc = peerConnections.value[playerId]
    if (pc) {
      pc.close()
      delete peerConnections.value[playerId]
    }
    delete remoteStreams.value[playerId]
    delete iceCandidateQueues.value[playerId]
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
    iceCandidateQueues.value = {}
  }

  return {
    localStream,
    peerConnections,
    remoteStreams,
    error,
    getLocalStream,
    setSendCallbacks,
    createConnection,
    createAndSendOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closeConnection,
    closeAllConnections
  }
}