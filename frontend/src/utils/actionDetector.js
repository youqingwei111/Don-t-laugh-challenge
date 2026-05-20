/**
 * 动作检测模块 - 基于 MediaPipe Face Mesh + Pose 实现实时动作识别
 *
 * 检测动作（均需连续多帧确认才触发回调，防抖设计）：
 *   - 眨眼：EAR < 0.22 持续 2 帧
 *   - 点头：鼻尖 Y 坐标在 10 帧内向下移动 > 0.06（归一化坐标）又向上回归
 *   - 摇头：鼻尖 X 坐标在 10 帧内向左或右偏移 > 0.10（归一化坐标）又回归
 *   - 举手：双腕 Y 坐标 < 对应肩膀 Y 坐标（> 0.12 差值）持续 5 帧
 *   - 摸鼻子：手腕/食指 Landmark 与鼻尖 Landmark 距离 < 0.08 持续 5 帧
 *
 * npm install @mediapipe/face_mesh @mediapipe/pose @mediapipe/drawing_utils @mediapipe/camera_utils
 */

import { FaceMesh } from '@mediapipe/face_mesh'
import { Pose } from '@mediapipe/pose'
import { drawingUtils } from '@mediapipe/drawing_utils'
import { Camera } from '@mediapipe/camera_utils'

// -------------------- 辅助函数 --------------------

/**
 * 计算两点之间的欧氏距离（归一化坐标）
 */
function landmarksDistance(lm1, lm2) {
  return Math.sqrt(
    (lm1.x - lm2.x) ** 2 +
    (lm1.y - lm2.y) ** 2 +
    (lm1.z - lm2.z) ** 2
  )
}

/**
 * 计算 EAR（Eye Aspect Ratio）
 * 使用 6 个眼部 Landmark 计算眼睛宽高比
 * Left Eye: 33, 160, 158, 133, 153, 144
 * Right Eye: 362, 385, 387, 263, 373, 380
 * 公式: (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 */
function calculateEAR(landmarks, eyeIndices) {
  const [i1, i2, i3, i4, i5, i6] = eyeIndices
  const p1 = landmarks[i1]
  const p2 = landmarks[i2]
  const p3 = landmarks[i3]
  const p4 = landmarks[i4]
  const p5 = landmarks[i5]
  const p6 = landmarks[i6]

  const vertical = (
    Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2) +
    Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2)
  ) / 2

  const horizontal = Math.sqrt((p4.x - p1.x) ** 2 + (p4.y - p1.y) ** 2)

  return vertical / (horizontal + 1e-6) // 防止除 0
}

// -------------------- 主要类 --------------------

export class ActionDetector {
  /**
   * @param {Object} options
   * @param {HTMLVideoElement} options.videoElement - 本地视频元素（用于 Camera Utils 渲染调试）
   * @param {Function} options.onAction - 动作触发回调 (actionName: string) => void
   * @param {boolean} options.useCameraUtils - 是否使用 MediaPipe Camera Utils（自动管理摄像头，默认 true）
   */
  constructor(options = {}) {
    this.videoElement = options.videoElement || null
    this.onAction = options.onAction || (() => {})
    this.useCameraUtils = options.useCameraUtils !== false

    this.isRunning = false
    this.debugMode = false  // 设为 true 可以在 canvas 上可视化地看到特征点

    // ---- 动作检测状态（防抖）----
    this.blinkCount = 0        // 连续 EAR < 阈值的帧数
    this.nodHistory = []        // 存储最近 N 帧的鼻尖 Y 坐标
    this.shakeHistory = []      // 存储最近 N 帧的鼻尖 X 坐标（用于摇头检测）
    this.handRaiseCount = 0     // 连续举手帧数
    this.noseTouchCount = 0     // 连续摸鼻子帧数

    // ---- 动作阈值（可调）----
    this.EAR_THRESHOLD = 0.22   // EAR 低于此值视为眨眼
    this.BLINK_FRAMES = 2       // 需要连续 N 帧才触发眨眼

    this.NOD_FRAMES = 10        // 摇头/点头检测窗口帧数
    this.NOD_THRESHOLD = 0.06   // 点头位移阈值（归一化 Y）
    this.SHAKE_THRESHOLD = 0.10 // 摇头位移阈值（归一化 X）

    this.HAND_RAISE_THRESHOLD = 0.12  // 手腕需要比肩膀高出的最小距离（归一化 Y）
    this.HAND_RAISE_FRAMES = 5        // 需要连续 N 帧才触发举手

    this.NOSE_TOUCH_THRESHOLD = 0.08  // 手 Landmark 与鼻尖距离阈值（归一化）
    this.NOSE_TOUCH_FRAMES = 5         // 需要连续 N 帧才触发摸鼻子

    // ---- 历史记录（用于双动作检测）----
    this.lastActionTime = {}  // actionName -> timestamp，防止同一动作在 2s 内重复触发
    this.ACTION_COOLDOWN = 2000 // ms

    // ---- Pose Landmark 索引（33 个关键点，0-32）----
    this.POSE_INDICES = {
      NOSE: 0,
      LEFT_SHOULDER: 11,
      RIGHT_SHOULDER: 12,
      LEFT_WRIST: 15,
      RIGHT_WRIST: 16,
      LEFT_ELBOW: 13,
      RIGHT_ELBOW: 14,
      INDEX_FINGER: 19,  // 左手食指
    }

    // ---- Face Mesh Landmark 索引----
    this.FACE_INDICES = {
      NOSE_TIP: 1,
      LEFT_EYE: [33, 160, 158, 133, 153, 144],
      RIGHT_EYE: [362, 385, 387, 263, 373, 380],
      LEFT_INDEX_FINGER: 4,  // 左眼内侧（用于辅助判断摸鼻子）
      RIGHT_INDEX_FINGER: 454,
    }
  }

