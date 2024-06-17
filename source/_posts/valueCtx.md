---
title: valueCtx
date: 2024-06-17 19:31:18
tags:
- golang
- context
---

# valueCtx

用于存储数据的context, 其定义如下:

```go
type valueCtx struct {
    // parent context
    Context
    // 存储的key-value
    key, val interface{}
}
```

## 入口函数

使用context.WithValue获取valueCtx.

```go
func WithValue(parent Context, key, val any) Context {
    ...
    // 创建新的valueCtx, 记录parent context, 构成一种链式结构
    return &valueCtx(parent, key, val)
}
```

内存结构:
![](valueCtx_structure.drawio.png)



## Value()

valueCtx通过重写Value方法, 提供了数据查询的能力: 查询指定key对应的value, 如果自身不负责指定key的存储, 便向上递归查询.

```go
func (c *valueCtx) Value(key any) {
    // 如果查询的key确实存储在此context, 返回存储的value
    if c.key == key {
    	return c.val
    }

    // 向父context继续查询
    return value(c.Context, key)
}

// 统一的查询入口
func value(c Context, key any) any {
    // 循环查询, 直到某个分支查询成功
    for {
        switch ctx := c.(type) {
        case *valueCtx:
            if key == ctx.key {
                return ctx.val
            }
            // 将查询对象变更为父context, 下一次循环继续查询
            c = ctx.Context
            
        case *cancelCtx:
            // cancelCtx不参与实际的数据存储, 因此仅在key为&cancelCtxKey时直接返回自身
            // 其他情况跳过本次查询
            if key == &cancelCtxKey {
                return c
            }
            c = ctx.Context
            
        case withoutCancelCtx:
            // 同上
            if key == &cancelCtxKey {
                return nil
            }
            c = ctx.Context
            
        case *timerCtx:
            if key == &cancelCtxKey {
                return &ctx.cancelCtx
            }
            c = ctx.Context
            
        case backgroundCtx, todoCtx:
            // backgroundCtx, todoCtx是emptyCtx的封装, 通常作为最初的context, 因此直接返回nil
            return nil
            
        default:
            return c.Value(key)
        }
    }
}
```

查询流程图示:
![](valueCtx_search.drawio.png)
