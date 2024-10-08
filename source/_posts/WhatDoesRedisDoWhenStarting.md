---
title: Redis源码图解(15) Redis服务端在启动时做了什么(单机)
date: 2024-08-19 14:22:01
categories:
- Tech
tags:
- redis

---

# Redis单机服务端启动流程

在这里我们将服务进程启动的流程**按顺序**切分为数个**重要的子流程**, 分别进行描述. 

在此过程中仅介绍**个人认为**对理解Redis核心处理逻辑有帮助的流程.

## 静态配置初始化

Redis在源码中定义了一套静态默认配置, 在启动时将这一套配置写入内存. 部分如下图所示.

![](static_config.png)

![](static_config_2.png)

## 指令表初始化(Command Table)

Redis将所有可以处理的指令以**表**的格式定义在源码中, 在初始化时将指令表写入内存.

下图截取了部分Set命令的定义.

![](command_table.png)

## 注册Socket CT(Connection Type)

Redis将用于处理socket的函数集合称为ConnectionType. 在初始化过程中, Redis会注册TCP CT和Unix CT.

TCP CT的定义如下图所示, 包含了事件监听(后续介绍)、建立连接、读写socket等和连接相关的全部函数.

![](tcp_ct.png)

## 配置覆盖

如果在启动时指定了Redis配置文件, 或者在命令行输入了配置项, 这些后来的配置会覆盖前文中的同名配置.

## 修改Redis进程可使用的FD数量

在配置阶段, Redis默认配置可以打开的fd数量为10000, 在此时会调用setrlimit()尝试将进程的fd上限提高到10032. 如果不行, 就逐步递减, 直到可以设置成功. 

![](maxclients.png)

如果最后的结果是进程只能打开小于32个fd, 会报错终止进程.

## 创建AE事件总线

创建事件总线, 默认的事件最大容量为进程可使用fd数量+128(出于某种安全考量).

## 创建DB对象

以单机模式启动, 默认创建16个DB, 每个DB包含1个Dict用于存储数据, 1个Dict用于存储过期时间.

## 注册AE定时事件(1ms)

注册一个预期执行间隔为1ms的定时任务到事件总线.

这个事件负责Redis的大量定时操作, 其中包括对**过期数据的主动清理**:

1. 对过期的非Hash数据, 会直接从内存中剔除;
2. 对Hash中过期的某些field, 仅会删除其对应的过期元数据(Metadata), 在实际发生对这个field读写时才会将其从内存剔除;

## 启动Socket监听

根据配置指定的ip:port, 创建socket fd.

## 注册AE文件事件: Socket监听

将前面创建的socket fd注册进AE事件总线, 监听可读状态.

![](register_socket.png)

## 注册AE事件前置操作(Before Sleep)和后置操作(After Sleep)

注册2个函数进事件总线, 在真正进入事件循环后, 这2个函数作为kevent()系统调用的前置操作和后置操作被调用.

### 前置操作(Before Sleep)

这个函数主要进行了3个操作:

1. 处理因为开启多线程读而被推迟的读请求;
2. 落盘AOF数据;
3. 处理因为开启多线程写而被推迟的写请求;

如下图所示.

![](before_sleep.png)

### 后置操作(After Sleep)

包含一些无益于理解的操作, 这里不做描述.

## 创建系统后台线程

创建3个后台线程, 分别负责AOF相关操作, Lazy Free相关操作, 和Close File相关操作.

## 创建IO线程(Optional)

如果配置了io线程数>1, 此时会创建指定数量的线程. 线程数不能大于128.

IO子线程的核心逻辑为:

1. 查询自身的任务队列, 获取线程内没有处理完的任务;
2. 循环处理任务: 
	1. 如果是读, 则将数据从socket中读进内存后返回, 不处理命令; 
	2. 如果是写, 则将数据从内存缓冲写进socket后返回;

## 启动AE事件总线

至此, Redis初始化全部完成, 进入轮询内核获取激活kevent的循环. 循环流程参考上一篇的图示.
