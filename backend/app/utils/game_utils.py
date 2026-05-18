import random
import uuid
from typing import List, Dict
from pydantic import BaseModel


# -------------------- 工具函数 --------------------

def generate_room_id() -> str:
    return uuid.uuid4().hex[:8]


def generate_player_id() -> str:
    return uuid.uuid4().hex[:8]


# -------------------- 词库与任务库 --------------------

# 禁忌词库 - 共50个词，分为5组，每组10个
# 实际游戏时可从每组抽取1个，确保5个词风格不同
TABOO_WORDS = {
    "group_1": [
        "大象", "冰箱", "天空", "火车", "电脑",
        "医生", "狗", "音乐", "春节", "足球"
    ],
    "group_2": [
        "手机", "河流", "书本", "雨伞", "飞机",
        "老师", "猫", "电影", "中秋", "篮球"
    ],
    "group_3": [
        "蛋糕", "高山", "眼镜", "地铁", "电视",
        "护士", "鸟", "歌曲", "端午", "网球"
    ],
    "group_4": [
        "沙发", "大海", "帽子", "出租车", "相机",
        "警察", "鱼", "舞蹈", "清明", "排球"
    ],
    "group_5": [
        "台灯", "沙漠", "手套", "电梯", "手机壳",
        "厨师", "兔子", "画画", "重阳", "羽毛球"
    ]
}

# 随机任务库 - 共30个任务
# 格式: (任务描述, 是否需要指定玩家, 是否需要道具)
RANDOM_TASKS = [
    ("请大声朗读以下绕口令：四是四，十是十", False, False),
    ("请用方言模仿主持人播报天气", False, False),
    ("请表演一个动物的经典动作，其他人要猜", False, False),
    ("请玩家C唱一段你最喜欢的歌", True, False),  # 随机选一个玩家
    ("请所有玩家同时做鬼脸，持续5秒", False, False),
    ("请玩家D表演一段绕口令", True, False),
    ("请模仿一种你熟悉的声音（汽车鸣笛、门铃等）", False, False),
    ("请玩家A用三种不同的语气说'hello'", True, False),
    ("请所有人一起做一个搞笑的自我介绍", False, False),
    ("请玩家B表演你最近学到的一个新技能", True, False),
    ("请用即兴表演的方式讲一个冷笑话", False, False),
    ("请玩家E模仿在场任意一人的说话方式", True, False),
    ("请所有人同时数数，从1数到20，要求语速越来越快", False, False),
    ("请玩家C表演一段你小时候最喜欢的动画片片段", True, False),
    ("请做出一道数学题：15 + 27 = ? 并大声说出答案", False, False),
    ("请玩家A表演一个你最近看过的电影海报", True, False),
    ("请模仿一种自然现象的声音（风声、雨声、雷声等）", False, False),
    ("请玩家D用肢体语言表达'我很开心'", True, False),
    ("请所有人一起合唱一首生日歌", False, False),
    ("请玩家B朗读以下诗句：床前明月光，疑是地上霜", True, False),
    ("请模仿一种职业的典型动作（教师、医生、厨师等）", False, False),
    ("请玩家E用不同的语调重复说：今天天气真好", True, False),
    ("请表演你早上起床后做的第一件事", False, False),
    ("请玩家A模仿一种宠物的叫声和行为", True, False),
    ("请所有玩家一起做5个俯卧撑", False, False),
    ("请玩家C用说唱的方式自我介绍", True, False),
    ("请模仿一个你认为最有意思的老师上课的样子", False, False),
    ("请玩家D表演当你听到好消息时的反应", True, False),
    ("请所有人一起玩'石头剪刀布'，输的人要做惩罚", False, False),
    ("请玩家E说一个你最近的烦恼，然后其他人一起出主意", True, False),
]


# -------------------- 数据模型 --------------------

class GameTask(BaseModel):
    """游戏任务"""
    id: str
    description: str
    target_player_id: str | None = None  # 被指定执行任务的玩家ID
    target_player_name: str | None = None
    duration: int = 30  # 任务持续时间（秒）


