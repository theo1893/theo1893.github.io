---
title: LangGraph学习笔记(4) Pregel执行过程
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-05 20:18:57
---


# Pregel执行过程

本章节详细介绍LangGraph图的底层Pregel执行过程. 使用到的代码如下所示:

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

    builder = StateGraph(state_schema=MyState)
    builder.add_node("node1", node1)
    builder.add_node("node2", node2)
    builder.add_node("node3", node3)
    builder.add_node("node4", node4)

    builder.add_edge("node1", "node2")
    builder.add_edge("node1", "node3")
    builder.add_edge("node2", "node4")
    builder.add_edge("node3", "node4")


    builder.set_entry_point("node1")
    graph = builder.compile()

    return graph


if __name__ == "__main__":
    graph = gen_graph()

    # from IPython.display import Image
    # with open("arch.png", "wb") as f:
    #     f.write(Image(graph.get_graph().draw_png()).data)

    print(graph.invoke({"value": "bar"}))
```

Graph的结构如下图所示:

![](arch.png)



## Pregel对象

在Graph编译完成后, Pregel对象也即创建完毕. 在这个用例中, Pregel对象总共包含5个Node和8个Channel, 如下图所示

![](pregel_arch.svg)



### START节点

从图上可以看到, 除了用户定义的4个节点外, 图中还包含一个名为**\_\_start\_\_**的节点, 下面以START节点描述.

START节点是Pregel图的默认输入节点, 其输入通道和触发通道均为\_\_start\_\_. 当没有设置START节点时, 图的编译会直接报错.

START节点在被执行时, 没有数据处理行为, 但是会触发2个输出事件:

1. 将输入数据分发写入到对应的Channel中. 在这个用例中, 即将"bar"写入value通道;
2. 向与其绑定的下游控制通道写入一条空消息. 在这个用例中, 即向branch:to:node1写一条空消息;



### 通道

#### 用户通道

在前面的章节中, 我们详细介绍了Pregel Channel, 但并未介绍Channel如何被构造. 

在LangGraph的实现中, 用户定义的全局结构体会被进行解析, **每个字段都是一个Channel**. 在这个用例中, 由于MyState包含2个字段: value和name, 最终对应到2个Pregel Channel, 如上图所示. 

同时, 在LangGraph的实现中, 每个字段默认是LastValue类型的Channel, 然而在前面的章节中我们知道, 在一次Super Step中, LastValue通道不允许同时收到多个更新, 因此在这个用例中, value被定义为AnyValue通道.



#### 系统通道

除了用户定义的结构体解析出的通道, LangGraph还会引入至少2个用户不可见的系统通道: \_\_start\_\_ 和 \_\_pregel\_tasks.

正如前文所说, START节点是图的第一节点, \_\_start\_\_则是用于触发START节点的触发通道: 用户输入会产生一条消息发送到\_\_start\_\_通道, 进而触发START节点.

而\_\_pregel\_tasks通道被用于运行时动态分支的任务收集, 后续章节会进行介绍.

除了这2个通道外, 在这个用例还存在4个用户不可见的控制通道, 即总共存在8个通道, 其中用户可感知的通道数为2.



## Pregel循环 (Loop)

当Pregel图接收到用户输入后, 会进入Pregel循环, 每一个有效的循环即为一次Super Step. 循环的流程图如下图所示:

![](loop_process.svg)

下面对Pregel循环的每个流程进行描述.



### Pregel 循环初始化

在这个用例中, 用户输入了一个dict对象. Pregel在收到请求后, 会初始化Pregel Loop对象. 用户输入的dict对象被送到\_\_start\_\_通道,  然后结束初始化. 

此流程结束后, Pregel Loop的状态如下图:

![](loop_init.svg)



### 第0轮Super Step

#### 扫描

初始化完成, 此时Pregel记录了上一轮被更新的Channel: \_\_start\_\_. 

Pregel进入第0轮Super Step, 扫描上一轮被更新的Channel, 得到\_\_start\_\_. 根据图的定义, 得到被此通道触发的下游节点: START节点. 因而产生第0轮Super Step需要执行的任务列表: [执行START节点].



#### 执行

在前文我们介绍过, START节点有2个实际的行为: 将节点的输入分发到对应的Channel, 以及向下游控制通道发布消息. 事实上, **基本上所有的节点都遵循这2步的输出规则**.

在这个用例中, START节点将"bar"发布到value通道, 并向branch:to:node1写入一条None:

![](loop_0.svg)



### 第1轮Super Step

#### 扫描

Pregel执行完第0轮Super Step, 开始扫描第1轮Super Step的任务. 此时发生更新的Channel为["value", "branch:to:node1"]. 由于branch:to:node1会触发node1的执行, 因此Pregel扫描得到第1轮Super Step的任务列表: [执行node1节点].



#### 执行

此时, Pregel将node1封装为PregelTask送进**线程池**执行.

node1从用户定义通道拉取数据, 得到当前的状态为{"value": "bar"}, 然后执行函数操作, 返回{"value": "bar-node1"}. Pregel将node1的返回解析写入对应的Channel, 并向下游的控制通道发布消息. 具体来说, 即将"bar-node1"写入value通道, 并向branch:to:node2 以及 branch:to:node3 分别写入空消息:

![](loop_1.svg)



### 第2轮Super Step

#### 扫描

同上, Pregel根据第1轮更新过的Channel决定第2轮的任务. 由于第1轮更新的Channel为["value", "branch:to:node2", "branch:to:node3"], 因此第2轮的任务列表为: [执行node2节点, 执行node3节点].



#### 执行

此时, Pregel将node2和node3封装为2个PregelTask送进线程池执行. node2和node3分别返回{"value": "bar-node1-node2"}和{"value": "bar-node1-node3"}, 并均向branch:to:node4发送消息.

由于在MyState的定义中, value被定义为AnyValue, 仅保留最后一条更新数据, 因此即使这里有多个节点对value通道进行更新, 也仅有最后一条更新有效, LangGraph不做最终保证. 在这个case里, 假设"bar-node1-node3"有效.

![](loop_2.svg)



### 第3轮Super Step

#### 扫描

同上. 此时仅有branch:to:node4能够触发node4, 因此第3轮的任务列表为: [执行node4节点].



#### 执行

同上, node4更新value通道.

![](loop_3.svg)



### 第4轮Super Step

#### 扫描

由于第3轮发生更新的通道仅有value, 而value无法触发其他节点, 因此第4轮没有任务需要执行, 即Pregel运行结束.
