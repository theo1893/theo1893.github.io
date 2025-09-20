---
title: Golang杂学 GMP模型(5) Defer和Panic
date: 2025-09-18 14:18:57
categories:
- Tech
tags:
- golang

---

# Golang杂学 GMP模型(5) Defer和Panic

本章节会基于GMP模型介绍Golang中defer和panic的实现原理.



## 运行时数据结构

在前面的章节我们介绍过g的数据结构, 其中包含\_panic和\_defer字段, 分别对应这个协程执行链中产生的panic和defer, 以链状结构被串联起来. 下面给出其中部分字段:

```go
// G结构
type g struct {
    ......

	_panic		*_panic		// panic链
	_defer		*_defer		// defer链
    
    ......
}

// defer运行时结构
type _defer struct {
    ......

	sp        uintptr // defer时的sp, 用于判断属于哪个函数的函数栈
	pc        uintptr // defer时的pc, 用于在panic场景下恢复执行
	fn        func()  // 函数指针
	link      *_defer // 在链表中指向下一个defer
    
    ......
}

// panic运行时结构
type _panic struct {
    ......
    
    sp unsafe.Pointer   // _panic属于的函数栈帧, 用于判断这个_panic的归属
	arg  any            // panic的参数
	link *_panic        // 在链表中指向下一个panic
	retpc uintptr       // 在panic场景下恢复执行的pc, 来源_defer.pc
	recovered   bool    // 标记这个panic是否已经被recover
    deferreturn bool    // 标记这个panic是否是由deferreturn产生
    
    ......
}
```

运行时产生的数据结构大致如下图所示:

![](datastructure.svg)

需要注意的是, 在Golang的实现中, _panic是通用结构, 即使没有panic调用, 在执行defer链时也会生成\_panic数据, 只不过生成的\_panic内的部分数据和由panic产生的\_panic数据存在差异(比如deferreturn字段), 不会导致程序中断.



## Defer流程

这里我们介绍defer流程, 使用的代码如下:

```go
package main

import (
	"fmt"
)

func main() {
	foo1()
}

func foo1() {
	defer func() {
		fmt.Println("foo1 defer")
	}()
	foo2()
}

func foo2() {
	defer func() {
		fmt.Println("foo2 defer")
	}()
    foo3()
}

func foo3() {
	defer func() {
		fmt.Println("foo3 defer")
	}()
}

```

### deferproc

用户代码中的defer语句, 会被编译器替换为deferproc函数调用, 其代码如下:

```go
func deferproc(fn func()) {
	gp := getg()
	if gp.m.curg != gp {
		throw("defer on system stack")
	}

    // 新建defer结构
	d := newdefer()
    
    // 把最新的defer放进_defer队头
	d.link = gp._defer
	gp._defer = d
    
    // 保存defer的函数指针, 以及调用者的sp, pc
	d.fn = fn
	d.pc = getcallerpc()
	d.sp = getcallersp()

	return0()
}
```

我们作如下假设:

foo1的函数栈sp=30000000, 执行defer时pc=30000032

foo2的函数栈sp=20000000, 执行defer时pc=20000032

foo3的函数栈sp=10000000, 执行defer时pc=10000032

则在foo3返回之前, 此协程的运行时相关数据如下图所示:

![](simple_defer.svg)



### deferreturn

在编译期间, 如果编译器发现某个函数调用过deferproc, 则deferreturn会被插入函数尾部.

deferreturn函数的代码如下:

```go
func deferreturn() {
    // 创建_panic结构, 标记这个_panic是defer流程, 和真正的panic无关
	var p _panic
	p.deferreturn = true

    // 设置_panic的栈帧为调用函数
	p.start(getcallerpc(), unsafe.Pointer(getcallersp()))
	for {
        // 尝试获取下一个可执行的defer函数
		fn, ok := p.nextDefer()
		if !ok {
			break
		}
		fn()
	}
}
```

