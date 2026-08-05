---
title: WebSocket 学习笔记(2) 实现原理
date: 2026-08-04 14:54:12
categories:
- Tech
tags:
- golang
- websocket
- net
---


# WebSocket 学习笔记(2)  实现原理

本篇介绍WebSocket的具体实现逻辑.

使用代码如下:

``` go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	listenAddress     = "127.0.0.1:8080"
	heartbeatInterval = time.Second
	heartbeatTimeout  = 3 * time.Second
	heartbeatCheck    = 100 * time.Millisecond
	closeWait         = time.Second
)

type Message struct {
	Username string `json:"username"`
	Text     string `json:"text"`
}

// heartbeatState只保存内存状态，不依赖底层连接的deadline。
type heartbeatState struct {
	mu       sync.RWMutex
	lastSeen time.Time
	timedOut bool
}

// Gorilla要求同一时刻只能有一个协程写消息。
type messageWriter struct {
	mu        sync.Mutex
	closeOnce sync.Once
	closeErr  error
	conn      *websocket.Conn
}

func (w *messageWriter) write(messageType int, payload []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteMessage(messageType, payload)
}

// closeWebSocket先发送Close帧。只有对端未完成关闭握手时，才在等待期后
// 释放底层TCP连接，避免连接永久泄漏。
func (w *messageWriter) closeWebSocket(code int, reason string) error {
	w.closeOnce.Do(func() {
		w.closeErr = w.write(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(code, reason),
		)
		time.AfterFunc(closeWait, func() {
			_ = w.conn.Close()
		})
	})
	return w.closeErr
}

func newHeartbeatState() *heartbeatState {
	return &heartbeatState{lastSeen: time.Now()}
}

func (h *heartbeatState) touch() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastSeen = time.Now()
}

func (h *heartbeatState) expireIfNeeded() bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	if time.Since(h.lastSeen) < heartbeatTimeout {
		return false
	}
	h.timedOut = true
	return true
}

func (h *heartbeatState) didTimeOut() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.timedOut
}

var upgrader = websocket.Upgrader{}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// 响应客户端请求, 执行Upgrade行为, 切换到WebSocket协议
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	// 收到Pong后更新内存中的心跳时间
	writer := &messageWriter{conn: conn}
	heartbeat := newHeartbeatState()
	conn.SetPongHandler(func(data string) error {
		log.Printf("server received pong: %s", data)
		heartbeat.touch()
		return nil
	})

	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	go sendHeartbeat(writer, stopHeartbeat)
	go monitorHeartbeat("server", writer, heartbeat, stopHeartbeat)

	// 持续读取，并根据消息类型执行不同逻辑。
	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}

		switch messageType {
		case websocket.TextMessage:
			var message Message
			if err := json.Unmarshal(payload, &message); err != nil {
				log.Printf("invalid text message: %v", err)
				continue
			}
			log.Printf("server received text: %+v", message)
			if err := writer.write(websocket.TextMessage, payload); err != nil {
				return
			}
		case websocket.BinaryMessage:
			log.Printf("server received binary: %d bytes", len(payload))
			if err := writer.write(websocket.BinaryMessage, payload); err != nil {
				return
			}
		default:
			log.Printf("server ignored message type: %d", messageType)
		}
	}
}

func sendHeartbeat(writer *messageWriter, stop <-chan struct{}) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case heartbeatTime := <-ticker.C:
			data := heartbeatTime.Format(time.RFC3339)
			log.Printf("server sent ping: %s", data)
			if err := writer.write(websocket.PingMessage, []byte(data)); err != nil {
				return
			}
		case <-stop:
			return
		}
	}
}

func monitorHeartbeat(name string, writer *messageWriter, heartbeat *heartbeatState, stop <-chan struct{}) {
	ticker := time.NewTicker(heartbeatCheck)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if heartbeat.expireIfNeeded() {
				reason := fmt.Sprintf("heartbeat timeout after %s", heartbeatTimeout)
				log.Printf("%s %s, sending close frame", name, reason)
				if err := writer.closeWebSocket(websocket.ClosePolicyViolation, reason); err != nil {
					log.Printf("%s send close frame: %v", name, err)
				}
				return
			}
		case <-stop:
			return
		}
	}
}

func runClient() error {
	// 建立WebSocket连接
	conn, _, err := websocket.DefaultDialer.Dial("ws://"+listenAddress+"/ws", nil)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close()

	// 每次收到Ping都更新内存中的心跳时间并回复Pong
	writer := &messageWriter{conn: conn}
	heartbeat := newHeartbeatState()
	conn.SetPingHandler(func(data string) error {
		fmt.Printf("client received ping: %s\n", data)
		heartbeat.touch()
		return writer.write(websocket.PongMessage, []byte(data))
	})

	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	go monitorHeartbeat("client", writer, heartbeat, stopHeartbeat)

	// JSON是文本帧的内容，实际发送使用WriteMessage。
	payload, err := json.Marshal(Message{Username: "demo-clientttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt", Text: "hello websocket"})
	if err != nil {
		return err
	}
	if err := writer.write(websocket.TextMessage, payload); err != nil {
		return fmt.Errorf("send: %w", err)
	}

	// 持续读取，并根据消息类型执行不同逻辑。
	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			if heartbeat.didTimeOut() {
				return fmt.Errorf("heartbeat timeout: no ping for %s", heartbeatTimeout)
			}
			return fmt.Errorf("read: %w", err)
		}

		switch messageType {
		case websocket.TextMessage:
			var message Message
			if err := json.Unmarshal(payload, &message); err != nil {
				return fmt.Errorf("decode text message: %w", err)
			}
			fmt.Printf("client received text: %+v\n", message)
		case websocket.BinaryMessage:
			fmt.Printf("client received binary: %d bytes\n", len(payload))
		default:
			fmt.Printf("client ignored message type: %d\n", messageType)
		}
	}
}

func main() {
	http.HandleFunc("/ws", handleWebSocket)

	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		log.Fatal(err)
	}
	go http.Serve(listener, nil)

	log.Printf("WebSocket server started on %s", listenAddress)
	if err := runClient(); err != nil {
		log.Fatal(err)
	}
}

```



