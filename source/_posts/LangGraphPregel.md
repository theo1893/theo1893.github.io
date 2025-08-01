---
title: LangGraph学习笔记(1) Pregel基本概念
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-01 11:19:25
---


# Pregel

Pregel是[柯尼斯堡七桥问题](https://zh.wikipedia.org/zh-cn/%E6%9F%AF%E5%B0%BC%E6%96%AF%E5%A0%A1%E4%B8%83%E6%A1%A5%E9%97%AE%E9%A2%98)中桥下的那条河. 

Google在2010发表论文[Pregel: a system for large-scale graph processing](https://dl.acm.org/doi/abs/10.1145/1807167.1807184), 以Pregel命名提出的图算法, 这一算法现今被LangGraph作为底层的图实现.

后续的描述均基于LangGraph使用到的具体实现, 而非Google提出的原生Pregel算法.



## 三个概念

LangGraph Pregel中涉及到3个重要的概念: 通道(Channel), 节点(Node), 超步(Super Step).



### 通道(Channel)

Channel的概念类似于普通图中的边(Edge), 用作Node之间通信. 但是和Edge不同的地方在于, Pregel中的Channel是pub/sub模式, 多个Node可以订阅同一个Channel, 多个Node可以向同一个Channel发布数据. 

下图展示了一个将输入字符串进行拼接后输出的Channel流程:

![](acc_channel.svg)




### 节点(Node)

Pregel中的Node, 和普通图中的节点概念类似, 是进行具体行为的单元. 

Node在初始化时订阅输入Channel, 从输入Channel中读取数据, 对数据进行处理, 然后将输出发布到指定的Channel中. 下图展示了订阅了2个Channel的Node, 在默认情况下如何处理数据: 

N1订阅了Channel A 和 Channel B, 按顺序处理Channel A的数据和Channel B数据后产生2条处理后的数据, 并按顺序将这2条数据发布到ChannelC.

![](node_demo.svg)



### 超步(Super Step)

简单来说, Pregel图中的每一个**完整轮**的操作, 被定义为一次Super Step.

下图展示了一个包含4个有效节点的图. 在收到数据输入后, 整个图经历3个Super Step, 在第3轮处理完成后, 整个图重新进入不活跃状态.

 ![](super_step.svg)