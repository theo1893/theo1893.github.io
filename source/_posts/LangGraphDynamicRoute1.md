---
title: LangGraph学习笔记(5) 动态路由 ConditionalEdge和Send
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-16 19:59:54
---


# 动态路由: ConditionalEdge和Send

除了通过静态的Edge连接不同的Node, LangGraph还提供了3种动态路由的方式, 以支持更复杂的图设计. 本章节会介绍其中2个, 另外一个会在下一章节进行介绍.



## ConditionalEdge

在前面的章节我们介绍过LangGraph Edge的实现, 其本质是在Node的执行阶段额外增加了一个可执行对象, 用于向下游Node的触发通道写入一条空消息.

然而除了静态的Edge, LangGraph还提供了类似的ConditionalEdge机制, 使用一个判断方法来决定下游节点是谁.



这里我们使用如下代码:

``` python
from typing import TypedDict, Annotated

from langgraph.channels import AnyValue
from langgraph.graph import StateGraph


class MyState(TypedDict):
    value: Annotated[str, AnyValue]
    name: str

def gen_graph():
    def node1(state: MyState):
        return {
            "value": state["value"] + "-node1",
        }

    def node2(state: MyState):
        return {
            "value": state["value"] + "-node2",
        }

    def node3(state: MyState):
        return {
            "value": state["value"] + "-node3",
        }

    def node4(state: MyState):
        return {
            "value": state["value"] + "-node4",
        }

    def router(state: MyState):
        return "node3"

    builder = StateGraph(state_schema=MyState)
    builder.add_node("node1", node1)
    builder.add_node("node2", node2)
    builder.add_node("node3", node3)
    builder.add_node("node4", node4)

    builder.add_conditional_edges("node1", router, ["node2", "node3", "node4"])

    builder.set_entry_point("node1")
    graph = builder.compile()

    return graph


if __name__ == "__main__":
    graph = gen_graph()

    # from IPython.display import Image
    # with open("conditional_edge.png", "wb") as f:
    #     f.write(Image(graph.get_graph().draw_png()).data)

    print(graph.invoke({"value": "bar"}))
```

为方便描述, 这里使用的router()简单固定返回node3. 这里的LangGraph图结构如下所示:

![](conditional_edge.png)



我们从Node1牵出3条动态Edge分别到Node2, Node3, Node4, 根据router方法的返回在运行时进行判断具体的下游节点.

这里实际生成的Pregel图如下图所示:

![](node_with_conditional_edge.svg)

这张图里, Write Entries阶段由2个部分构成: 更新数据通道, 更新触发通道(Dynamically).



### 更新数据通道

在更新数据通道的阶段, 用户返回的{"value": "bar-node1"}被写入Task的本地通道缓存. 这里不做额外描述.



### 更新触发通道(Dynamically)

和静态Edge不同之处在于, 静态Edge在Pregel编译时就确定应该写入哪个触发通道, 而**动态Edge在运行时需要执行一次指定的路由方法**, 根据路由方法判断应该写入哪个触发通道.

同时, 由于动态Edge需要在运行时获取当前的完全状态, 这一过程涉及到全局通道数据(Global)和本地通道缓存(Local)的冲突. Pregel使用的方案是优先本地通道缓存, 次优全局通道数据, 如上图紫色部分所示. 通过这种方式, Pregel Task在运行时能够获取全局的状态, 并根据当前状态进行路由判断.



## Send

Send是LangGraph提供的另外一种动态路由的方式: 通过返回Send对象, 来告诉Pregel图下一轮的执行路由.

作为示例使用的代码如下:

``` python
from typing import TypedDict, Annotated

from langgraph.channels import AnyValue
from langgraph.graph import StateGraph
from langgraph.types import Send


class MyState(TypedDict):
    value: Annotated[str, AnyValue]
    name: str

def gen_graph():
    def node1(state: MyState):
        return {
            "value": state["value"] + "-node1",
        }


    def node2(state: MyState):
        return {
            "value": state["value"] + "-node2",
        }

    def node3(state: MyState):
        return {
            "value": state["value"] + "-node3",
        }

    def node4(state: MyState):
        return {
            "value": state["value"] + "-node4",
        }

    def router(state: MyState):
        return [Send("node2", {"value": state["value"] + "-router"})]

    builder = StateGraph(state_schema=MyState)
    builder.add_node("node1", node1)
    builder.add_node("node2", node2)
    builder.add_node("node3", node3)
    builder.add_node("node4", node4)

    builder.add_conditional_edges("node1", router, ["node2", "node3", "node4"])

    builder.set_entry_point("node1")
    graph = builder.compile()

    return graph


if __name__ == "__main__":
    graph = gen_graph()

    # from IPython.display import Image
    # with open("conditional_edge.png", "wb") as f:
    #     f.write(Image(graph.get_graph().draw_png()).data)

    print(graph.invoke({"value": "bar"}))
```

和前面一段代码的不同之处在于, 这里的router返回的是**Sequence[Send]**. ConditionalEdge可以返回多个Send, 实现在下一次Super Step同时触发多个节点的执行.

这里需要的注意的是, 如果多个Send均路由向同一个节点, 那么每个Send会被当做单独任务, 在下一轮Super Step时被执行.



### \__pregel\_tasks通道

在第前一篇博客中, 我们提到过一个名为\__pregel\_tasks的通道. 这个用户不可见的系统通道被Pregel用于收集Send对象. 在第N轮Super Step完成后, 假设存在Send对象, 那么在第N+1轮Super Step扫描任务时, 这些Send对象会被扫描出来, 和trigger机制产生的Task一起, 作为第N+1轮的任务集合.

以这里的代码片段为例, Pregel的运行时数据流如下图所示:

![](send_process.svg)

Pregel在node1执行结束后, 向\__pregel\_tasks通道写入一条Send("node2", {"value": "value-node1-router"})的数据. Pregel循环进入下一轮, 扫描任务时会将\_\_pregel\_tasks里存储的Send对象拉出来, 构造Pregel Task. 大致的流程如下图所示:

![](next_super_step.svg)



### 注意点

使用Send有几个注意点:

1. Send对象只能在ConditionalEdge场景下使用, 因为普通的Node没有支持Send对象的返回处理.
2. Send对象的arg参数即为node执行接收到的参数. **Pregel不会单独为node构造请求入参, 即指定的node不会获得比arg更多的传入信息**. 因此如果arg为{}, 则node的入参即为{}.
