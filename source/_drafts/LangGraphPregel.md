---
title: LangGraph学习笔记(1) Pregel
categories:
- Tech
tags: 
- LangGraph
- Agent

---

# Pregel

Pregel是[柯尼斯堡七桥问题](https://zh.wikipedia.org/zh-cn/%E6%9F%AF%E5%B0%BC%E6%96%AF%E5%A0%A1%E4%B8%83%E6%A1%A5%E9%97%AE%E9%A2%98)中桥下的那条河. Google在2010发表论文[Pregel: a system for large-scale graph processing](https://dl.acm.org/doi/abs/10.1145/1807167.1807184), 以Pregel命名提出的图算法, 这一算法现今被LangGraph作为底层的图实现.

后续的描述均基于LangGraph使用到的具体实现, 而非Google提出的原生Pregel算法.

## 三个概念

Pregel中涉及到3个比较重要的概念: 节点(Node), 通道(Channel), 超步(Super Step).

### 节点(Node)

Pregel中的节点, 和普通图中的节点概念类似, 是进行具体行为的单元, 可以将其执行流程大致划分为3步:

S1. 读取节点输入;

S2. 数据操作;

S3. 输出结果;



## 通道(Channel)

Channel的概念类似于普通图中的边(Edge), 用作Node之间通信. 但是和Edge不同的地方在于, Pregel中的Channel是pub/sub模式, 多个Node可以订阅同一个Channel, 多个Node可以向同一个Channel发布数据.



## 超步(Super Step)

简单来说, Pregel图中的每一个完整轮次的操作, 被定义为一次Super Step.