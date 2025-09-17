---
title: Golang杂学 GMP模型(4) Channel实现原理
date: 2025-09-16 11:40:45
categories:
- Tech
tags:
- golang

---

# Golang杂学 GMP模型(4) Channel实现原理

本章会给予GMP模型介绍Channel的实现原理.

后续假设我们初始化了一个大小为10, 类型为int的通道, 代码如下.

```go
ch := make(chan int, 10)
```



## runtime.hchan

Channel的运行时数据结构为hchan, 其字段如下所示:

``` go
type hchan struct {
	qcount   uint           // 当前通道的数据数量
	dataqsiz uint           // 通道的buffer上限, 即初始化时传入的size
	buf      unsafe.Pointer // buffer入口地址, 环形数组
	elemsize uint16         // 元素大小
	closed   uint32         // 0-未关闭; 1-关闭
	elemtype *_type // 元素类型
	sendx    uint   // buffer的发送索引, 下一个发送数据往buf[sendx]写入
	recvx    uint   // buffer的接受索引, 下一个接收数据从buf[recvx]读取
	recvq    waitq  // 阻塞监听此通道的g列表
	sendq    waitq  // 阻塞写入此通道的g列表

	lock mutex
}
```



## Channel初始化

初始化的代码如下所示:

```go
func makechan(t *chantype, size int) *hchan {
	elem := t.Elem

	if elem.Size_ >= 1<<16 {
		throw("makechan: invalid channel element type")
	}
	if hchanSize%maxAlign != 0 || elem.Align_ > maxAlign {
		throw("makechan: bad alignment")
	}

    // 检查通道是否超过大小限制
	mem, overflow := math.MulUintptr(elem.Size_, uintptr(size))
	if overflow || mem > maxAlloc-hchanSize || size < 0 {
		panic(plainError("makechan: size out of range"))
	}

    // 初始化hchan对象, 并为buf分配指定大小的内存
	var c *hchan
	switch {
	case mem == 0:
		c = (*hchan)(mallocgc(hchanSize, nil, true))
		c.buf = c.raceaddr()
	case elem.PtrBytes == 0:
		c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
		c.buf = add(unsafe.Pointer(c), hchanSize)
	default:
		c = new(hchan)
		c.buf = mallocgc(mem, elem, true)
	}

	c.elemsize = uint16(elem.Size_)
	c.elemtype = elem
	c.dataqsiz = uint(size)
	lockInit(&c.lock, lockRankHchan)

	if debugChan {
		print("makechan: chan=", c, "; elemsize=", elem.Size_, "; dataqsiz=", size, "\n")
	}
	return c
}
```

makechan函数负责创建hchan对象. 在初始化过程中, 我们可以看到, 指定的size会参与buf的内存占用计算, 因此size会直接影响通道的大小. 另外需要注意的是, 如果buf内存占用过大, 函数会直接报错. 在64位系统下, buf允许分配的最大内存为(1<<64)-1字节, 即18446744073709551615.

按照用户代码逻辑, 我们创建一个size为10且元素类型为int的通道, 初始化完成后通道的内存分布如下:

![](chan_after_init.svg)



## 向通道发送数据

发送数据存在3种场景. 假设发送协程为g10, 绑定p1和m2, 下面按照优先级进行介绍.

### 存在被阻塞的接收协程

假设当前通道为空, 但是存在2个接收协程被阻塞, 分别为g16和g17. 此时g10向通道发送数据, 主要流程如下:

1. 从recvq获取第一个阻塞协程g16;
2. 将数据通过memmove拷贝到g16的指定内存;
3. 将g16扭转到_Grunnable, 将g16放入本地p的执行队列, 最后执行wakep执行调度;

 当g16被调度到某个p和m之后(假设分别为p7和m5), g16会从其pc开始继续执行. 整体流程图大概如下图所示:

![](chan_write_with_blocked_recv.svg)



### 通道缓存未满

在这个场景下, 由于通道的缓存还未被写满, 因此g10可以直接把数据写入通道.

假设在本次写入前, 通道内已经存在2个数据, 则本次写入后, 通道的变化如下:

![](chan_after_write_with_enough_space.svg)



### 通道缓存已满

在这个场景下, 通道的缓存已经写满, g10无法再往里面写入数据, 因此g10阻塞, 被记录到sendq队列中. 同时, g10与当前m解绑, 而m.g0重新进行调度, 优先执行其他协程. 整体的流程图大概如下图所示:

![](chan_write_without_space.svg)

需要注意的是, 仅有阻塞式写入的g会被记录到sendq并中断执行. 如果是非阻塞式的写入则正常退出, 不会被中断执行, 比如下面这段代码:

```go
select {
case ch <- 123:
    fmt.Println("Send 123")
    
default:
    fmt.println("Default")
}
```

这段代码为非阻塞式写入, 在ch无法写入时不会导致协程中断.



## 从通道接收数据

和写入一样, 接收存在3种场景. 假设接收协程为g12, 绑定p4和m7, 下面按照优先级进行介绍.



### 存在被阻塞的发送协程

假设当前通道存在2个发送协程被阻塞, 分别为g16和g17. 此时g12从通道读取数据, 主要流程如下:

1. 从sendq获取第一个阻塞协程g16;
2. 将g16携带的数据通过memmove拷贝到g12的指定内存;
3. 将g16扭转到_Grunnable, 将g16放入本地p的执行队列, 最后执行wakep执行调度;

大致流程图如下:

![](chan_recv_with_blocked_g.svg)



### 通道缓存内存在数据

在此场景下, g12直接从通道缓存读取数据, 大致流程图如下:

![](chan_recv_with_data.svg)



### 通道为空

此时没有协程向通道写入数据, 通道缓存也为空, 因此g12的读取操作被阻塞, g12被解绑, m7优先调度其他协程.

![](chan_recv_blocked.svg)

同样, 这里的流程仅适用于阻塞式的读取. 如果是非阻塞式的读取操作, 则g12不会中断:

```go
select {
case v := <-ch:
    fmt.Println(v)
default:
    fmt.Println("channel is empty")
}
```



## 关闭通道

关闭通道的逻辑比较简单, 流程图如下:

![](close_chan.svg)

