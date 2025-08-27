---
title: LangGraph学习笔记(6) 动态路由 Command
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-17 14:56:43
---

# 动态路由: Command

本章介绍LangGraph提供的第3种动态路由方式: Command.  但在那之前, 我们需要首先细化一下LangGraph Pregel运行时的一个实现细节: 运行时作用域.



## 运行时作用域

在LanhGraph的实现中, 只要是可以被调用的对象都可以被当做节点放入图中, 因此, **LangGraph也支持图的嵌套**.

接下来的记录基于如下代码:

``` python
from typing import TypedDict, Annotated

from langgraph.channels import AnyValue
from langgraph.graph import StateGraph
from langgraph.types import Command


class MyState(TypedDict):
    value: Annotated[str, AnyValue]
    name: str

def gen_graph():
    def node1(state: MyState):
        return Command(goto="sub_graph", update={"value": state["value"] + "-node1"})

    def node2(state: MyState):
        return {
            "value": state["value"] + "-node2",
        }

    def node3(state: MyState):
        if state["name"] == "theo":
            return {"value": state["value"] + "-node3"}
        else:
            return Command(graph=Command.PARENT, goto="node2", update={"value": state["value"] + "-node3"})

    def node4(state: MyState):
        return {
            "value": state["value"] + "-node4",
        }




    sub_builder = StateGraph(state_schema=MyState)
    sub_builder.add_node("node3", node3)
    sub_builder.add_node("node4", node4)
    sub_builder.add_edge("node3", "node4")
    sub_builder.set_entry_point("node3")
    sub_graph = sub_builder.compile()

    builder = StateGraph(state_schema=MyState)
    builder.add_node("node1", node1)
    builder.add_node("node2", node2)
    builder.add_node("sub_graph", sub_graph)

    builder.set_entry_point("node1")
    graph = builder.compile()

    return graph


if __name__ == "__main__":
    graph = gen_graph()

    # from IPython.display import Image
    # with open("conditional_edge.png", "wb") as f:
    #     f.write(Image(graph.get_graph().draw_png()).data)

    print(graph.invoke({"value": "bar", "name": "theo"}))
    ## output: {'value': 'bar-node1-node3-node4', 'name': 'theo'}

    print(graph.invoke({"value": "bar", "name": "foo"}))
    ## output: {'value': 'bar-node1-node3-node2', 'name': 'foo'}
    

```

其等效的图结构如下图所示, node3:

![](graph.svg)

这里存在2个Graph对象: 最外层的无名主图, 以及内部名为sub_graph的子图. 这里的主图由3个可见节点组成: node1, node2, 以及sub_graph. 子图由2个可见节点组成: node3, 以及node4.

在运行阶段, LangGraph会给每个被执行的node分配一个uuid, 作为**这个node本次运行的标记**, 因而图与图的嵌套可以通过将主子图的标记串联, 得到一条唯一的调用链. 最终的数据格式为: {parent_node}:{parent_uuid}|{current_node}:{current_uuid}. 

接下来以这张图的执行为例进行介绍, 为简化描述, 省略START节点:



### 主图Loop 1

此时node1节点被激活并生成1个Pregel Task, 假设uuid为478d97f3-0887-42f6-974a-3507e6648866. 由于node1不存在上层图, 因此node1的运行时标记为**node1:478d97f3-0887-42f6-974a-3507e6648866**, 如下图所示:

![](loop_1.svg)



### 主图Loop 2

在Loop1中, 我们通过返回Command对象, 在其中指定goto="sub_graph", 将请求转发到sub_graph节点. 此时sub_graph节点被激活, 假设uuid为53ff2dbf-26c8-4fda-a89e-f53b9ff0f334, 则sub_graph的运行时标记为**sub_graph:53ff2dbf-26c8-4fda-a89e-f53b9ff0f334**. 

同时, 由于sub_graph是另外一个Pregel对象, 因此sub_graph会初始化子图的Loop, 而**主图的Loop从这里开始阻塞等待子图执行完成**:

![](loop_2.svg)



#### sub_graph Loop 1

进入sub_graph循环后, 第一个用户可见的节点为node3, 因此node3被激活. 由于sub_graph存在归属上层图, 因而sub_graph中的所有节点, 都从属于上层图的作用域下. 

假设node3的运行时uuid为819fd2ed-eafd-4524-b7dc-5b0b5ee2e70f, 则node3的运行时标记为**sub_graph:53ff2dbf-26c8-4fda-a89e-f53b9ff0f334|node3:819fd2ed-eafd-4524-b7dc-5b0b5ee2e70f**:

![](sub_graph_loop_1.svg)

假设我们触发了Command返回的分支, 由于在返回Command中指定了转发到上层图的node2节点(下面会介绍详细的实现细节, 这里将其当做事实), 因此本轮执行结束后, sub_graph的执行也就结束.



### 主图Loop 3

sub_graph执行结束后, 主图的node2被激活, 假设其运行时uuid为43db2bc8-0651-418e-a71e-792d6807c3d1, 则node2的运行时标记为**node2: 43db2bc8-0651-418e-a71e-792d6807c3d1**(因为没有上层图, 所以和node1一样没有前缀), 如下图所示:

![](loop_3.svg)



### 结束执行

