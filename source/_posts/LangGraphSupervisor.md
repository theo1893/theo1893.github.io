---
title: LangGraph学习笔记(9) Supervisor模型
date: 2025-08-30 15:44:04
categories:
  - Tech
tags:
  - LangGraph
  - Agent
---

# LangGraph Supervisor模型

LangGraph官方代码库同样实现了[Supervisor](https://langchain-ai.github.io/langgraph/agents/multi-agent/#supervisor)模式, 本章对官方的Supervisor模式进行分析.



## 代码

本章使用的代码如下所示:

``` python
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor
from langchain_deepseek import ChatDeepSeek

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
    return "Done"


math_agent = create_react_agent(
    model="deepseek-chat",
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
    model="deepseek-chat",
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


_llm = ChatDeepSeek(model="deepseek-chat")
supervisor = create_supervisor(
    model=_llm,
    agents=[math_agent, personal_agent],
    prompt=(
        "You are a supervisor managing two agents:\n"
        "- a personal agent. Assign personal related tasks to this agent, for example, booking a flight\n"
        "- a math agent. Assign math-related tasks to this agent\n"
        "Assign work to one agent at a time, do not call agents in parallel.\n"
        "Do not do any work yourself.\n"
        "Remember that if the task failed for some reasons, you must retry it to make sure it succeeded."
    ),
    add_handoff_back_messages=True,
    output_mode="full_history",
).compile()

resp = supervisor.invoke({"messages": [{"role": "user", "content": "Book me an flight to Beijing."}]}, stream_mode="values")
print(resp)
```

和前一章Swarm相同, 使用math_agent和personal_agent, 不同之处在于, 由于Supervisor模式下存在一个用户不可见的调度节点, 因此agent的工具集不需要指定handoff tool.



## Pregel图

这里生成的Pregel图如下图所示:

![](pregel.svg)



### supervisor_agent

前面我们提到, 在使用Supervisor模式时, 会生成一个用户不可见的调度节点, 这个节点即是supervisor_agent. 在默认情况下, supervisor_agent负责下面2个功能:

1. 判断当前任务是否完成, 如果已经完成, 则终止执行;
2. 如果任务未完成, 则将执行权通过Command转移到其他的执行节点;

每个执行节点在执行完成后, 会将执行权归还supervisor_agent, 这样构成一个以单节点为中心的网状结构, 如上图.