class GameState(BaseModel):
    """游戏状态"""
    round: int = 1
    current_task: GameTask | None = None
    task_start_time: float | None = None
    taboo_words: Dict[str, str] = {}  # player_id -> taboo_word
    violations: Dict[str, int] = {}  # player_id -> 犯规次数
    used_tasks: List[int] = []  # 已使用过的任务索引
    is_active: bool = False


# -------------------- 游戏引擎 --------------------

class GameEngine:
    """游戏引擎 - 管理一局游戏的全部逻辑"""

    def __init__(self, room_id: str, players: list):
        self.room_id = room_id
        self.players = players
        self.state = GameState()
        self.task_timer = None  # 定时器引用（asyncio）

    def distribute_taboo_words(self) -> Dict[str, str]:
        """
        为每个玩家分配禁忌词
        简单实现：从所有词库中随机抽取与玩家数量相等的词，
        然后依次分配给每个玩家。
        即使只有1个或2个玩家也不会崩溃。
        """
        taboo_distribution = {}
        all_words = []

        # 1. 收集所有词到列表
        for group in TABOO_WORDS.values():
            all_words.extend(group)

        # 2. 随机抽取与玩家数量相等的词（不重复）
        selected_words = random.sample(all_words, len(self.players))

        # 3. 依次分配给每个玩家
        for i, player in enumerate(self.players):
            taboo_distribution[player.id] = selected_words[i]

        return taboo_distribution

    def get_filtered_taboo_words(self, player_id: str) -> Dict[str, str]:
        """
        获取指定玩家应该看到的禁忌词（不包含自己的）
        这是核心安全逻辑：玩家只能看到其他人的禁忌词
        """
        filtered = {}
        for pid, word in self.state.taboo_words.items():
            if pid != player_id:
                player = next((p for p in self.players if p.id == pid), None)
                if player:
                    filtered[player.nickname] = word
        return filtered

    def generate_task(self) -> GameTask:
        """生成一个新的随机任务"""
        available_indices = [
            i for i in range(len(RANDOM_TASKS))
            if i not in self.state.used_tasks
        ]

        if not available_indices:
            # 任务库用完，重置
            self.state.used_tasks = []
            available_indices = list(range(len(RANDOM_TASKS)))

        task_idx = random.choice(available_indices)
        self.state.used_tasks.append(task_idx)

        task_desc, needs_target, _ = RANDOM_TASKS[task_idx]
        target_player = None
        target_name = None

        if needs_target:
            # 随机选择一个玩家作为任务目标
            target = random.choice(self.players)
            target_player = target.id
            target_name = target.nickname
            # 替换任务描述中的占位符（如"玩家C"）
            task_desc = task_desc.replace("玩家C", target.nickname)
            task_desc = task_desc.replace("玩家A", target.nickname)
            task_desc = task_desc.replace("玩家B", target.nickname)
            task_desc = task_desc.replace("玩家D", target.nickname)
            task_desc = task_desc.replace("玩家E", target.nickname)

        task = GameTask(
            id=f"task_{self.state.round}_{task_idx}",
            description=task_desc,
            target_player_id=target_player,
            target_player_name=target_name
        )

        self.state.current_task = task
        self.state.task_start_time = None  # 将在广播时设置

        return task

    def next_round(self):
        """进入下一轮"""
        self.state.round += 1
        self.state.current_task = None

    def end_game(self):
        """结束游戏"""
        self.state.is_active = False
        self.state.current_task = None


# 存储活跃的游戏引擎实例
active_games: Dict[str, GameEngine] = {}


def get_or_create_game(room_id: str, players: list) -> GameEngine:
    """获取或创建游戏引擎实例"""
    if room_id not in active_games:
        active_games[room_id] = GameEngine(room_id, players)
    return active_games[room_id]


def remove_game(room_id: str):
    """移除游戏引擎实例"""
    if room_id in active_games:
        del active_games[room_id]