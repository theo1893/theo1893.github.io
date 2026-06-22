---
title: HTTP/2 源码图解(1) HTTP/2 流与帧
date: 2026-04-30 10:22:46
categories:
- Tech
tags:
- golang
- http
---

# HTTP/2 流与帧

由于HTTP/1.x的协议设计中限制了单个TCP连接在同一时间只能处理1个请求, 因此其天然存在队首阻塞(Head-Of-Line Blocking)的问题. 为了解决这一问题, 提高连接的并发利用率, HTTP/2重新设计了TCP连接的使用方式, 提出了流与帧的概念.



## 流(Stream)

这里我们先回顾一下HTTP/1.x的TCP连接使用方式, 下图展示了1个HTTP/1.x请求发起时, 连接池的变化.

![](http1_tcp_pool.png)

从图中可见, HTTP/1.x会为每个请求分配独占的TCP连接, 直到请求结束才会被归还到连接池. 这导致了2个问题:

1. 在短时间内的对相同域名的访问, 可能会触发大量的TCP连接建立;
2. 如果下游服务响应时间过长, 在这段时间内此TCP连接被空占用, 没有传输任何有效负载;

造成上述问题的是同一个原因: HTTP/1.x不支持TCP连接的多路复用. 

为了解决这些问题, HTTP/2重新设计了协议, 引入了Stream的概念. HTTP/2的TCP连接使用方式如下图所示.

![](http2_tcp_pool.png)

尽管仍然存在连接池, 但HTTP/2在请求发起时并不会将TCP从池子中拿出. HTTP/2会遍历指定域名的可用TCP连接, 检查此连接**是否有能力承载新的请求**. 如果连接未达到设置的负载上限, 此时会创建一条新的Stream与此TCP连接绑定, 本次请求由这条Stream负责处理.

在这个例子中, 查询到的TCP连接正在处理3条Stream, 由于没有到达处理上限, 因此新的请求会在此连接上创建Stream7, 在请求结束后将Stream7与TCP连接解绑.



## 帧(Frame)

Frame是HTTP/2的另一个核心概念. HTTP/2将HTTP/1.x里的整个请求体/响应体拆分为了粒度更小的Frame, 不同的Frame承担不同的职责.

Frame的结构如下图所示, 其由固定的2个部分组成: 长度为9Byte的帧头, 以及变长的帧负荷.

![](frame_structure.png)