这里的核心逻辑被封装在nextDefer内.



### nextDefer

基于具体的场景, 我们假设在foo3执行nextDefer, 主要流程如下图所示:

![](nextdefer.svg)

我们首先获取g._defer链表头的defer函数记作foo3_defer, 经过判断, foo3_defer和foo3属于同一函数帧, 因此返回foo3_defer给上层deferreturn执行.

在第二次进入nextDefer时, 链表头函数为foo2_defer, 而foo2_defer和foo3属于不同函数帧, 因此查找失败, 而由于**deferreturn不允许跨栈帧查找defer函数**, 因此foo3的deferreturn执行结束. 接下来正常返回到foo2, 由foo2开始执行deferreturn.



### 小结

至此为止, 普通的defer流程介绍结束, 下面介绍带有panic的defer流程.



## Panic流程

这里我们在foo3内调用panic, 代码如下:

```go
package main

import (
	"fmt"
)

func main() {
	foo1()
}

func foo1() {
	defer func() {
		fmt.Println("foo1 defer")
	}()
	foo2()
}

func foo2() {
	defer func() {
		fmt.Println("foo2 defer")
	}()
    foo3()
}

func foo3() {
	defer func() {
		fmt.Println("foo3 defer")
	}()
    
    panic("test panic")
}
```

### gorecover

在介绍panic之前, 我们先介绍recover实现.

当我们使用recover来捕获panic时, 编译器会将其修改为gorecover调用, 其代码如下所示:

```go
func gorecover(argp uintptr) any {
	gp := getg()
    // 获取panic链表头
	p := gp._panic
	if p != nil && !p.goexit && !p.recovered && argp == uintptr(p.argp) {
        // 修改p.recovered字段, 标记此panic被捕获
		p.recovered = true
		return p.arg
	}
	return nil
}
```

gorecover的逻辑非常简单: 获取当前g的panic链表的表头元素, 将其标记为已被捕获.

那么当前g的panic链表什么时候被写入元素呢?



### gopanic

当我们使用panic语句时, 编译器会将其修改为gopanic调用, 其部分代码如下所示:

```go
func gopanic(e any) {
	......

    // 设置_panic的参数
	var p _panic
	p.arg = e

	runningPanicDefers.Add(1)

    // 设置_panic的初始栈帧
    // 注意, 由于p不是由deferreturn产生, p会被写入g._panic
	p.start(getcallerpc(), unsafe.Pointer(getcallersp()))
	for {
        // 同样, 寻找下一个defer函数执行
		fn, ok := p.nextDefer()
		if !ok {
			break
		}
		fn()
	}

	preprintpanics(&p)

    // 在此函数内部打印panic信息, 并退出进程
	fatalpanic(&p)
	*(*int)(nil) = 0
}
```

从上述代码可见, gopanic和deferreturn的逻辑非常相似, 外部的区别仅在3处:

1. 在p.start函数中, p会被写入当前g._panic;
2. 设置了p.arg, 这是panic的参数;
3. 循环结束后会打印panic并退出进程;

此时g的数据如下图所示:

![](panic_defer.svg)

具体的逻辑差异发生在nextDefer函数内.

### nextDefer

和deferreturn场景相比, panic场景的nextDefer主要存在2个差异:

1. 判断_panic是否已经被捕获: 如果被捕获, 则根据\_panic.retpc在当前协程恢复执行;
2. 如果_panic未被捕获, 则将\_panic所属栈帧上浮, 迭代寻找可执行的defer函数;

由于这里我们没有执行recover方法捕获panic, 因此panic会一直上浮, 将foo3, foo2, foo1的defer函数全部消耗完毕, 最后中断进程, 流程图如下所示:

![](panic_nextdefer.svg)

最终的输出如下:

```go
foo3 defer
foo2 defer
foo1 defer
panic: test panic
```

### 小结

至此为止, 我们介绍了panic的实现以及其与defer的区别.

