# 团队成员与分工

## 项目介绍

Don't Laugh Challenge 是一个实时多人憋笑挑战游戏，支持视频通话、禁忌词自动检测和动作识别功能。

## 项目整体方案

### 技术架构

- 前端：Vue 3 + Vite + WebRTC + MediaPipe Pose + Web Speech API
- 后端：FastAPI + WebSocket
- 通信：WebSocket 实时消息推送 + WebRTC P2P 媒体流

### 核心流程

玩家进入房间后开启视频通话，房主设置禁忌词。玩家说话时通过语音识别检测禁忌词，系统自动重置。动作检测实时分析玩家姿态，异常动作也会触发提示。

### 目录结构

```
backend/          # FastAPI 后端
  app/
    models/       # 数据模型
    routers/      # API 路由
    utils/        # 游戏逻辑
    websocket/    # WebSocket管理
  requirements.txt

frontend/         # Vue 3 前端
  src/
    api/          # API请求
    utils/        # 工具模块(webrtc/actionDetector/speechDetector)
    views/        # 页面组件
  package.json
```

## 团队成员分工

### 罗仁杰：项目架构师

**主要职责：项目初始化与基础架构搭建**

- 设计并搭建项目整体架构（前后端分离）
- 搭建 FastAPI 后端框架结构
  - `backend/app/main.py` - 应用入口
  - `backend/app/models/` - 数据模型设计
  - `backend/app/routers/` - API 路由设计
- 搭建 Vue 3 前端框架结构
  - `frontend/src/main.js` - 前端入口
  - `frontend/src/App.vue` - 根组件
  - `frontend/src/router/` - 路由配置
- 编写项目配置文件
  - `backend/requirements.txt` - Python 依赖
  - `frontend/package.json` - Node.js 依赖
  - `frontend/vite.config.js` - Vite 构建配置

---

### 尤青伟：WebRTC 视频通话工程师

**主要职责：实时视频通话功能实现**

- 开发 WebRTC 封装模块
  - `frontend/src/utils/webrtc.js` - WebRTC 核心功能封装
  - 信令服务器通信
  - 媒体流处理
- 开发后端 WebSocket 管理器
  - `backend/app/websocket/manager.py` - WebSocket 连接管理
  - `backend/app/routers/ws.py` - WebSocket 路由处理
- 开发视频通话界面
  - `frontend/src/views/GameRoom.vue` - 游戏房间视频区域
- 实现房间系统
  - `frontend/src/views/Room.vue` - 房间创建/加入
  - `backend/app/models/room.py` - 房间数据模型
  - `backend/app/routers/room.py` - 房间 API

---

### 姚明强：游戏逻辑工程师

**主要职责：游戏核心玩法逻辑实现**

- 开发游戏工具函数
  - `backend/app/utils/game_utils.py` - 核心游戏逻辑
- 实现禁忌词系统
  - 禁忌词设置功能
  - 禁忌词检测与匹配
  - 禁忌词重置机制
- 实现自动检测系统
  - 语音识别自动检测禁忌词
  - 检测到后禁忌词自动重置
- 开发玩家数据模型
  - `backend/app/models/player.py` - 玩家数据模型

---

### 王震：动作识别工程师

**主要职责：玩家动作检测与识别**

- 开发动作检测模块
  - `frontend/src/utils/actionDetector.js` - MediaPipe Pose 集成
  - 33个关键点姿态检测
  - 动作数据提取与处理
- 后端动作数据处理
  - `backend/app/routers/ws.py` - 动作数据 WebSocket 传输
- 动作可视化
  - `frontend/src/views/GameRoom.vue` - 动作检测结果显示

---

### 杨鑫烨：语音识别工程师

**主要职责：玩家语音检测与识别**

- 开发语音检测模块
  - `frontend/src/utils/speechDetector.js` - 语音识别功能
  - 实时语音转文字
  - 敏感词检测
- 语音数据传输
  - WebSocket 语音数据实时传输
  - 后端语音数据处理

---

## 协作方式

- 使用 Git 进行版本管理
- 遵循 feature-branch 工作流
- 通过 WebSocket 实现实时多人协作
- 前后端通过 REST API 和 WebSocket 通信

## 技术栈

- 后端框架：FastAPI + Uvicorn
- 前端框架：Vue 3 + Vite + Pinia
- 实时通信：WebSocket
- 视频通话：WebRTC
- 动作识别：MediaPipe Pose
- 语音识别：Web Speech API
