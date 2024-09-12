---
title: Golang杂学 timerCtx
date: 2024-06-17 19:31:27
categories:
- Tech
tags:
- golang
- context
---

# timerCtx

timerCtx是cancelCtx的一种封装, 在cancelCtx提供的手动cancel基础上, 额外提供了定时触发cancel的功能.

其结构定义如下:

```go
type timerCtx struct {
    // parent context, 这里是cancelCtx
    cancelCtx
    // 计时器
    timer *time.Timer
    
    // cancel时间
    deadline time.Time
}
```

## 入口函数

一般使用context.WithDeadline获取timerCtx.

```go
// 一般使用此方法
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    return WithDeadlineCause(parent, d, nil)
}

func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
    ...
    // parent的deadline < d, 即parent会先触发cancel. 
    // 这种情况下child不需要计时器, 返回普通cancelCtx即可, 等待parent触发cancel.
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        return WithCancel(parent)
    }
    c := &timerCtx{
        deadline: d,
    }
    // 和普通cancelCtx一样, 将c挂载在parent的cancel链上.
    c.cancelCtx.propagateCancel(parent, c)
    
    // 计算还需多久到达deadline
    dur := time.Util(d)
    if dur <= 0 {
        // 已经到达deadline, 则将c直接cancel
        c.cancel(true, DeadlineExceeded, cause)
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.err == nil {
        // 设置定时器, 在dur时间之后cancel掉c
        c.timer = time.AfterFunc(dur, func() {
            c.cancel(true, DeadlineExceeded, cause)
        })
    }
    
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

## cancel()

由于存在定时器, timerCtx重写了cancel方法, 主要为了资源的释放

```go
func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(c.cancelCtx.Context, c)
    }
    
    c.mu.Lock()
    // 释放定时器
    if c.timer != nil {
        c.timer.Stop()
        c.timer = nil
    }
    c.mu.Unlock()
}
```



