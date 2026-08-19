---
title: HTTP/2 源码图解(3) HTTP/2 Client流程分析
date: 2026-08-07 14:24:34
categories:
- Tech
tags:
- golang
- http
---


# HTTP/2 Client流程分析

本篇介绍HTTP/2 Client的请求流程, 使用的代码片段如下, Golang版本固定1.24.10:

``` go
func HTTP2Client() {
	// 构造HTTP库底层使用的Transport, HTTP库会通过Transport接口使用HTTP2协议
	transport := &http2.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	}

	client := &http.Client{Transport: transport}

	jsonBody := []byte(`{"message":"Hello HTTP/2!"}`)
	resp, err := client.Post("https://localhost:8443/echo", "application/json", bytes.NewReader(jsonBody))
	if err != nil {
		log.Fatal("Error making request: ", err)
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal("Error reading response: ", err)
	}

	fmt.Println("Protocol:", resp.Proto)
	fmt.Println("Status:", resp.Status)
	fmt.Println("Body:", string(body))
}
```

从代码可见, HTTP/2和HTTP在使用上的区别, 仅在于在建立连接时, 指定了HTTP/2专用的Transport.

下面对HTTP/2的客户端流程进行分析.



## 获取TLS连接

客户端首先解析URL, 根据地址尝试从连接池获取TLS连接. 如果当前指定地址地址存在可用连接则复用, 否则创建新的TLS连接.

协议建议每个TLS连接设置的最大Stream数不小于100. 在Golang的实现中, 每个TLS默认可以承载最大1000个Stream.

![](get_tls_conn.png)



## 创建HTTP/2 Connection

获取可用TLS连接后, Golang在其上封装了HTTP/2连接逻辑, 其部分字段如下.

``` go
type ClientConn struct {
	...
	
	tconn         net.Conn             // TLS连接
	tlsState      *tls.ConnectionState // TLS状态

	streams         map[uint32]*clientStream // 此连接上的活跃Stream, 映射为stream id -> steram
	nextStreamID    uint32                   // 为下一条新的Stream预留分配的id; 从1开始计数.
	pendingRequests int                      // 此连接上阻塞的请求数量(Stream不够用导致)

	maxFrameSize           uint32            // 最大Frame大小. 默认为16 << 10
	maxConcurrentStreams   uint32            // 最大并发Stream数. 默认1000

	hbuf bytes.Buffer   // HPACK编码后的Header数据
	henc *hpack.Encoder // HPACK编码器
	
	...
}
```

同时, 在TLS连接上创建HTTP/2连接后, Golang会启动读协程, 负责从连接中读取数据帧进行处理. 详细的数据帧处理逻辑会在下一篇笔记中记录, 这里不展开.

![](new_client_conn.png)



## 创建Stream

HTTP/2协议规定每个请求(大部分)要和Stream绑定, 因此获取到可用的HTTP/2 Connection后:
1. 创建新的Stream, 将其与ClientConn绑定, 使用ClientConn.nextStreamID为StreamId赋值, 并将conn维护的nextStreaID+2;
2. 如果CliencConn的并发Stream已经打满, 则将请求写入pendingRequests进入排队(理论上这种场景很少出现, 因为如果连接的并发Stream被打满, 在获取连接时就会创建新的连接);

由于客户端侧的StreamId为奇数, 即从1开始计数, 第一条stream的id为1, 此时conn维护的next stream id变为3.

![](new_stream.png)



## 写入HTTP Header

获取可用Stream后, 客户端首先等待接收**服务端在连接维度发送的Setting帧**对连接进行初始化.

客户端收到第一个InitialWindowSize Setting帧后, 回复服务端Setting ACK, 本条HTTP/2连接正式建立完成, 客户端此后开始向其中写入数据.

标准HTTP/2请求的第1个帧是Header帧, 客户端向Stream写入HPACK编码后的HTTP Header.

![](write_header.png)

如果单个Frame大小超过了上限, 会触发HTTP/2的分片机制. 

在Golang的实现中, 单个Frame的默认大小上限是16KB, 上图展示了HTTP Header发生分片时的Frame数据写入情况: 

第1帧是Header帧, 标记Header帧的起始; 后续会跟着多个Continuation帧, 最后1帧的end_header为1, 标记Header数据传输完毕.



## 写入HTTP Body

Header数据写入完毕后, 客户端开始向连接写入Body数据. Body数据的分片同时受到Frame大小和HTTP/2限流机制的限制, 并且多个分片均为Data帧, 最后1帧的end_stream为1, 标记这条客户端的stream数据传输完成. 下图展示了客户端写入Data帧的情况:

![](write_data.png)

HTTP/2限流机制会单独介绍, 这里不展开.





## 读取HTTP响应

前文提到, 在TLS连接上封装HTTP/2连接时, 客户端同时启动了1个协程监听TLS连接的返回数据, 下图展示了客户端构造HTTP响应的流程:

![](client_read_loop.png)

构造HTTP响应交给上层应用主要依赖2种帧:

1. 客户端读到Header Frame后, 创建HTTP Resp对象, 并填入解析得到的HTTP Headers;
2. 客户端读到Data Frame后, 把数据填入第1步创建的HTTP Resp对象中;

其他帧的解析会在下一篇笔记介绍, 这里不展开.



## 小结

本篇笔记记录了HTTP/2客户端发起请求并解析响应的全过程, 下一篇会介绍HTTP/2服务端处理各种数据的流程.
