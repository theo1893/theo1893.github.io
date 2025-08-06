---
title: LangGraph Swarm
categories:
  - Tech
tags:
  - LangGraph
  - Agent
---

# LangGraph Swarm

LangGraph官方代码库实现了[Swarm](https://langchain-ai.github.io/langgraph/agents/multi-agent/#swarm)模式, 本章对官方的Swarm模式进行分析.



## 代码

使用的用例代码如下所示

``` python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor
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
    model="openai:gpt-4.1",
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
    model="openai:gpt-4.1",
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


for chunk in swarm.stream({"messages": [{"role": "user", "content": "I wanna go to Beijing next Monday"}]}):
    print(chunk)
```



## Pregel图