至此为止, 整个图的执行结束. 我们已经基本理解了Pregel的主子图, Pregel运行时作用域概念, 以及Command的基本用法. 

目前还剩下2个问题:

1. Command如何实现不跨图的路由?
2. Command如何实现跨图的路由?

下面会对Command的实现方式进行详细介绍.



## Command

Command是LangGraph提供的一种动态路由方式, 用户可以通过Command在同一个Pregel图内进行路由, 也可以跳出当前图, 将执行转移到上层图的某个节点. 下面我们分别介绍这2种路由的实现.



### 图内路由

我们可以通过下面的语法, 在node的执行函数中返回Command对象, 将执行转移到当前图的某个节点.

``` python
def node1(state: MyState):
    ## goto为当前图中指定节点的名字
    ## update为增量更新的通道
    return Command(goto="sub_graph", update={"value": state["value"] + "-node1"})
```

在LangGraph的实现中, 图内转发的原理非常简单, 由2个步骤组成:

1. 使用update字段更新通道. 这个例子里, 即更新value通道;
2. 向goto指定节点的触发通道, 写入空消息. 这个例子里, 即向**branch:to:sub_graph**通道写入一个None;

具体操作见下图:

![](in_graph_command.svg)

从这里我们可以看出, 图内路由实际上和Edge基本一致. 这个例子我们可以等效写为下面的代码, 它们的执行流程是一样的:

``` python
def node1(state: MyState):
    return {"value": state["value"] + "-node1"}

builder.add_edge("node1", "sub_graph")
```

但是Command提供了灵活的路由方向, 不再局限于静态边.



### 跨图路由

首先我们需要明确的是, 在LangGraph(v0.6.5)当前的Command实现中, 跨图路由的方式仅支持向**最近的上层图**跨越, 既没有向子图跨越(这个可能没有必要), 也没有向更高的上层图跨越的支持. 

我们仍然以本章开头的代码为例. 当sub_graph的node3被激活时, node3试图将执行权转移到上层图的node2节点. 这里实际上发生的事件是: node3在Write Entries阶段, 抛出了名为**ParentCommand**的异常. 

由于node3的运行时标识符为**sub_graph:53ff2dbf-26c8-4fda-a89e-f53b9ff0f334|node3:819fd2ed-eafd-4524-b7dc-5b0b5ee2e70f**, 在抛出异常时, node3(实际上是一个调度器而非node3, 但这里为方便描述, 仍然使用node3书写)会从其自身的标识符中提取出上层图的标识符: **sub_graph:53ff2dbf-26c8-4fda-a89e-f53b9ff0f334**, 并用其重写graph字段.

此时这个异常上浮到主图的sub_graph被捕获. sub_graph进行一次判断: 由于**异常指定的graph和自己的标识符完全一致**, 因此sub_graph开始处理此异常. 至此为止的流程如下图所示:

![](out_graph_command.svg)

而处理异常的流程和图内路由完全一致:

1. 使用异常中包含的update字段更新通道;
2. 向异常中包含的goto字段对应的节点的触发通道, 写入空消息;

具体操作见下图:

![](handle_parent_command.svg)

此时, 异常处理完毕, sub_graph正常执行完成. 在主图的下一轮循环扫描任务时, 由于node2的触发通道被写入了消息, 因此node2被激活. 

通过这样的方式, LangGraph实现了子图到上层图的执行权转移, 实现了跨图的动态路由.



#### 子图节点返回多条Command的处理

这种情况不应该出现, 属于图的设计缺陷, 但这里仍然记录一下这一场景, 以及LangGraph的处理方式.

这里使用的图结构如下图所示:

![](multi_command_from_sub_graph.svg)

子图sub_graph包含3个节点. 从图中可以看出, 在sub_graph的第2轮super step会存在node3和node4这2个任务, 而node3和node4分别使用Command指向上层图的node5和node2.

在LangGraph的实现中, **仅有其中某一个Command能够生效**. 部分执行代码如下所示:

``` python
while True:
    try:
        # clear any writes from previous attempts
        task.writes.clear()
        # run the task
        # 这里执行具体的task
        return task.proc.invoke(task.input, config)
    except ParentCommand as exc:
        # 捕获第一个ParentCommand, 捕获完成后此函数正常退出
        ns: str = config[CONF][CONFIG_KEY_CHECKPOINT_NS]
        cmd = exc.args[0]
        if cmd.graph in (ns, task.name):
            # this command is for the current graph, handle it
            for w in task.writers:
                w.invoke(cmd, config)
            break
        elif cmd.graph == Command.PARENT:
            # this command is for the parent graph, assign it to the parent
            parts = ns.split(NS_SEP)
            if parts[-1].isdigit():
                parts.pop()
            parent_ns = NS_SEP.join(parts[:-1])
            exc.args = (replace(cmd, graph=parent_ns),)
        # bubble up
        raise
```



对上层图而言, sub_graph是单个节点, 能且仅能抛出1个异常, 而每个节点只被允许抛出1个异常. 因此sub_graph向上抛出的2个ParentCommand异常, 仅有第1个可以被处理. 另外, 由于super step的任务执行使用线程池并发, 因而不保证完成顺序, 最终结果是node3和node4中的某个Command生效.