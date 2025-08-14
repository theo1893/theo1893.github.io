---
title: LangGraph学习笔记(5) 动态路由
categories:
  - Tech
tags:
  - LangGraph
  - Agent

---

# 动态路由

除了通过静态的Edge连接不同的Node, LangGraph还提供了3种动态路由的方式, 以支持更复杂的图设计.



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