  /**
   * 初始化 MediaPipe Face Mesh + Pose
   * 注意：这两个模型分开初始化，因为 Face Mesh 用于面部（眨眼），Pose 用于身体（举手）
   */
  async init() {
    console.log('[ActionDetector] Initializing MediaPipe models...')

    // ---- 初始化 Face Mesh（眼部检测）----
    this.faceMesh = new FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      }
    })

    this.faceMesh.setOptions({
      maxNumFaces: 1,              // 只检测 1 张脸
      refineLandmarks: true,        // 精细化地标（含眼角等额外点）
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    this.faceMesh.onResults((results) => this._onFaceResults(results))

    // ---- 初始化 Pose（身体检测）----
    this.pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      }
    })

    this.pose.setOptions({
      modelComplexity: 1,           // 0=Lite, 1=Full, 2=Heavy（1 是性能和精度的好平衡）
      smoothLandmarks: true,        // 平滑地标，减少抖动
      enableSegmentation: false,    // 不需要背景分割
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    this.pose.onResults((results) => this._onPoseResults(results))

    console.log('[ActionDetector] MediaPipe models initialized')
  }

  /**
   * 开始处理视频流
   * @param {HTMLVideoElement} videoElement
   */
  async start(videoElement) {
    if (this.isRunning) return

    if (!this.videoElement) {
      this.videoElement = videoElement
    }

    await this.init()
    this.isRunning = true

    // 使用 MediaPipe Camera Utils 自动从摄像头捕获并处理帧
    // 也可以用 send() 手动喂帧（见下方的 sendFrame 方法）
    this.camera = new Camera(this.videoElement, {
      onFrame: async () => {
        if (!this.isRunning) return
        // 同时发送给 Face Mesh 和 Pose
        await this.faceMesh.send({ image: this.videoElement })
        await this.pose.send({ image: this.videoElement })
      },
      width: 640,
      height: 480,
    })

    this.camera.start()
    console.log('[ActionDetector] Camera started')
  }

  /**
   * 手动喂入一帧（当不想用 Camera Utils 时可以调用此方法）
   * @param {HTMLVideoElement|HTMLCanvasElement} input
   */
  async sendFrame(input) {
    if (!this.isRunning) return
    await this.faceMesh.send({ image: input })
    await this.pose.send({ image: input })
  }

  /**
   * 停止检测，释放资源
   */
  stop() {
    this.isRunning = false
    if (this.camera) {
      this.camera.stop()
    }
    console.log('[ActionDetector] Stopped')
  }

  /**
   * 统一触发回调（带防抖）
   */
  _triggerAction(actionName) {
    const now = Date.now()
    const lastTime = this.lastActionTime[actionName] || 0

    if (now - lastTime < this.ACTION_COOLDOWN) {
      console.log(`[ActionDetector] ${actionName} triggered too recently, ignored`)
      return
    }

    this.lastActionTime[actionName] = now
    console.log(`[ActionDetector] Action triggered: ${actionName}`)
    this.onAction(actionName)
  }

  // ==================== Face Mesh 回调 ====================

  _onFaceResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      return
    }

    const landmarks = results.multiFaceLandmarks[0]

    // ---- 检测眨眼 ----
    const leftEAR = calculateEAR(landmarks, this.FACE_INDICES.LEFT_EYE)
    const rightEAR = calculateEAR(landmarks, this.FACE_INDICES.RIGHT_EYE)
    const avgEAR = (leftEAR + rightEAR) / 2

    // 调试输出
    if (this.debugMode) {
      console.log(`[ActionDetector] EAR: ${avgEAR.toFixed(3)}`)
    }

    if (avgEAR < this.EAR_THRESHOLD) {
      this.blinkCount++
      if (this.blinkCount >= this.BLINK_FRAMES) {
        this.blinkCount = 0  // 重置计数
        this._triggerAction('眨眼')
      }
    } else {
      this.blinkCount = 0
    }

    // ---- 摸鼻子（Face Mesh 提供更精细的鼻尖和手指位置）----
    const noseTip = landmarks[this.FACE_INDICES.NOSE_TIP]
    const leftIndex = landmarks[this.FACE_INDICES.LEFT_INDEX_FINGER]  // 左手食指landmark

    // 计算左手食指到鼻尖的距离
    const distLeft = landmarksDistance(leftIndex, noseTip)

    if (distLeft < this.NOSE_TOUCH_THRESHOLD) {
      this.noseTouchCount++
      if (this.noseTouchCount >= this.NOSE_TOUCH_FRAMES) {
        this.noseTouchCount = 0
        this._triggerAction('摸鼻子')
      }
    } else {
      this.noseTouchCount = 0
    }

    // ---- 可选：在 canvas 上绘制特征点（调试用）----
    if (this.debugMode && this.videoElement) {
      // 创建一个同尺寸的 canvas 可视化（略）
    }
  }

  // ==================== Pose 回调 ====================

  _onPoseResults(results) {
    if (!results.poseLandmarks) {
      return
    }

    const lm = results.poseLandmarks

    const nose = lm[this.POSE_INDICES.NOSE]
    const leftShoulder = lm[this.POSE_INDICES.LEFT_SHOULDER]
    const rightShoulder = lm[this.POSE_INDICES.RIGHT_SHOULDER]
    const leftWrist = lm[this.POSE_INDICES.LEFT_WRIST]
    const rightWrist = lm[this.POSE_INDICES.RIGHT_WRIST]

    // ---- 检测点头/摇头（基于鼻尖位移）----
    // 记录当前 Y 和 X 到历史
    this.nodHistory.push(nose.y)
    this.shakeHistory.push(nose.x)

    // 保持历史窗口长度
    if (this.nodHistory.length > this.NOD_FRAMES) {
      this.nodHistory.shift()
    }
    if (this.shakeHistory.length > this.NOD_FRAMES) {
      this.shakeHistory.shift()
    }

    if (this.nodHistory.length === this.NOD_FRAMES) {
      const firstY = this.nodHistory[0]
      const lastY = this.nodHistory[this.nodHistory.length - 1]
      const firstX = this.shakeHistory[0]
      const lastX = this.shakeHistory[this.shakeHistory.length - 1]

      // 点头：Y 先变小（鼻尖上移）再变大（鼻尖下移），且幅度足够
      // 摇头：X 单方向偏移足够大
      const deltaY = lastY - firstY  // 正=低头，负=仰头
      const deltaX = lastX - firstX  // 正=向右，负=向左

      // 检测点头（Y 偏移 > 阈值，然后回来，或直接 Y 偏移足够大）
      if (Math.abs(deltaY) > this.NOD_THRESHOLD) {
        // 只有当移动方向回转时才触发（防止单向持续偏移误报）
        const midIdx = Math.floor(this.NOD_FRAMES / 2)
        const midY = this.nodHistory[midIdx]
        const deviation = Math.abs(midY - (firstY + lastY) / 2)
        if (deviation > this.NOD_THRESHOLD * 0.5) {
          this._triggerAction('点头')
          this.nodHistory = []  // 重置，等待下一次
          this.shakeHistory = []
        }
      }

      // 检测摇头（X 偏移 > 阈值）
      if (Math.abs(deltaX) > this.SHAKE_THRESHOLD) {
        const midIdx = Math.floor(this.NOD_FRAMES / 2)
        const midX = this.shakeHistory[midIdx]
        const deviation = Math.abs(midX - (firstX + lastX) / 2)
        if (deviation > this.SHAKE_THRESHOLD * 0.5) {
          this._triggerAction('摇头')
          this.nodHistory = []
          this.shakeHistory = []
        }
      }
    }

    // ---- 检测举手（双臂或单臂，手腕高于对应肩膀）----
    let handRaised = false

    // 左腕高于左肩
    if (leftWrist.y < leftShoulder.y - this.HAND_RAISE_THRESHOLD) {
      handRaised = true
    }
    // 右腕高于右肩
    if (rightWrist.y < rightShoulder.y - this.HAND_RAISE_THRESHOLD) {
      handRaised = true
    }

    if (handRaised) {
      this.handRaiseCount++
      if (this.handRaiseCount >= this.HAND_RAISE_FRAMES) {
        this.handRaiseCount = 0
        this._triggerAction('举手')
      }
    } else {
      this.handRaiseCount = 0
    }

    // ---- 检测摸鼻子（备选方案：用 Pose 的手腕 + 鼻尖距离）----
    // 此处复用 face mesh 的结果，这里只做 Pose 的兜底
    const leftWristDist = landmarksDistance(leftWrist, nose)
    if (leftWristDist < this.NOSE_TOUCH_THRESHOLD * 1.5) {  // 稍微放宽阈值
      this.noseTouchCount++
      if (this.noseTouchCount >= this.NOSE_TOUCH_FRAMES) {
        this.noseTouchCount = 0
        this._triggerAction('摸鼻子')
      }
    }
  }
}

// -------------------- 组合式函数（便捷封装） --------------------

/**
 * 创建并启动动作检测器
 *
 * @param {Object} options
 * @param {HTMLVideoElement} options.videoElement
 * @param {Function} options.onAction - (actionName: string) => void
 * @returns {ActionDetector}
 */
export function useActionDetector(options) {
  const detector = new ActionDetector(options)

  return {
    start: (videoElement) => detector.start(videoElement),
    sendFrame: (input) => detector.sendFrame(input),
    stop: () => detector.stop(),
  }
}