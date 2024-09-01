---
title: Redis源码图解(18) Redis事务
date: 2024-09-01 16:04:05
categories:
- Tech
tags:
- redis

---

# Redis事务

## 使用方法

使用很简单, 一个Redis事务以MULTI指令开始, 以EXEC指令终结, 在输入EXEC后, 事务中所有的指令会被执行.

引用Redis官方文档的[demo](https://redis.io/docs/latest/develop/interact/transactions/):

```shel
> MULTI
OK
> INCR foo
QUEUED
> INCR bar
QUEUED
> EXEC
1) (integer) 1
2) (integer) 1
```

## 原理

在前面的图解中我们知道, Redis服务器采用AE事件模型作为网络I/O的组件, 每个建立起来的TCP连接都以**文件事件**的形式被事件总线监听.

基于此, Redis实现了事务流程:

1. 在TCP连接A上, Redis Server读到MULTI指令, 此连接进入事务模式;
2. Redis Server在连接A上读到指令cmd(比如INCR), 指令被缓存进入连接A的内存对象中;
3. Redis Server在连接A上读到指令EXEC, 从连接A的内存对象中读取缓存指令, 依次执行;

流程图如下.

![](redis_tx_process.png)

## ACID

很明显, 由于Redis事务更像是一组命令的批量执行脚本, 没有回滚的特性(**甚至这一组命令中某条命令执行失败, 也不会终止后续的执行**)Redis事务不支持原子性.

### 隔离性呢?

Redis是单线程处理模型, 隔离性由单线程保证.
