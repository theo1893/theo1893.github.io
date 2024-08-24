---
title: Redis源码图解(0) 系列介绍
date: 2024-08-04 13:54:39
categories:
- Tech
tags:
- redis


---

# Redis源码图解

早年阅读过redis 3.2.x的部分源码, 但当时仅仅了解了内部数据结构的实现, 对如何完整处理一条命令一知半解.

现今阅读7.4.0版本, 发现有大量的改动, 因此对过去的记录进行修正并记录, 当作笔记.

本系列的所有源码, 基于[redis 7.4.0版本](https://github.com/redis/redis/tree/7.4.0).