## WebSocket流程

上文demo涉及到的WebSocket流程可以大致分为3个部分: 握手阶段, 数据交换, 心跳监控, 以及过期后的断开连接. 下面分别进行介绍.



### 握手阶段

握手阶段的流程如下图所示:

![](handshake.png)

握手阶段有几个值得注意的地方:

1. WebSocket协议规定了Upgrade, Connection, Sec-Websocket-Version 3个HTTP头的固定值, 作为握手的请求头. 客户端和服务端均需要遵守固定值, 如果出现偏差则握手失败.
2. WebSocket协议规定了一个固定的字符串: **258EAFA5-E914-47DA-95CA-C5AB0DC85B11**. 这个字符串会参与双端对challenge key的校验计算, 如果校验失败则握手失败.
3. 对服务端而言, 监听的是http/https协议头, 而客户端发起连接请求使用的是ws/wss请求头, 这是由于底层websocket库做了处理.

握手成功后, 这条WebSocket连接就可以开始进行数据交换.



### 数据交换

数据交换的流程如下图所示:

![](data_transfer.png)

由于WebSocket消息不区分请求和响应, 因此客户端和服务端的读写流程几乎完全一致: 

1. 向WebSocket连接写入消息时, 依次写入FIN, opcode, MASK, 然后根据实际消息长度构造Payload Len字段, 然后产生32b 的Mask Key, 最后写入编码后的消息体;
2. 从WebSocket连接读取消息时按帧读取, 先读取头部2 Byte, 解析FIN, opcode, 然后解析Payload Len字段, 然后读取32b 的Mask Key, 最后读取消息体并解码后进行处理;



### 心跳监控

这里的demo构造了一个简单的心跳监控, 其流程如下图所示:

![](heartbeat.png)

WebSocket协议本身并不强制要求心跳监控, 因此Ping/Pong消息的处理由业务自己负责. 在这里的demo中, 我们在内存中维护了每条连接的活跃时间, 当心跳过期时连接被强制过期.



### 断开连接

在demo中, 任意一方检测到心跳超时后, 会主动断开WebSocket连接. 断连流程如下图所示:

![](close.png)

WebSocket的协议设计中存在2个点:

1. 当一方发送Close帧后, 这一方后续的写操作会被全部拒绝;
2. 当一方收到Close帧后, 这一方后续的读操作会被全部拒绝;

因此从协议的角度来说, 断连理论上应该要做一轮完整的Close握手. 但实际上很多实现中不会发送Close帧, 而是直接断开底层TCP连接, 因为实现更简单, 而断连阶段部分的数据包丢失通常来说也是可以接受的. 

此处demo中的断连流程仅供参考, 也并非标准的协议断连流程.
