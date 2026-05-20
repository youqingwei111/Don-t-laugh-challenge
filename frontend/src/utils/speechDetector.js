/**
 * 语音识别模块 - 基于 Web Speech API 实现实时语音转文字
 *
 * 功能：
 *   - 持续监听系统默认麦克风输入
 *   - 将识别出的文本片段通过回调输出
 *   - 识别器意外中断时自动重启
 *   - 支持中文（zh-CN）识别
 *
 * 使用方式：
 *   const detector = new SpeechDetector({
 *     onTranscript: (text) => {
 *       console.log('识别到文本:', text)
 *       // 发送给后端比对禁忌词
 *     },
 *     onError: (error) => {
 *       console.error('识别器错误:', error)
 *     }
 *   })
 *   detector.start()
 */

export class SpeechDetector {
  constructor(options = {}) {
    this.onTranscript = options.onTranscript || (() => {})
    this.onInterimTranscript = options.onInterimTranscript || (() => {})
    this.onError = options.onError || (() => {})
    this.onStart = options.onStart || (() => {})
    this.onEnd = options.onEnd || (() => {})

    this.isRunning = false
    this.recognition = null

    // 静默重试计数（连续识别失败一定次数后触发重启）
    this._silenceCount = 0
    this._maxSilenceCount = 3  // 3 次识别结果为空白则重启

    // 识别器配置
    this.config = {
      lang: 'zh-CN',           // 中文
      continuous: true,         // 持续识别，不自动终止
      interimResults: true,     // 返回中间结果（不稳定的临时文本）
      maxAlternatives: 1,       // 只取最佳结果
    }
  }

  /**
   * 创建 SpeechRecognition 实例（兼容不同浏览器前缀）
   */
  _createRecognition() {
    const SpeechRecognition = window.SpeechRecognition ||
                             window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      throw new Error('当前浏览器不支持 Web Speech API')
    }

    const recognition = new SpeechRecognition()
    recognition.lang = this.config.lang
    recognition.continuous = this.config.continuous
    recognition.interimResults = this.config.interimResults
    recognition.maxAlternatives = this.config.maxAlternatives

    // ---- 识别出一段结果时触发 ----
    // 注意：continuous 模式下，即使说话停顿也不会自动结束，
    // 每次识别出一段话（一个 utterance 的结尾）就会触发 onresult
    recognition.onresult = (event) => {
      this._silenceCount = 0

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript.trim()
        const isFinal = result.isFinal

        if (transcript) {
          if (isFinal) {
            // 最终结果：用户说完了一段话，非常可靠
            console.log(`[SpeechDetector] Final: "${transcript}"`)
            this.onTranscript(transcript)
          } else {
            // 中间结果：用户还在说，文本不稳定
            // 可以选择是否输出中间结果（这里默认不输出，除非有需要）
            this.onInterimTranscript(transcript)
          }
        }
      }
    }

    // ---- 识别开始（用户授权麦克风后）----
    recognition.onstart = () => {
      console.log('[SpeechDetector] 识别开始')
      this.isRunning = true
      this._silenceCount = 0
      this.onStart()
    }

    // ---- 识别结束（通常由用户主动停止或网络问题触发）----
    recognition.onend = () => {
      console.log('[SpeechDetector] 识别结束')
      this.isRunning = false
      this.onEnd()

      // 识别器意外终止且我们仍在运行时，自动重启
      if (this._shouldRestart) {
        console.log('[SpeechDetector] 识别器意外停止，尝试在 1 秒后重启...')
        setTimeout(() => {
          if (this._shouldRestart) {
            this.start()
          }
        }, 1000)
      }
    }

    // ---- 识别出错 ----
    recognition.onerror = (event) => {
      console.error(`[SpeechDetector] 识别错误: ${event.error}`)

      this.onError(event.error)

      // 某些错误可以自动恢复
      if (event.error === 'no-speech') {
        // 用户没有说话，增加静默计数
        this._silenceCount++
        console.log(`[SpeechDetector] 静默次数: ${this._silenceCount}`)
        if (this._silenceCount >= this._maxSilenceCount) {
          console.log('[SpeechDetector] 静默次数过多，重启识别器')
          this._restart()
        }
        return
      }

      if (event.error === 'audio-capture') {
        console.error('[SpeechDetector] 无法访问麦克风，请检查权限')
        return
      }

      if (event.error === 'network') {
        // 网络错误，稍后重试
        console.warn('[SpeechDetector] 网络错误，2秒后重试')
        setTimeout(() => this._restart(), 2000)
        return
      }

      // 其他错误（not-allowed, service-not-allowed 等）需要用户手动重启
      if (['not-allowed', 'service-not-allowed', 'aborted'].includes(event.error)) {
        console.warn(`[SpeechDetector] 错误 "${event.error}" 需要手动重启`)
        this._shouldRestart = false
      }
    }

    this.recognition = recognition
    return recognition
  }

  /**
   * 启动语音识别
   */
  start() {
    if (this.isRunning) {
      console.warn('[SpeechDetector] 识别器已在运行中')
      return
    }

    try {
      this._shouldRestart = true
      this._silenceCount = 0
      const recognition = this._createRecognition()
      recognition.start()
      console.log('[SpeechDetector] 已发送 start 请求')
    } catch (err) {
      console.error('[SpeechDetector] 启动失败:', err)
      // 如果是因为已经在运行，先停止再启动
      if (err.message && err.message.includes('already started')) {
        this._restart()
      } else {
        this.onError(err.message)
      }
    }
  }

  /**
   * 停止语音识别
   */
  stop() {
    this._shouldRestart = false
    if (this.recognition) {
      try {
        this.recognition.stop()
      } catch (err) {
        console.warn('[SpeechDetector] stop 时出错:', err)
      }
    }
    this.isRunning = false
    console.log('[SpeechDetector] 已停止')
  }

  /**
   * 重启识别器（用于静默超时或出错后恢复）
   */
  _restart() {
    if (!this._shouldRestart) return

    this.stop()
    setTimeout(() => {
      if (this._shouldRestart) {
        this.start()
      }
    }, 300)
  }

  /**
   * 手动触发一次重启（外部可调用）
   */
  restart() {
    this._restart()
  }
}

// -------------------- 组合式便捷封装 --------------------

/**
 * 创建并启动语音识别器
 *
 * @param {Object} options
 * @param {Function} options.onTranscript - 最终文本回调 (text: string) => void
 * @param {Function} options.onError - 错误回调 (error: string) => void
 * @returns {SpeechDetector}
 */
export function useSpeechDetector(options) {
  const detector = new SpeechDetector(options)
  return detector
}
