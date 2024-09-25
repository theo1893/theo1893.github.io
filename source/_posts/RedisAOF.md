---
title: Redis源码图解(19) Redis AOF基本原理
date: 2024-09-24 23:16:31
categories:
- Tech
tags:
- redis

---

# Redis AOF基本原理

AOF(Append Only File)是Redis提供的一种数据持久化方案, 简单来说, 在开启AOF后, Redis会记录每一条指令, 并依据配置的不同, 在不同的时间将记录的指令写入AOF磁盘文件.

下面将这个流程拆分为几个主要的步骤.

## Step 1 记录指令到AOF缓存

当Redis Server**实际执行完成指令**后, 会将对应的指令缓存在操作列表(Redis Operation Array)中, 然后将操作列表中的指令以RESP格式写入AOF缓存.

这里不涉及文件写入.

![](aof_buffer.png)

## Step 2 将AOF缓存刷入磁盘

在前面的图解中我们介绍过, Redis Server的AE事件循环中, 存在一个间隔为1ms的定时任务.

AOF缓存写入AOF文件就发生在这个定时任务中.

![](buf_to_fd.png)

在上图中可以看到, Redis Server在配置为AOF_FSYNC_ALWAYS和AOF_FYNS_EVERYSEC时调用fcntl的方式不同:

在AOF_FSYNC_ALWAYS时, 会同步调用fcntl刷盘;

在AOF_FYNS_EVERYSEC时, 会提交一个异步任务给后台线程, 由后台线程负责调用fcntl刷盘;

### 后台线程是什么时候被创建的?

在前面的图解中我们介绍过, Redis Server在启动时会创建3个后台线程, 其中一个负责AOF相关的操作.