需要注意的是, [RFC文档](https://datatracker.ietf.org/doc/html/rfc7540#autoid-12)使用的是上图的上半部分作为描述, 但实际上在Flags后紧跟着就是保留位, 中间没有额外的填充字节, 因此在网络中实际传输的字节流如上图下半部分所示.

接下来对不同的Frame分别进行介绍.



### Data Frame

Data Frame用于传输具体的应用数据, 对应Frame Type = 0x0. Data Frame的结构如下图所示

![](data_frame.png)

Padding最初被设计用于防止网络攻击, [相关章节](https://datatracker.ietf.org/doc/html/rfc7540#section-10.7).



#### Flags

Data Frame的可选标记如下表所示.

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagDataEndStream | 0x1   | 标记Stream结束(即后续不会有更多的Frame) |
| FlagDataPadded    | 0x8   | 标记此Frame是否存在填充字节                   |



### Header Frame

Header Frame用于建立一条Stream, 并用于传输HTTP Headers. Header Frame的Frame Type = 0x1, 对应的结构如下图所示:

![](header_frame.png)



#### Flags

Header Frame的可选标记如下表所示.

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagHeaderEndStream | 0x1   | 标记Stream结束 |
| FlagHeaderEndHeaders | 0x4   | 标记Header结束(Header传输完毕, 后续不会出现Continuation Frame) |
| FlagHeaderPadded | 0x8   | 标记此Frame是否存在填充字节                   |
| FlagHeadersPriority    | 0x20   | 和Stream优先级/依赖相关的标记. 如果置为1, 则表示上图中的E, Stream Dependency, Weight 3个字段有效  |



### Priority Frame

Priority Frame用于在一条Stream中指定优先级, 单独的帧和Header Frame中携带的帧效果一致. Priority Frame的Frame Type = 0x2, 其对应的结构如下图所示:

![](priority_frame.png)



#### Flags

Priority Frame不支持标记.



### RstStream Frame

RstStream Frame用于关闭一条Steram, 其Frame Type = 0x3, 结构如下图所示:

![](rst_frame.png)

错误码参考[文档](https://datatracker.ietf.org/doc/html/rfc7540#section-7).



#### Flags

RsgStream Frame不支持标记.



### Settings Frame

Setting Frame用于指定连接相关的一些配置. 协议规定双端在建立连接时必须发送一轮Setting Frame, 后续在任意时刻都可以发送Setting Frame. 

Setting Frame是双向通信, 发送方向接收方发送帧后, 接收方需要向发送方响应带有Ack的Setting Frame帧.

Setting Frame的Frame Type = 0x3, 结构如下图所示:

![](setting_frame.png)

Setting Frame是连接维度的数据包, 不和Stream绑定, 因此Steram Identifier固定为0.



#### Settings

[协议](https://datatracker.ietf.org/doc/html/rfc7540#autoid-41)规定了可选的Setting ID, 如下表所示:

| Identifier | Value | Meaning |
| :--- | :--- | :--- |
| HeaderTableSize | 0x1 | 指定Hpack算法中动态表的最大可行字节数, 默认4096. |
| EnablePush | 0x2 | 指定是否开启Server Push. |
| MaxConcurrentStreams | 0x3 | Setting Frame发送方允许的此连接上的最大Stream数量. 默认无限制. |
| InitialWindowSize | 0x4 | Setting Frame发送方告知对方自己的Stream初始窗口大小, 流量控制相关. 默认为65535, 最大不超过2^31-1. |
| MaxFrameSize | 0x5 | 发送方告知对方自己期望收到的最大Frame字节数. 默认为16384. 最大不超过2^24-1. |
| MaxHeaderListSize | 0x6 | 发送方告知对方自己期望收到的最多Header字节数.  默认是16MB. |


#### Flags

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagSettingAck | 0x1   | 接收方回复发送方Ack, 此后新的Setting生效 |



### PushPromise Frame

PushPromise Frame是服务端推送用到的帧. 当服务端打算发起主动推送时, 服务端会向客户端发送PushPromise Frame, 告知自己即将在指定Stream上推送数据. PushPromise Frame的Type = 0x5, 其结构如下:

![](pushpromise_frame.png)

需要注意的是,<span style="color:red">截止2026.04.15, 市面上基本已经不存在支持Server Push的Client</span> , 因此这里记录仅用作学习.



#### Flags

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagPushPromiseEndHeaders | 0x4   | 标记Header传输完毕, 后续不会出现Continuation Frame |
| FlagPushPromisePadded | 0x8   | 标记是否包含Padding数据 |






### Ping Frame

Ping Frame用于探测RT, 同时也用于探测一条Idle状态的TCP连接是否可用. Ping Frame的Type=0x6, 其结构如下:

![](ping_frame.png)

Ping Frame不与任何Stream绑定, 因此其Steram Identifier总为0.

另外, Ping Frame是双向通信: A向B发送Ping Frame后, B需要使用相同的payload, 向A回复携带ACK的Ping Frame, 完成一轮通信.



#### Flags

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagPingAck | 0x1   | 标记这个Ping帧是响应前一条Ping的帧 |



### GoAway Frame

GoAway Frame用于优雅关闭TCP连接. GoAway Frame的荷载包含一个Stream Id, 其含义为: 所有大于此Stream ID的Stream将不再处理, 所有不超过此Stream ID的Stream会处理完成.

GoAway Frame的Type=0x7, 其结构如下:

![](goaway_frame.png)

同样的, GoAway Frame不与任何Stream绑定, 其Stream Identifier总为0. 错误码参考[文档](https://datatracker.ietf.org/doc/html/rfc7540#section-7).



#### Flags

GoAway Frame不支持标记.



### WindowUpdate Frame

WindowUpdate Frame用于通信双方控制二者间的流量窗口.

WindowUpdate Frame的Type=0x8, 其结构如下:

![](windowupdate_frame.png)

需要注意的是, HTTP2的流量控制既可以发生在Connection维度, 也可以作用在Stream维度. 在实现中, 如果WindowUpdate Frame的Stream Identifier为0, 则标记这次窗口变更发生在Connection; 否则, 则这次窗口变更发生在指定的Stream.



#### Flags

WindowUpdate Frame不支持标记.





### Continuation Frame

Continuation Frame用于传输无法在一个Header Frame / PushPromise Frame内传输完毕的HTTP Headers分片.

Continuation Frame的Type=0x9, 其结构如下:

![](continuation_frame.png)



#### Flags

Header Frame的可选标记如下表所示.

| Flag              | Value | Meaning                                       |
| :---------------- | :---- | :-------------------------------------------- |
| FlagHeaderEndHeaders | 0x4   | 标记Header结束(Header传输完毕, 后续不会出现Continuation Frame) |
