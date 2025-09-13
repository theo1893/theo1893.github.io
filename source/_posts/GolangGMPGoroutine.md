---
title: Golang杂学 GMP模型(3) Goroutine启动流程
date: 2025-09-11 16:59:42
categories:
- Tech
tags:
- golang

---

# Golang杂学 GMP模型(3) Goroutine启动流程

接上一章节, 本章会基于GMP模型介绍一个普通的goroutine的执行流程.



## 前置条件

假设我们的代码是当前处于某个长时服务,  设置的GOMAXPROCS=8. 

我们当前处于协程g17内, 关联到p7和m3, 线程id为7号 此时我们开启一个新的协程:

``` go
go func(){
    fmt.Println("Hello")
}
```

接下来的流程可以大致细分如下:

1. 在g17作用域(严格来说是m3.g0作用域)下创建新的g, 记作newg, 并将newg放入p7的执行队列;
2. 唤醒某个空闲的p;
3. 创建新的m;
4. 执行一次调度, 并执行;

从上面的流程我们可以看到, 从第2步开始, 流程的细节就和启动主程序之间存在差异. 下面我们跳过第1步, 从第2步开始分别介绍.



## wakep

假设第1步执行完毕后的数据分布如下图:

![](data_dist_before_wakep.svg)

当前g在创建newg并将其放入p7执行队列后, 会执行wakep函数去唤醒一个**处于空闲状态的p**, 在我们的例子中是p6被唤醒.

此函数内部包含大量的函数调用, 但可以根据线程创建的时间点, 被分为前后2个部分.



### 执行线程创建前

当前我们处于7号线程, 处于全局m3.g0的作用域下. 此阶段负责分配可用的m和p, 并为m分配执行线程. 主要流程如下图所示:

![](wakep_before_pthread_create.svg)

从上图我们知道分配的p为p6, 这里我们假设创建的m为m4.

### 执行线程创建后

在上一步最后, m3.g0会调用pthread_create, 线程入口为runtime·mstart_stub, 入参为m4的地址, 其汇编代码如下所示:

``` asm
TEXT runtime·mstart_stub(SB),NOSPLIT,$28
	NOP	SP

	// 保存寄存器
	MOVL	BX, bx-4(SP)
	MOVL	BP, bp-8(SP)
	MOVL	SI, si-12(SP)
	MOVL	DI, di-16(SP)

	MOVL	32(SP), AX			// 获取入参, 即m4
	MOVL	m_g0(AX), DX		// 获取m4.g0
	get_tls(CX)
	MOVL	DX, g(CX)			// 把m4.g0写入TLS, 后续作用域即为m.g0

	CALL	runtime·mstart(SB)	// 启动m4

	// 恢复寄存器
	MOVL	di-16(SP), DI
	MOVL	si-12(SP), SI
	MOVL	bp-8(SP),  BP
	MOVL	bx-4(SP),  BX

	MOVL	$0, AX
	RET
```



 假设新线程的id为8, 此时8号线程开始执行, 主要流程如下图所示:

![](wakep_after_pthread_create.svg)

从上图我们可以看到, 8号线程会进入一个**阻塞式**获取可执行协程的循环: 首先从p的本地队列获取, 其次从全局队列获取, 最后会尝试从其他的p偷取协程来执行. 由于此时处于p6, 而p6不存在可执行协程, 因此m3.g0会尝试从其他p偷取任务, 即从p7偷到newg.

在成功获取到g之后, **8号线程会在内部调用一次wakep, 唤醒另一个空闲p, 创建新的m, 并创建新的线程, 通过这种方式保证始终存在自旋线程处于待命状态. 主线程不存在这种行为**. 在完成这些操作后, 8号线程进入执行协程的逻辑, 入口为runtime·gogo, 执行逻辑和上一章节内容没有差别.

在gogo执行完毕后释放p6时,  如果发现p6的本地队列存在可执行任务, 则启动新的m进入执行. 

在那之后, 清理当前m即m4, 并退出当前线程, 即8号线程.

至此, 一个协程的执行流程结束.
