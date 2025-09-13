---
title: Golang杂学 GMP模型(1) GMP模型数据结构
date: 2025-09-03 12:02:00
categories:
- Tech
tags:
- golang
---



# Golang杂学 GMP模型(1) GMP模型数据结构

本章会对Golang实现协程的数据结构和机制进行介绍, 在后续章节会针对协程启动的流程进行详细解析.



## GMP模型

G(Goroutine)-M(Machine)-P(Processor)模型是Golang实现协程的基石.



### G(Goroutine)

G是用户层协程的逻辑表征, 同时也是Golang程序运行时的最小执行单元. 在运行时, G由特定的数据结构g表达, 这里挑选其中几个容易理解的字段:

``` go
// 栈结构
type stack struct {
	lo uintptr
	hi uintptr
}

// 协程入口结构
type gobuf struct {
	sp   uintptr	// 栈指针
	pc   uintptr	// pc指针
	g    guintptr	// g指针

	......
}

// G结构
type g struct {
	stack		stack		// 协程栈

	_panic		*_panic		// panic链
	_defer		*_defer		// defer链
	m			*m			// 绑定的m
	sched		gobuf		// 协程的入口函数相关信息

	goid			uint64	// 当前协程id
	parentGoid		uint64	// 父协程id

	......
}
```

从上面的结构我们能得到几个信息:

1. g维护着自己的协程栈. 事实上, 每个g在被创建时会被分配默认大小的栈大小, 根据g的类型不同而不同;
2. g维护着调用链中产生的panic和defer链表;
3. g绑定着m;

#### G的类型

虽然G均使用g结构, 但是在运行时确实存在2种本质上不同的G: 用于调度的G, 称作g0, 以及实际执行的g. 

前者用户不可感知, 用于处理调度相关的逻辑, 其默认栈大小为16k.

后者用户可感知, 等效于使用go关键字生成的结果, 其默认栈大小为2k.



### P(Processor)

P是处理器的逻辑表征. P的数量在程序初始化时确定, 默认数量为当前CPU核数, 然而可以被GOMAXPROCS环境变量覆盖. P的运行时结构体为p, 下面给出其中部分字段:

``` go
const (
	// 当前p空闲
	_Pidle = iota

	// 当前p正在运行用户代码
	_Prunning

	// 当前p在系统调用中
	_Psyscall

	// 当前p被gc的STW影响而暂停
	_Pgcstop

	// 当前p不再使用
	_Pdead
)

// P结构
type p struct {
	id          int32
	status      uint32		// 当前p状态
	link        puintptr	// 指向下一个p, 用于将IDLE状态的p串起来
	m           muintptr	// 当前p绑定的m

	// p的本地执行队列, 包含可执行g的列表
	runqhead uint32
	runqtail uint32
	runq     [256]guintptr
	runnext guintptr

	......
}
```

从上面我们可以看出, 虽然在逻辑上P可以被理解为处理器, 但是在实现中其本质是一个**任务队列**, P会将待执行的G放进队列中, 等待时机对这些G进行调度.



### M(Machine)

每个M对应一个系统线程, 同时由于在M需要参与在其上运行的G的调度(比如创建一个新的G), 因此每个M都需要绑定一个独立的g0. M的部分字段如下:

``` go
type m struct {
	g0      *g				// 用于调度的g
	procid        uint64	// 线程id
	mstartfn      func()	// m启动函数, **不是线程入口函数**
	curg          *g       // 需要执行的g
	p             puintptr // 绑定的p

	......
}
```

## 全局调度

GMP这3种数据结构仅仅组成了调度系统的基本元素, 程序仍然需要一个全局的调度系统. 在实现中, 每个进程存在如下的全局数据:

![](global_var.svg)

从图上可以看到, 全局存在一个m0和g0. 和普通的M的结构一致, m0对应1号线程, 即主线程, 而g0则是与m0绑定的调度协程.

而在运行时, 假设我们设置处理器数为8, 数据分布可能如下图所示:

![](runtime_var.svg)



## 小结

本章简单介绍了GMP模型. 后续章节会针对具体的场景, 基于GMP对程序流程进行分析.
