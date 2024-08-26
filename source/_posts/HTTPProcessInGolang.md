---
title: Golang杂学 Golang服务器怎么处理一次HTTP请求(HTTP 1.x)
date: 2024-08-25 11:45:51
categories:
- Tech
tags:
- golang
- http

---

# HTTP1.x处理流程

本文基于go 1.22.3.

在服务器启动时, 首先建立监听fd, 每当有新的TCP连接进来后, 便开启协程进行处理, 是标准的多协程模型.

这里从**新的TCP连接建立**开始描述, 默认开启keep-alive.

## 建立新的TCP连接

HTTP库从监听端口建立新的TCP连接后, 会创建连接级别的context **connCtx**, 然后将**connCtx**传入协程进行处理.

在此TCP连接上的后续所有操作, 都基于此**connCtx**.

## 循环从TCP连接读取数据

子协程开始循环从TCP连接读取数据.

###  读取HTTP报文

HTTP报文结构如下.

![](http1_x_data.png)

在此阶段, HTTP库从TCP流中按行处理非body数据, 构造为内存对象request.

### 注册Body EOF回调函数

此时注册Body EOF回调函数, 在Body读取完毕时执行. **这里的EOF不一定是TCP连接中断, 也可能是Body正常读完**.

函数的行为后续单独介绍.

### 调用业务处理函数

此时调用我们在业务代码中实现的方法. 不做描述.

### Peek TCP连接的新数据

等待TCP连接的新数据:

如果有新的请求过来, 回到循环头部处理.

如果TCP已经到EOF(连接被关闭), 清理资源, 退出协程.

## Body EOF回调函数

在业务代码中从Body把数据读完, 或者读到EOF(由于TCP连接中断), 回调函数会被调用.

由于部分操作不涉及Body(eg. GET), 回调函数会在注册时被直接调用.

回调函数的主要操作是: 监听TCP连接是否断开. 如果TCP连接被断开, 取消context, 即上文中的**connCtx**. 这个行为会导致通过此TCP连接创建的所有未完成的HTTP请求, 在业务代码中的context被取消掉, 这也是HTTP请求通过网络传递Cancel信号的原理.

### 如果是keep-alive的HTTP连接, Client取消了某个请求, Server端可以收到取消信号吗?

实际上, 对HTTP Client而言, 取消一个HTTP请求, 会触发**关闭其底层的TCP连接**.

因此, 对Client和Server而言机制是相同的: Client取消请求, 导致底层TCP连接被关闭; Server监听到TCP连接被关闭, 为完成的请求被中断.

## HTTP库对HTTP1.1 Pipeline机制的支持

别用. 

HTTP库对每个TCP连接上的一系列请求(如果有), 采用串行处理.  HTTP库中也明确提到, 如果确实有相关需求建议使用HTTP/2:

```go
	// But we're not going to implement HTTP pipelining because it
	// was never deployed in the wild and the answer is HTTP/2.
```

## HTTP1.x处理全流程图示

通常处理流程如下.

![](http1_x_process.png)

取消场景, 以最复杂的HTTP长连接+Post请求+处理中发生请求取消时的流程如下.

![](http1_x_cancel.png)
