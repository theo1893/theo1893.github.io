---
title: Golang杂学 GMP模型(2) Go程序启动流程
date: 2025-09-09 15:24:53
categories:
- Tech
tags:
- golang

---

# GMP模型(2) Go程序启动流程

本章会基于GMP模型详细介绍一个Go程序的启动流程. 

本章所有的内容, 均基于go 1.22.3.

## 全局唯一变量

在一个Go程序的生命周期中, 存在一些用户不可见的全局唯一变量, 这里我们仅关注其中可能和GMP相关的变量, 如下图所示. 需要注意的是, 这里的分布并非按照内存分布排列, 仅作为展示:

![](global_var.svg)



## Go程序启动流程

由于GMP模型的存在, 每个Go程序最终生成的二进制文件均不是直接执行main函数, 而是首先做了大量的初始化工作. 而在初始化阶段, 不同的架构对应不同的汇编代码, 下面使用386架构的代码进行介绍.

### TEXT _rt0_386

尽管在这个函数之前还存在一些其他操作, 这个函数仍然被官方定义为386的程序入口.

这段汇编代码如下:

``` asm
TEXT _rt0_386(SB),NOSPLIT,$8
	MOVL	8(SP), AX	// argc
	LEAL	12(SP), BX	// argv
	MOVL	AX, 0(SP)
	MOVL	BX, 4(SP)
	JMP	runtime·rt0_go(SB)	// 跳转到rt0_go
```

在设置好argc和argv参数后, 就调用runtime·rt0_go进入下一流程.



### TEXT runtime·rt0_go

rt0_go函数在1号线程执行, 负责Go程序的初始化. 其内部包含大量的架构判定和逻辑, 下面仅对部分重要逻辑进行介绍:

``` asm
TEXT runtime·rt0_go(SB),NOSPLIT|NOFRAME|TOPFRAME,$0
	// 这里设置全局g0变量的默认栈大小为64kb + 104
	MOVL	$runtime·g0(SB), BP
	LEAL	(-64*1024+104)(SP), BX
	MOVL	BX, g_stackguard0(BP)
	MOVL	BX, g_stackguard1(BP)
	MOVL	BX, (g_stack+stack_lo)(BP)	// 设置栈顶
	MOVL	SP, (g_stack+stack_hi)(BP)	// 设置栈顶
	
	......
	
	// 操作线程本地变量寄存器TLS, 由于此时处在1号线程内, 因此下面操作的是1号线程TLS
	get_tls(BX)
	LEAL	runtime·g0(SB), DX	// 把全局变量g0的地址写入DX
	MOVL	DX, g(BX)			// 把DX的值存入TLS
	LEAL	runtime·m0(SB), AX	// 把全局变量m0的地址写入AX

	// save m0->g0 = g0
	MOVL	DX, m_g0(AX)		// 如官方注释, 这条指令等效于m0->g0 = g0
	// save g0->m = m0
	MOVL	AX, g_m(DX)			// 见官方注释

	......

	// saved argc, argv
	MOVL	120(SP), AX
	MOVL	AX, 0(SP)
	MOVL	124(SP), AX
	MOVL	AX, 4(SP)
	CALL	runtime·args(SB)	// args函数参数中提取完整的可执行文件路径
	CALL	runtime·osinit(SB)	// 从系统获取cpu核数以及hugepagesize, 分别写入全局变量ncpu和physHugePageSize
	CALL	runtime·schedinit(SB)	// 初始化全局调度器, 下文详细介绍

	PUSHL	$runtime·mainPC(SB)	// 把runtime·mainPC的地址压栈
	CALL	runtime·newproc(SB)	// 使用runtime·mainPC地址调用runtime·newproc, 下文详细介绍
	POPL	AX

	// start this M
	CALL	runtime·mstart(SB)	// 启动全局m0

	CALL	runtime·abort(SB)
	RET
```

上面这段代码包含4个重要的函数: runtime·schedinit, runtime·mainPC, runtime·newproc, runtime·mstart. 下面分别进行介绍.



#### runtime·schedinit

此函数负责初始化全局调度器. 此函数内部包含大量的初始化逻辑, 这里我们仅关心其中部分代码:

``` go
func schedinit() {
	......
    
    // 设置m的最大数量为10000
    sched.maxmcount = 10000
	
    ......
    
    // 设置p的数量, 优先为GOMAXPROCS, 次优为初始化时检测到的cpu核数
    procs := ncpu
	if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
		procs = n
	}
    // 初始化p
	if procresize(procs) != nil {
		throw("unknown runnable goroutine during bootstrap")
	}
    
    ......
}
```

