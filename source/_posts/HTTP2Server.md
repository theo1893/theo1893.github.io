---
title: HTTP/2 源码图解(4) HTTP/2 Server流程分析
date: 2026-08-12 15:35:34
categories:
- Tech
tags:
- golang
- http
---

# HTTP/2 Server流程分析

本篇介绍HTTP/2 Server的请求处理流程. 使用的代码片段如下, 固定golang版本为1.24.10.

``` go
// HTTP Handler
func echoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading body", http.StatusInternalServerError)
		return
	}
	defer r.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
	fmt.Println("Echo - Protocol:", r.Proto, "Body:", string(body))
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/echo", echoHandler)

	// HTTP/2协议要求使用TLS, 版本最低为1.2
	cert, err := tls.LoadX509KeyPair("server.crt", "server.key")
	if err != nil {
		log.Fatal("Error loading certificate: ", err)
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}

	server := &http.Server{
		Addr:      ":8443",
		Handler:   mux,
		TLSConfig: tlsConfig,
	}

	fmt.Println("HTTP/2 Server listening on https://localhost:8443")
	// 开始监听HTTP/2 socket
	if err := server.ListenAndServeTLS("", ""); err != nil {
		log.Fatal(err)
	}
}
```



## TLS握手

HTTP/2协议规定, 通信必须使用TLS协议进行加密, 协议最低版本为v1.2, 因此和HTTP/1.x相比, 服务器在监听到TCP连接后, 增加了一步响应TLS握手的操作, 这一阶段的流程如下图所示:

![](tls_handshake.png)



## Setting同步

TLS握手成功后, 服务端首先会按顺序发送一组Setting帧, 这组Setting帧会作为这条连接的初始配置:

![](init_setting.png)

InitialWindowSize同时作为一个标记: 当HTTP/2 连接收到第一个InitialWindowSize帧后, 这条连接初始化完成, 后续开始正式进行双向数据传输.



## 帧处理

在HTTP/2连接正式建立完成后, 服务端启动协程监听HTTP/2帧, 并针对不同的帧类型进行处理:

![](frame_process.png)

下面对各个子流程进行介绍.



### Header帧和Continuation帧预处理

Header帧的处理比较特殊, 存在预处理流程. 在读到Header帧时, HTTP/2库会根据Frame Header判断后续是否存在Continuation帧, 根据Payload的首字节进行判断是否需要更新动态表.

在HTTP/2的协议设计中, Payload的首字节整型编码共有[5种情况](https://httpwg.org/specs/rfc7541.html#rfc.section.6), 分别对应5个场景:

1. 完全匹配: 要发送的Header完全命中表空间, 客户端仅告诉服务端Header在表空间中的索引.

2. 非完全匹配并且需要插入动态表: 

   a. 要发送的Header仅有Key命中, 客户端告诉服务端Key的索引, 以及Value的编码数据, 服务端把完整的Header插入动态表.

   b. 要发送的Header完全未命中, 客户端告诉服务端Key和Value的编码数据, 服务端把完整的Header插入动态表.

3. 非完全匹配并且不需要插入动态表: 同2. 区别在于服务端不会更新动态表.

4. 非完全匹配并且是敏感数据: 同3. 区别在于服务端解析出的Header还会增加一个Sensitive字段.

5. 更新动态表最大大小: 发送方告诉接收方动态表的最大大小.

![](header_process.png)

在预处理阶段, HTTP/2库会进入循环, 循环消费原始字节流, 直到把Header和Continuation帧全部读完, 最后向上层抛出完整的一个解析完成的Header帧.



### Header帧处理

在获取到解析完成的Header帧后, HTTP/2库在内存中构造HTTP请求对象, 将Header写入内存, 并**预先构造一块空内存区域**, 用于承载即将收到的Data帧. 完成构造后, HTTP/2将请求对象向上抛给应用层, 应用层此时就可以读取HTTP Req, 但是直到收到Data帧为止, 应用层会一直被阻塞. Header帧的处理流程如下图所示:

![](header_process_2.png)



### Data帧处理

在收到Data帧后, HTTP/2库把数据写入先前构造完成的HTTP Req对象中, 此时上层应用层对HTTP Req的读阻塞被解除, 获得完整的请求体, 进入处理. Data帧的处理流程如下图所示:

![](data_process.png)



### Setting帧处理

HTTP/2库对Setting帧的处理由下面几个步骤组成:

1. 常规校验;
2. 根据每个配置项对本地的配置进行更新;
3. 回复ACK帧;

Setting帧的处理流程如下图:

![](setting_process.png)
Setting帧在连接维度生效, 因此处理流程不涉及Stream.



### Ping帧处理

HTTP/2库对Ping帧的处理就是简单的echo: 一方收到Ping帧后, 把包中的数据原封不动写进ACK帧, 回复给另一方. Ping帧的处理流程如下:

![](ping_process.png)

Ping帧探测的是HTTP/2连接的健康情况, 因此处理流程不涉及Stream.



### Reset帧处理

Reset用于关闭一条不处于Idle的Stream. Reset帧的处理流程如下:

![](reset_process.png)



### GoAway帧处理

GoAway帧用于通信双方进行连接关闭前的同步. 假设服务端收到客户端发起的GoAway帧, 服务端会通知客户端可接受的最高Stream数据, 并拒绝所有更高的Stream数据. GoAway帧的处理流程如下:

![](goaway_process.png)



### 其他帧

还有流量控制相关的WindowUpdate帧和优先级相关的Priority帧, 后续单独介绍.



## 服务端返回响应

在服务端的Handler处理完成请求后, Handler会向HTTP连接写入响应数据. 在本文中的代码demo中, 服务端会将客户端传入的数据完全一致地返回, 底层的HTTP/2库收到二进制数据后, 会将其封装为HTTP/2帧后写入到连接中. 服务端返回响应的处理流程如下:

![](resp_process.png)

