---
title: HTTP/2 源码图解(2) HPACK算法
date: 2026-05-12 10:22:46
categories:
- Tech
tags:
- golang
- http
---



# HPACK

HPACK是HTTP2中用于压缩HTTP Header的算法. 在介绍HPACK算法前, 我们先看一下HTTP/2引入的Pseudo-Header.



## Pseudo-Header

HTTP/2引入了几个特殊的Pseudo-Header, 用于传递URI, 请求方法, 状态码等数据. 这些字段格式和HTTP/1.x不同, 用于区分.

| Pseudo-Header | Meaning                          |
| ------------- | -------------------------------- |
| :method       | 请求头. 用于传递HTTP方法: GET, POST, ... |
| :scheme | 请求头. 用于传递协议头: http, https |
| :authority | 请求头. 用于传递host, 比如example.com |
| :path | 请求头. 用于传递path, 比如/demo/get?q=1 |
| :status | 响应头. 用于传递状态码 |



## Cookie

HTTP/2[建议](https://datatracker.ietf.org/doc/html/rfc7540#section-8.1.2.5)把Cookie按照 **;** 拆分为更小的项. 在Golang的HTTP/2实现中, Cookie被完全按照 **;** 拆分为单独的项:

``` 
// 原始cookie串
cookie: A=a1; B=b2; C=c1; D=d1

// HPACK编码后的header entry
cookie: A=a1
cookie: B=b1
cookie: C=c1
cookie: D=d1
```