这里首先设置了m的最大数量为10000, 然后使用GOMAXPROCS或ncpu来初始化全部的p. procresize的核心逻辑为: 

1. 创建指定个数的p;
2. 将p0和m0强绑定;
3. 将剩余的p全部写入空闲链表;

假设我们设置了GOMAXPROCS=8, 那么在schedinit执行完毕后, 全局变量的数据分布如下图所示:

![](global_var_after_schedinit.svg)



#### runtime·newproc

通常来说, 这个函数主要负责创建新的g, 将g放入**某个**p的队列, 然后触发一次调度. 然而启动流程比较特殊, 此函数并不会直接触发调度, 因此下面仅按顺序介绍前2个功能.



##### newproc1

这个函数负责返回一个可用的g, 其逻辑如下:

1. 尝试从当前g绑定的p中, 获取一个可用的g对象;
2. 如果上一步不存在可用g对象, 则创建一个newg, 栈大小为2k, 为其分配goroutine id, 并设置其父协程为当前g;

由于我们处于程序初始化阶段, 当前g为g0, 绑定的p0中不存在其他的g, 因此会执行步骤2, 创建一个新g, 其栈大小为2k.



##### runqput

这个函数将创建的newg放入当前g绑定的p的执行队列中. 此时由于仍然处于全局g0, 所以newg会被放入p0的队列. 此时的数据分布如下图所示:

![](global_var_after_runqput.svg)

至此为止, 我们已经获得了主协程运行时所需的全部资源: m0, p0, newg.

#### runtime·mstart

从这里开始, 如函数名所示, m开始启动. 这里可简单分为2个步骤: 调度, 以及执行, 流程图如下:

![](main_schedule.svg)



##### schedule

schedule函数负责g的调度, 其主要功能是获取可执行的g, 并执行它.

获取g的逻辑判断非常复杂, 可以按优先级简单归类如下:

1. 从当前p的本地执行队列获取;
2. 从全局执行队列获取;
3. 从其他p的本地队列偷取: 从随机索引的p开始, 遍历最多4个p;

此时由于我们仍然处于g0作用域下, 对应的p为p0, 因此schedule尝试从p0的队列获取g. 此时p0中恰好存在可执行g——即包含我们程序main函数的newg.



##### gogo

gogo函数是执行newg之前, 在g0作用域下的最后一个函数, 其函数签名如下:

``` go
// 函数签名
func gogo(buf *gobuf)

// 入参结构体
type gobuf struct {
	sp   uintptr
	pc   uintptr
	g    guintptr	// 对应的g
	ctxt unsafe.Pointer
	ret  uintptr
	lr   uintptr
	bp   uintptr
}
```

而在实现中, gogo的函数体直接以汇编书写, 其386架构的代码如下:

``` asm
// 汇编入口
TEXT runtime·gogo(SB), NOSPLIT, $0-4
	MOVL	buf+0(FP), BX		// 入参为gobuf, 放入BX
	MOVL	gobuf_g(BX), DX		// 把需要执行的g, 放入DX
	MOVL	0(DX), CX		
	JMP	gogo<>(SB)

TEXT gogo<>(SB), NOSPLIT, $0
	get_tls(CX)
	MOVL	DX, g(CX)			// 从g0切换到newg
	MOVL	gobuf_sp(BX), SP	// 重写部分寄存器
	MOVL	gobuf_ret(BX), AX
	MOVL	gobuf_ctxt(BX), DX
	MOVL	$0, gobuf_sp(BX)	
	MOVL	$0, gobuf_ret(BX)
	MOVL	$0, gobuf_ctxt(BX)
	MOVL	gobuf_pc(BX), BX	// 把PC写入BX
	JMP	BX						// 跳转BX执行代码
```

执行到这一步为止, 我们的程序已经切换到newg的作用域, 做好准备代码的准备. 下面介绍main函数的真正入口.



##### runtime·mainPC

在前面的汇编中我们知道, 名为runtime·mainPC的函数被作为参数传入了runtime·newproc, 创建了newg, 因此这个函数是newg的入口函数, 其汇编声明如下, 指向runtime·main:

``` asm
DATA	runtime·mainPC+0(SB)/4,$runtime·main(SB)	// 指向runtime.main
```

在这里我们仅关心runtime·main的一个操作: 调用main_main函数, 而main_main函数会被链接到main.main, 即用户可感知的main函数.

``` go
//go:linkname main_main main.main
func main_main()

func main() {
	......
    fn := main_main 
	fn()
    ......
}
```



## 小结

至此为止, 我们梳理了一个完整的main函数的启动流程. 下一节我们介绍普通协程的启动流程.





