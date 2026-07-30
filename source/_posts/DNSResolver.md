---
title: DNS 学习笔记(3) Resolver实现
date: 2026-07-29 16:39:22
categories:
- Tech
tags:
- golang
- dns
- net
---


# DNS 学习笔记(3) Resolver实现

本篇介绍Unix-Like系统上Golang原生库对DNS Resolver的实现细节, 使用代码:

``` go
package main

import (
	"fmt"
	"net"
)

func main() {
	// 指定使用go原生dns, 而非cgo
	net.DefaultResolver.PreferGo = true
	addrs, err := net.LookupHost("www.baidu.com")
	if err != nil {
		fmt.Println(err)
	}
	fmt.Println(addrs)

	// 逆向解析
	name, err := net.LookupAddr(addrs[0])
	// 大概率会报错, 很多dns服务器不支持逆向解析
	if err != nil {
		fmt.Println(err)
	}
	fmt.Println(name)
}
```





## IP查询整体流程

下图展示了发起一次IP查询的DNS整体流程:

![](overview.png)

从上图可见, DNS核心流程由3个部分组成: 请求构造, 请求发起, 响应解析. 下面对3个部分分别进行介绍.



### 构造DNS Msg

构造DNS Msg请求的流程如下图所示:

![](build_dns_msg.png)

从流程图可见, 在发起DNS请求时, 原本长度为12B的DNS Header, 实际只使用了4B, 这也是DNS协议规定请求和响应使用同一套数据结构的结果.

流程图中还有一个OPT RR的数据写入, 这个涉及到2013年的[RFC 6891](https://datatracker.ietf.org/doc/html/rfc6891), 不展开描述.

另外可以看到流程图中描述了一套理论上的消息压缩表, 但是Golang默认禁止了DNS压缩, 因此实际上并没有使用这个映射.

最终整个DNS Message的大小为44B. 如果使用TCP进行传输, 还会在数据包最前方写入2B大小的长度数据, 总TCP包大小为46B. (不过默认使用的是UDP, 不会有这2个Byte)



### 发起请求

事实上在向Nameserver发起请求前, 还有配置解析的流程, 见下图:

![](request_dns_server.png)

从图中可以看到, 默认的Nameserver使用了/etc/resolv.conf中的配置, 而这个文件是在接入网络供应商后由操作系统的网络层负责写入.



### 解析响应

在收到Nameserver的响应后, Resolver负责解析收到的TCP数据包, 其流程如下图所示:

![](parse_dns_resp.png)

整体流程比较简单, 即使涉及到压缩消息解压, 也只是对首字节进行判断后的字符串处理, 这里不做额外描述.