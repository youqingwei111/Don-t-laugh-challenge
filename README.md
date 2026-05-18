# Don't Laugh Challenge

一个实时多人憋笑挑战游戏，支持视频通话、禁忌词检测和举报功能。

## 功能特性

- **实时视频通话**：使用 WebRTC 技术实现玩家之间的实时视频通信
- **禁忌词检测**：房主可以设置禁忌词，玩家说出禁忌词将被检测
- **举报功能**：玩家可以手动举报其他玩家违规
- **房间系统**：支持创建和加入游戏房间

## 技术栈

### 后端
- **FastAPI** - 异步 Web 框架
- **Pydantic** - 数据验证
- **WebSocket** - 实时通信
- **UVicorn** - ASGI 服务器

### 前端
- **Vue 3** - 渐进式 JavaScript 框架
- **Vite** - 现代前端构建工具
- **Axios** - HTTP 客户端
- **Pinia** - Vue 状态管理
- **Vue Router** - Vue 官方路由

## 项目结构

```
├── backend/                 # 后端服务
│   ├── app/
│   │   ├── main.py         # FastAPI 入口
│   │   ├── models/         # 数据模型
│   │   │   ├── player.py   # 玩家模型
│   │   │   └── room.py     # 房间模型
│   │   ├── routers/        # API 路由
│   │   │   ├── room.py     # 房间相关路由
│   │   │   └── ws.py       # WebSocket 路由
│   │   ├── utils/          # 工具函数
│   │   │   └── game_utils.py
│   │   └── websocket/      # WebSocket 管理
│   │       └── manager.py
│   └── requirements.txt    # Python 依赖
│
└── frontend/                # 前端应用
    ├── src/
    │   ├── api/            # API 请求
    │   ├── components/      # Vue 组件
    │   ├── router/         # 路由配置
    │   ├── stores/         # Pinia 状态库
    │   ├── utils/          # 工具函数
    │   │   └── webrtc.js   # WebRTC 封装
    │   ├── views/          # 页面视图
    │   │   ├── Home.vue    # 首页
    │   │   ├── GameRoom.vue # 游戏房间
    │   │   └── WaitingRoom.vue # 等待房间
    │   ├── App.vue
    │   └── main.js
    ├── index.html
    ├── vite.config.js
    └── package.json
```

## 快速开始

### 前置条件

- Python 3.8+
- Node.js 18+

### 后端安装

```bash
cd backend
pip install -r requirements.txt
```

### 前端安装

```bash
cd frontend
npm install
```

### 启动服务

**启动后端：**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**启动前端：**
```bash
cd frontend
npm run dev
```

前端默认运行在 `http://localhost:5173`

## 游戏规则

1. 玩家进入房间后进行视频通话
2. 房主可以设置禁忌词
3. 玩家在游戏中不能说禁忌词
4. 玩家可以举报说禁忌词的玩家
5. 被举报后禁忌词将被重置

## License

MIT