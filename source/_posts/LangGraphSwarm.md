---
title: LangGraph学习笔记(8) Swarm模型
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-29 15:27:31
---


# LangGraph Swarm模型

LangGraph官方代码库实现了[Swarm](https://langchain-ai.github.io/langgraph/agents/multi-agent/#swarm)模式, 本章对官方的Swarm模式进行分析.



## 代码

使用的用例代码如下所示

``` python
from langgraph.prebuilt import create_react_agent
from langgraph_swarm import create_swarm, create_handoff_tool


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
    model="deepseek-chat",
    tools=[add, multiply, divide, create_handoff_tool(agent_name="personal_agent", description="To a personal agent")],
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
    model="deepseek-chat",
    tools=[book_flight, create_handoff_tool(agent_name="math_agent", description="To a math agent")],
    prompt=(
        "You are a personal agent.\n\n"
        "INSTRUCTIONS:\n"
        "- Assist ONLY with personal tasks\n"
        "- After you're done with your tasks, respond to the supervisor directly\n"
        "- Respond ONLY with the results of your work, do NOT include ANY other text."
    ),
    name="personal_agent",
)


swarm = create_swarm(
    agents=[personal_agent, math_agent],
    default_active_agent="math_agent",
).compile()


resp = swarm.invoke({"messages": [{"role": "user", "content": "I wanna go to Beijing next Monday"}]}, stream_mode="updates")
print(resp)
```



## Pregel图

这个Swarm中的每个节点均使用ReAct子图, 前一章节已经对ReAct进行过详细介绍, 这里对ReAct进行简化. Swarm产生的Pregel图如下图所示:

![](pregel.svg)

从图中我们可以看到, 这里引入了2个新的对象: 名为active_agent的通道, 以及handoff工具.



### active_agent通道

由于Swarm模式下不存在中心节点来负责任务的调度, 数据流向完全由各个agent自行决定, 因此Swarm需要使用单独的通道用来记录当前正在活跃的节点, 也就是这里的agent_agent通道.



### handoff工具

由于Swarm不适配静态路由, 因此需要handoff工具为每个节点设置可选的路由. 以上面的代码为例, 我们初始化Swarm时设置默认的active_agent为math_agent, 同时我们希望math_agent需要在自身无法完成任务时将执行权转移到personal_agent, 因此我们增加下面的工具:

``` python
create_handoff_tool(agent_name="personal_agent", description="To a personal agent")
```

handoff工具内部的核心执行逻辑如下所示:

``` python
@tool(name, description=description)
def handoff_to_agent(
    state: Annotated[Any, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    tool_message = ToolMessage(
        content=f"Successfully transferred to {agent_name}",
        name=name,
        tool_call_id=tool_call_id,
    )
    return Command(
        goto=agent_name,
        graph=Command.PARENT,
        update={
            "messages": [*_get_field(state, "messages"), tool_message],
            "active_agent": agent_name,
        },
    )
```

可见handoff工具的作用有二:

1. 产生一条ToolMessage;
2. 使用Command跳出当前图, 将控制权转移到上层图的指定agent;

由于Command的实现在前面的章节已经详细介绍过, 这里略过.

另外, 这里需要提一下, **messges**通道默认是支持merge的二元操作通道, 然而这里的merge会根据message id进行去重, 而非简单的append. 因此实际使用中, 可以直接将所有历史消息列表都返回. 

add_message的函数路径如下:

``` shell
/site-packages/langgraph/graph/message.py:add_messages
```

认准这个函数.
