---
title: cancelCtx
date: 2024-06-17 19:31:22
categories:
- Tech
tags:
- golang
- context
---

# cancelCtx

cancelCtx通过实现canceler接口, 提供了取消context的能力. 其结构体定义如下:

```go
type cancelCtx {
    // parent context
    Context
    
    // 锁, 用于并发场场景下保护其他变量
    mu			sync.mutex
    // 存储chan struct{}
    done		atomic.Value
    // 存储此context的子context
    children	map[canceler]struct{}
    err 		error
    cause		error
}

type canceler interface {
    // 实际cancel context的方法
    cancel(removeFromParent bool, err, cause error)
    Done() <-chan struct{}
}
```

## 入口函数

使用context.WithCancel获取cancelCtx.

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    c := withCancel(parent)
    // 这里将cancelCtx实现的cancel方法暴露出去，上层可以通过调用cancel方法控制此context的生命周期
    // 需要注意的是, 暴露给上层调用的cancel会将此context从context链中移除
    return c, func() {c.cancel(true, Canceled, nil)}
}
```

从源代码可见其核心逻辑在于withCancel方法, 以及cancel方法.

withCancel的逻辑非常简单: 创建cancelCtx, 传播cancel.

```go
func withCancel(parent Context) *cancelCtx {
    ...
    // 创建内存对象
    c := &cancelCtx{}
    // 传播cancel: 从parent节点(parent)到child节点(c)
    c.propagateCancel(parent, c)
    return c
}
```

propagateCancel的核心逻辑是监听cancel信号, 将其传递到所有子节点下:

```go
func (c *cancelCtx) propagateCancel(parent Context, child cancler) {
    c.Context = parent
    
    // parent永远不会cancel, 因此不需要做任何操作
    done := parent.Done()
    if done == nil {
        return
    }
    
    select {
    case <- done:
        // parent context已经终止, 直接触发cancel链, 不需要进行监听
        child.cancel(false, parent.Err(), Cause(parent))
        return
    default:
    }
    
    // 从parent开始向前查找cancelCtx, 返回找到的第一个cancelCtx, 负责调用child的cancel, 只需要将child挂载在children中
    if p, ok := parentCancelCtx(parent); ok {
        p.mu.Lock()
        if p.err != nil {
            // parent已经终止, 则触发child终止
            child.cancel(false, p.err, p.cause)
        } else {
            if p.children = nil {
                p.children = make(map[canceler]struct{})
            }
            // 将child挂载在parent上, 由parent负责触发cancel
            p.children[child] = struct{}{}
        }
        p.mu.Unlock()
        return
    }
    
    // 这里有afterFuncer类型的判断, 但此类型并未提供公开的创建方法, 仅存在于test中, 因此跳过介绍
    ...
    
    // 监听parent context的cancel状态, 如果parent context已经终止, 向下传递
    go func() {
        select {
        case <-parent.Done():
            child.cancel(false, parent.Err(), Cause(parent))
        case child.Done():
        }
    }()
}


```

## Done()

Done方法返回cancelCtx存储的done, 用于判断cancelCtx是否cancel: 如果已经cancel, 返回的通道会退出阻塞.

```go
func (c *cancelCtx) Done() <-chan struct{} {
    d := c.done.Load()
    ...
    // 将done存储的变量恢复为chan struct{}
    return d.(chan struct{})
}
```

## Value()

对cancelCtx而言, 由于其并不参与数据的存储, 所以Value方法仅有这一个功能: 如果要获取的是自身, 就返回自身; 如果遇到其他key, 则跳过自身的查询;

```go
var cancelCtxKey int

func (c *cancelCtx) Value(key any) any {
    // 查询的就是cancelCtx, 则返回自身
    if key == &cancelCtxKey {
        return c
    }
    // 在parent context中继续查询
    return value(c.Context, key)
} 
```

## cancel()

cancel方法负责cancelCtx的实际cancel行为, 其核心逻辑主要有:

1. 关闭存储的done通道;
2. 递归cancel掉所有的子context;
3. 从parent context中将自身移除(*optional*);

```go
var closedchan = make(chan struct{})

func init() {
    close(closedchan)
}

func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    ...
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        // 某些情况下由于lazy init还未发生, done未被赋值, 这里直接写入closedchan
        c.done.Store(closedchan)
    } else {
        // 关闭done通道, 解除Done()方法返回通道的阻塞
        close(d)
    }
    
    // 递归cancel所有的子context
    for child := range c.children {
        child.cancel(false, err, cause)
    }
    
    // 将此context从parent context中移除
    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```
用户调用cancel方法后, 会触发将context移除cancel链的操作.

```go
func removeChild(parent Context, child canceler) {
    ...
    p, ok := parentCancelCtx(parent){
        if !ok {
            return
        }
    }
    p.mu.Lock()
    // 将child从p的child context中移除
    if p.children != nil {
        delete(p.children, child)
    }
    p.mu.Unlock()
}
```

cancel操作图示:

![](cancelCtx_cancel.drawio.png)
