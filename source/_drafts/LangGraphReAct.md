---
title: LangGraph学习笔记(4) ReAct模型
categories:
  - Tech
tags:
  - LangGraph
  - Agent

---

# LangGraph ReAct模型

[ReAct](https://arxiv.org/pdf/2210.03629)机制由2个步骤组成: Reasoning 和 Acting, AI通过在Reasoning和Acting之间循环操作, 来完成用户任务, 从原理上理解非常直观. 本章节我们介绍LangGraph实现的ReAct模型.

