---
title: Golang杂学 context简介
date: 2024-06-17 19:30:40
categories:
- Tech
tags:
- golang
- context
---

# Context

本文基于go1.22. 

golang中的context主要用于传递调用链路的上下文关系, 其定义如下:

```go
type Context interface {
    // 返回此context的deadline; 如果不存在deadline, ok=false;
    Deadline() (deadline time.Time, ok bool)
    // 返回context结束通道; 如果context已经失效, 此通道会被close, 对通道的读取会立即返回;
    Done() <-chan struct{}
    // 返回context的结束原因; 如果context未完成, Err返回nil;
    Err() error
    // 获取context存储的数据;
    Value(key any) any
}
```

由于context的设计, 其呈现出一种链的形态, 如下图所示:

![](context_chain.drawio.png)

在一次调用链中, 由于库函数封装了2次context, 业务代码实际进行处理时已经不再是原始的context. 而业务代码在处理过程中, 又封装了多次context, 最终请求外部系统时的context已经成为长度为4的context链: 上下文的信息存储在链中, 终止信号通过链进行传播.

目前golang官方context包中提供了4种context的实现: **cancelCtx**, **timerCtx**, **valueCtx**, **emptyCtx**.

## emptyCtx

一种特殊的实现, 其实现的4个方法返回均为空值, 是接收外部context的基础context. 也常被用于占位: 如果某些方法必须传递context, 但是手边没有合适的context变量时, 可以使用emptyCtx. 

### 入口函数

context库提供2个方法用于获取emptyCtx:

```go
var (
    background	=	new(emptyCtx)
    todo		=	new(emptyCtx)
)

func Background() Context {
    return background
}

func Todo() Context {
    return todo
}
```

### Deadline()

返回空值

```go
func (*emptyCtx) Deadline() (deadline time.Time, ok bool) {
    return
}
```

### Done()

返回空值

```go
func (*emptyCtx) Done() <-chan struct{} {
    return nil
}
```

### Err()

返回空值

```go
func (*emptyCtx) Err() error {
    return nil
}
```

### Value()

返回空值

```go
func (*emptyCtx) Value(key any) any {
    return nil
}
```
