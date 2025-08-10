---
title: LangGraph学习笔记(4) ReAct模型
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-09 14:53:38
---


# LangGraph ReAct模型

[ReAct](https://arxiv.org/pdf/2210.03629)机制由2个步骤组成: Reasoning 和 Acting. 在Reasoning阶段, LLM根据当前可用的工具集, 判断是否需要进行Acting; 在Acting阶段, LLM使用指定的工具进行一步操作, 然后将控制权再次交给Reasoning, 进行下一轮判断. 而在这2个步骤之前, ReAct模型还需要进行一些初始化的工作.

本章会基于下面这一段代码, 从Init, Reasoning, Acting 3个基本组成部分介绍LangGraph实现的ReAct模型.

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


for chunk in math_agent.stream({"messages": [{"role": "user", "content": "Calculate 1+1"}]}):
    print(chunk)
```

## Init

在ReAct的初始化阶段, LangGraph主要做了2个操作: 构造ToolNode, 以及构造Pregel图.

### ToolNode

在LangGraph的实现中, Tool对象是对可执行工具的基本封装, 每个Tool对应着一个工具. 而ToolNode是由多个Tool组成的工具集结点, 对应着一个Pregel结点. 

在初始化流程中, LangGraph首先将用户指定的多个可执行对象分别封装为单独的StructuredTool对象, 其核心定义如下:

``` python
class StructuredTool(BaseTool):
    ......
    
    description: str = ""	## 工具描述. 默认使用func的docstring.
    args_schema: Annotated[ArgsSchema, SkipValidation()] = Field(
        ..., description="The tool schema."
    )	## 工具参数, 由func的签名推导得出.
    func: Optional[Callable[..., Any]] = None	## 实际的可执行对象.
    
    ......
```

而ToolNode就是Tool的集合, 其包含了用户指定的所有Tool. 以上面的代码为例, LangGraph在初始化阶段会生成3个StructuredTool, 分别对应add, divide, multiply方法, 然后创建一个ToolNode对象, 包含这里的3个Tool. 

#### 执行

由于ToolNode属于Pregel节点, 按照之前章节的介绍, ToolNode需要处理Pregel输入并返回处理的结果.

ToolNode的执行流程图如下图所示:  ToolNode订阅名为**messages**的通道, 从messages逆序获取第一条AI消息, 提取并构造tool calls, 提交给全局线程池, 最后将tool result构造为ToolMessage, 重新发布到**messages**通道.

![](tool_node.svg)
