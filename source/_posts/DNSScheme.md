---
title: DNS 学习笔记(2) 协议设计
date: 2026-07-02 18:54:23
categories:
- Tech
tags:
- golang
- dns
- net
---


# DNS 学习笔记(2) 协议设计

本章介绍DNS协议的详细设计.



## Resource Record

Resource Record是DNS协议中负责传输数据的数据结构. 其传输结构如下图所示:

![](resource_record.png)



下面对RR的各个部分进行介绍.



### TYPE枚举

TYPE表示RR的数据类型, 其协议枚举如下表所示:

| TYPE  | 值(Dec) | 语义                                     |
| ----- | ------- | ---------------------------------------- |
| A     | 1       | IPv4地址                                 |
| NS    | 2       | Authoritative Name Server                |
| CNAME | 5       | 别名                                     |
| SOA   | 6       | 标记一个权威域(zone of authority)的开始  |
| WKS   | 11      | 用于描述共识服务(well known service)的RR |
| PTR   | 12      | 指向其他域名                             |
| HINFO | 13      | 主机信息, 包含CPU和OS信息                |
| MX    | 15      | 邮件交换域名                             |
| TXT   | 16      | 纯文本数据                               |



### CLASS枚举

CLASS表示RR的网络类型, 其协议枚举如下表所示, 在现代互联网场景下固定为1.

| TYPE | 值(Dec) | 语义     |
| ---- | ------- | -------- |
| IN   | 1       | 因特网   |
| CH   | 3       | 混沌网络 |



### RDATA

RDATA是RR中的有效负载, 承载了RR的具体数据. 下面分别对不同类型的RDATA进行记录.



#### CNAME

CNAME类型的RR仅包含一个别名字符串, 其结构如下图所示:

![](cname.png)



#### HINFO

HINFO类型的RR包含CPU和OS两个部分的描述, 其结构如下图所示:

![](hinfo.png)



#### MX

MX的RDATA由两个部分组成:

1. 定长16b的偏好系数. 系数越小表示指定的邮件交换主机越好(preferred).
2. 变长的字符串, 指向指定的邮件交换主机.

其结构如下图所示:

![](mx.png)



#### NS

NS类型包含一个字符串, 指向查询域名的Authoritative Name Server, 其结构如下图所示:

![](ns.png)



#### PTR

PTR的RDATA包含一个字符串, 指向另一个域名, 通常被用于逆向域名解析(IP -> Domain), 其结构如下图所示:

![](ptr.png)



#### SOA

SOA的RDATA包含一组和Name Server维护相关的数据, 用户基本不感知, 其结构如下图所示:

![](soa.png)



#### TXT

TXT存储了一些描述性文本, 其结构如下图所示:

![](txt.png)



#### A

A类型专指互联网中的IPv4地址记录, 其结构如下图所示:

![](a.png)



#### WKS

WKS记录用于描述一个特定的地址对某些特定服务的支持. 其结构如下图所示:

![](wks.png)

PROTOCOL是协议枚举, \<BIT MAP\>是对应的端口号, 比如PROTOCAL=6表示此地址支持TCP协议, 同时\<BIT MAP\>的第26个位被置为1, 表示25号端口可以支持TCP协议, 而25号被专门用于SMTP服务, 因此这条WKS的意思是: 这个地址支持SMTP服务.

PROTOCOL和\<BIT MAP\>的可取枚举参考[RFC 1010](https://www.rfc-editor.org/info/rfc1010/). 



### IN-ADDR.ARPA.

DNS协议中有一个特殊的域名IN-ARRD.ARPA. 用于查询从IP到域名的逆向映射.

对IP为a.b.c.d, 域名为EXAMPLE.XX的主机而言, 其逆向映射的RR如下所示:

``` 
d.c.b.a.IN-ARRD.ARPA.		PTR		EXAMPLE.XX.
```



## DNS Message

DNS Message是DNS协议在网络中的完整数据包. Resolver和Name Server发生通信时, DNS请求和DNS响应均使用此数据结构, 其由5个部分组成: Header, Question, Answer, Authority, Additional. 其中Answer是一批Resource Record的集合, 表示本次DNS请求的回复数据.

接下来对其中主要的3个部分: Header, Question, Answer进行介绍.



### Header

Header固定长度12Byte, 其结构如下图所示:

![](header.png)



### Question

Question用于携带DNS查询的目标, 其结构如下图所示:

![](question.png)

图中展示了域名 **www.theo1893.com** 被编码到QNAME字段后的字节流.





### Answer (Resource Record)

RR表示实际获取的数据, 其结构如下图所示:

![](rr_scheme.png)





## 消息压缩

为了降低DNS的网络负载, DNS协议在设计上引入了压缩机制. 如果一个域名字符串在一条DNS消息中多次出现(事实上由于DNS域名的后缀树结构, 重复后缀非常常见), 则仅在第一次出现时进行完整的记录, 后续出现均以**引用**的形式进行处理.

具体而言, 每个引用固定长度2B, 最高的2b固定为11, 剩下的14b用于表示引用字符串在DNS消息中的起始位置.

下图展示了一条DNS消息中出现的域名引用, 其中总共涉及3个域名: F.ISI.ARPA. , FOO.ARPA. , ARPA.

![](message_compress.png)
