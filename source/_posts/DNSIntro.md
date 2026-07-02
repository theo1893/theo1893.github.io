---
title: DNS 学习笔记(1) 架构设计
date: 2026-07-01 10:22:46
categories:
- Tech
tags:
- golang
- dns
- net
---

# DNS 学习笔记(1) 架构设计



DNS由3个主要部分构成: Domain Name Space and Resource Records, Name Server, 以及 Resolver. 下面分别介绍.



## Domain Name Space and Resource Records

在互联网发展早期, 由于整个网络内的联网设备数量较低, 因此从主机名(Host Name)到IP地址的映射是通过一个**HOSTS.TXT**文本文件, 通过FTP协议在所有设备间传输, 来进行维护的. 然而随着联网设备数量的增加, 这种交互方式既无法适配越来越复杂的应用场景, 也会对网络整体产生非常大的流量负载(和联网设备数成平方增长). 因此DNS协议在1987年被正式提上RFC.

DNS协议重新设计了资源(Resource Record)和域名(Domain Name)的映射关系和维护关系.

具体而言, DNS将整个网络的域名空间设想为一个树状空间. DNS按照 **.** 拆分域名, 将每个域名映射到这个树状空间中的一个节点. 所有域名均来源自一个根节点, 其长度为0. 下面展示了一组域名, 以及这些域名在域名空间中形成的树状结构. 需要注意的是, 由于根节点的长度为0, 因此在实际使用中, 一般会省略域名最后的 **.** , 即 **A.B.C.** 和 **A.B.C** 等价.

``` 
BRL.MIL
NOSC.MIL
DARPA.MIL

IN-ADDR.ARPA
SRI-NIC.ARPA
ACC.ARPA

UCI.EDU
XX.LCS.MIT.EDU
ACHILLES.MIT.EDU

A.ISI.EDU
C.ISI.EDU
VAXA.ISI.EDU
VENERA.ISI.EDU
Mockapetris.ISI.EDU

UDEL.EDU
YALE.EDU
```

![](domain_space.png)

域名空间中的每个节点, 均可以和一组资源(Resource Record)绑定, 不同的资源有不同的类型.

以互联网中的经典场景为例, 我们希望知道域名X对应的实际IPv4地址, 则查询域名X这个节点的**A类型**的Resource Record即可.



#### Resource Record

Resource Record是和节点绑定的资源记录, 其由5个部分组成, 格式如下所示:

![](resource_record.png)



#### type

type标记这条RR的类型, 其可选值如下表:

| 类型  | 语义                                                         |
| ----- | ------------------------------------------------------------ |
| A     | 主机IPv4地址                                                 |
| CNAME | 域名的别名                                                   |
| HINFO | 主机的CPU和OS信息                                            |
| MX    | 指向负责这个域名的邮件交换地址                               |
| NS    | 负责这个域名的Name Server                                    |
| PTR   | 指向域名空间的其他分支. 常见用法是实现从IP地址到域名的逆向映射. |
| SOA   | 标记一个权威Zone的起始                                       |



#### class

class标记这条RR的网络类型, 其可选值如下表:

| 类型 | 语义       |
| ---- | ---------- |
| IN   | 因特网系统 |
| CH   | 混沌系统   |



#### RDATA

RDATA携带这条RR的具体数据, 不同的type和class有着不同的RDATA格式, 如下表所示:

| 类型  | 语义                                                         |
| ----- | ------------------------------------------------------------ |
| A     | 因特网中的32位IPv4地址                                       |
| CNAME | 域名地址                                                     |
| MX    | 1个16位的偏好值(越小越偏好) + 1个负责查询域名邮件交换的邮件域名地址 |
| NS    | 主机地址                                                     |
| PTR   | 域名地址                                                     |
| SOA   | 很多字段                                                     |



#### RR 示例

下面展示了几条示例RR.

``` 
EDU.    86400   NS      SRI-NIC.ARPA.
EDU.    86400   NS      C.ISI.EDU.

SRI-NIC.ARPA.   A       26.0.0.73
SRI-NIC.ARPA.   A       10.0.0.51
SRI-NIC.ARPA.   MX      0 SRI-NIC.ARPA.
SRI-NIC.ARPA.   HINFO   DEC-2060 TOPS20
```



## Name Server

Name Server是存储有域名树状结构关系, 以及相关Resource Record的服务器实例. 一般来说, 每个Name Server会负责域名空间中从某个节点开始的整个子分支, 还会记录有指向部分其他Name Server的信息, 用于在接收到自己无法处理的请求时, 指引用户向更接近目的节点的方向查询.

对其负责的子分支而言, 这台Name Server被定义为权威服务器(Authotiry), 而由其负责的Resource Record会被划分为名为Zone的资源单位, 方便进行管理. 每个Zone包含一组Resource Record, 对用户透明.

下图在上文的基础上, 增加了7台Name Server的分配, Name Server和所管理子分支之间用虚线关联.

```  
root Authority
C.ISI.EDU
SRI-NIC.ARPA
A.ISI.EDU

MIL Authority
SRI-NIC.ARPA
A.ISI.EDU

EDU Authority
SRI-NIC.ARPA
C.ISI.EDU

MIT.EDU Authority
XX.LCS.MIT.EDU
ACHILLES.MIT.EDU

ISI.EDU Authority
VAXA.ISI.EDU
VENERA.ISI.EDU
A.ISI.EDU
```

![](name_server.png)



## Resolver

Resolver是发起DNS请求并解析响应的应用程序, 后续将单独介绍.
