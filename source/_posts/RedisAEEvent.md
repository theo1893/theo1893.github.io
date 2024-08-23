---
title: Redis源码图解(14) Redis 多路复用机制——AE事件模型
date: 2024-08-18 16:52:12
categories:
- Tech
tags:
- redis

---

# Redis AE事件模型

Redis使用了一套前缀带AE的API来实现事件模型, 基于kqueue实现内部的IO复用机制.

模型由总线和事件2个部分组成:

1. 事件代表每一个需要监听和处理的单元, 比如某个套接字可读/写, 会触发此套接字注册的事件;
2. 总线维护注册的全部事件, 负责监听事件的激活和调用处理函数. 

相关代码定义如下.

```c 
// AE文件事件, 即socket事件
typedef struct aeFileEvent {
    int mask;                 // 枚举: READABLE|WRITABLE|BARRIER
    aeFileProc *rfileProc;    // 注册的读方法
    aeFileProc *wfileProc;    // 注册的写方法
    void *clientData;
} aeFileEvent;

// AE时间事件
typedef struct aeTimeEvent {
    long long id; 
    monotime when;
    aeTimeProc *timeProc;     // 注册的处理方法
    aeEventFinalizerProc *finalizerProc;
    void *clientData;
    struct aeTimeEvent *prev; // 前一个时间事件
    struct aeTimeEvent *next; // 后一个时间事件
    int refcount; 
} aeTimeEvent;

// AE事件总线
typedef struct aeEventLoop {
    int maxfd;   
    int setsize;                       // 事件集合的大小上限, 在Redis服务初始化时确定
    long long timeEventNextId;
    aeFileEvent *events;               // 注册的文件事件集合, 是连续内存中的数组
    aeFiredEvent *fired;               // 被激活的事件集合
    aeTimeEvent *timeEventHead;        // 时间事件链表头
    int stop;
    void *apidata;                     // 维护内核中的kqueue实例
    aeBeforeSleepProc *beforesleep;    // 前置处理函数
    aeBeforeSleepProc *aftersleep;     // 后置处理函数
    int flags;
} aeEventLoop;
```

## 注册事件

以文件事件为例, 向事件总线中注册事件时, 调用方式如下.

```c 
/*
  arg[0]: 事件总线
  arg[1]: 要注册的fd
  arg[2]: 要监听的状态, 此处为监听可读
  arg[3]: 处理函数
  arg[4]: 自定义数据
*/
aeCreateFileEvent(server.el, sfd->fd[j], AE_READABLE, accept_handler,sfd)
```

事件总线会调用系统调用kevent()将这个fd和对应**监听的状态**注册进内核. 代码如下.

```c 
static int aeApiAddEvent(aeEventLoop *eventLoop, int fd, int mask) {
    // 获取之前内核返回的kqueue句柄
    aeApiState *state = eventLoop->apidata;
    struct kevent ke;

    if (mask & AE_READABLE) {
        // 初始化监听读kevent
        EV_SET(&ke, fd, EVFILT_READ, EV_ADD, 0, 0, NULL);
        // 将kevent注册进内核
        if (kevent(state->kqfd, &ke, 1, NULL, 0, NULL) == -1) return -1;
    }
    if (mask & AE_WRITABLE) {
        // 初始化监听写kevent
        EV_SET(&ke, fd, EVFILT_WRITE, EV_ADD, 0, 0, NULL);
        // 将kevent注册进内核
        if (kevent(state->kqfd, &ke, 1, NULL, 0, NULL) == -1) return -1;
    }
    return 0;
}
```

图解如下.

![](register_event.png)

需要注意的是, 定时任务的触发由事件总线维护, 不涉及内核.

## 监听事件流程

在Redis主线程启动后, Redis会向内核**无限轮询激活事件**. 

当内核返回有fd可以读写, 或者定时任务被触发, Redis调用注册事件时使用的处理函数, 进行相应处理.

大致的流程如下图所示.

![](event_loop.png)

需要注意的是, 上图中给出的**前置操作**和**后置操作**分别对应事件总线中的beforesleep函数和aftersleep函数. 前置和后置是对kevent()调用而言, 因为kevent()可能会阻塞后陷入sleep状态.
