---
title: HTTP2 Client源码解析
date: 2026-12-31 10:22:46
categories:
- Tech
tags:
- golang
- http
---

# HTTP2 Client源码解析
以下内容基于Golang 1.24.10.

## Client代码
本文使用的客户端代码参考如下:

``` go
package main

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"

	"golang.org/x/net/http2"
)

func main() {
	transport := &http2.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, 
		},
	}

	client := &http.Client{Transport: transport}

	resp, err := client.Get("https://localhost:8443/")
	if err != nil {
		log.Fatal("Error making request: ", err)
	}
	printResponse(resp)
}

func printResponse(resp *http.Response) {
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

从客户端代码可见, HTTP2客户端侧的变更**只有**使用了http2库中的Transport, 因此在实现上, HTTP2和HTTP1.x的主要差异也就在于Transport中.



## 发送HTTP请求

HTTP库的发送请求核心逻辑在下面这段代码, 最终会落入不同的transport实现.

``` go
// net/http/client.go
func (c *Client) send(req *Request, deadline time.Time) (resp *Response, didTimeout func() bool, err error) {
  ......
  
  // 使用http2的transport发起请求
	resp, didTimeout, err = send(req, c.transport(), deadline)
  
  ......
}

//net/http/client.go
func send(ireq *Request, rt RoundTripper, deadline time.Time) (resp *Response, didTimeout func() bool, err error) {
  ......
  
  // 进入transport逻辑开始操作
  resp, err = rt.RoundTrip(req)
  
  ......
}
```



### 获取TLS连接

客户端首先解析URL, 根据地址尝试从连接池获取TLS连接. 如果当前指定地址地址存在可用连接则复用, 否则创建新的TLS连接.

![](get_tls_conn.png)



### 创建HTTP2 Connection

在TLS连接的基础上, HTTP2封装了逻辑连接, 其部分字段如下.

``` go
type ClientConn struct {
	t             *Transport
	tconn         net.Conn             // TLS连接
	tlsState      *tls.ConnectionState // TLS状态

	streams         map[uint32]*clientStream // 此连接上的活跃Stream, 映射为stream id -> steram
	nextStreamID    uint32                   // 为下一条新的Stream分配的id; 从1开始计数.
  pendingRequests int                      // 此连接上阻塞的请求数量(Stream不够用导致)

	maxFrameSize           uint32            // 最大Frame大小; 默认为16 << 10.
	maxConcurrentStreams   uint32            // 最大并发Stream数

	hbuf bytes.Buffer   // HPACK编码后的Header数据
	henc *hpack.Encoder // HPACK编码器
}
```

![](new_client_conn.png)



### 创建Stream

创建新的Stream, 将其与ClientConn绑定, 使用ClientConn.nextStreamID为StreamId赋值, 并将conn维护的nextStreaID+2.

由于客户端侧的StreamId为奇数, 即从1开始计数, 第一条stream的id为1, 此时conn维护的next stream id变为3.

![](new_stream.png)



### HPACK基本编码

在正式介绍HPACK编码之前, 我们需要先了解HPACK中使用到的2种基本编码: 整型编码和字符串编码. 详细文档参考 [RFC7541](https://httpwg.org/specs/rfc7541.html#low-level.representation).



#### 整形编码

HPACK的整型编码接受1个参数: 前缀长度. 下图展示了前缀N=5的2种编码情况.

```
// 数据过小, 可以在5bit内存储  
  0   1   2   3   4   5   6   7
+---+---+---+---+---+---+---+---+
| ? | ? | ? |       Value       |
+---+---+---+-------------------+


// 数据无法在5bit内存储
  0   1   2   3   4   5   6   7
+---+---+---+---+---+---+---+---+
| ? | ? | ? | 1   1   1   1   1 |
+---+---+---+-------------------+
| 1 |    Value-(2^N-1) LSB      |
+---+---------------------------+
               ...
