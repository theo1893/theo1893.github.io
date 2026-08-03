---
title: WebSocket 学习笔记(1) 协议实现
date: 2026-07-31 16:09:13
categories:
- Tech
tags:
- golang
- websocket
- net
---


# WebSocket 学习笔记(1)  协议设计

WebSocket[初版协议](https://datatracker.ietf.org/doc/html/rfc6455)于2011年被提出, 其设计目的主要是解决HTTP 1.x无法双向通信的问题. 相较于HTTP协议, WebSocket充分利用了TCP的全双工能力, 支持同时双向数据包传输.

下面从建立连接和数据包2个方面分别进行描述.



## WebSocket握手

WebSocket在设计之初, 是为了替代当时市面上使用HTTP轮询来实现双向通信的方案, 因此其在设计上和HTTP高度兼容: WebSocket的默认端口和HTTP服务一致(80/443), 并且在连接握手阶段使用HTTP报文进行传输.

假设客户端向服务端发起握手请求, 其发送的HTTP报文可能如下:

``` http	
GET /wss HTTP/1.1
Host: theo.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Protocol: chat, superchat
Sec-WebSocket-Version: 13
```

其中有一些协议规定的固定字段: Upgrade固定填写**websocket**, Connection固定填写**Upgrade**, Sec-WebSocket-Version固定填写**13**.

Sec-WebSocket-Key由客户端随机生成, 服务端收到后会进行处理后返回Sec-Websocket-Accept字段, 客户端通过校验此返回字段来实现challenge.

服务端收到握手请求后, 返回的HTTP报文可能如下:

``` http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

只有:

1. 收到服务端返回响应101;

2. Upgrade字段为**websocket**;

3. Connection字段为**Upgrade**;

4. Sec-WebSocket-Accept校验无误;

以上4个条件全部满足时, 客户端才应该认为本次握手成功. 在握手完成后, 客户端/服务端就可以以数据帧的格式读写连接.



## 帧

WebSocket的帧结构定义如下图所示:

![](ws_frame_intro.png)

各个结构定义如下表:

|  字段  |  长度  |  描述  |
| ---------- | ---------- | ---------- |
|    FIN        |   1 bit         |   标记这条Frame是否已经传输完毕,和数据分片有关         |
| RSV1 | 1 bit | 保留位, 留给扩展功能使用 |
| RSV2 | 1 bit | 保留位, 留给扩展功能使用 |
| RSV3 | 1 bit | 保留位, 留给扩展功能使用 |
| opcode | 4 bit | 标记这条Frame的类型 |
| MASK | 1 bit  | 标记这条Frame的payload是否被masking. 所有客户端Frame必须置为1 |
| Payload length | 7 bit / 7+16 bit / 7+64bit | 变长字段. 描述Payload的长度|
| Masking-key | 0 bit / 32 bit | 变长字段. 用作masking的值 |
| Payload Data | N bit | 变长字段. Frame的数据荷载 |

### 帧类型

WebSocket帧中使用长为4 bit的opcode字段来表示帧的类型, 其枚举如下表:

| 值 | 类型 |
| ---------- | ---------- |
| 0x0 | 标记是continuation帧, 是某个被分片的帧的一部分 |
| 0x1 | 标记是text帧 |
| 0x2 | 标记是binary帧 |
| 0x8 | 标记是close帧 |
| 0x9 | 标记是ping帧 |
| 0xA | 标记是pong帧 |

#### 数据帧

数据帧是opcode=0x0/0x1/0x2的帧.

##### 文本帧

文本帧的opcode=1, 其中的数据是UTF=8编码的文本数据.

##### 二进制帧

二进制帧的opcode=2, 其中的数据完全由应用进行解释, 协议不做任何限制.

##### 中间帧

中间帧的opcode=0, 表示这个帧是某个更大的数据帧的子帧.



#### 控制帧

控制帧是opcode=0x8/0x9/0xA的帧.

##### 断连帧

断连帧(Close)是opcode=0x8的帧, 用于关闭这条WebSocket连接. 如果一方收到了Close帧, 这意味着两件事:

1. 对方不会再推送新的帧过来;
2. 在此之后我方推送的帧, 对方不保证处理;

因此在一方收到Close帧后, 需要尽快发送Close帧作为响应. 当且仅当连接双方都发送/接收到Close帧后, 连接双方才能安全关闭连接.

另外, Close帧可以携带状态码(Status Code)和断连原因(Reason).

| 状态码 | 语义 |
| --  | -- |
| 1000 | 正常关闭 |
| 1001 | 服务器宕机 or 浏览器跳到其他页面而中断连接 |
| 1002 | 由于协议错误而中断连接 |
| 1003 | 应用层收到了自己无法处理的数据包而中断连接 |
| 1004 | 保留 |
| 1005 | 表示无状态码 |
| 1006 | 连接被异常关闭, 比如没有收到/发送close帧就关闭 |
| 1007 | 由于收到和帧类型不符的数据, 比如text帧里是非UTF-8数据 |
| 1008 | 通用错误码, 不知道用什么就用这个 |
| 1009 | 由于收到了过大的单条消息而中断连接 |
| 1010 | 客户端希望协商插件, 但服务端没有返回, 因此中断连接 |
| 1011 | 服务器出现异常, 中断连接 |
| 1015 | TLS握手阶段失败的错误码 |




##### 心跳帧(Ping/Pong)

Ping/Pong帧是opcode=0x9和0xA的帧, 没有实际业务含义, 通常被用在心跳流程中.

Ping帧可以在帧中携带部分数据, 而当接收方收到后, 必须在Pong帧中携带完全一致的数据作为响应.



### 数据长度

Payload len字段表示Payload Data的字节数, 其遵守如下规则:
1. 如果Payload Data长度 < 126, 则Payload len占用7 bit.
2. 如果 126 <= Payload Data长度 < 655356, 则Payload len总共占用23 bit, 前7 bit固定为126, 后16 bit用于表示长度.
3. 如果 65536 <= Payload Data长度 < 18446744073709551615, 则Payload len总共占用71 bit, 前7 bit固定为127, 后64 bit用于表示长度.

因此Payload len为变长字段, 请求接收方需要根据Payload len的前7 bit决定如何读取数据.

### 分片

WebSocket协议支持对Data Frame的分片, **不支持**对Control Frame的分片.

如果Data Frame被分片, 其帧的FIN字段和opcode的情况如下图所示:

![](fragmentation.png)

首帧的opcode决定帧的类型是text还是binary; 中间帧的opcode保持为continuation(0); 尾帧的FIN为1, 决定分片的结束.



