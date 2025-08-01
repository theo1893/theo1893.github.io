## 代码

``` python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor

def add(a: float, b: float):
    """Add two numbers."""
    return a + b


def multiply(a: float, b: float):
    """Multiply two numbers."""
    return a * b


def divide(a: float, b: float):
    """Divide two numbers."""
    return a / b

def book_flight():
    """ Book flight """
    return "Success"


math_agent = create_react_agent(
    model="openai:gpt-4.1",
    tools=[add, multiply, divide],
    prompt=(
        "You are a math agent.\n\n"
        "INSTRUCTIONS:\n"
        "- Assist ONLY with math-related tasks\n"
        "- After you're done with your tasks, respond to the supervisor directly\n"
        "- Respond ONLY with the results of your work, do NOT include ANY other text."
    ),
    name="math_agent",
)

personal_agent = create_react_agent(
    model="openai:gpt-4.1",
    tools=[book_flight],
    prompt=(
        "You are a personal agent.\n\n"
        "INSTRUCTIONS:\n"
        "- Assist ONLY with personal tasks\n"
        "- After you're done with your tasks, respond to the supervisor directly\n"
        "- Respond ONLY with the results of your work, do NOT include ANY other text."
    ),
    name="personal_agent",
)


_llm = ChatOpenAI(model="gpt-4.1",)
supervisor = create_supervisor(
    model=_llm,
    agents=[math_agent, personal_agent],
    prompt=(
        "You are a supervisor managing two agents:\n"
        "- a personal agent. Assign personal tasks to this agent\n"
        "- a math agent. Assign math-related tasks to this agent\n"
        "Assign work to one agent at a time, do not call agents in parallel.\n"
        "Do not do any work yourself.\n"
        "Remember that if the task failed for some reasons, you must retry it to make sure it succeeded."
    ),
    add_handoff_back_messages=True,
    output_mode="full_history",
).compile()

for chunk in supervisor.stream({"messages": [{"role": "user", "content": "I wanna go to Beijing next Monday"}]}):
    print(chunk)
```





## 图

见supervisor_graph



## 最大执行次数(TBD)

LangGraph按照Pregel组织, 每个Pregel在执行时有自己的PregelLoop. 即存在下面2个事实:

1. 对一次调用而言, 调用共享一份配置, 即所有Pregel对象均受限于相同的recursion limit. 默认为25.
2. 当前所在Pregel Loop每执行一步, 当前Pregel Loop的执行步数+1;  Sub Graph本次执行完成后, 返回Parent Pregel Graph, Parent Pregel Loop执行步数+1. **存疑**
3. 重入一个Pregel对象时, 执行轮数会被重置到0.

总的来说, 最外层Pregel对象的执行轮数始终递增, 内层Pregel对象的执行轮数在每次重入时清零, 最终整个graph表现为最外层Pregel的执行上限.



## LangGraph提供的react agent有反思吗

没有.

LangGraph封装的react agent仅判断最新一条message是否包含tool call, 如果不包含tool call, 则退出react执行流.