+---+---------------------------+
| 0 |    Value-(2^N-1) MSB      |
+---+---------------------------+
```



这里我们用一个例子来解释. 假设N=7, 对小于127的整数, 编码使用1个字节存储, 最高位0, 剩余位数为二进制位.

对大于等于127的整数, 编码使用多个字节存储, 分为3个部分:

1. 首字节固定为127;

2. 中间多个字节的首位固定位1, 剩余7位存储7个有效位;

3. 尾字节存储剩余有效位;

其编码流程如下图所示:

![](int_encode_process.png)



具体编码格式如下图所示:

![](int_encode.png)



解码操作即为这里的逆流程, 读取字节流将其中的payload重新组装为整数, 相应的细节在net/http2/hpack/hpack.go.



#### 字符串编码

HPACK对字符串的编码数据如下图所示:

```
  0   1   2   3   4   5   6   7
+---+---+---+---+---+---+---+---+
| H |    String Length (7+)     |
+---+---------------------------+
|  String Data (Length octets)  |
+-------------------------------+
```

编码数据由2部分组成: 

1. 前N个字节是使用前缀长度=7为参数的长度编码; 第1个字节的第1个bit标记字符串是否使用霍夫曼编码.
2. 后M个字节是具体的字符串数据.



这里以字符串`hello,world`为例. 字符串原始长度为11Byte, 编码后的长度为9Byte. 编码长度占优, 因此使用编码数据.

![](string_encode.png)



补充: HTTP2的标准提案遵循一套预定义的霍夫曼编码表, 所有实现方均使用这张编码表:

``` go
// 编码表
var huffmanCodes = [256]uint32{
	0x1ff8,
	0x7fffd8,
	0xfffffe2,
	0xfffffe3,
  ......
}

// 编码长度
var huffmanCodeLen = [256]uint8{
	13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28,
  ......
}
```



### 静态表/动态表查找

HTTP2标准预定义了一张包含61个常用Header的[静态表](https://httpwg.org/specs/rfc7541.html#rfc.section.A), 以及一张初始为空, 最大占用4096B的动态表. 在通信时, C-S会尝试发送表索引而非完整的字符串, 通过这种协议共识来减小HTTP的Header传输压力.

静态表和动态表共享一个索引空间, 下图展示了静态表长度为s, 动态表长度为k的索引空间分布:

``` 
<----------        索引空间       ---------->
<--     静态表     -->  <--     动态表     -->
+---+-----------+---+  +---+-----------+---+
| 1 |    ...    | s |  |s+1|    ...    |s+k|
+---+-----------+---+  +---+-----------+---+
                       ^                   |
                       |                   v
                  动态表插入位置         动态表删除位置
```



在具体实现中, 静态表和动态表由2部分组成: 需要同时匹配Header-Value的完全匹配表, 以及仅需要匹配Header的部分匹配表.

当一个HTTP Header同时命中Header-Value时, 这里称为**完全命中**; 当仅命中Header, 而没有命中Value时, 这里称为**部分命中**.

下面对查询结果分情况讨论.



#### 完全匹配

在完全匹配的场景下, 发送方直接将命中的索引id编码后写入字节流.

![](add_header.png)

此时使用整型索引前缀N=7, 同时, 最终编码的首字节会执行 |= 0x80, 用于标记完全匹配. 

最终编码长度为1字节.



#### 部分匹配

在部分匹配的场景下, 发送方会将这一组Header-Value写入动态表, 并将匹配得到的旧索引以及Value进行编码, 写入字节流.

![](add_header_2.png)

需要注意的是, 此场景涉及动态表更新, 因此整型索引前缀N=6, 编码的首字节会执行 |= 0x40, 用于标记动态表发生更新. 

最终编码长度为7字节.



#### 未命中

在未命中的场景下, 发送方会将这一组Header-Value写入动态表, 并将Header和Value进行编码, 写入字节流.

![](add_header_3.png)

和部分匹配不同的是, 在未命中的场景下, 最终编码会在头部额外增加一个字节 = 0x40, 用于标记动态表更新.

最终编码长度为19字节.



### 写入Header Frame

