---
title: Golang杂学 Atomic原子操作
date: 2025-10-23 14:59:51
categories:
- Tech
tags:
- golang
---



# Golang杂学 Atomic原子操作

本章介绍atomic包内的原子操作底层实现.

## AddInt32

atomic.AddInt32的函数签名如下:

``` go
func AddInt32(addr *int32, delta int32) (new int32)
```

AddInt32的具体实现仅由一行汇编代码构成:

``` asm
TEXT ·AddInt32(SB),NOSPLIT,$0
	JMP	runtime∕internal∕atomic·Xadd(SB)	## 跳转到Xadd函数
```

atomic.Xadd函数的实现根据不同架构存在不同, 这里以arm架构的实现(atomic_arm.go)为例:

``` go
func Xadd(val *uint32, delta int32) uint32 {
	for {
        // 先计算old value和new value, 然后进入CAS操作
		oval := *val
		nval := oval + uint32(delta)
		if Cas(val, oval, nval) {
			return nval
		}
	}
}
```

从上面的代码我们可以看到, Xadd是一个包含Cas操作的无限循环, 当且仅当Cas成功时, Xadd才会正常退出.

Cas函数的签名如下:

``` go
func Cas(ptr *uint32, old, new uint32) bool
```

同样, Cas的逻辑实现直接使用汇编编写. 这里以386汇编(atomic_386.s)为例, 其实现如下:

``` asm
TEXT ·Cas(SB), NOSPLIT, $0-13
	MOVL	ptr+0(FP), BX	## BX存储ptr的值, 即原始值地址
	MOVL	old+4(FP), AX	## AX存储上层计算完成的old value
	MOVL	new+8(FP), CX	## CX存储上层计算完成的new value
	LOCK					## 核心逻辑: LOCK指令用作修饰, 保证下面一条指令线程安全
	CMPXCHGL	CX, 0(BX)	## Compare and Exchange指令, 实现具体的CAS操作 
	SETEQ	ret+12(FP)		## 设置返回值ret: 指令成功或失败
	RET
```

我们以下面的代码段对竞争场景进行描述:

```go
package main

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
)

func bar1(ptr *int32) {
	newV := atomic.AddInt32(ptr, 1)
	fmt.Println("bar1:", newV)
}

func bar2(ptr *int32) {
	newV := atomic.AddInt32(ptr, 1)
	fmt.Println("bar2:", newV)
}

func main() {
	wg := sync.WaitGroup{}
	wg.Add(2)
	v := int32(0)

	go func() {
		defer wg.Done()
		bar1(&v)
	}()

	go func() {
		defer wg.Done()
		bar2(&v)
	}()

	wg.Wait()
}

```

上面的代码描述了一个竞争场景: 不同协程对同一个变量竞争更新. 这段代码多次运行的结果**理论上**存在不同的可能性, 因为多个协程并发运行, 无法确定谁先更新变量. 然而由于GMP的调度实现存在一些优化(猜测), 实际上难以出现不同的结果.

