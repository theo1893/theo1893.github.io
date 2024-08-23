---
title: Redis源码图解(9) 高级类型String
date: 2024-08-14 17:50:12
categories:
- Tech
tags:
- redis

---

# String

String是Redis的高级类型之一, 是Redis中用于表达字符串数据的类型.  String在Redis内部的一个典型应用为: 服务器从TCP收到的原始请求均会被转化为String对象.

String存在3种编码:

OBJ_ENCODING_EMBSTR, 用于存储小于44B的字符串, 在内存中是一整块连续的空间;

OBJ_ENCODING_INT, 用于存储可以用整型表示的字符串, 通常用于内存压缩;

OBJ_ENCODING_RAW, 不满足上述编码时, 使用此通用编码, 在内存中由分开的ROBJ和SDS构成;

3种编码的内存模式如下图所示.

![](string_memory.png)



String的大小限制默认为512MB, 限制发生在以下2种场景:

1. Redis Server从TCP获取到指令构造String对象时, 指令长度不能大于512MB;
2. 对String对象操作导致长度增加, 最终长度不能大于512MB;
