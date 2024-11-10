---
title: Redis源码图解(21) Redis 增量AOF
date: 2024-11-11 06:25:57
categories:
- Tech
tags:
- redis

---

# Redis 增量AOF

上一篇图解介绍了AOF的基本流程和触发条件, 其中涉及到增量AOF的相关内容单独在这一篇介绍.

## 增量AOF文件和重写AOF文件

在上一篇图解中我们知道, Redis主进程在fork()出子进程后, 主进程和子进程分别在不同的AOF文件上进行IO, 其中负责重写的子进程会将当前数据分布重写到**temp-rewriteaof-bg-{pid}.aof**文件中.

而主进程在此过程中, 会创建的AOF文件, 命名格式通常为**appendonly.aof.1.incr.aof**, 这种文件被称为增量AOF文件, 因为其仅存在于AOF重写中的父进程, 负责记录在此期间的新增操作.

具体过程大致如下, 这里在前一章图解中增加细节:

![](incr_aof.png)



## AOF文件体积合并

当子进程重写完成后, 主线程(父进程)中的定时任务会监听到子进程完成重写, 此时主线程会重新计算服务端当前的AOF体积, 并将其设置为**Base AOF体积**:

当前AOF体积 = 重写AOF文件体积 + 增量AOF文件体积

**Base AOF**体积 = 当前AOF体积

**Base AOF**体积会被用于将来的AOF重写判断的基数体积, 当AOF增长至这个**Base AOF**体积的2倍时, 才会执行下一次AOF重写.

整体的流程大致如下, 这里在前一章图解中增加细节:

![](aof_rewrite_cron_details.png)

